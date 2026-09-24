const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../supabase');
const { authMiddleware } = require('../middleware/auth');

// --- ЛОГГЕР С IP И ДЕТАЛЯМИ ---
router.use((req, res, next) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [IP: ${ip}] ${req.method} ${req.originalUrl}`);
    next();
});

router.use(authMiddleware);

// --- 0.1. ПОЛУЧЕНИЕ ПРОФИЛЯ С ТЕКУЩЕЙ РОЛЬЮ ---
router.get('/profile', (req, res) => {
    res.json({
        id: req.user.id,
        email: req.user.email,
        role: req.user.role || 'employee',
        organization_id: req.user.organization_id
    });
});

// --- ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ПЕРЕСЧЕТА ---
async function recalculateDocTotal(doc_id) {
    try {
        const { data: works } = await supabaseAdmin
            .from('est_doc_works')
            .select('amount')
            .eq('doc_id', doc_id)
            .eq('is_excluded', false);

        const directCosts = (works || []).reduce((sum, w) => sum + Number(w.amount || 0), 0);
        const { data: coeffs } = await supabaseAdmin.from('est_coefficients').select('value_percent').eq('doc_id', doc_id);
        const coeffsTotal = (coeffs || []).reduce((sum, c) => sum + (directCosts * Number(c.value_percent) / 100), 0);
        const grandTotal = directCosts + coeffsTotal;

        await supabaseAdmin.from('est_documents').update({ total_amount: grandTotal }).eq('id', doc_id);
        console.log(`[RECALC] Doc ${doc_id}: directCosts=${directCosts}, coeffsTotal=${coeffsTotal}, grandTotal=${grandTotal}`);
    } catch (err) {
        console.error(`[CALC ERROR] [Doc: ${doc_id}]:`, err.message);
    }
}

// --- Сохранение корректировок объемов/ресурсов/коэффициентов, внесенных утверждающим (фин.директором) ---
// перед решением по плановой версии (утверждение или отклонение) — BR-04
async function saveApproverCorrections(docId, { works, resources, coefficients }) {
    if (!(works && Array.isArray(works) && works.length > 0)) return;

    const worksToUpsert = works.map(work => {
        if (!work) return null;
        const factVolume = work.fact_volume != null && work.fact_volume !== '' ? Number(work.fact_volume) : null;
        return {
            id: work.id,
            doc_id: docId,
            wbs_id: work.wbs_id,
            work_id: work.work_id,
            volume: work.volume,
            price: work.price || 0,
            amount: work.amount || 0,
            fact_volume: factVolume,
            fact_amount: work.fact_amount != null && work.fact_amount !== '' ? Number(work.fact_amount) : null,
            is_excluded: work.is_excluded || false
        };
    }).filter(Boolean);

    if (worksToUpsert.length > 0) {
        const { error: worksErr } = await supabaseAdmin.from('est_doc_works').upsert(worksToUpsert);
        if (worksErr) throw worksErr;
    }

    if (resources && Array.isArray(resources) && resources.length > 0) {
        const resourcesToUpsert = resources.map(res => {
            if (!res) return null;
            const factNorm = res.fact_norm != null && res.fact_norm !== '' ? Number(res.fact_norm) : null;
            const factQuantity = res.fact_quantity != null && res.fact_quantity !== '' ? Number(res.fact_quantity) : null;
            const factPrice = res.fact_price != null && res.fact_price !== '' ? Number(res.fact_price) : null;
            const factAmount = res.fact_amount != null && res.fact_amount !== ''
                ? Number(res.fact_amount)
                : (factQuantity != null && factPrice != null ? factQuantity * factPrice : null);
            return {
                id: res.id,
                doc_id: docId,
                work_id: res.work_id,
                resource_id: res.resource_id,
                norm: res.norm,
                quantity: res.quantity,
                price: res.price || 0,
                amount: res.amount || 0,
                source: res.source || null,
                fact_norm: factNorm,
                fact_quantity: factQuantity,
                fact_price: factPrice,
                fact_amount: factAmount,
                is_excluded: res.is_excluded || false
            };
        }).filter(Boolean);

        if (resourcesToUpsert.length > 0) {
            const { error: resErr } = await supabaseAdmin.from('est_doc_resources').upsert(resourcesToUpsert);
            if (resErr) throw resErr;
        }
    }

    if (coefficients && Array.isArray(coefficients) && coefficients.length > 0) {
        const coeffsToUpsert = coefficients.map(c => {
            if (!c) return null;
            return {
                id: c.id,
                doc_id: docId,
                name: c.name,
                type: c.type || 'overhead',
                value_percent: c.value_percent
            };
        }).filter(Boolean);
        if (coeffsToUpsert.length > 0) {
            const { error: coeffsErr } = await supabaseAdmin.from('est_coefficients').upsert(coeffsToUpsert);
            if (coeffsErr) throw coeffsErr;
        }
    }

    await recalculateDocTotal(docId);
}

// --- ПРОВЕРКА БЛОКИРОВКИ СМЕТЫ (РАБОЧЕЙ ИЛИ ПЛАНОВОЙ/ФАКТИЧЕСКОЙ) ---
async function checkIfDocLocked(docId) {
    if (!docId) return false;
    try {
        const { data: doc } = await supabaseAdmin
            .from('est_documents')
            .select('id, status, estimate_type')
            .eq('id', docId)
            .maybeSingle();
        if (!doc) return false;

        const estType = doc.estimate_type || 'work';

        // 1. Плановая версия сметы
        if (estType === 'planned') {
            // Плановую смету в статусе 'planned_approved' или 'planned_inactive' редактировать нельзя
            if (doc.status === 'planned_approved' || doc.status === 'planned_inactive') {
                return true;
            }
            const { data: actuals } = await supabaseAdmin
                .from('est_documents')
                .select('id')
                .eq('parent_doc_id', docId)
                .eq('estimate_type', 'actual')
                .limit(1);
            if (actuals && actuals.length > 0) return true;

            return false;
        }

        // 2. Фактическая версия сметы
        if (estType === 'actual') {
            // Можно редактировать только в статусе 'actual_formed'
            if (doc.status !== 'actual_formed') return true;
            return false;
        }

        // 3. Рабочая версия сметы (work)
        // Блокируем, если есть активные плановые версии
        const { data: activePlans } = await supabaseAdmin
            .from('est_documents')
            .select('id')
            .eq('parent_doc_id', docId)
            .eq('estimate_type', 'planned')
            .in('status', ['planned_formed', 'planned_review', 'planned_approved'])
            .limit(1);
        if (activePlans && activePlans.length > 0) return true;

        // Блокируем, если есть фактическая версия (которая строится по цепочке через плановую)
        const { data: plans } = await supabaseAdmin
            .from('est_documents')
            .select('id')
            .eq('parent_doc_id', docId)
            .eq('estimate_type', 'planned');
        if (plans && plans.length > 0) {
            const planIds = plans.map(p => p.id);
            const { data: actuals } = await supabaseAdmin
                .from('est_documents')
                .select('id')
                .in('parent_doc_id', planIds)
                .eq('estimate_type', 'actual')
                .limit(1);
            if (actuals && actuals.length > 0) return true;
        }

        return false;
    } catch (e) {
        console.error('[checkIfDocLocked error]:', e);
        return false;
    }
}

/** Сопоставляет temp_* ID с реальным UUID из карты; не передаёт temp_* в PostgreSQL */
function resolveMappedId(id, map, label = 'id') {
    if (!id) return null;
    const sid = String(id);
    if (sid.startsWith('temp_')) {
        const resolved = map[sid];
        if (!resolved) {
            throw new Error(
                `Временный ${label} "${sid}" не сопоставлен с записью в БД. ` +
                'Перезагрузите страницу и нажмите «Сохранить изменения» снова.'
            );
        }
        return resolved;
    }
    return sid;
}

async function getLatestResourcePrice(resourceId, regionId, currencyId, cache = {}) {
    const key = `${resourceId}_${regionId || 'default'}_${currencyId || 'default'}`;
    if (cache[key] !== undefined) return cache[key];

    // Check if the resource is from Baku CAS tables
    const [labor, machine, material] = await Promise.all([
        supabaseAdmin.from('Labor_cas').select('price').eq('id', resourceId).single(),
        supabaseAdmin.from('Machine_cas').select('price').eq('id', resourceId).single(),
        supabaseAdmin.from('Materials_cas').select('price').eq('id', resourceId).single()
    ]);
    const foundRow = labor.data || machine.data || material.data;
    if (foundRow) {
        const price = Number(foundRow.price || 0);
        cache[key] = price;
        return price;
    }

    let query = supabaseAdmin
        .from('resource_prices')
        .select('price')
        .eq('resource_id', resourceId)
        .eq('is_active', true);
    
    if (regionId) query = query.eq('region_id', regionId);
    if (currencyId) query = query.eq('currency_id', currencyId);

    query = query.order('valid_from', { ascending: false }).limit(1);

    const { data: prices } = await query;
    let price = Number(prices?.[0]?.price);
    
    // Fallback if specific regional price not found:
    if (isNaN(price)) {
        const { data: fallbackPrices } = await supabaseAdmin
            .from('resource_prices')
            .select('price')
            .eq('resource_id', resourceId)
            .eq('is_active', true)
            .order('valid_from', { ascending: false })
            .limit(1);
        price = Number(fallbackPrices?.[0]?.price || 0);
    }

    cache[key] = price;
    return price;
}

// --- ОРИГИНАЛЬНЫЙ ТЕСТОВЫЙ ЭНДПОИНТ ---
router.get('/all-test', async (req, res) => {
    try {
        let allowedRegionIds = null;
        if (req.user.role !== 'admin') {
            const { data: userRegs } = await supabaseAdmin
                .from('profile_regions')
                .select('region_id')
                .eq('profile_id', req.user.id);
            allowedRegionIds = (userRegs || []).map(r => r.region_id);
        }

        const { data } = await supabaseAdmin
            .from('est_documents')
            .select(`
                *,
                projects:project_uuid (id, name, code, region_id, is_active),
                project_objects:object_id (id, name),
                plan_submitted_by_user:plan_submitted_by (id, first_name, last_name)
            `)
            .order('date', { ascending: false });

        // Fetch all WBS templates for translation mapping
        const { data: wbsTemplates } = await supabaseAdmin
            .from('wbs_templates')
            .select('name_ru, name_en, name_ka, name_az, name_tr');

        // zone/phase/discipline = null сами по себе ничего не значат: так выглядит и пустая
        // служебная WBS-заготовка объекта, и настоящая рабочая смета с работами (эти поля
        // в разделе "Смета" никогда не заполняются). Различаем по наличию реальных работ -
        // пустая заготовка их не имеет.
        const docIdsWithNullFields = (data || [])
            .filter(est => !est.zone && !est.phase && !est.discipline)
            .map(est => est.id);

        let docIdsWithWorks = new Set();
        if (docIdsWithNullFields.length > 0) {
            const { data: worksRows } = await supabaseAdmin
                .from('est_doc_works')
                .select('doc_id')
                .in('doc_id', docIdsWithNullFields);
            docIdsWithWorks = new Set((worksRows || []).map(w => w.doc_id));
        }

        // [AUTO ESTIMATE HIDING COMMENT]: Hide object-level WBS template estimates (where zone, phase, and discipline are all null AND there are no works yet)
        const filteredDocs = (data || []).filter(est => {
            const isEmptyObjectTemplate = !est.zone && !est.phase && !est.discipline && !docIdsWithWorks.has(est.id);
            if (isEmptyObjectTemplate) return false;

            // Смета скрытого (деактивированного) проекта не должна всплывать в общем списке —
            // проект спрятан из реестра проектов именно для того, чтобы не мешаться, а смета
            // раньше игнорировала это и показывалась всё равно.
            if (est.projects && est.projects.is_active === false) return false;

            if (allowedRegionIds) {
                const estRegionId = est.region_id || est.projects?.region_id;
                return allowedRegionIds.includes(estRegionId);
            }
            return true;
        });

        const mappedData = filteredDocs.map(est => {
            const zoneTemp = est.zone ? (wbsTemplates || []).find(t => 
                t.name_ru === est.zone ||
                t.name_en === est.zone ||
                t.name_ka === est.zone ||
                t.name_az === est.zone ||
                t.name_tr === est.zone
            ) : null;

            const phaseTemp = est.phase ? (wbsTemplates || []).find(t => 
                t.name_ru === est.phase ||
                t.name_en === est.phase ||
                t.name_ka === est.phase ||
                t.name_az === est.phase ||
                t.name_tr === est.phase
            ) : null;

            const discTemp = est.discipline ? (wbsTemplates || []).find(t => 
                t.name_ru === est.discipline ||
                t.name_en === est.discipline ||
                t.name_ka === est.discipline ||
                t.name_az === est.discipline ||
                t.name_tr === est.discipline
            ) : null;

            return {
                ...est,
                zone_ru: zoneTemp?.name_ru || est.zone,
                zone_en: zoneTemp?.name_en || est.zone,
                zone_ka: zoneTemp?.name_ka || est.zone,
                zone_az: zoneTemp?.name_az || est.zone,
                zone_tr: zoneTemp?.name_tr || est.zone,

                phase_ru: phaseTemp?.name_ru || est.phase,
                phase_en: phaseTemp?.name_en || est.phase,
                phase_ka: phaseTemp?.name_ka || est.phase,
                phase_az: phaseTemp?.name_az || est.phase,
                phase_tr: phaseTemp?.name_tr || est.phase,

                discipline_ru: discTemp?.name_ru || est.discipline,
                discipline_en: discTemp?.name_en || est.discipline,
                discipline_ka: discTemp?.name_ka || est.discipline,
                discipline_az: discTemp?.name_az || est.discipline,
                discipline_tr: discTemp?.name_tr || est.discipline
            };
        });

        res.json(mappedData);
    } catch (err) {
        console.error('[ALL-TEST ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /estimates/schedule-doc-ids — id-шники смет, у которых уже есть начатый календарный
// план (хотя бы у одной работы проставлена дата начала). Нужно разделу «Календарное
// планирование», чтобы отличать «Создать КП» (ещё не начато) от «Открыть КП» (уже есть).
router.get('/schedule-doc-ids', async (req, res) => {
    try {
        // Календарный план хранится в отдельной таблице est_doc_schedules (не в est_doc_works) —
        // одна строка на назначенную дату начала работы, doc_id ссылается на est_documents.
        const { data, error } = await supabaseAdmin
            .from('est_doc_schedules')
            .select('doc_id');
        if (error) throw error;
        const docIds = Array.from(new Set((data || []).map(r => r.doc_id).filter(Boolean)));
        res.json({ docIds });
    } catch (err) {
        console.error('[SCHEDULE DOC IDS ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Получение зон по template_id (WBS уровни L=2)
router.get('/wbs-templates/zones', async (req, res) => {
    try {
        const { template_id } = req.query;
        const { data, error } = await supabaseAdmin
            .from('wbs_templates')
            .select('*')
            .eq('template_id', template_id || '501a58b7-33e7-4bdf-8107-143655deef01')
            .eq('type', 'Facility/Zone')
            .order('sort_order');
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        console.error('[ZONES ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Получение дочерних фаз/дисциплин по parent_id
router.get('/wbs-templates/children', async (req, res) => {
    try {
        const { parent_id } = req.query;
        if (!parent_id) {
            return res.json([]);
        }
        const { data, error } = await supabaseAdmin
            .from('wbs_templates')
            .select('*')
            .eq('parent_id', parent_id)
            .order('sort_order');
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        console.error('[CHILDREN ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

router.post('/create', async (req, res) => {
    try {
        const { project_id, organization_id } = req.body;
        const { data, error } = await supabaseAdmin.from('est_documents').insert([{
            project_id,
            organization_id,
            status: 'draft',
            total_amount: 0,
            date: new Date(),
            created_by: req.user?.id || null
        }]).select().single();
        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('[CREATE ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// БЛОК 1: РЕСУРСЫ
// ==========================================

router.patch('/resource/:id/toggle-exclusion', async (req, res) => {
    try {
        const { id } = req.params;
        const { is_excluded } = req.body;

        const { data: currentRes } = await supabaseAdmin.from('est_doc_resources').select('doc_id').eq('id', id).single();
        if (currentRes && await checkIfDocLocked(currentRes.doc_id)) {
            return res.status(403).json({ error: 'Редактирование плановой версии сметы заблокировано' });
        }

        const { data: resource, error: upError } = await supabaseAdmin.from('est_doc_resources').update({ is_excluded }).eq('id', id).select('doc_id, work_id').single();
        if (upError) throw upError;

        const { data: allRes } = await supabaseAdmin.from('est_doc_resources').select('amount').eq('work_id', resource.work_id).eq('is_excluded', false);
        const totalWorkAmount = (allRes || []).reduce((sum, r) => sum + Number(r.amount), 0);
        await supabaseAdmin.from('est_doc_works').update({ amount: totalWorkAmount }).eq('id', resource.work_id);

        await recalculateDocTotal(resource.doc_id);
        res.json({ message: 'Статус ресурса изменен' });
    } catch (err) {
        console.error('[RESOURCE EXCLUSION ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

router.patch('/resource/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { norm, quantity } = req.body;

        const { data: currentRes } = await supabaseAdmin.from('est_doc_resources').select('doc_id').eq('id', id).single();
        if (currentRes && await checkIfDocLocked(currentRes.doc_id)) {
            return res.status(403).json({ error: 'Редактирование плановой версии сметы заблокировано' });
        }

        const { data: resItem } = await supabaseAdmin.from('est_doc_resources').select('*').eq('id', id).single();
        const { data: work } = await supabaseAdmin.from('est_doc_works').select('volume').eq('id', resItem.work_id).single();

        let newNorm = norm !== undefined ? parseFloat(norm) : resItem.norm;
        let newQty = quantity !== undefined ? parseFloat(quantity) : resItem.quantity;

        if (norm !== undefined && work.volume > 0) newQty = newNorm * work.volume;
        else if (quantity !== undefined && work.volume > 0) newNorm = newQty / work.volume;

        const newAmount = newQty * resItem.price;
        await supabaseAdmin.from('est_doc_resources').update({ norm: newNorm, quantity: newQty, amount: newAmount }).eq('id', id);

        const { data: allRes } = await supabaseAdmin.from('est_doc_resources').select('amount').eq('work_id', resItem.work_id).eq('is_excluded', false);
        const totalWorkAmount = allRes.reduce((sum, r) => sum + Number(r.amount), 0);
        await supabaseAdmin.from('est_doc_works').update({ amount: totalWorkAmount }).eq('id', resItem.work_id);

        await recalculateDocTotal(resItem.doc_id);
        res.json({ message: 'Ресурс обновлен' });
    } catch (err) {
        console.error('[RESOURCE UPDATE ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

router.delete('/resource/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const { data: currentRes } = await supabaseAdmin.from('est_doc_resources').select('doc_id').eq('id', id).single();
        if (currentRes && await checkIfDocLocked(currentRes.doc_id)) {
            return res.status(403).json({ error: 'Редактирование плановой версии сметы заблокировано' });
        }

        const { data: resource } = await supabaseAdmin.from('est_doc_resources').select('doc_id, work_id').eq('id', id).single();
        if (resource) {
            await supabaseAdmin.from('est_doc_resources').delete().eq('id', id);
            const { data: allRes } = await supabaseAdmin.from('est_doc_resources').select('amount').eq('work_id', resource.work_id).eq('is_excluded', false);
            const totalWorkAmount = (allRes || []).reduce((sum, r) => sum + Number(r.amount), 0);
            await supabaseAdmin.from('est_doc_works').update({ amount: totalWorkAmount }).eq('id', resource.work_id);
            await recalculateDocTotal(resource.doc_id);
        }
        res.json({ message: 'Ресурс удален' });
    } catch (err) {
        console.error('[RESOURCE DELETE ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Цена ресурса из est_prices (до маршрутов /:docId)
router.get('/resource-price/:resourceId', async (req, res) => {
    try {
        const { resourceId } = req.params;
        const price = await getLatestResourcePrice(resourceId);
        const { data } = await supabaseAdmin
            .from('resource_prices')
            .select('id')
            .eq('resource_id', String(resourceId))
            .eq('is_active', true)
            .limit(1);
        res.json({
            resource_id: String(resourceId),
            price,
            found: (data || []).length > 0
        });
    } catch (err) {
        console.error('[RESOURCE PRICE ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

router.post('/resource', async (req, res) => {
    try {
        const { doc_id, work_id, resource_id, norm, quantity } = req.body;
        // Fetch document to get region/currency
        const { data: doc } = await supabaseAdmin.from('est_documents').select('region_id, currency_id, projects:project_uuid(region_id)').eq('id', doc_id).single();
        const regionId = doc?.region_id || doc?.projects?.region_id;
        const price = await getLatestResourcePrice(resource_id, regionId, doc?.currency_id);
        const amount = quantity * price;

        console.log(`[RESOURCE ADD] resource_id=${resource_id}, price=${price}, quantity=${quantity}, amount=${amount}`);
        const { data } = await supabaseAdmin.from('est_doc_resources').insert([{ doc_id, work_id, resource_id, norm, quantity, price, amount, source: req.body.source || 'manual' }]).select().single();
        const { data: allRes } = await supabaseAdmin.from('est_doc_resources').select('amount').eq('work_id', work_id).eq('is_excluded', false);
        const totalWorkAmount = (allRes || []).reduce((sum, r) => sum + Number(r.amount), 0);
        await supabaseAdmin.from('est_doc_works').update({ amount: totalWorkAmount }).eq('id', work_id);
        await recalculateDocTotal(doc_id);
        res.json(data);
    } catch (err) {
        console.error('[RESOURCE ADD ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// БЛОК 2: РАБОТЫ И ПРОЧЕЕ
// ==========================================

router.post('/approve', async (req, res) => {
    try {
        const { doc_id } = req.body;
        const { data: wbsNodes } = await supabaseAdmin.from('est_wbs').select('id, name').eq('doc_id', doc_id);
        for (const node of (wbsNodes || [])) {
            const { count } = await supabaseAdmin.from('est_doc_works').select('*', { count: 'exact', head: true }).eq('wbs_id', node.id);
            if (!count || count === 0) return res.status(400).json({ error: `Раздел "${node.name}" пуст.` });
        }
        let countryCode = 'GE';
        const { data: doc } = await supabaseAdmin.from('est_documents').select('region_id, projects:project_uuid(region_id)').eq('id', doc_id).single();
        const regionId = doc?.region_id || doc?.projects?.region_id;
        if (regionId) {
            const { data: reg } = await supabaseAdmin
                .from('dic_regions')
                .select('id, code, dic_countries(id, code)')
                .eq('id', regionId)
                .single();
            if (reg?.dic_countries?.code) {
                countryCode = reg.dic_countries.code.toUpperCase();
            }
        }
        const isAz = countryCode === 'AZ';

        const { data: works } = await supabaseAdmin.from('est_doc_works').select('id, volume, is_excluded, work_id').eq('doc_id', doc_id);
        const workIds = (works || []).map(w => w.work_id).filter(Boolean);
        const { data: workLocs } = workIds.length > 0 ? await supabaseAdmin
            .from('localization')
            .select('object_id, name')
            .eq('object_name', isAz ? 'jobs_cas' : 'jobs')
            .eq('locale', 'ru')
            .in('object_id', workIds) : { data: [] };
        
        const workNamesMap = {};
        (workLocs || []).forEach(l => {
            workNamesMap[l.object_id] = l.name;
        });

        for (const work of (works || [])) {
            if (work.is_excluded) continue;
            const workName = workNamesMap[work.work_id] || `Job ${work.work_id}`;
            if (!work.volume || work.volume <= 0) return res.status(400).json({ error: `У работы "${workName}" не указан объем.` });
            const { count } = await supabaseAdmin.from('est_doc_resources').select('*', { count: 'exact', head: true }).eq('work_id', work.id).eq('is_excluded', false);
            if (!count || count === 0) return res.status(400).json({ error: `У работы "${workName}" нет активных ресурсов.` });
        }
        await supabaseAdmin.from('est_documents').update({ status: 'approved' }).eq('id', doc_id);
        res.json({ success: true });
    } catch (err) {
        console.error('[APPROVE ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

router.get('/norms/:work_id', async (req, res) => {
    try {
        const { work_id } = req.params;
        const { country_code } = req.query;
        const isAz = country_code === 'AZ' || country_code === 'azerbaijan';
        const normTable = isAz ? 'jobs_norms_cas' : 'job_resource_norms';
        console.log(`[NORMS] Запрос нормативов из ${normTable} для work_id: ${work_id}`);
        
        let norms = [];
        let error = null;

        if (isAz) {
            const { data: casNorms, error: casErr } = await supabaseAdmin
                .from('jobs_norms_cas')
                .select('material_id, machine_id, labor_id, count')
                .eq('job_id', work_id);
            error = casErr;
            norms = (casNorms || []).map(n => ({
                resource_id: n.material_id || n.machine_id || n.labor_id,
                value_number: n.count
            })).filter(n => n.resource_id != null);

            if (!norms || norms.length === 0) {
                const { data: fallbackNorms } = await supabaseAdmin
                    .from('job_resource_norms')
                    .select('resource_id, value_number')
                    .eq('job_id', work_id);
                norms = fallbackNorms || [];
            }
        } else {
            const { data: stdNorms, error: stdErr } = await supabaseAdmin
                .from('job_resource_norms')
                .select('resource_id, value_number')
                .eq('job_id', work_id);
            error = stdErr;
            norms = stdNorms || [];
        }
        if (error) throw error;
        
        console.log(`[NORMS] Найдено нормативов: ${norms?.length || 0}`);
        if (!norms || norms.length === 0) return res.json([]);

        const resourceIds = norms.map(n => n.resource_id);
        let resources = [];
        let locs = [];

        if (isAz) {
            if (resourceIds.length > 0) {
                const [laborRes, machineRes, materialRes] = await Promise.all([
                    supabaseAdmin.from('Labor_cas').select('id, code, dic_measures(id, code), dic_resource_types(id, code)').in('id', resourceIds),
                    supabaseAdmin.from('Machine_cas').select('id, code, dic_measures(id, code), dic_resource_types(id, code)').in('id', resourceIds),
                    supabaseAdmin.from('Materials_cas').select('id, code, dic_measures(id, code), dic_resource_types(id, code)').in('id', resourceIds)
                ]);
                resources = [
                    ...(laborRes.data || []),
                    ...(machineRes.data || []),
                    ...(materialRes.data || [])
                ];
                const { data: customLocs } = await supabaseAdmin
                    .from('localization')
                    .select('object_id, locale, name')
                    .in('object_name', ['Labor_cas', 'Machine_cas', 'Materials_cas'])
                    .in('object_id', resourceIds);
                locs = customLocs || [];
            }
        } else {
            if (resourceIds.length > 0) {
                const { data: geRes, error: rErr } = await supabaseAdmin
                    .from('resources')
                    .select('id, code, dic_measures(id, code), dic_resource_types(id, code)')
                    .in('id', resourceIds);
                if (rErr) throw rErr;
                resources = geRes || [];

                const { data: geLocs, error: locErr } = await supabaseAdmin
                    .from('localization')
                    .select('object_id, locale, name')
                    .eq('object_name', 'resources')
                    .in('object_id', resourceIds);
                if (locErr) throw locErr;
                locs = geLocs || [];
            }
        }

        const { data: typeLocs } = await supabaseAdmin
            .from('localization')
            .select('object_id, locale, name')
            .eq('object_name', 'dic_resource_types');

        const allMeasureIds = Array.from(new Set(resources.map(r => r.dic_measures?.id).filter(Boolean)));
        const { data: measureLocs } = allMeasureIds.length > 0 ? await supabaseAdmin
            .from('localization')
            .select('object_id, locale, name')
            .eq('object_name', 'dic_measures')
            .in('object_id', allMeasureIds) : { data: [] };

        const typeLocMap = {};
        (typeLocs || []).forEach(l => {
            if (!typeLocMap[l.object_id]) typeLocMap[l.object_id] = {};
            typeLocMap[l.object_id][l.locale] = l.name;
        });

        const measureLocMap = {};
        (measureLocs || []).forEach(l => {
            if (!measureLocMap[l.object_id]) measureLocMap[l.object_id] = {};
            measureLocMap[l.object_id][l.locale] = l.name;
        });

        const locMap = {};
        locs.forEach(l => {
            if (!locMap[l.object_id]) locMap[l.object_id] = {};
            locMap[l.object_id][l.locale] = l.name;
        });

        const resMap = {};
        resources.forEach(r => {
            const names = locMap[r.id] || {};
            const typeId = r.dic_resource_types?.id;
            const typeNames = typeLocMap[typeId] || {};
            const measureId = r.dic_measures?.id;
            const unitNames = measureLocMap[measureId] || {};
            resMap[r.id] = {
                id: r.id,
                code: r.code,
                name: names.ru || names.en || names.ka || names.az || names.tr || `Resource ${r.code}`,
                name_ru: names.ru || '',
                name_en: names.en || '',
                name_ka: names.ka || '',
                name_ge: names.ka || '',
                name_az: names.az || '',
                name_tr: names.tr || '',
                type: typeNames.ru || typeNames.en || typeNames.ka || typeNames.az || typeNames.tr || `Type ${r.dic_resource_types?.code || ''}`,
                type_ru: typeNames.ru || '',
                type_en: typeNames.en || '',
                type_ka: typeNames.ka || '',
                type_ge: typeNames.ka || '',
                type_az: typeNames.az || '',
                type_tr: typeNames.tr || '',
                type_code: r.dic_resource_types?.code || '',
                unit: unitNames.ru || unitNames.en || unitNames.ka || unitNames.az || unitNames.tr || r.dic_measures?.code || 'PCS',
                unit_ru: unitNames.ru || r.dic_measures?.code || '',
                unit_en: unitNames.en || r.dic_measures?.code || '',
                unit_ka: unitNames.ka || r.dic_measures?.code || '',
                unit_ge: unitNames.ka || r.dic_measures?.code || '',
                unit_az: unitNames.az || r.dic_measures?.code || '',
                unit_tr: unitNames.tr || r.dic_measures?.code || ''
            };
        });

        const formatted = norms.map(n => {
            const resDetails = resMap[n.resource_id] || {};
            return {
                resource_id: n.resource_id,
                norm: Number(n.value_number) || 0,
                est_resources: resDetails
            };
        });

        console.log(`[NORMS] Возвращаем: ${formatted.length} нормативов`);
        res.json(formatted);
    } catch (err) { 
        console.error('[NORMS ERROR]:', err.message);
        res.status(500).json({ error: err.message }); 
    }
});

router.post('/work', async (req, res) => {
    try {
        const { doc_id, wbs_id, work_id, volume } = req.body;

        if (await checkIfDocLocked(doc_id)) {
            return res.status(403).json({ error: 'Редактирование плановой версии сметы заблокировано' });
        }

        const { data } = await supabaseAdmin.from('est_doc_works').insert([{ doc_id, wbs_id, work_id, volume, price: 0, amount: 0 }]).select().single();
        await recalculateDocTotal(doc_id);
        res.json(data);
    } catch (err) {
        console.error('[WORK ADD ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

router.patch('/work/:id/toggle-exclusion', async (req, res) => {
    try {
        const { id } = req.params;
        const { is_excluded } = req.body;

        const { data: currentWork } = await supabaseAdmin.from('est_doc_works').select('doc_id').eq('id', id).single();
        if (currentWork && await checkIfDocLocked(currentWork.doc_id)) {
            return res.status(403).json({ error: 'Редактирование плановой версии сметы заблокировано' });
        }

        const { data: work } = await supabaseAdmin.from('est_doc_works').update({ is_excluded }).eq('id', id).select('doc_id').single();
        await recalculateDocTotal(work.doc_id);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/work/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { volume } = req.body;

        const { data: currentWork } = await supabaseAdmin.from('est_doc_works').select('doc_id').eq('id', id).single();
        if (currentWork && await checkIfDocLocked(currentWork.doc_id)) {
            return res.status(403).json({ error: 'Редактирование плановой версии сметы заблокировано' });
        }

        const { data: work } = await supabaseAdmin.from('est_doc_works').update({ volume }).eq('id', id).select().single();
        const { data: resources } = await supabaseAdmin.from('est_doc_resources').select('*').eq('work_id', id);

        let newWorkAmount = 0;
        for (const r of resources) {
            const newQty = r.norm * volume;
            const newAmt = newQty * r.price;
            newWorkAmount += r.is_excluded ? 0 : newAmt;
            await supabaseAdmin.from('est_doc_resources').update({ quantity: newQty, amount: newAmt }).eq('id', r.id);
        }

        await supabaseAdmin.from('est_doc_works').update({ amount: newWorkAmount }).eq('id', id);
        await recalculateDocTotal(work.doc_id);
        res.json({ message: 'Объем обновлен' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/work/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const { data: currentWork } = await supabaseAdmin.from('est_doc_works').select('doc_id').eq('id', id).single();
        if (currentWork && await checkIfDocLocked(currentWork.doc_id)) {
            return res.status(403).json({ error: 'Редактирование плановой версии сметы заблокировано' });
        }

        const { data: work } = await supabaseAdmin.from('est_doc_works').select('doc_id').eq('id', id).single();
        if (work) {
            await supabaseAdmin.from('est_doc_resources').delete().eq('work_id', id);
            await supabaseAdmin.from('est_doc_works').delete().eq('id', id);
            await recalculateDocTotal(work.doc_id);
        }
        res.json({ message: 'Работа удалена' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/wbs', async (req, res) => {
    try {
        const { doc_id } = req.body;
        if (await checkIfDocLocked(doc_id)) {
            return res.status(403).json({ error: 'Редактирование плановой версии сметы заблокировано' });
        }
        const { data } = await supabaseAdmin.from('est_wbs').insert([req.body]).select().single();
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/wbs/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { data: node } = await supabaseAdmin.from('est_wbs').select('doc_id').eq('id', id).single();
        if (node && await checkIfDocLocked(node.doc_id)) {
            return res.status(403).json({ error: 'Редактирование плановой версии сметы заблокировано' });
        }

        const { data: works } = await supabaseAdmin.from('est_doc_works').select('id').eq('wbs_id', id);
        if (works?.length) {
            const ids = works.map(w => w.id);
            await supabaseAdmin.from('est_doc_resources').delete().in('work_id', ids);
            await supabaseAdmin.from('est_doc_works').delete().in('id', ids);
        }
        await supabaseAdmin.from('est_wbs').delete().eq('id', id);
        res.json({ message: 'Раздел удален' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 5. ДЕАКТИВАЦИЯ / АКТИВАЦИЯ РАЗДЕЛА WBS С ЖУРНАЛОМ АУДИТА ---
router.patch('/wbs/:id/toggle-exclusion', async (req, res) => {
    try {
        const { id } = req.params;
        const { is_excluded } = req.body;

        const { data: currentNode } = await supabaseAdmin.from('est_wbs').select('doc_id').eq('id', id).single();
        if (currentNode && await checkIfDocLocked(currentNode.doc_id)) {
            return res.status(403).json({ error: 'Редактирование плановой версии сметы заблокировано' });
        }

        const { data: node, error: nodeErr } = await supabaseAdmin
            .from('est_wbs')
            .update({ is_excluded })
            .eq('id', id)
            .select('doc_id, name')
            .single();

        if (nodeErr) throw nodeErr;

        const { data: allWbs, error: allWbsErr } = await supabaseAdmin
            .from('est_wbs')
            .select('id, parent_id')
            .eq('doc_id', node.doc_id);

        if (allWbsErr) throw allWbsErr;

        const parentToChildren = {};
        for (const w of (allWbs || [])) {
            if (w.parent_id) {
                if (!parentToChildren[w.parent_id]) {
                    parentToChildren[w.parent_id] = [];
                }
                parentToChildren[w.parent_id].push(w.id);
            }
        }

        const wbsIds = [];
        const queue = [id];
        while (queue.length > 0) {
            const currentId = queue.shift();
            wbsIds.push(currentId);
            const children = parentToChildren[currentId] || [];
            for (const childId of children) {
                queue.push(childId);
            }
        }

        if (wbsIds.length > 1) {
            const { error: updWbsErr } = await supabaseAdmin
                .from('est_wbs')
                .update({ is_excluded })
                .in('id', wbsIds);
            if (updWbsErr) throw updWbsErr;
        }

        const { error: updWorksErr } = await supabaseAdmin
            .from('est_doc_works')
            .update({ is_excluded })
            .in('wbs_id', wbsIds);
        if (updWorksErr) throw updWorksErr;

        const { data: works, error: fetchWorksErr } = await supabaseAdmin
            .from('est_doc_works')
            .select('id')
            .in('wbs_id', wbsIds);
        
        if (fetchWorksErr) throw fetchWorksErr;

        if (works && works.length > 0) {
            const workIds = works.map(w => w.id);
            const { error: updResErr } = await supabaseAdmin
                .from('est_doc_resources')
                .update({ is_excluded })
                .in('work_id', workIds);
            if (updResErr) throw updResErr;
        }

        await recalculateDocTotal(node.doc_id);

        let createdBy = null;
        if (req.user && req.user.id && req.user.id !== 'admin-dev-id') {
            const { data: profileCheck } = await supabaseAdmin
                .from('profiles')
                .select('id')
                .eq('id', req.user.id)
                .maybeSingle();
            if (profileCheck) {
                createdBy = profileCheck.id;
            }
        }

        const { error: logErr } = await supabaseAdmin
            .from('estimate_audit_logs')
            .insert([{
                doc_id: node.doc_id,
                wbs_id: id,
                user_id: createdBy,
                action: is_excluded ? 'DEACTIVATE_SUBCONSTRUCT' : 'ACTIVATE_SUBCONSTRUCT',
                details: {
                    wbs_name: node.name,
                    timestamp: new Date().toISOString()
                }
            }]);

        if (logErr) {
            console.error('Error inserting estimate audit log:', logErr);
        }

        res.json({ success: true, is_excluded });
    } catch (err) {
        console.error('[WBS TOGGLE EXCLUSION ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

router.post('/coefficients', async (req, res) => {
    try {
        const { doc_id } = req.body;
        if (await checkIfDocLocked(doc_id)) {
            return res.status(403).json({ error: 'Редактирование плановой версии сметы заблокировано' });
        }
        const { data } = await supabaseAdmin.from('est_coefficients').insert([req.body]).select().single();
        await recalculateDocTotal(doc_id);
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/coefficients/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { data: coeff, error: fetchError } = await supabaseAdmin
            .from('est_coefficients')
            .select('doc_id')
            .eq('id', id)
            .maybeSingle();

        if (fetchError) throw fetchError;
        if (!coeff) return res.status(404).json({ error: 'Коэффициент не найден' });

        if (await checkIfDocLocked(coeff.doc_id)) {
            return res.status(403).json({ error: 'Редактирование плановой версии сметы заблокировано' });
        }

        const { error: delError } = await supabaseAdmin.from('est_coefficients').delete().eq('id', id);
        if (delError) throw delError;

        await recalculateDocTotal(coeff.doc_id);
        res.json({ message: 'Коэффициент удален' });
    } catch (err) {
        console.error('[COEFF DELETE ERROR]:', err);
        res.status(500).json({ error: err.message });
    }
});

router.get('/dictionaries/prices', async (req, res) => {
    try {
        const { data } = await supabaseAdmin.from('resource_prices').select('*').eq('is_active', true);
        const pricesMap = {};
        (data || []).forEach(p => {
            pricesMap[p.resource_id] = p.price;
        });
        res.json(pricesMap);
    } catch (err) {
        console.error('[PRICES ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// БЛОК 3: МАССОВОЕ СОХРАНЕНИЕ (BULK SAVE)
// ==========================================

router.post('/:docId/save', async (req, res) => {
    try {
        const { docId } = req.params;
        const { wbs, works, resources, coefficients, project_id, region_id, currency_id } = req.body;

        if (!docId) return res.status(400).json({ error: 'docId не передан' });

        if (await checkIfDocLocked(docId)) {
            return res.status(403).json({ error: 'Редактирование плановой версии сметы заблокировано' });
        }

        // Resolve country and check if it is Azerbaijan (Baku)
        const { data: doc } = await supabaseAdmin.from('est_documents').select('region_id, projects:project_uuid(region_id)').eq('id', docId).single();
        const finalRegionId = region_id || doc?.region_id || doc?.projects?.region_id;
        let countryCode = 'GE';
        if (finalRegionId) {
            const { data: reg } = await supabaseAdmin
                .from('dic_regions')
                .select('id, code, dic_countries(id, code)')
                .eq('id', finalRegionId)
                .single();
            if (reg?.dic_countries?.code) {
                countryCode = reg.dic_countries.code.toUpperCase();
            }
        }
        const isAz = countryCode === 'AZ';

        const docUpdates = {};
        if (project_id) docUpdates.project_id = project_id;
        if (region_id) docUpdates.region_id = region_id;
        if (currency_id) docUpdates.currency_id = currency_id;

        if (Object.keys(docUpdates).length > 0) {
            const { error: renameError } = await supabaseAdmin.from('est_documents').update(docUpdates).eq('id', docId);
            if (renameError) throw renameError;
        }

        const existingWbsIds = (wbs || []).filter(w => !w.id.startsWith('temp_')).map(w => w.id);
        const existingWorkIds = (works || []).filter(w => !w.id.startsWith('temp_')).map(w => w.id);
        const existingResIds = (resources || []).filter(r => !r.id.startsWith('temp_')).map(r => r.id);
        const existingCoeffIds = (coefficients || []).filter(c => !c.id.startsWith('temp_')).map(c => c.id);

        // Старые значения нормы/количества — чтобы после upsert'а залогировать в
        // resource_quantity_history только то, что реально изменилось.
        let prevResourceValues = {};
        if (existingResIds.length > 0) {
            const { data: prevResRows } = await supabaseAdmin
                .from('est_doc_resources')
                .select('id, norm, quantity')
                .in('id', existingResIds);
            (prevResRows || []).forEach(r => { prevResourceValues[r.id] = r; });
        }

        if (existingWbsIds.length > 0) {
            await supabaseAdmin.from('est_wbs').delete().eq('doc_id', docId).not('id', 'in', `(${existingWbsIds.join(',')})`);
        } else {
            await supabaseAdmin.from('est_wbs').delete().eq('doc_id', docId);
        }

        // Перед удалением работ узнаём, какие id реально пропадут — если у них были связи
        // в КП (est_work_dependencies), связь-строки станут ссылаться на удалённую работу
        // и её нужно тоже подчистить (саму связанную работу и её даты это не трогает —
        // только убирает саму связь).
        const { data: currentDbWorks } = await supabaseAdmin.from('est_doc_works').select('id').eq('doc_id', docId);
        const currentDbWorkIds = (currentDbWorks || []).map(w => w.id);
        const deletedWorkIds = existingWorkIds.length > 0
            ? currentDbWorkIds.filter(id => !existingWorkIds.includes(id))
            : currentDbWorkIds;

        if (existingWorkIds.length > 0) {
            await supabaseAdmin.from('est_doc_works').delete().eq('doc_id', docId).not('id', 'in', `(${existingWorkIds.join(',')})`);
        } else {
            await supabaseAdmin.from('est_doc_works').delete().eq('doc_id', docId);
        }

        if (deletedWorkIds.length > 0) {
            const idsList = deletedWorkIds.join(',');
            await supabaseAdmin.from('est_work_dependencies').delete().or(`predecessor_id.in.(${idsList}),successor_id.in.(${idsList})`);
        }

        if (existingResIds.length > 0) {
            await supabaseAdmin.from('est_doc_resources').delete().eq('doc_id', docId).not('id', 'in', `(${existingResIds.join(',')})`);
        } else {
            await supabaseAdmin.from('est_doc_resources').delete().eq('doc_id', docId);
        }

        if (existingCoeffIds.length > 0) {
            await supabaseAdmin.from('est_coefficients').delete().eq('doc_id', docId).not('id', 'in', `(${existingCoeffIds.join(',')})`);
        } else {
            await supabaseAdmin.from('est_coefficients').delete().eq('doc_id', docId);
        }

        const crypto = require('crypto');
        const wbsIdMap = {};
        for (const node of (wbs || [])) {
            if (node.id.startsWith('temp_')) {
                wbsIdMap[node.id] = crypto.randomUUID();
            } else {
                wbsIdMap[node.id] = node.id;
            }
        }

        const wbsToUpsert = (wbs || []).map(node => {
            if (!node) return null;
            const realParentId = node.parent_id
                ? resolveMappedId(node.parent_id, wbsIdMap, 'parent_id WBS')
                : null;
            return {
                id: wbsIdMap[node.id],
                doc_id: docId,
                name: node.name,
                type: node.type || 'construct',
                sort_order: node.sort_order,
                parent_id: realParentId,
                is_excluded: node.is_excluded || false
            };
        }).filter(Boolean);

        if (wbsToUpsert.length > 0) {
            const { error: wbsErr } = await supabaseAdmin.from('est_wbs').upsert(wbsToUpsert);
            if (wbsErr) throw wbsErr;
        }

        const priceCache = {};

        // Блок оптимизации: пакетная загрузка цен ресурсов для предотвращения N+1 запросов к БД
        const resourceIds = Array.from(new Set((resources || []).map(r => r.resource_id).filter(Boolean)));
        if (resourceIds.length > 0) {
            const finalRegionId = region_id || doc?.region_id || doc?.projects?.region_id;
            const finalCurrencyId = currency_id || doc?.currency_id || null;
            if (isAz) {
                // Загружаем цены из CAS таблиц в Баку
                const [laborPrices, machinePrices, materialPrices] = await Promise.all([
                    supabaseAdmin.from('Labor_cas').select('id, price').in('id', resourceIds),
                    supabaseAdmin.from('Machine_cas').select('id, price').in('id', resourceIds),
                    supabaseAdmin.from('Materials_cas').select('id, price').in('id', resourceIds)
                ]);
                const allCas = [
                    ...(laborPrices.data || []),
                    ...(machinePrices.data || []),
                    ...(materialPrices.data || [])
                ];
                allCas.forEach(item => {
                    const key = `${item.id}_${finalRegionId || 'default'}_${finalCurrencyId || 'default'}`;
                    priceCache[key] = Number(item.price || 0);
                });
            } else {
                // Загружаем цены из resource_prices (Грузия)
                // Сначала берем специфичные для региона/валюты цены
                let priceQuery = supabaseAdmin
                    .from('resource_prices')
                    .select('resource_id, price, valid_from')
                    .in('resource_id', resourceIds)
                    .eq('is_active', true);
                if (finalRegionId) priceQuery = priceQuery.eq('region_id', finalRegionId);
                if (finalCurrencyId) priceQuery = priceQuery.eq('currency_id', finalCurrencyId);
                
                const { data: specificPrices } = await priceQuery;

                // Для надежности также подтянем базовые цены
                const { data: fallbackPrices } = await supabaseAdmin
                    .from('resource_prices')
                    .select('resource_id, price, valid_from')
                    .in('resource_id', resourceIds)
                    .eq('is_active', true);

                // Заполняем кэш: сначала базовые цены (как fallback)
                const sortedFallback = (fallbackPrices || []).sort((a, b) => new Date(a.valid_from) - new Date(b.valid_from));
                sortedFallback.forEach(item => {
                    const key = `${item.resource_id}_${finalRegionId || 'default'}_${finalCurrencyId || 'default'}`;
                    priceCache[key] = Number(item.price || 0);
                });

                // Теперь перезаписываем специфичными ценами региона/валюты, если они есть
                const sortedSpecific = (specificPrices || []).sort((a, b) => new Date(a.valid_from) - new Date(b.valid_from));
                sortedSpecific.forEach(item => {
                    const key = `${item.resource_id}_${finalRegionId || 'default'}_${finalCurrencyId || 'default'}`;
                    priceCache[key] = Number(item.price || 0);
                });
            }
        }

        const workIdMap = {};
        for (const work of (works || [])) {
            if (work.id.startsWith('temp_')) {
                workIdMap[work.id] = crypto.randomUUID();
            } else {
                workIdMap[work.id] = work.id;
            }
        }

        const resourcesToUpsert = (resources || []).map(res => {
            if (!res) return null;
            const realWorkId = resolveMappedId(res.work_id, workIdMap, 'work_id ресурса');
            
            const priceKey = `${res.resource_id}_${region_id || doc?.region_id || doc?.projects?.region_id || 'default'}_${currency_id || doc?.currency_id || 'default'}`;
            const dbPrice = priceCache[priceKey] !== undefined ? priceCache[priceKey] : 0;
            const quantity = Number(res.quantity) || 0;
            const amount = quantity * dbPrice;
            
            const isTemp = res.id.startsWith('temp_');
            const realId = isTemp ? crypto.randomUUID() : res.id;

            // US-06-005: факт вводится сметчиком напрямую (не пересчитывается от прайс-листа,
            // в отличие от плановой цены выше) — просто передаём как есть.
            const factNorm = res.fact_norm != null && res.fact_norm !== '' ? Number(res.fact_norm) : null;
            const factQuantity = res.fact_quantity != null && res.fact_quantity !== '' ? Number(res.fact_quantity) : null;
            const factPrice = res.fact_price != null && res.fact_price !== '' ? Number(res.fact_price) : null;
            const factAmount = res.fact_amount != null && res.fact_amount !== ''
                ? Number(res.fact_amount)
                : (factQuantity != null && factPrice != null ? factQuantity * factPrice : null);

            return {
                id: realId,
                doc_id: docId,
                work_id: realWorkId,
                resource_id: res.resource_id,
                norm: res.norm,
                quantity: res.quantity,
                price: dbPrice,
                amount,
                source: res.source || null,
                fact_norm: factNorm,
                fact_quantity: factQuantity,
                fact_price: factPrice,
                fact_amount: factAmount,
                is_excluded: res.is_excluded || false
            };
        }).filter(Boolean);

        const workAmounts = {};
        const workFactAmounts = {};
        for (const workId of Object.values(workIdMap)) {
            workAmounts[workId] = 0;
            workFactAmounts[workId] = 0;
        }
        resourcesToUpsert.forEach(res => {
            if (!res.is_excluded) {
                workAmounts[res.work_id] = (workAmounts[res.work_id] || 0) + Number(res.amount || 0);
                if (res.fact_amount != null) {
                    workFactAmounts[res.work_id] = (workFactAmounts[res.work_id] || 0) + Number(res.fact_amount || 0);
                }
            }
        });

        const worksToUpsert = (works || []).map(work => {
            if (!work) return null;
            const realWbsId = resolveMappedId(work.wbs_id, wbsIdMap, 'wbs_id работы');
            const realId = workIdMap[work.id];

            const factVolume = work.fact_volume != null && work.fact_volume !== '' ? Number(work.fact_volume) : null;

            return {
                id: realId,
                doc_id: docId,
                wbs_id: realWbsId,
                work_id: work.work_id,
                volume: work.volume,
                price: work.price || 0,
                amount: workAmounts[realId] || 0,
                fact_volume: factVolume,
                fact_amount: workFactAmounts[realId] || null,
                is_excluded: work.is_excluded || false
            };
        }).filter(Boolean);

        if (worksToUpsert.length > 0) {
            const { error: worksErr } = await supabaseAdmin.from('est_doc_works').upsert(worksToUpsert);
            if (worksErr) throw worksErr;
        }

        if (resourcesToUpsert.length > 0) {
            const { error: resErr } = await supabaseAdmin.from('est_doc_resources').upsert(resourcesToUpsert);
            if (resErr) throw resErr;

            const quantityHistoryRows = resourcesToUpsert
                .filter(r => prevResourceValues[r.id])
                .map(r => {
                    const prev = prevResourceValues[r.id];
                    const oldNorm = prev.norm !== null && prev.norm !== undefined ? Number(prev.norm) : null;
                    const newNorm = r.norm !== null && r.norm !== undefined ? Number(r.norm) : null;
                    const oldQuantity = prev.quantity !== null && prev.quantity !== undefined ? Number(prev.quantity) : null;
                    const newQuantity = r.quantity !== null && r.quantity !== undefined ? Number(r.quantity) : null;
                    const normChanged = oldNorm !== newNorm && !(oldNorm === null && newNorm === null);
                    const quantityChanged = oldQuantity !== newQuantity && !(oldQuantity === null && newQuantity === null);
                    if (!normChanged && !quantityChanged) return null;
                    return {
                        doc_resource_id: r.id,
                        resource_id: r.resource_id,
                        region_id: finalRegionId || null,
                        old_quantity: oldQuantity,
                        new_quantity: newQuantity,
                        old_norm: oldNorm,
                        new_norm: newNorm,
                        changed_by: req.user?.id || null,
                        changed_at: new Date().toISOString()
                    };
                })
                .filter(Boolean);

            if (quantityHistoryRows.length > 0) {
                const { error: histErr } = await supabaseAdmin.from('resource_quantity_history').insert(quantityHistoryRows);
                if (histErr) console.error('[RESOURCE QUANTITY HISTORY LOG ERROR]:', histErr.message);
            }
        }

        const coeffsToUpsert = (coefficients || []).map(coeff => {
            if (!coeff) return null;
            const isTemp = coeff.id.startsWith('temp_');
            const realId = isTemp ? crypto.randomUUID() : coeff.id;
            return {
                id: realId,
                doc_id: docId,
                name: coeff.name,
                type: coeff.type || 'overhead',
                value_percent: coeff.value_percent
            };
        }).filter(Boolean);

        if (coeffsToUpsert.length > 0) {
            const { error: coeffsErr } = await supabaseAdmin.from('est_coefficients').upsert(coeffsToUpsert);
            if (coeffsErr) throw coeffsErr;
        }

        await recalculateDocTotal(docId);
        res.json({
            success: true,
            message: 'Все изменения успешно сохранены',
            wbs: wbsToUpsert,
            works: worksToUpsert,
            resources: resourcesToUpsert,
            coefficients: coeffsToUpsert
        });
    } catch (err) {
        console.error('[BULK SAVE ERROR]:', err.message);
        res.status(500).json({ error: 'Ошибка сервера при массовом сохранении: ' + err.message });
    }
});

// ==========================================
// СОЗДАНИЕ КОПИИ
// ==========================================

router.post('/:docId/create-version', async (req, res) => {
    try {
        const { docId } = req.params;
        const { version_name } = req.body;
        
        const { data: origDoc } = await supabaseAdmin.from('est_documents').select('*').eq('id', docId).single();
        if (!origDoc) return res.status(404).json({ error: 'Смета не найдена' });
        
        const { data: newDoc, error: createErr } = await supabaseAdmin.from('est_documents').insert([{
            project_id: version_name || `${origDoc.project_id} (Версия)`,
            organization_id: origDoc.organization_id,
            status: 'draft',
            total_amount: origDoc.total_amount,
            date: new Date()
        }]).select().single();
        
        if (createErr) throw createErr;
        const newDocId = newDoc.id;
        
        const { data: wbs } = await supabaseAdmin.from('est_wbs').select('*').eq('doc_id', docId).order('sort_order');
        const wbsIdMap = {};
        for (const node of (wbs || [])) {
            const { data: newWbs, error } = await supabaseAdmin.from('est_wbs').insert([{
                doc_id: newDocId,
                name: node.name,
                type: node.type || 'construct',
                sort_order: node.sort_order
            }]).select().single();
            if (error) throw error;
            wbsIdMap[node.id] = newWbs.id;
        }
        
        for (const node of (wbs || [])) {
            if (node.parent_id) {
                const newParentId = wbsIdMap[node.parent_id];
                const newRealId = wbsIdMap[node.id];
                if (newParentId && newRealId) {
                    await supabaseAdmin.from('est_wbs').update({ parent_id: newParentId }).eq('id', newRealId);
                }
            }
        }
        
        const { data: works } = await supabaseAdmin.from('est_doc_works').select('*').eq('doc_id', docId);
        const workIdMap = {};
        for (const w of (works || [])) {
            const mappedWbsId = wbsIdMap[w.wbs_id];
            if (!mappedWbsId) continue;
            const { data: newWork, error } = await supabaseAdmin.from('est_doc_works').insert([{
                doc_id: newDocId,
                wbs_id: mappedWbsId,
                work_id: w.work_id,
                volume: w.volume,
                price: w.price,
                amount: w.amount,
                is_excluded: w.is_excluded
            }]).select().single();
            if (error) throw error;
            workIdMap[w.id] = newWork.id;
        }
        
        const { data: resources } = await supabaseAdmin.from('est_doc_resources').select('*').eq('doc_id', docId);
        for (const r of (resources || [])) {
            const mappedWorkId = workIdMap[r.work_id];
            if (!mappedWorkId) continue;
            const { error } = await supabaseAdmin.from('est_doc_resources').insert([{
                doc_id: newDocId,
                work_id: mappedWorkId,
                resource_id: r.resource_id,
                norm: r.norm,
                quantity: r.quantity,
                price: r.price,
                amount: r.amount,
                source: r.source,
                is_excluded: r.is_excluded
            }]);
            if (error) throw error;
        }
        
        const { data: coeffs } = await supabaseAdmin.from('est_coefficients').select('*').eq('doc_id', docId);
        for (const c of (coeffs || [])) {
            const { error } = await supabaseAdmin.from('est_coefficients').insert([{
                doc_id: newDocId,
                name: c.name,
                type: c.type,
                value_percent: c.value_percent
            }]);
            if (error) throw error;
        }
        
        res.json(newDoc);
    } catch (err) {
        console.error('[CREATE VERSION ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /estimates/estimators - получить список исполнителей/сметчиков
router.get('/estimators', async (req, res) => {
    try {
        let managers = null;
        try {
            const { data } = await supabaseAdmin
                .from('users')
                .select('id, first_name, last_name, email, role')
                .order('first_name');
            managers = data;
        } catch (e) {
            console.warn('[Estimators Users Query Warning]:', e);
        }

        if (!managers || managers.length === 0) {
            const { data: profiles } = await supabaseAdmin
                .from('profiles')
                .select('id, first_name, last_name, role')
                .order('first_name');
            managers = (profiles || []).map(p => ({
                id: p.id,
                first_name: p.first_name,
                last_name: p.last_name,
                email: `${p.first_name ? p.first_name.toLowerCase() : 'user'}@dev.local`,
                role: p.role
            }));
        }

        res.json(managers || []);
    } catch (err) {
        console.error('[GET ESTIMATORS ERROR]:', err);
        res.status(500).json({ error: 'Ошибка сервера при получении списка пользователей: ' + err.message });
    }
});

// GET /estimates/financial-directors - получить список финансовых директоров
router.get('/financial-directors', async (req, res) => {
    try {
        const { region_id } = req.query;
        const { data: profiles, error: profErr } = await supabaseAdmin
            .from('profiles')
            .select('id, first_name, last_name, role, profile_regions(region_id)')
            .eq('role', 'financial_director')
            .order('first_name');

        if (profErr) throw profErr;

        let filtered = profiles || [];
        if (region_id) {
            filtered = filtered.filter(p => p.profile_regions?.some(pr => pr.region_id === region_id));
        }

        const fds = filtered.map(p => ({
            id: p.id,
            first_name: p.first_name,
            last_name: p.last_name,
            email: `${p.first_name ? p.first_name.toLowerCase() : 'user'}@dev.local`,
            role: p.role
        }));

        res.json(fds);
    } catch (err) {
        console.error('[GET FINANCIAL DIRECTORS ERROR]:', err);
        res.status(500).json({ error: 'Ошибка сервера при получении списка финансовых директоров: ' + err.message });
    }
});

// ==========================================
// БЛОК: ПОЛУЧЕНИЕ СМЕТЫ ПО ID (ДОЛЖЕН БЫТЬ ПОСЛЕ ВСЕХ ДРУГИХ GET-МАРШРУТОВ)
// ==========================================

router.get('/:docId', async (req, res) => {
    try {
        const { docId } = req.params;
        console.log(`[FETCH] Getting document ${docId}`);
        
        const { data: doc } = await supabaseAdmin
            .from('est_documents')
            .select(`
                *,
                projects (id, name, status, code, region_id),
                project_objects:object_id (id, name),
                plan_approver:plan_approver_id (id, first_name, last_name),
                plan_submitted_by_user:plan_submitted_by (id, first_name, last_name)
            `)
            .eq('id', docId)
            .single();

        // US-06-004: наличие фактической сметы, созданной на основании этой плановой версии
        // (влияет на доступность действия "Деактивировать")
        if (doc && doc.estimate_type === 'planned') {
            const { data: actualChildren } = await supabaseAdmin
                .from('est_documents')
                .select('id')
                .eq('parent_doc_id', docId)
                .eq('estimate_type', 'actual')
                .limit(1);
            doc.has_actual_estimate = !!(actualChildren && actualChildren.length > 0);
        }

        // US-06-005: фактическая версия хранит ссылку на плановую версию-источник (BR-04)
        if (doc && doc.estimate_type === 'actual' && doc.parent_doc_id) {
            const { data: sourcePlan } = await supabaseAdmin
                .from('est_documents')
                .select('id, plan_version')
                .eq('id', doc.parent_doc_id)
                .maybeSingle();
            doc.source_plan = sourcePlan || null;
        }

        const regionId = doc?.region_id || doc?.projects?.region_id;
        let countryCode = 'GE';
        if (regionId) {
            const { data: reg } = await supabaseAdmin
                .from('dic_regions')
                .select('id, code, dic_countries(id, code)')
                .eq('id', regionId)
                .single();
            if (reg?.dic_countries?.code) {
                countryCode = reg.dic_countries.code.toUpperCase();
            }
        }
        const isAz = countryCode === 'AZ';
        if (doc) {
            doc.country_code = countryCode;
            doc.is_readonly = await checkIfDocLocked(docId);
        }

        const { data: wbs } = await supabaseAdmin.from('est_wbs').select('*').eq('doc_id', docId).order('sort_order');
        
        // Fetch all WBS templates for translations mapping
        const { data: wbsTemplates } = await supabaseAdmin
            .from('wbs_templates')
            .select('code, name_ru, name_en, name_ka, name_az, name_tr');

        const rawWbs = wbs || [];
        const localizedWbs = rawWbs.map(w => {
            const temp = (wbsTemplates || []).find(t => 
                t.name_ru === w.name ||
                t.name_en === w.name ||
                t.name_ka === w.name ||
                t.name_az === w.name ||
                t.name_tr === w.name
            );
            return {
                ...w,
                name_ru: temp?.name_ru || w.name,
                name_en: temp?.name_en || w.name,
                name_ka: temp?.name_ka || w.name,
                name_ge: temp?.name_ka || w.name,
                name_az: temp?.name_az || w.name,
                name_tr: temp?.name_tr || w.name
            };
        });

        const finalWbs = localizedWbs;

        const { data: works } = await supabaseAdmin.from('est_doc_works').select('*').eq('doc_id', docId).order('sort_order');
        const workIds = (works || []).map(w => w.work_id).filter(Boolean);

        const { data: jobsList } = workIds.length > 0 ? await supabaseAdmin
            .from('jobs')
            .select('id, code, name_id, dic_measures(id, code)')
            .in('id', workIds) : { data: [] };

        const { data: jobsCasList } = workIds.length > 0 ? await supabaseAdmin
            .from('jobs_cas')
            .select('id, code, name_id, dic_measures(id, code)')
            .in('id', workIds) : { data: [] };

        const jobsMap = {};
        (jobsList || []).forEach(j => { jobsMap[j.id] = j; });
        (jobsCasList || []).forEach(j => { jobsMap[j.id] = j; });
        const { data: resources } = await supabaseAdmin.from('est_doc_resources').select('*').eq('doc_id', docId);
        const { data: coefficients } = await supabaseAdmin.from('est_coefficients').select('*').eq('doc_id', docId);

        // Fetch resource details early to collect their measure IDs
        const resIds = (resources || []).map(r => r.resource_id).filter(Boolean);
        let resLocs = [];
        let customResourcesMap = {};

        if (isAz) {
            if (resIds.length > 0) {
                const [laborRes, machineRes, materialRes] = await Promise.all([
                    supabaseAdmin.from('Labor_cas').select('id, code, dic_measures(id, code), dic_resource_types(id, code)').in('id', resIds),
                    supabaseAdmin.from('Machine_cas').select('id, code, dic_measures(id, code), dic_resource_types(id, code)').in('id', resIds),
                    supabaseAdmin.from('Materials_cas').select('id, code, dic_measures(id, code), dic_resource_types(id, code)').in('id', resIds)
                ]);
                const allCustomResources = [
                    ...(laborRes.data || []),
                    ...(machineRes.data || []),
                    ...(materialRes.data || [])
                ];
                allCustomResources.forEach(r => {
                    customResourcesMap[r.id] = r;
                });
                const { data: locs } = await supabaseAdmin
                    .from('localization')
                    .select('object_id, locale, name')
                    .in('object_name', ['Labor_cas', 'Machine_cas', 'Materials_cas'])
                    .in('object_id', resIds);
                resLocs = locs || [];
            }
        } else {
            if (resIds.length > 0) {
                const { data: geRes } = await supabaseAdmin
                    .from('resources')
                    .select('id, code, dic_measures(id, code), dic_resource_types(id, code)')
                    .in('id', resIds);
                (geRes || []).forEach(r => {
                    customResourcesMap[r.id] = r;
                });
                const { data: locs } = await supabaseAdmin
                    .from('localization')
                    .select('object_id, locale, name')
                    .eq('object_name', 'resources')
                    .in('object_id', resIds);
                resLocs = locs || [];
            }
        }

        const allWorkNameIds = Array.from(new Set(
            (works || []).flatMap(w => [w.work_id, jobsMap[w.work_id]?.name_id]).filter(Boolean)
        ));

        const { data: workLocs } = allWorkNameIds.length > 0 ? await supabaseAdmin
            .from('localization')
            .select('object_id, locale, name')
            .eq('object_name', isAz ? 'jobs_cas' : 'jobs')
            .in('object_id', allWorkNameIds) : { data: [] };

        const workLocMap = {};
        (workLocs || []).forEach(l => {
            if (!workLocMap[l.object_id]) workLocMap[l.object_id] = {};
            workLocMap[l.object_id][l.locale] = l.name;
        });

        // Collect all measure IDs from both works and resources
        const allMeasureIds = Array.from(new Set([
            ...(jobsList || []).map(j => j.dic_measures?.id),
            ...(jobsCasList || []).map(j => j.dic_measures?.id),
            ...Object.values(customResourcesMap).map(r => r.dic_measures?.id)
        ])).filter(Boolean);

        const { data: measureLocs } = allMeasureIds.length > 0 ? await supabaseAdmin.from('localization')
            .select('object_id, locale, name')
            .eq('object_name', 'dic_measures')
            .in('object_id', allMeasureIds) : { data: [] };
        
        const measureLocMap = {};
        (measureLocs || []).forEach(l => {
            if (!measureLocMap[l.object_id]) measureLocMap[l.object_id] = {};
            measureLocMap[l.object_id][l.locale] = l.name;
        });

        const formattedWorks = (works || []).map(w => {
            const job = jobsMap[w.work_id] || {};
            const names = workLocMap[w.work_id] || workLocMap[job.name_id] || {};
            const measureId = job.dic_measures?.id;
            const unitNames = measureLocMap[measureId] || {};
            const rawName = names.ru || names.en || names.ka || names.az || names.tr || '';
            const defaultName = rawName ? `${job.code || ''} ${rawName}`.trim() : (job.code ? `${job.code} Строительные работы` : 'Строительные работы');

            return {
                id: w.id,
                doc_id: docId,
                wbs_id: w.wbs_id,
                work_id: w.work_id,
                volume: w.volume,
                price: w.price,
                amount: w.amount,
                fact_volume: w.fact_volume,
                fact_amount: w.fact_amount,
                is_excluded: w.is_excluded,
                sort_order: w.sort_order,
                est_works: {
                    name: defaultName,
                    name_ru: names.ru ? `${job.code || ''} ${names.ru}`.trim() : defaultName,
                    name_en: names.en ? `${job.code || ''} ${names.en}`.trim() : defaultName,
                    name_ge: names.ka ? `${job.code || ''} ${names.ka}`.trim() : defaultName,
                    name_ka: names.ka ? `${job.code || ''} ${names.ka}`.trim() : defaultName,
                    name_az: names.az ? `${job.code || ''} ${names.az}`.trim() : defaultName,
                    name_tr: names.tr ? `${job.code || ''} ${names.tr}`.trim() : defaultName,
                    unit: unitNames.ru || unitNames.en || unitNames.ka || unitNames.az || unitNames.tr || job.dic_measures?.code || 'PCS',
                    unit_ru: unitNames.ru || job.dic_measures?.code || '',
                    unit_en: unitNames.en || job.dic_measures?.code || '',
                    unit_ka: unitNames.ka || job.dic_measures?.code || '',
                    unit_ge: unitNames.ka || job.dic_measures?.code || '',
                    unit_az: unitNames.az || job.dic_measures?.code || '',
                    unit_tr: unitNames.tr || job.dic_measures?.code || ''
                }
            };
        });

        // Resource details already loaded above

        const resLocMap = {};
        (resLocs || []).forEach(l => {
            if (!resLocMap[l.object_id]) resLocMap[l.object_id] = {};
            resLocMap[l.object_id][l.locale] = l.name;
        });

        const { data: typeLocs } = await supabaseAdmin
            .from('localization')
            .select('object_id, locale, name')
            .eq('object_name', 'dic_resource_types');

        const typeLocMap = {};
        (typeLocs || []).forEach(l => {
            if (!typeLocMap[l.object_id]) typeLocMap[l.object_id] = {};
            typeLocMap[l.object_id][l.locale] = l.name;
        });

        const formattedResources = (resources || []).map(r => {
            const resObj = customResourcesMap[r.resource_id] || r.resources || {};
            const names = resLocMap[r.resource_id] || {};
            const typeId = resObj.dic_resource_types?.id;
            const typeNames = typeLocMap[typeId] || {};
            const measureId = resObj.dic_measures?.id;
            const unitNames = measureLocMap[measureId] || {};
            return {
                id: r.id,
                doc_id: docId,
                work_id: r.work_id,
                resource_id: r.resource_id,
                norm: r.norm,
                quantity: r.quantity,
                price: r.price,
                amount: r.amount,
                source: r.source,
                fact_norm: r.fact_norm,
                fact_quantity: r.fact_quantity,
                fact_price: r.fact_price,
                fact_amount: r.fact_amount,
                is_excluded: r.is_excluded,
                est_resources: {
                    code: resObj.code || '',
                    name: names.ru || names.en || names.ka || names.az || names.tr || `Resource ${resObj.code || ''}`,
                    name_ru: names.ru || '',
                    name_en: names.en || '',
                    name_ge: names.ka || '',
                    name_ka: names.ka || '',
                    name_az: names.az || '',
                    name_tr: names.tr || '',
                    type: typeNames.ru || typeNames.en || typeNames.ka || typeNames.az || typeNames.tr || `Type ${resObj.dic_resource_types?.code || ''}`,
                    type_ru: typeNames.ru || '',
                    type_en: typeNames.en || '',
                    type_ka: typeNames.ka || '',
                    type_ge: typeNames.ka || '',
                    type_az: typeNames.az || '',
                    type_tr: typeNames.tr || '',
                    type_code: resObj.dic_resource_types?.code || '',
                    unit: unitNames.ru || unitNames.en || unitNames.ka || unitNames.az || unitNames.tr || resObj.dic_measures?.code || 'PCS',
                    unit_ru: unitNames.ru || resObj.dic_measures?.code || '',
                    unit_en: unitNames.en || resObj.dic_measures?.code || '',
                    unit_ka: unitNames.ka || resObj.dic_measures?.code || '',
                    unit_ge: unitNames.ka || resObj.dic_measures?.code || '',
                    unit_az: unitNames.az || resObj.dic_measures?.code || '',
                    unit_tr: unitNames.tr || resObj.dic_measures?.code || ''
                }
            };
        });

        // Deduplicate coefficients by name
        const uniqueCoefficients = [];
        const seenCoeffNames = new Set();
        (coefficients || []).forEach(c => {
            const lowerName = (c.name || '').trim().toLowerCase();
            if (!seenCoeffNames.has(lowerName)) {
                seenCoeffNames.add(lowerName);
                uniqueCoefficients.push({
                    ...c,
                    doc_id: docId
                });
            }
        });

        let versionsList = [];
        if (doc) {
            const rootId = doc.parent_doc_id || doc.id;
            const { data: dbVersions } = await supabaseAdmin
                .from('est_documents')
                .select('id, estimate_type, plan_version, status, created_at, plan_created_at')
                .or(`id.eq.${rootId},parent_doc_id.eq.${rootId}`)
                .order('plan_version', { ascending: true, nullsFirst: true });
            
            versionsList = (dbVersions || []).map(v => ({
                id: v.id,
                estimate_type: v.estimate_type || 'work',
                plan_version: v.plan_version,
                status: v.status,
                created_at: v.plan_created_at || v.created_at
            }));
        }

        res.json({
            doc,
            wbs: finalWbs || [],
            works: formattedWorks || [],
            resources: formattedResources || [],
            coefficients: uniqueCoefficients || [],
            versions: versionsList
        });
    } catch (err) {
        console.error('[FETCH ERROR]:', err);
        res.status(500).json({ error: 'Ошибка сервера при получении сметы: ' + err.message });
    }
});

// --- 9. УДАЛЕНИЕ СМЕТЫ ---
router.delete('/:docId', async (req, res) => {
    try {
        const { docId } = req.params;
        
        // Fetch the estimate
        const { data: est, error: fetchErr } = await supabaseAdmin
            .from('est_documents')
            .select('*')
            .eq('id', docId)
            .maybeSingle();

        if (fetchErr || !est) {
            return res.status(404).json({ error: 'Смета не найдена' });
        }

        if (est.status && est.status.startsWith('planned_')) {
            return res.status(403).json({ error: 'Удаление плановой версии сметы заблокировано' });
        }

        // Check if the status is 'draft'
        if (est.status !== 'draft') {
            return res.status(400).json({ error: 'Можно удалять только сметы со статусом Черновик (draft)' });
        }

        // Check permissions: admin or creator
        const isAdmin = req.user?.role === 'admin';
        const isCreator = est.created_by && req.user?.id && (est.created_by === req.user.id);
        
        if (!isAdmin && !isCreator) {
            return res.status(403).json({ error: 'У вас нет прав на удаление этой сметы. Смету может удалить только её создатель или администратор.' });
        }

        console.log(`[DELETE ESTIMATE] Deleting estimate ${docId} (Project: ${est.project_id}, Object: ${est.object_id})...`);

        // Cascade delete from child tables
        // 1. est_coefficients
        await supabaseAdmin.from('est_coefficients').delete().eq('doc_id', docId);
        
        // 2. est_doc_resources
        await supabaseAdmin.from('est_doc_resources').delete().eq('doc_id', docId);

        // 3. est_doc_works
        await supabaseAdmin.from('est_doc_works').delete().eq('doc_id', docId);

        // 4. est_wbs
        await supabaseAdmin.from('est_wbs').delete().eq('doc_id', docId);

        // 5. est_documents
        const { error: delErr } = await supabaseAdmin.from('est_documents').delete().eq('id', docId);

        if (delErr) {
            throw delErr;
        }

        console.log(`[DELETE ESTIMATE] Estimate ${docId} deleted successfully!`);
        res.json({ success: true, message: 'Смета успешно удалена' });
    } catch (err) {
        console.error('[DELETE ESTIMATE ERROR]:', err);
        res.status(500).json({ error: 'Ошибка сервера при удалении сметы: ' + err.message });
    }
});

// --- КАЛЕНДАРНОЕ ПЛАНИРОВАНИЕ (US-001) ---
const fs = require('fs');
const path = require('path');
const SCHEDULE_FILE_PATH = path.join(__dirname, '..', 'data', 'schedules.json');

function readSchedulesStore() {
    try {
        if (!fs.existsSync(SCHEDULE_FILE_PATH)) {
            const dir = path.dirname(SCHEDULE_FILE_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(SCHEDULE_FILE_PATH, JSON.stringify({}), 'utf8');
            return {};
        }
        const content = fs.readFileSync(SCHEDULE_FILE_PATH, 'utf8');
        return JSON.parse(content || '{}');
    } catch (err) {
        console.error('[SCHEDULE STORE READ ERROR]:', err);
        return {};
    }
}

function writeSchedulesStore(store) {
    try {
        const dir = path.dirname(SCHEDULE_FILE_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(SCHEDULE_FILE_PATH, JSON.stringify(store, null, 2), 'utf8');
    } catch (err) {
        console.error('[SCHEDULE STORE WRITE ERROR]:', err);
    }
}

// Есть ли у работы связь (зависимость) в КП, и с какой работой — используется в разделе
// «Сметы» перед удалением работы, чтобы предупредить: связь потеряется, но дата/длительность
// оставшейся связанной работы не изменятся (их значения не трогаем — удаляем только саму
// связь-строку в est_work_dependencies, что и так происходит автоматически при сохранении
// сметы без этой работы).
router.get('/work-links/:workId', async (req, res) => {
    try {
        const { workId } = req.params;
        const { data: deps, error: depsErr } = await supabaseAdmin
            .from('est_work_dependencies')
            .select('predecessor_id, successor_id')
            .or(`predecessor_id.eq.${workId},successor_id.eq.${workId}`);
        if (depsErr) throw depsErr;

        if (!deps || deps.length === 0) {
            return res.json({ linked: false, links: [] });
        }

        const otherIds = Array.from(new Set(deps.map(d => (d.predecessor_id === workId ? d.successor_id : d.predecessor_id))));
        const { data: otherWorks } = await supabaseAdmin
            .from('est_doc_works')
            .select('id, work_id')
            .in('id', otherIds);

        const jobIds = Array.from(new Set((otherWorks || []).map(w => w.work_id).filter(Boolean)));
        const { data: jobsList } = jobIds.length > 0 ? await supabaseAdmin.from('jobs').select('id, code').in('id', jobIds) : { data: [] };
        const { data: jobsCasList } = jobIds.length > 0 ? await supabaseAdmin.from('jobs_cas').select('id, code').in('id', jobIds) : { data: [] };
        const jobsMap = {};
        (jobsList || []).forEach(j => { jobsMap[j.id] = j; });
        (jobsCasList || []).forEach(j => { jobsMap[j.id] = j; });

        // localization.object_id для jobs/jobs_cas — это id самой работы в справочнике,
        // а не name_id (см. установленный ранее паттерн в /schedule/:docId ниже).
        const { data: locs } = jobIds.length > 0 ? await supabaseAdmin
            .from('localization')
            .select('object_id, locale, name')
            .in('object_name', ['jobs', 'jobs_cas'])
            .in('object_id', jobIds) : { data: [] };
        const locMap = {};
        (locs || []).forEach(l => {
            if (!locMap[l.object_id]) locMap[l.object_id] = {};
            locMap[l.object_id][l.locale] = l.name;
        });

        const links = (otherWorks || []).map(w => {
            const names = locMap[w.work_id] || {};
            const name = names.ru || names.en || names.ka || names.az || (jobsMap[w.work_id]?.code) || 'Работа';
            return { workId: w.id, name };
        });

        res.json({ linked: true, links });
    } catch (err) {
        console.error('[WORK LINKS CHECK ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Получить данные календарного планирования для сметы
router.get('/schedule/:docId', async (req, res) => {
    try {
        const { docId } = req.params;
        const { lang = 'ru' } = req.query;

        // 1. Получаем документ сметы
        const { data: doc, error: docErr } = await supabaseAdmin
            .from('est_documents')
            .select('*, projects:project_uuid(region_id)')
            .eq('id', docId)
            .single();

        if (docErr || !doc) {
            return res.status(404).json({ error: 'Смета не найдена' });
        }

        const regionId = doc.region_id || doc.projects?.region_id;
        let countryCode = 'GE';
        if (regionId) {
            const { data: reg } = await supabaseAdmin
                .from('dic_regions')
                .select('id, code, dic_countries(id, code)')
                .eq('id', regionId)
                .single();
            if (reg?.dic_countries?.code) {
                countryCode = reg.dic_countries.code.toUpperCase();
            }
        }
        const isAz = countryCode === 'AZ';
        doc.is_readonly = await checkIfDocLocked(docId);

        // 2. Получаем данные проекта (включая start_date и end_date)
        // ВАЖНО: doc.project_id — это текстовый код/название сметы (например, номер объекта),
        // а не UUID проекта. Реальная ссылка на таблицу projects — doc.project_uuid.
        let project = null;
        if (doc.project_uuid) {
            const { data: p } = await supabaseAdmin
                .from('projects')
                .select('id, code, name, start_date, end_date, manager_id')
                .eq('id', doc.project_uuid)
                .single();
            project = p;
        }

        // 3. Получаем список менеджеров / исполнителей
        let managers = null;
        try {
            const { data } = await supabaseAdmin
                .from('users')
                .select('id, first_name, last_name, email, role')
                .order('first_name');
            managers = data;
        } catch (e) {
            console.warn('[Schedule Users Query Warning]:', e);
        }

        if (!managers || managers.length === 0) {
            const { data: profiles } = await supabaseAdmin
                .from('profiles')
                .select('id, first_name, last_name, role')
                .order('first_name');
            managers = (profiles || []).map(p => ({
                id: p.id,
                first_name: p.first_name,
                last_name: p.last_name,
                email: `${p.first_name ? p.first_name.toLowerCase() : 'user'}@dev.local`,
                role: p.role
            }));
        }

        // 4. Получаем структуру WBS
        const { data: wbs } = await supabaseAdmin
            .from('est_wbs')
            .select('*')
            .eq('doc_id', docId)
            .eq('is_excluded', false)
            .order('sort_order');

        // Fetch all WBS templates for translations mapping
        const { data: wbsTemplates } = await supabaseAdmin
            .from('wbs_templates')
            .select('code, name_ru, name_en, name_ka, name_az, name_tr');

        const wbsWithLoc = (wbs || []).map(w => {
            const temp = (wbsTemplates || []).find(t => 
                t.name_ru === w.name ||
                t.name_en === w.name ||
                t.name_ka === w.name ||
                t.name_az === w.name ||
                t.name_tr === w.name
            );
            return {
                ...w,
                name_ru: temp?.name_ru || w.name,
                name_en: temp?.name_en || w.name,
                name_ka: temp?.name_ka || w.name,
                name_ge: temp?.name_ka || w.name,
                name_az: temp?.name_az || w.name,
                name_tr: temp?.name_tr || w.name
            };
        });

        // 5. Получаем работы сметы
        const { data: works } = await supabaseAdmin
            .from('est_doc_works')
            .select('id, doc_id, wbs_id, work_id, volume, price, amount, is_excluded, sort_order')
            .eq('doc_id', docId)
            .eq('is_excluded', false);

        // 6. Подгружаем названия работ и единицы измерения из jobs и jobs_cas
        const workIds = (works || []).map(w => w.work_id).filter(Boolean);

        const { data: jobsList } = workIds.length > 0 ? await supabaseAdmin
            .from('jobs')
            .select('id, code, name_id, dic_measures(id, code)')
            .in('id', workIds) : { data: [] };

        const { data: jobsCasList } = workIds.length > 0 ? await supabaseAdmin
            .from('jobs_cas')
            .select('id, code, name_id, dic_measures(id, code)')
            .in('id', workIds) : { data: [] };

        const jobsMap = {};
        (jobsList || []).forEach(j => { jobsMap[j.id] = j; });
        (jobsCasList || []).forEach(j => { jobsMap[j.id] = j; });

        const allWorkNameIds = Array.from(new Set(
            (works || []).flatMap(w => [w.work_id, jobsMap[w.work_id]?.name_id]).filter(Boolean)
        ));

        const { data: workLocs } = allWorkNameIds.length > 0 ? await supabaseAdmin
            .from('localization')
            .select('object_id, locale, name')
            .eq('object_name', isAz ? 'jobs_cas' : 'jobs')
            .in('object_id', allWorkNameIds) : { data: [] };

        const workLocMap = {};
        (workLocs || []).forEach(l => {
            if (!workLocMap[l.object_id]) workLocMap[l.object_id] = {};
            workLocMap[l.object_id][l.locale] = l.name;
        });

        const allMeasureIds = Array.from(new Set([
            ...(jobsList || []).map(j => j.dic_measures?.id),
            ...(jobsCasList || []).map(j => j.dic_measures?.id)
        ])).filter(Boolean);

        const { data: measureLocs } = allMeasureIds.length > 0 ? await supabaseAdmin.from('localization')
            .select('object_id, locale, name')
            .eq('object_name', 'dic_measures')
            .in('object_id', allMeasureIds) : { data: [] };

        const measureLocMap = {};
        (measureLocs || []).forEach(l => {
            if (!measureLocMap[l.object_id]) measureLocMap[l.object_id] = {};
            measureLocMap[l.object_id][l.locale] = l.name;
        });

        // 7. Читаем расписание из est_doc_schedules (основная таблица)
        let docScheduleStore = {};

        try {
            const { data: dbSchedList, error: dbSchedErr } = await supabaseAdmin
                .from('est_doc_schedules')
                .select('*')
                .eq('doc_id', docId);

            if (!dbSchedErr && dbSchedList && dbSchedList.length > 0) {
                // est_doc_schedules имеет данные — используем их как единственный источник
                dbSchedList.forEach(item => {
                    if (item.work_id) {
                        // work_id в est_doc_schedules = est_doc_works.id
                        docScheduleStore[item.work_id] = {
                            start_date: item.start_date,
                            duration_days: item.duration_days,
                            assignee_id: item.assignee_id,
                            assignee_type: 'employee',
                            assignee_name: null
                        };
                    }
                });
            } else {
                // est_doc_schedules пуста — падаем до localization бэкапа
                try {
                    const { data: dbSched } = await supabaseAdmin
                        .from('localization')
                        .select('name')
                        .eq('object_name', 'est_schedule')
                        .eq('object_id', docId)
                        .maybeSingle();
                    if (dbSched && dbSched.name) {
                        const parsed = JSON.parse(dbSched.name);
                        // Ключ в localization может быть w.id (есть) или старый формат
                        Object.entries(parsed).forEach(([key, val]) => {
                            if (typeof val === 'object' && val !== null) {
                                docScheduleStore[key] = {
                                    start_date: val.start_date,
                                    duration_days: val.duration_days || 1,
                                    assignee_id: val.assignee_id || null
                                };
                            }
                        });
                    }
                } catch (e) {
                    console.warn('[LOCALIZATION SCHEDULE FETCH FALLBACK ERROR]:', e.message);
                }
                // Также проверяем локальный файл как последний резерв
                try {
                    const fileStore = readSchedulesStore();
                    if (fileStore && fileStore[docId]) {
                        Object.entries(fileStore[docId]).forEach(([key, val]) => {
                            if (!docScheduleStore[key] && typeof val === 'object' && val !== null) {
                                docScheduleStore[key] = {
                                    start_date: val.start_date,
                                    duration_days: val.duration_days || 1,
                                    assignee_id: val.assignee_id || null
                                };
                            }
                        });
                    }
                } catch (e) {
                    console.warn('[FILE SCHEDULE FETCH FALLBACK ERROR]:', e.message);
                }
            }
        } catch (e) {
            console.warn('[DB est_doc_schedules FETCH ERROR]:', e.message);
        }

        let projectStartDate = new Date().toISOString().split('T')[0];
        if (project && project.start_date) {
            try {
                projectStartDate = new Date(project.start_date).toISOString().split('T')[0];
            } catch (e) {
                // Ignore
            }
        }

        // 8. Считаем количество людей (трудовые ресурсы, тип 10.100.) на каждую работу — для Ганта
        const laborCountMap = {};
        try {
            const { data: docResources } = await supabaseAdmin
                .from('est_doc_resources')
                .select('work_id, resource_id, quantity, fact_quantity')
                .eq('doc_id', docId)
                .eq('is_excluded', false);

            const resIds = (docResources || []).map(r => r.resource_id).filter(Boolean);
            let laborResIds = new Set();

            if (resIds.length > 0) {
                if (isAz) {
                    const { data: laborRes } = await supabaseAdmin.from('Labor_cas').select('id').in('id', resIds);
                    (laborRes || []).forEach(r => laborResIds.add(r.id));
                } else {
                    const { data: laborRes } = await supabaseAdmin
                        .from('resources')
                        .select('id, dic_resource_types(id, code)')
                        .in('id', resIds);
                    (laborRes || []).forEach(r => {
                        const tCode = r.dic_resource_types?.code;
                        const rtId = r.dic_resource_types?.id;
                        if (rtId === '5f2071ad-a611-43de-82f0-a5e788c9499f' || (tCode && tCode.startsWith('10.100.'))) {
                            laborResIds.add(r.id);
                        }
                    });
                }
            }

            (docResources || []).forEach(r => {
                if (!r.work_id || !laborResIds.has(r.resource_id)) return;
                const qty = doc.estimate_type === 'actual'
                    ? Number(r.fact_quantity != null ? r.fact_quantity : r.quantity || 0)
                    : Number(r.quantity || 0);
                laborCountMap[r.work_id] = (laborCountMap[r.work_id] || 0) + qty;
            });
        } catch (e) {
            console.warn('[SCHEDULE LABOR COUNT ERROR]:', e.message);
        }

        const formattedWorks = (works || []).map(w => {
            const job = jobsMap[w.work_id] || {};
            const names = workLocMap[w.work_id] || workLocMap[job.name_id] || {};
            const measureId = job.dic_measures?.id;
            const unitNames = measureLocMap[measureId] || {};

            // Код работы уже приходит отдельным полем `code` (своя колонка «КОД») — раньше он
            // ещё и приклеивался в начало `name`, из-за чего в печатной форме КП и на диаграмме
            // Ганта код показывался дважды подряд.
            const rawName = names[lang] || names.ru || names.en || names.ka || names.az || '';
            const jobName = rawName || 'Строительные работы';
            const unitName = unitNames[lang] || unitNames.ru || unitNames.en || job.dic_measures?.code || 'ед.';
            const schedItem = docScheduleStore[w.id] || docScheduleStore[w.work_id] || {};

            let itemStartDate = schedItem.start_date || projectStartDate;
            if (itemStartDate && itemStartDate.includes('T')) {
                itemStartDate = itemStartDate.split('T')[0];
            }

            return {
                id: w.id,
                doc_id: w.doc_id,
                wbs_id: w.wbs_id,
                work_id: w.work_id,
                name: jobName,
                code: job.code || '',
                volume: w.volume,
                unit: unitName,
                start_date: itemStartDate,
                duration_days: parseInt(schedItem.duration_days, 10) || 1,
                assignee_id: schedItem.assignee_id || null,
                labor_count: laborCountMap[w.id] || 0
            };
        });

        let dependencies = [];
        try {
            const { data: dbDeps, error: dbDepsErr } = await supabaseAdmin
                .from('est_work_dependencies')
                .select('*')
                .eq('doc_id', docId);
            if (!dbDepsErr && dbDeps) {
                dependencies = dbDeps;
            }
        } catch (e) {
            console.warn('[DB est_work_dependencies FETCH ERROR]:', e.message);
        }

        // Calculate critical path on load
        let cp = {};
        try {
            const worksList = formattedWorks.map(w => ({
                id: w.id,
                base_start_date: w.start_date,
                duration_days: w.duration_days
            }));
            const calculatedSchedules = {};
            formattedWorks.forEach(w => {
                calculatedSchedules[w.id] = {
                    start_date: w.start_date,
                    duration_days: w.duration_days
                };
            });
            cp = calculateCriticalPath(worksList, dependencies, calculatedSchedules, projectStartDate);
        } catch (e) {
            console.warn('[GET SCHEDULE CRITICAL PATH CALCULATION ERROR]:', e.message);
        }

        res.json({
            doc,
            project,
            wbs: wbsWithLoc || [],
            works: formattedWorks,
            managers: managers || [],
            dependencies: dependencies,
            criticalPath: cp
        });
    } catch (err) {
        console.error('[SCHEDULE FETCH ERROR]:', err);
        res.status(500).json({ error: 'Ошибка загрузки календарного плана: ' + err.message });
    }
});

// Сохранить календарный план для сметы с ведением журнала изменений (аудит)
const AUDIT_FILE_PATH = path.join(__dirname, '..', 'data', 'schedule_audit.json');

function writeAuditLog(docId, schedules) {
    try {
        let logs = [];
        if (fs.existsSync(AUDIT_FILE_PATH)) {
            const content = fs.readFileSync(AUDIT_FILE_PATH, 'utf8');
            logs = JSON.parse(content || '[]');
        }
        
        const timestamp = new Date().toISOString();
        Object.entries(schedules).forEach(([workId, val]) => {
            logs.push({
                timestamp,
                user: 'Сметчик',
                doc_id: docId,
                work_id: workId,
                action: 'UPDATE_SCHEDULE',
                new_values: val
            });
        });

        // Ограничим лог последними 1000 записями
        if (logs.length > 1000) {
            logs = logs.slice(logs.length - 1000);
        }

        const dir = path.dirname(AUDIT_FILE_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(AUDIT_FILE_PATH, JSON.stringify(logs, null, 2), 'utf8');
    } catch (err) {
        console.error('[AUDIT WRITE ERROR]:', err);
    }
}

// =========================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ КАЛЕНДАРНОГО ПЛАНИРОВАНИЯ И ЗАВИСИМОСТЕЙ
// =========================================================================

function topologicalSort(nodes, edges) {
    const adj = {};
    const inDegree = {};
    nodes.forEach(id => {
        adj[id] = [];
        inDegree[id] = 0;
    });

    edges.forEach(e => {
        if (adj[e.predecessor_id]) {
            adj[e.predecessor_id].push(e.successor_id);
            inDegree[e.successor_id]++;
        }
    });

    const queue = [];
    nodes.forEach(id => {
        if (inDegree[id] === 0) queue.push(id);
    });

    const order = [];
    while (queue.length > 0) {
        const u = queue.shift();
        order.push(u);
        const neighbors = adj[u] || [];
        neighbors.forEach(v => {
            inDegree[v]--;
            if (inDegree[v] === 0) queue.push(v);
        });
    }

    return order;
}

function hasCycle(nodes, edges) {
    const adj = {};
    nodes.forEach(id => { adj[id] = []; });
    edges.forEach(e => {
        if (adj[e.predecessor_id]) {
            adj[e.predecessor_id].push(e.successor_id);
        }
    });

    const visited = {}; // id -> 0: unvisited, 1: visiting, 2: visited
    nodes.forEach(id => { visited[id] = 0; });

    function dfs(u) {
        visited[u] = 1;
        const neighbors = adj[u] || [];
        for (const v of neighbors) {
            if (visited[v] === 1) return true;
            if (visited[v] === 0) {
                if (dfs(v)) return true;
            }
        }
        visited[u] = 2;
        return false;
    }

    for (const id of nodes) {
        if (visited[id] === 0) {
            if (dfs(id)) return true;
        }
    }
    return false;
}

const addDays = (dateStr, days) => {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
};

function recalculateSchedules(worksList, dependencies, projectStartDate) {
    const nodes = worksList.map(w => w.id);
    const order = topologicalSort(nodes, dependencies);

    const calculated = {};
    worksList.forEach(w => {
        calculated[w.id] = {
            id: w.id,
            start_date: w.base_start_date || projectStartDate,
            duration_days: w.duration_days
        };
    });

    const incoming = {};
    nodes.forEach(id => { incoming[id] = []; });
    dependencies.forEach(dep => {
        if (incoming[dep.successor_id]) {
            incoming[dep.successor_id].push(dep);
        }
    });

    order.forEach(id => {
        const work = calculated[id];
        const deps = incoming[id] || [];
        if (deps.length === 0) return;

        let maxStart = new Date(work.start_date);

        deps.forEach(dep => {
            const pred = calculated[dep.predecessor_id];
            if (!pred) return;

            let proposedStart = null;
            const predStartStr = pred.start_date;
            const predEndStr = addDays(predStartStr, pred.duration_days - 1);

            if (dep.type === 'FS') {
                proposedStart = new Date(predEndStr);
                proposedStart.setDate(proposedStart.getDate() + 1 + (dep.lag || 0));
            } else if (dep.type === 'SS') {
                proposedStart = new Date(predStartStr);
                proposedStart.setDate(proposedStart.getDate() + (dep.lag || 0));
            } else if (dep.type === 'FF') {
                const proposedEnd = new Date(predEndStr);
                proposedEnd.setDate(proposedEnd.getDate() + (dep.lag || 0));
                proposedStart = new Date(proposedEnd);
                proposedStart.setDate(proposedStart.getDate() - work.duration_days + 1);
            } else if (dep.type === 'SF') {
                const proposedEnd = new Date(predStartStr);
                proposedEnd.setDate(proposedEnd.getDate() + (dep.lag || 0));
                proposedStart = new Date(proposedEnd);
                proposedStart.setDate(proposedStart.getDate() - work.duration_days + 1);
            }

            if (proposedStart && proposedStart > maxStart) {
                maxStart = proposedStart;
            }
        });

        const projStart = new Date(projectStartDate);
        if (maxStart < projStart) {
            maxStart = projStart;
        }

        work.start_date = maxStart.toISOString().split('T')[0];
    });

    return calculated;
}

function calculateCriticalPath(worksList, dependencies, calculatedSchedules, projectStartDate) {
    const nodes = worksList.map(w => w.id);
    if (nodes.length === 0) return {};

    const ES = {};
    const EF = {};
    const duration = {};

    worksList.forEach(w => {
        const sched = calculatedSchedules[w.id];
        ES[w.id] = new Date(sched.start_date);
        duration[w.id] = sched.duration_days;

        const efDate = new Date(sched.start_date);
        efDate.setDate(efDate.getDate() + sched.duration_days - 1);
        EF[w.id] = efDate;
    });

    let projectFinish = new Date(projectStartDate);
    nodes.forEach(id => {
        if (EF[id] > projectFinish) {
            projectFinish = EF[id];
        }
    });

    const LF = {};
    const LS = {};
    nodes.forEach(id => {
        LF[id] = new Date(projectFinish);
    });

    const order = topologicalSort(nodes, dependencies);
    const revOrder = [...order].reverse();

    const outgoing = {};
    nodes.forEach(id => { outgoing[id] = []; });
    dependencies.forEach(dep => {
        if (outgoing[dep.predecessor_id]) {
            outgoing[dep.predecessor_id].push(dep);
        }
    });

    revOrder.forEach(id => {
        const deps = outgoing[id] || [];
        if (deps.length === 0) {
            const lsDate = new Date(LF[id]);
            lsDate.setDate(lsDate.getDate() - duration[id] + 1);
            LS[id] = lsDate;
            return;
        }

        let minLF = new Date(projectFinish);
        let first = true;

        deps.forEach(dep => {
            const succ = calculatedSchedules[dep.successor_id];
            if (!succ) return;

            const succLS = LS[dep.successor_id];
            const succLF = new Date(succLS);
            succLF.setDate(succLF.getDate() + succ.duration_days - 1);

            let reqLF = null;

            if (dep.type === 'FS') {
                reqLF = new Date(succLS);
                reqLF.setDate(reqLF.getDate() - 1 - (dep.lag || 0));
            } else if (dep.type === 'SS') {
                const reqLS = new Date(succLS);
                reqLS.setDate(reqLS.getDate() - (dep.lag || 0));
                reqLF = new Date(reqLS);
                reqLF.setDate(reqLF.getDate() + duration[id] - 1);
            } else if (dep.type === 'FF') {
                reqLF = new Date(succLF);
                reqLF.setDate(reqLF.getDate() - (dep.lag || 0));
            } else if (dep.type === 'SF') {
                const reqLS = new Date(succLF);
                reqLS.setDate(reqLS.getDate() - (dep.lag || 0));
                reqLF = new Date(reqLS);
                reqLF.setDate(reqLF.getDate() + duration[id] - 1);
            }

            if (reqLF) {
                if (first || reqLF < minLF) {
                    minLF = reqLF;
                    first = false;
                }
            }
        });

        LF[id] = minLF;
        const lsDate = new Date(LF[id]);
        lsDate.setDate(lsDate.getDate() - duration[id] + 1);
        LS[id] = lsDate;
    });

    const criticalPath = {};
    nodes.forEach(id => {
        const slack = Math.round((LF[id] - EF[id]) / (1000 * 60 * 60 * 24));
        criticalPath[id] = slack <= 0;
    });

    return criticalPath;
}

router.post('/schedule-save', async (req, res) => {
    try {
        const { doc_id, schedules, dependencies = [], wbs_periods = {} } = req.body;
        if (!doc_id || !schedules) {
            return res.status(400).json({ error: 'Обязательные параметры: doc_id, schedules' });
        }

        if (await checkIfDocLocked(doc_id)) {
            return res.status(403).json({ error: 'Редактирование календарного плана заблокировано' });
        }

        const isValidUuid = (id) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

        // 1. Получаем все работы сметы из базы данных для проверки существования
        // (wbs_id нужен ниже — чтобы проверить, что работы укладываются в период своего
        // конструктива, см. "8b. Период конструктива" после расчёта итоговых дат).
        const { data: dbWorks, error: dbWorksErr } = await supabaseAdmin
            .from('est_doc_works')
            .select('id, wbs_id')
            .eq('doc_id', doc_id)
            .eq('is_excluded', false);

        if (dbWorksErr) throw dbWorksErr;
        const validWorkIds = new Set((dbWorks || []).map(w => w.id));
        const workIdToWbsId = {};
        (dbWorks || []).forEach(w => { workIdToWbsId[w.id] = w.wbs_id; });

        // 2. Валидация зависимостей
        for (const dep of dependencies) {
            if (!dep.predecessor_id || !dep.successor_id) {
                return res.status(400).json({ error: 'Предшествующая и последующая работы должны быть заполнены' });
            }
            if (dep.predecessor_id === dep.successor_id) {
                return res.status(400).json({ error: 'Работа не может зависеть сама от себя' });
            }
            if (!validWorkIds.has(dep.predecessor_id)) {
                return res.status(400).json({ error: 'Нельзя создать зависимость между работами разных проектов' });
            }
            if (!validWorkIds.has(dep.successor_id)) {
                return res.status(400).json({ error: 'Нельзя создать зависимость между работами разных проектов' });
            }
            if (!['FS', 'SS', 'FF', 'SF'].includes(dep.type)) {
                return res.status(400).json({ error: 'Неподдерживаемый тип зависимости' });
            }
            if (dep.lag !== undefined && (!Number.isInteger(dep.lag) || dep.lag < 0)) {
                return res.status(400).json({ error: 'Некорректное значение смещения' });
            }
        }

        const allWorkIdsArray = Array.from(validWorkIds);

        // Проверка циклических ссылок
        if (hasCycle(allWorkIdsArray, dependencies)) {
            return res.status(400).json({ error: 'Невозможно создать зависимость. Обнаружена циклическая ссылка между работами' });
        }

        // 3. Получение даты начала проекта
        // ВАЖНО: est_documents.project_id — текстовый код сметы, а не UUID проекта.
        // Реальная ссылка на таблицу projects — project_uuid.
        let projectStartDate = new Date().toISOString().split('T')[0];
        const { data: doc } = await supabaseAdmin.from('est_documents').select('project_uuid').eq('id', doc_id).single();
        if (doc && doc.project_uuid) {
            const { data: proj } = await supabaseAdmin.from('projects').select('start_date').eq('id', doc.project_uuid).single();
            if (proj && proj.start_date) {
                projectStartDate = new Date(proj.start_date).toISOString().split('T')[0];
            }
        }

        // 4. Формирование базовых (пользовательских) дат и длительностей с валидацией
        let projectEndDate = null;
        if (doc && doc.project_uuid) {
            const { data: proj } = await supabaseAdmin.from('projects').select('end_date').eq('id', doc.project_uuid).single();
            if (proj && proj.end_date) {
                projectEndDate = new Date(proj.end_date).toISOString().split('T')[0];
            }
        }

        // Раньше любая проблема у ОДНОЙ работы (пустая дата, дата за пределами календаря
        // проекта и т.п.) валила запрос целиком — 400 на весь КП, и это плохое значение
        // застревало в состоянии фронтенда навсегда: следующее автосохранение снова слало
        // ту же самую работу и снова падало с той же ошибкой, КП переставал сохраняться
        // вообще. Теперь проблемная работа просто пропускается (её дата в базе остаётся
        // прежней — новую мы не пишем) и собирается в скипWarnings, а все остальные работы
        // сохраняются как обычно. Само предупреждение конкретно по этой работе пользователь
        // и так уже видит в таблице (подсветка/бейдж на клиенте).
        const worksList = [];
        const skippedWorkIds = new Set();
        const skipWarnings = [];
        for (const workId of allWorkIdsArray) {
            const val = schedules[workId];
            if (!val) {
                skippedWorkIds.add(workId);
                continue;
            }

            const { start_date, duration_days } = val;

            if (!start_date || String(start_date).trim() === '' || duration_days === undefined || duration_days === null || String(duration_days).trim() === '') {
                skippedWorkIds.add(workId);
                continue;
            }

            const startD = new Date(start_date);
            if (isNaN(startD.getTime())) {
                skippedWorkIds.add(workId);
                skipWarnings.push('Пропущена работа с некорректной датой начала.');
                continue;
            }

            const days = parseInt(duration_days, 10);
            if (isNaN(days) || days <= 0) {
                skippedWorkIds.add(workId);
                skipWarnings.push('Пропущена работа с некорректной продолжительностью.');
                continue;
            }

            // Валидация с началом проекта
            const projStartD = new Date(projectStartDate);
            if (!isNaN(projStartD.getTime()) && startD < projStartD) {
                skippedWorkIds.add(workId);
                skipWarnings.push(`Пропущена работа: дата начала раньше начала проекта (${projectStartDate}).`);
                continue;
            }

            // Валидация с окончанием проекта
            if (projectEndDate) {
                const projEndD = new Date(projectEndDate);
                const endD = new Date(startD);
                endD.setDate(endD.getDate() + days - 1);
                if (!isNaN(projEndD.getTime()) && endD > projEndD) {
                    skippedWorkIds.add(workId);
                    skipWarnings.push('Пропущена работа: период выходит за пределы календаря проекта.');
                    continue;
                }
            }

            let sDate = start_date;
            if (String(sDate).includes('T')) {
                sDate = String(sDate).split('T')[0];
            }

            worksList.push({
                id: workId,
                base_start_date: sDate,
                duration_days: days,
                assignee_id: val.assignee_id || null,
                assignee_type: val.assignee_type || 'employee',
                assignee_name: val.assignee_name || null
            });
        }

        // Связи, где хоть одна из сторон пропущена, для ЭТОГО сохранения не учитываем в
        // расчётах (пересчёт дат/критпуть) — у пропущенной работы просто нет валидных дат,
        // считать по ней нечего. Сами строки связей в базе не трогаем здесь отдельно — при
        // сохранении блок ниже (п.8) всё равно пишет только то, что пришло в dependencies.
        const effectiveDependencies = skippedWorkIds.size > 0
            ? dependencies.filter(dep => !skippedWorkIds.has(dep.predecessor_id) && !skippedWorkIds.has(dep.successor_id))
            : dependencies;

        // 5. Пересчет дат на основе зависимостей
        const calculatedSchedules = recalculateSchedules(worksList, effectiveDependencies, projectStartDate);

        // 6. Расчет критического пути
        const criticalPath = calculateCriticalPath(worksList, effectiveDependencies, calculatedSchedules, projectStartDate);

        // 6b. Период конструктива (US: "Период на уровне конструктива") — дата+длительность
        // самого узла всегда сохраняется (это просто значение поля, блокировать его сохранение
        // нельзя). А вот попадают ли работы внутри в этот период — это отдельная, более мягкая
        // проверка: раньше она блокировала сохранение ВСЕЙ сметы целиком при любом несовпадении,
        // из-за чего КП переставал сохраняться вообще (не только период, а вообще всё). Теперь
        // это предупреждение (warnings в ответе), а сама блокировка сделана точечно — при
        // создании/редактировании связи (см. /schedule-save логику ниже не трогаем, ограничение
        // ставится на клиенте в handleAddDirectDependency).
        const wbsPeriodWarnings = [];
        const wbsPeriodEntries = Object.entries(wbs_periods).filter(([, p]) => p && p.start_date && p.duration_days);
        if (wbsPeriodEntries.length > 0) {
            const { data: allWbsNodes, error: wbsFetchErr } = await supabaseAdmin
                .from('est_wbs')
                .select('id, parent_id, name')
                .eq('doc_id', doc_id);
            if (wbsFetchErr) throw wbsFetchErr;

            const childrenByParent = {};
            (allWbsNodes || []).forEach(n => {
                if (!n.parent_id) return;
                if (!childrenByParent[n.parent_id]) childrenByParent[n.parent_id] = [];
                childrenByParent[n.parent_id].push(n.id);
            });
            const wbsNameById = {};
            (allWbsNodes || []).forEach(n => { wbsNameById[n.id] = n.name; });

            const getDescendantWbsIds = (rootId) => {
                const result = new Set([rootId]);
                const queue = [rootId];
                while (queue.length > 0) {
                    const current = queue.pop();
                    (childrenByParent[current] || []).forEach(childId => {
                        if (!result.has(childId)) {
                            result.add(childId);
                            queue.push(childId);
                        }
                    });
                }
                return result;
            };

            for (const [wbsId, period] of wbsPeriodEntries) {
                const periodStartD = new Date(period.start_date);
                if (isNaN(periodStartD.getTime())) {
                    return res.status(400).json({ error: `Некорректная дата начала периода конструктива «${wbsNameById[wbsId] || wbsId}»` });
                }
                const periodDays = parseInt(period.duration_days, 10);
                if (isNaN(periodDays) || periodDays <= 0) {
                    return res.status(400).json({ error: `Некорректная длительность периода конструктива «${wbsNameById[wbsId] || wbsId}»` });
                }
                const periodEndD = new Date(periodStartD);
                periodEndD.setDate(periodEndD.getDate() + periodDays - 1);

                const descendantIds = getDescendantWbsIds(wbsId);
                const childWorkIds = Object.keys(workIdToWbsId).filter(wid => descendantIds.has(workIdToWbsId[wid]));

                for (const wid of childWorkIds) {
                    const calc = calculatedSchedules[wid];
                    if (!calc || !calc.start_date) continue;
                    const workStartD = new Date(calc.start_date);
                    const workEndD = new Date(workStartD);
                    workEndD.setDate(workEndD.getDate() + (parseInt(calc.duration_days, 10) || 1) - 1);

                    if (workStartD < periodStartD || workEndD > periodEndD) {
                        const workName = (worksList.find(w => w.id === wid) || {}).name;
                        wbsPeriodWarnings.push(
                            `Работа${workName ? ` «${workName}»` : ''} выходит за период конструктива «${wbsNameById[wbsId] || ''}» ` +
                            `(${period.start_date} — ${periodEndD.toISOString().split('T')[0]}).`
                        );
                    }
                }
            }

            // Период сохраняем в любом случае — несовпадение с датами работ это предупреждение,
            // не повод не дать заполнить/поправить сам период конструктива.
            // ВАЖНО: тут именно UPDATE, а не upsert — Postgres проверяет NOT NULL constraints
            // (name, type, doc_id...) у INSERT-варианта строки ДАЖЕ когда конфликт по id
            // приведёт к обычному UPDATE. Раз узел уже существует (мы его только что читали
            // из этой же таблицы), апдейт безопасен и не требует остальных полей.
            for (const [wbsId, period] of wbsPeriodEntries) {
                const { error: wbsPeriodErr } = await supabaseAdmin
                    .from('est_wbs')
                    .update({
                        period_start_date: period.start_date,
                        period_duration_days: parseInt(period.duration_days, 10)
                    })
                    .eq('id', wbsId);
                if (wbsPeriodErr) throw wbsPeriodErr;
            }
        }

        // 7. Сохранение расписания в est_doc_schedules
        const upsertRows = worksList.map(w => {
            const calc = calculatedSchedules[w.id];
            return {
                doc_id: doc_id,
                work_id: w.id,
                start_date: calc.start_date,
                duration_days: calc.duration_days,
                assignee_id: w.assignee_id || null,
                updated_at: new Date().toISOString()
            };
        });

        if (upsertRows.length > 0) {
            const { error: upsertErr } = await supabaseAdmin
                .from('est_doc_schedules')
                .upsert(upsertRows, { onConflict: 'doc_id,work_id' });
            if (upsertErr) throw upsertErr;
        }

        // 8. Сохранение связей в est_work_dependencies
        // Удаляем старые связи
        const { error: delErr } = await supabaseAdmin
            .from('est_work_dependencies')
            .delete()
            .eq('doc_id', doc_id);
        if (delErr) throw delErr;

        // Вставляем новые связи
        if (dependencies.length > 0) {
            // В базе на (predecessor_id, successor_id) стоит UNIQUE-ограничение — между двумя
            // работами может быть только ОДНА связь, независимо от типа (FS/SS/FF/SF). Если в
            // пришедшем массиве такая пара встретилась дважды (например, из-за гонки при быстром
            // двойном клике на клиенте — react ещё не успел применить первое добавление, и обе
            // попытки прочитали одно и то же старое состояние), insert падает с "duplicate key
            // value violates unique constraint". Схлопываем дубли здесь — оставляем последнюю
            // версию пары, чтобы сохранение не падало целиком из-за одной гонки на клиенте.
            const depMap = new Map();
            dependencies.forEach(dep => {
                depMap.set(`${dep.predecessor_id}::${dep.successor_id}`, dep);
            });
            const depRows = Array.from(depMap.values()).map(dep => ({
                doc_id: doc_id,
                predecessor_id: dep.predecessor_id,
                successor_id: dep.successor_id,
                type: dep.type || 'FS',
                lag: dep.lag || 0
            }));
            const { error: insErr } = await supabaseAdmin
                .from('est_work_dependencies')
                .insert(depRows);
            if (insErr) throw insErr;
        }

        // 9. Автоматическое распределение ГПР по умолчанию на весь период
        try {
            const { data: dbWorks } = await supabaseAdmin
                .from('est_doc_works')
                .select('id, volume')
                .eq('doc_id', doc_id)
                .eq('is_excluded', false);

            if (dbWorks && dbWorks.length > 0) {
                const { data: dbDists } = await supabaseAdmin
                    .from('est_work_volume_distribution')
                    .select('*')
                    .eq('doc_id', doc_id);

                const store = readVolumeDistributionsStore();
                let localDists = store[doc_id] || [];

                const newDistsToUpsert = [];
                const workIdsToDelete = [];

                for (const w of dbWorks) {
                    const calc = calculatedSchedules[w.id];
                    if (!calc || !calc.start_date || !calc.duration_days) continue;

                    const startD = new Date(calc.start_date);
                    const endD = new Date(startD);
                    endD.setDate(endD.getDate() + parseInt(calc.duration_days, 10) - 1);
                    const endDateStr = endD.toISOString().split('T')[0];

                    const dbDistsForWork = (dbDists || []).filter(d => d.work_id === w.id);
                    const localDistsForWork = localDists.filter(d => d.work_id === w.id);

                    const noDists = dbDistsForWork.length === 0 && localDistsForWork.length === 0;
                    const isDefaultDb = dbDistsForWork.length === 1 && Number(dbDistsForWork[0].volume) === Number(w.volume);
                    const isDefaultLocal = localDistsForWork.length === 1 && Number(localDistsForWork[0].volume) === Number(w.volume);

                    if (noDists || isDefaultDb || isDefaultLocal) {
                        workIdsToDelete.push(w.id);
                        newDistsToUpsert.push({
                            doc_id: doc_id,
                            work_id: w.id,
                            period_type: 'custom',
                            period_start: calc.start_date,
                            period_end: endDateStr,
                            volume: Number(w.volume) || 0,
                            period_label: 'Период выполнения'
                        });
                    }
                }

                if (workIdsToDelete.length > 0) {
                    await supabaseAdmin
                        .from('est_work_volume_distribution')
                        .delete()
                        .in('work_id', workIdsToDelete);
                    localDists = localDists.filter(d => !workIdsToDelete.includes(d.work_id));
                }

                if (newDistsToUpsert.length > 0) {
                    const { error: insDistsErr } = await supabaseAdmin
                        .from('est_work_volume_distribution')
                        .insert(newDistsToUpsert);
                    if (insDistsErr) {
                        console.warn('[DB GPR AUTO-DIST INSERT WARNING]:', insDistsErr.message);
                    }

                    const localRows = newDistsToUpsert.map(d => ({
                        work_id: d.work_id,
                        period_type: d.period_type,
                        period_start: d.period_start,
                        period_end: d.period_end,
                        volume: d.volume,
                        period_label: d.period_label
                    }));
                    localDists = [...localDists, ...localRows];
                }

                store[doc_id] = localDists;
                writeVolumeDistributionsStore(store);
            }
        } catch (autoDistErr) {
            console.error('[AUTO GPR DISTRIBUTION ERROR]:', autoDistErr);
        }

        // Пишем лог изменений
        writeAuditLog(doc_id, schedules);

        res.json({
            success: true,
            message: 'Календарный план и зависимости успешно сохранены',
            schedules: calculatedSchedules,
            criticalPath: criticalPath,
            warnings: [...skipWarnings, ...wbsPeriodWarnings]
        });
    } catch (err) {
        console.error('[SCHEDULE SAVE ERROR]:', err);
        res.status(500).json({ error: 'Ошибка сохранения календарного плана: ' + err.message });
    }
});

router.get('/objects/:objectId/general-schedule', async (req, res) => {
    try {
        const { objectId } = req.params;
        const { lang = 'ru' } = req.query;

        // 1. Получаем все сметы объекта
        const { data: docs, error: docsErr } = await supabaseAdmin
            .from('est_documents')
            .select('id, zone, phase, discipline, project_id, organization_id, region_id, estimate_type, status, plan_version, projects:project_uuid(id, code, name, start_date, end_date, manager_id, region_id)')
            .eq('object_id', objectId)
            .order('created_at', { ascending: true });

        if (docsErr) throw docsErr;
        if (!docs || docs.length === 0) {
            return res.json({
                project: null,
                docs: [],
                wbs: [],
                works: [],
                dependencies: [],
                criticalPath: {},
                managers: []
            });
        }

        const docIds = docs.map(d => d.id);

        const regionId = docs[0].region_id || docs[0].projects?.region_id;
        let countryCode = 'GE';
        if (regionId) {
            const { data: reg } = await supabaseAdmin
                .from('dic_regions')
                .select('id, code, dic_countries(id, code)')
                .eq('id', regionId)
                .single();
            if (reg?.dic_countries?.code) {
                countryCode = reg.dic_countries.code.toUpperCase();
            }
        }
        const isAz = countryCode === 'AZ';

        // 2. Данные проекта уже получены через join project_uuid → projects
        const project = docs[0].projects || null;

        // 3. Получаем список менеджеров / исполнителей
        let managers = null;
        try {
            const { data } = await supabaseAdmin
                .from('users')
                .select('id, first_name, last_name, email, role')
                .order('first_name');
            managers = data;
        } catch (e) {
            console.warn('[General Schedule Users Query Warning]:', e);
        }

        if (!managers || managers.length === 0) {
            const { data: profiles } = await supabaseAdmin
                .from('profiles')
                .select('id, first_name, last_name, role')
                .order('first_name');
            managers = (profiles || []).map(p => ({
                id: p.id,
                first_name: p.first_name,
                last_name: p.last_name,
                email: `${p.first_name ? p.first_name.toLowerCase() : 'user'}@dev.local`,
                role: p.role
            }));
        }

        // 4. Получаем структуру WBS для всех смет
        const { data: wbs } = await supabaseAdmin
            .from('est_wbs')
            .select('*')
            .in('doc_id', docIds)
            .eq('is_excluded', false)
            .order('sort_order');

        // Fetch all WBS templates for translations mapping
        const { data: wbsTemplates } = await supabaseAdmin
            .from('wbs_templates')
            .select('code, name_ru, name_en, name_ka, name_az, name_tr');

        const wbsWithLoc = (wbs || []).map(w => {
            const temp = (wbsTemplates || []).find(t => 
                t.name_ru === w.name ||
                t.name_en === w.name ||
                t.name_ka === w.name ||
                t.name_az === w.name ||
                t.name_tr === w.name
            );
            return {
                ...w,
                name_ru: temp?.name_ru || w.name,
                name_en: temp?.name_en || w.name,
                name_ka: temp?.name_ka || w.name,
                name_ge: temp?.name_ka || w.name,
                name_az: temp?.name_az || w.name,
                name_tr: temp?.name_tr || w.name
            };
        });

        // Вспомогательная функция для получения локализованного значения WBS-шаблона (зона/фаза/дисциплина)
        const getLocalizedWbsValue = (rawValue) => {
            if (!rawValue) return null;
            const temp = (wbsTemplates || []).find(t =>
                t.name_ru === rawValue || t.name_en === rawValue ||
                t.name_ka === rawValue || t.name_az === rawValue || t.name_tr === rawValue
            );
            if (!temp) return rawValue;
            return temp[`name_${lang}`] || temp.name_ru || rawValue;
        };

        // Строим виртуальные WBS-узлы для каждой сметы.
        // Служебная WBS-шаблон смета объекта (zone/phase/discipline = null) — это не "смета",
        // а структура самого объекта, поэтому у неё нет подписи.
        // Обычные сметы из раздела "Смета" подписываются как в списке смет: номер · название · (зона/фаза/дисциплина).
        const wbsList = [];
        docs.forEach((doc, idx) => {
            const isTemplate = !doc.zone && !doc.phase && !doc.discipline;
            const estName = doc.project_id && typeof doc.project_id === 'string' ? doc.project_id : '';
            let label = '';

            if (isTemplate || idx === 0) {
                // Первое показывает структуру ВБС - не пишем Смета и Номер
                label = estName || 'Структура WBS';
            } else {
                // Порядковый номер сметы (начиная с СМ-00011 для второй сметы)
                const numCode = `СМ-000${10 + idx}`;
                const details = [getLocalizedWbsValue(doc.zone), getLocalizedWbsValue(doc.phase), getLocalizedWbsValue(doc.discipline)]
                    .filter(Boolean).join(' / ');
                label = [numCode, estName, details ? `(${details})` : ''].filter(Boolean).join(' · ');
            }

            wbsList.push({
                id: doc.id,
                parent_id: null,
                name: label,
                name_ru: label,
                name_en: label,
                name_ka: label,
                name_ge: label,
                name_az: label,
                name_tr: label,
                is_virtual: true
            });
        });

        // Корректируем parent_id у оригинальных WBS-узлов: если parent_id = null, перенаправляем на ID соответствующей сметы
        wbsWithLoc.forEach(w => {
            if (!w.parent_id) {
                w.parent_id = w.doc_id;
            }
            wbsList.push(w);
        });

        // 5. Получаем работы всех смет
        const { data: works } = await supabaseAdmin
            .from('est_doc_works')
            .select('id, doc_id, wbs_id, work_id, volume, price, amount, is_excluded, sort_order')
            .in('doc_id', docIds)
            .eq('is_excluded', false);

        // 6. Подгружаем названия работ и единицы измерения из jobs и jobs_cas
        const workIds = (works || []).map(w => w.work_id).filter(Boolean);

        const { data: jobsList } = workIds.length > 0 ? await supabaseAdmin
            .from('jobs')
            .select('id, code, name_id, dic_measures(id, code)')
            .in('id', workIds) : { data: [] };

        const { data: jobsCasList } = workIds.length > 0 ? await supabaseAdmin
            .from('jobs_cas')
            .select('id, code, name_id, dic_measures(id, code)')
            .in('id', workIds) : { data: [] };

        const jobsMap = {};
        (jobsList || []).forEach(j => { jobsMap[j.id] = j; });
        (jobsCasList || []).forEach(j => { jobsMap[j.id] = j; });

        const allWorkNameIds = Array.from(new Set(
            (works || []).flatMap(w => [w.work_id, jobsMap[w.work_id]?.name_id]).filter(Boolean)
        ));

        const { data: workLocs } = allWorkNameIds.length > 0 ? await supabaseAdmin
            .from('localization')
            .select('object_id, locale, name')
            .eq('object_name', isAz ? 'jobs_cas' : 'jobs')
            .in('object_id', allWorkNameIds) : { data: [] };

        const workLocMap = {};
        (workLocs || []).forEach(l => {
            if (!workLocMap[l.object_id]) workLocMap[l.object_id] = {};
            workLocMap[l.object_id][l.locale] = l.name;
        });

        const allMeasureIds = Array.from(new Set([
            ...(jobsList || []).map(j => j.dic_measures?.id),
            ...(jobsCasList || []).map(j => j.dic_measures?.id)
        ])).filter(Boolean);

        const { data: measureLocs } = allMeasureIds.length > 0 ? await supabaseAdmin.from('localization')
            .select('object_id, locale, name')
            .eq('object_name', 'dic_measures')
            .in('object_id', allMeasureIds) : { data: [] };

        const measureLocMap = {};
        (measureLocs || []).forEach(l => {
            if (!measureLocMap[l.object_id]) measureLocMap[l.object_id] = {};
            measureLocMap[l.object_id][l.locale] = l.name;
        });

        // 7. Читаем расписание из est_doc_schedules для всех смет
        let docScheduleStore = {};
        try {
            const { data: dbSchedList, error: dbSchedErr } = await supabaseAdmin
                .from('est_doc_schedules')
                .select('*')
                .in('doc_id', docIds);

            if (!dbSchedErr && dbSchedList) {
                dbSchedList.forEach(item => {
                    if (item.work_id) {
                        docScheduleStore[item.work_id] = {
                            start_date: item.start_date,
                            duration_days: item.duration_days,
                            assignee_id: item.assignee_id,
                            assignee_type: 'employee',
                            assignee_name: null
                        };
                    }
                });
            }
        } catch (e) {
            console.warn('[DB general est_doc_schedules FETCH ERROR]:', e.message);
        }

        let projectStartDate = new Date().toISOString().split('T')[0];
        if (project && project.start_date) {
            try {
                projectStartDate = new Date(project.start_date).toISOString().split('T')[0];
            } catch (e) {
                // Ignore
            }
        }

        const formattedWorks = (works || []).map(w => {
            const job = jobsMap[w.work_id] || {};
            const names = workLocMap[w.work_id] || workLocMap[job.name_id] || {};
            const measureId = job.dic_measures?.id;
            const unitNames = measureLocMap[measureId] || {};

            const rawName = names[lang] || names.ru || names.en || names.ka || names.az || '';
            // Код работы уже приходит отдельным полем `code` — не дублируем его в `name`
            // (раньше склеивались вместе, и в печатной форме/на диаграмме Ганта код был виден дважды).
            const jobName = rawName || 'Строительные работы';
            const unitName = unitNames[lang] || unitNames.ru || unitNames.en || job.dic_measures?.code || 'ед.';
            const schedItem = docScheduleStore[w.id] || docScheduleStore[w.work_id] || {};

            let itemStartDate = schedItem.start_date || projectStartDate;
            if (itemStartDate && itemStartDate.includes('T')) {
                itemStartDate = itemStartDate.split('T')[0];
            }

            return {
                id: w.id,
                doc_id: w.doc_id,
                wbs_id: w.wbs_id,
                work_id: w.work_id,
                name: jobName,
                code: job.code || '',
                volume: w.volume,
                unit: unitName,
                start_date: itemStartDate,
                duration_days: parseInt(schedItem.duration_days, 10) || 1,
                assignee_id: schedItem.assignee_id || null
            };
        });

        // 8. Получаем связи всех смет
        let dependencies = [];
        try {
            const { data: dbDeps, error: dbDepsErr } = await supabaseAdmin
                .from('est_work_dependencies')
                .select('*')
                .in('doc_id', docIds);
            if (!dbDepsErr && dbDeps) {
                dependencies = dbDeps;
            }
        } catch (e) {
            console.warn('[DB general est_work_dependencies FETCH ERROR]:', e.message);
        }

        // Вычисляем критический путь для всей совокупности работ объекта
        let cp = {};
        try {
            const worksList = formattedWorks.map(w => ({
                id: w.id,
                base_start_date: w.start_date,
                duration_days: w.duration_days
            }));
            const calculatedSchedules = {};
            formattedWorks.forEach(w => {
                calculatedSchedules[w.id] = {
                    start_date: w.start_date,
                    duration_days: w.duration_days
                };
            });
            cp = calculateCriticalPath(worksList, dependencies, calculatedSchedules, projectStartDate);
        } catch (e) {
            console.warn('[GET GENERAL SCHEDULE CRITICAL PATH CALCULATION ERROR]:', e.message);
        }

        res.json({
            project,
            docs: docs.map(d => ({ id: d.id, estimate_type: d.estimate_type, status: d.status, plan_version: d.plan_version })),
            wbs: wbsList,
            works: formattedWorks,
            dependencies,
            criticalPath: cp,
            managers: managers || []
        });

    } catch (err) {
        console.error('[GET GENERAL SCHEDULE ERROR]:', err);
        res.status(500).json({ error: 'Ошибка получения общего календарного плана: ' + err.message });
    }
});

router.post('/general-schedule-save', async (req, res) => {
    try {
        const { object_id, schedules, dependencies = [] } = req.body;
        if (!object_id || !schedules) {
            return res.status(400).json({ error: 'Обязательные параметры: object_id, schedules' });
        }

        // 1. Получаем все сметы данного объекта
        const { data: docs, error: docsErr } = await supabaseAdmin
            .from('est_documents')
            .select('id, project_uuid')
            .eq('object_id', object_id);

        if (docsErr) throw docsErr;
        if (!docs || docs.length === 0) {
            return res.status(400).json({ error: 'У этого объекта нет смет.' });
        }

        const docIds = docs.map(d => d.id);

        // 2. Получаем все работы этих смет
        const { data: dbWorks, error: dbWorksErr } = await supabaseAdmin
            .from('est_doc_works')
            .select('id, doc_id')
            .in('doc_id', docIds)
            .eq('is_excluded', false);

        if (dbWorksErr) throw dbWorksErr;
        
        const validWorkIds = new Set(dbWorks.map(w => w.id));
        const workToDocMap = {};
        dbWorks.forEach(w => {
            workToDocMap[w.id] = w.doc_id;
        });

        // 3. Валидация зависимостей
        for (const dep of dependencies) {
            if (!dep.predecessor_id || !dep.successor_id) {
                return res.status(400).json({ error: 'Предшествующая и последующая работы должны быть заполнены' });
            }
            if (dep.predecessor_id === dep.successor_id) {
                return res.status(400).json({ error: 'Работа не может зависеть сама от себя' });
            }
            if (!validWorkIds.has(dep.predecessor_id) || !validWorkIds.has(dep.successor_id)) {
                return res.status(400).json({ error: 'Нельзя создать зависимость между работами разных проектов' });
            }
            if (!['FS', 'SS', 'FF', 'SF'].includes(dep.type)) {
                return res.status(400).json({ error: 'Неподдерживаемый тип зависимости' });
            }
            if (dep.lag !== undefined && (!Number.isInteger(dep.lag) || dep.lag < 0)) {
                return res.status(400).json({ error: 'Некорректное значение смещения' });
            }
        }

        const allWorkIdsArray = Array.from(validWorkIds);

        // Проверка циклических ссылок
        if (hasCycle(allWorkIdsArray, dependencies)) {
            return res.status(400).json({ error: 'Невозможно создать зависимость. Обнаружена циклическая ссылка между работами' });
        }

        // 4. Получение даты начала проекта
        // ВАЖНО: project_id на est_documents — текстовый код сметы, а не UUID проекта — реальная ссылка на projects это project_uuid.
        let projectStartDate = new Date().toISOString().split('T')[0];
        let projectEndDate = null;
        if (docs[0].project_uuid) {
            const { data: proj } = await supabaseAdmin.from('projects').select('start_date, end_date').eq('id', docs[0].project_uuid).single();
            if (proj && proj.start_date) {
                projectStartDate = new Date(proj.start_date).toISOString().split('T')[0];
            }
            if (proj && proj.end_date) {
                projectEndDate = new Date(proj.end_date).toISOString().split('T')[0];
            }
        }

        // 5. Формирование базовых работ с валидацией дат
        const worksList = [];
        for (const [workId, val] of Object.entries(schedules)) {
            if (!validWorkIds.has(workId)) continue;

            const { start_date, duration_days } = val;
            if (!start_date || String(start_date).trim() === '' || duration_days === undefined || duration_days === null || String(duration_days).trim() === '') {
                return res.status(400).json({ error: 'Заполните обязательные поля периода выполнения' });
            }

            const startD = new Date(start_date);
            if (isNaN(startD.getTime())) {
                return res.status(400).json({ error: 'Некорректная дата начала работы' });
            }

            const days = parseInt(duration_days, 10);
            if (isNaN(days) || days <= 0) {
                return res.status(400).json({ error: 'Продолжительность должна быть больше 0 дней.' });
            }

            // Валидация с началом проекта
            const projStartD = new Date(projectStartDate);
            if (!isNaN(projStartD.getTime()) && startD < projStartD) {
                return res.status(400).json({ error: `Дата начала работы не может быть меньше даты начала проекта (${projectStartDate})` });
            }

            // Валидация с окончанием проекта
            if (projectEndDate) {
                const projEndD = new Date(projectEndDate);
                const endD = new Date(startD);
                endD.setDate(endD.getDate() + days - 1);
                if (!isNaN(projEndD.getTime()) && endD > projEndD) {
                    return res.status(400).json({ error: 'Выбранный период выходит за пределы календаря проекта.' });
                }
            }

            let sDate = start_date;
            if (String(sDate).includes('T')) {
                sDate = String(sDate).split('T')[0];
            }

            worksList.push({
                id: workId,
                base_start_date: sDate,
                duration_days: days,
                assignee_id: val.assignee_id || null,
                doc_id: workToDocMap[workId]
            });
        }

        // 6. Пересчет дат на основе всех связей объекта
        const calculatedSchedules = recalculateSchedules(worksList, dependencies, projectStartDate);

        // 7. Расчет критического пути
        const criticalPath = calculateCriticalPath(worksList, dependencies, calculatedSchedules, projectStartDate);

        // 8. Сохранение расписания в разрезе смет
        for (const docId of docIds) {
            const docWorksList = worksList.filter(w => w.doc_id === docId);
            const upsertRows = docWorksList.map(w => {
                const calc = calculatedSchedules[w.id];
                return {
                    doc_id: docId,
                    work_id: w.id,
                    start_date: calc.start_date,
                    duration_days: calc.duration_days,
                    assignee_id: w.assignee_id || null,
                    updated_at: new Date().toISOString()
                };
            });

            if (upsertRows.length > 0) {
                const { error: upsertErr } = await supabaseAdmin
                    .from('est_doc_schedules')
                    .upsert(upsertRows, { onConflict: 'doc_id,work_id' });
                if (upsertErr) throw upsertErr;
            }

            // Сохранение связей для этой сметы (по признаку successor_id в этой смете)
            const docDeps = dependencies.filter(dep => workToDocMap[dep.successor_id] === docId);

            // Удаляем старые связи для этой сметы
            const { error: delErr } = await supabaseAdmin
                .from('est_work_dependencies')
                .delete()
                .eq('doc_id', docId);
            if (delErr) throw delErr;

            // Вставляем новые — схлопываем дубли по (predecessor_id, successor_id), см.
            // подробный комментарий у аналогичного места в /schedule-save.
            if (docDeps.length > 0) {
                const docDepMap = new Map();
                docDeps.forEach(dep => {
                    docDepMap.set(`${dep.predecessor_id}::${dep.successor_id}`, dep);
                });
                const depRows = Array.from(docDepMap.values()).map(dep => ({
                    doc_id: docId,
                    predecessor_id: dep.predecessor_id,
                    successor_id: dep.successor_id,
                    type: dep.type || 'FS',
                    lag: dep.lag || 0
                }));
                const { error: insErr } = await supabaseAdmin
                    .from('est_work_dependencies')
                    .insert(depRows);
                if (insErr) throw insErr;
            }

            // Логируем аудит
            const docSchedulesPart = {};
            docWorksList.forEach(w => {
                docSchedulesPart[w.id] = schedules[w.id];
            });
            writeAuditLog(docId, docSchedulesPart);
        }

        res.json({
            success: true,
            message: 'Общий календарный план и все зависимости объекта успешно сохранены',
            schedules: calculatedSchedules,
            criticalPath: criticalPath
        });

    } catch (err) {
        console.error('[GENERAL SCHEDULE SAVE ERROR]:', err);
        res.status(500).json({ error: 'Ошибка сохранения общего календарного плана: ' + err.message });
    }
});

// --- ГРАФИК ПРОИЗВОДСТВА РАБОТ (ГПР) И РАСПРЕДЕЛЕНИЕ ОБЪЕМОВ (US-05-001) ---
const VOLUME_DIST_FILE_PATH = path.join(__dirname, '..', 'data', 'volume_distributions.json');

function readVolumeDistributionsStore() {
    try {
        if (!fs.existsSync(VOLUME_DIST_FILE_PATH)) {
            const dir = path.dirname(VOLUME_DIST_FILE_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(VOLUME_DIST_FILE_PATH, JSON.stringify({}), 'utf8');
            return {};
        }
        const content = fs.readFileSync(VOLUME_DIST_FILE_PATH, 'utf8');
        return JSON.parse(content || '{}');
    } catch (err) {
        console.error('[VOLUME DIST STORE READ ERROR]:', err);
        return {};
    }
}

function writeVolumeDistributionsStore(store) {
    try {
        const dir = path.dirname(VOLUME_DIST_FILE_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(VOLUME_DIST_FILE_PATH, JSON.stringify(store, null, 2), 'utf8');
    } catch (err) {
        console.error('[VOLUME DIST STORE WRITE ERROR]:', err);
    }
}

// 1. Получить данные для построения ГПР и распределения объемов по объекту
router.get('/gpr-data/:objectId', async (req, res) => {
    try {
        const { objectId } = req.params;
        const { lang = 'ru', estimate_type = 'actual' } = req.query;

        // 1. Получаем смету объекта на основе выбранного типа
        let query = supabaseAdmin
            .from('est_documents')
            .select('id, zone, phase, discipline, project_id, organization_id, region_id, estimate_type, plan_version, status, projects:project_uuid(id, code, name, start_date, end_date, manager_id, region_id)')
            .eq('object_id', objectId)
            .eq('estimate_type', estimate_type);

        if (estimate_type === 'planned') {
            query = query.in('status', ['planned_formed', 'planned_review', 'planned_approved']);
        } else {
            query = query.in('status', ['actual_formed', 'actual_review', 'actual_approved']);
        }

        const { data: docs, error: docsErr } = await query.order('created_at', { ascending: false });

        if (docsErr) throw docsErr;
        if (!docs || docs.length === 0) {
            return res.status(404).json({ error: estimate_type === 'planned' ? 'Плановая смета отсутствует' : 'Фактическая смета отсутствует' });
        }

        // Вычисляем is_readonly
        const isReadonly = await checkIfDocLocked(docs[0].id);
        docs[0].is_readonly = isReadonly;

        const docIds = docs.map(d => d.id);
        const regionId = docs[0].region_id || docs[0].projects?.region_id;
        let countryCode = 'GE';
        if (regionId) {
            const { data: reg } = await supabaseAdmin
                .from('dic_regions')
                .select('id, code, dic_countries(id, code)')
                .eq('id', regionId)
                .single();
            if (reg?.dic_countries?.code) {
                countryCode = reg.dic_countries.code.toUpperCase();
            }
        }
        const isAz = countryCode === 'AZ';

        // Данные проекта
        const project = docs[0].projects || null;

        // Получаем список менеджеров / исполнителей
        const { data: profiles } = await supabaseAdmin
            .from('profiles')
            .select('id, first_name, last_name, role');
        const profilesMap = {};
        (profiles || []).forEach(p => {
            profilesMap[p.id] = `${p.first_name || ''} ${p.last_name || ''}`.trim();
        });

        // 4. Получаем структуру WBS для всех смет
        const { data: wbs } = await supabaseAdmin
            .from('est_wbs')
            .select('*')
            .in('doc_id', docIds)
            .eq('is_excluded', false)
            .order('sort_order');

        // Fetch all WBS templates for translations mapping
        const { data: wbsTemplates } = await supabaseAdmin
            .from('wbs_templates')
            .select('code, name_ru, name_en, name_ka, name_az, name_tr');

        const wbsWithLoc = (wbs || []).map(w => {
            const temp = (wbsTemplates || []).find(t => 
                t.name_ru === w.name ||
                t.name_en === w.name ||
                t.name_ka === w.name ||
                t.name_az === w.name ||
                t.name_tr === w.name
            );
            return {
                ...w,
                name_ru: temp?.name_ru || w.name,
                name_en: temp?.name_en || w.name,
                name_ka: temp?.name_ka || w.name,
                name_ge: temp?.name_ka || w.name,
                name_az: temp?.name_az || w.name,
                name_tr: temp?.name_tr || w.name
            };
        });

        // Вспомогательная функция для получения локализованного значения WBS-шаблона
        const getLocalizedWbsValue = (rawValue) => {
            if (!rawValue) return null;
            const temp = (wbsTemplates || []).find(t =>
                t.name_ru === rawValue || t.name_en === rawValue ||
                t.name_ka === rawValue || t.name_az === rawValue || t.name_tr === rawValue
            );
            if (!temp) return rawValue;
            return temp[`name_${lang}`] || temp.name_ru || rawValue;
        };

        // Строим виртуальные WBS-узлы для каждой сметы
        const wbsList = [];
        docs.forEach((doc, idx) => {
            const isTemplate = !doc.zone && !doc.phase && !doc.discipline;
            const estName = doc.project_id && typeof doc.project_id === 'string' ? doc.project_id : '';
            let label = '';

            if (isTemplate || idx === 0) {
                label = estName || 'Структура WBS';
            } else {
                const numCode = `СМ-000${10 + idx}`;
                const details = [getLocalizedWbsValue(doc.zone), getLocalizedWbsValue(doc.phase), getLocalizedWbsValue(doc.discipline)]
                    .filter(Boolean).join(' / ');
                label = [numCode, estName, details ? `(${details})` : ''].filter(Boolean).join(' · ');
            }

            wbsList.push({
                id: doc.id,
                parent_id: null,
                name: label,
                name_ru: label,
                name_en: label,
                name_ka: label,
                name_ge: label,
                name_az: label,
                name_tr: label,
                is_virtual: true
            });
        });

        wbsWithLoc.forEach(w => {
            if (!w.parent_id) {
                w.parent_id = w.doc_id;
            }
            wbsList.push(w);
        });

        // 5. Получаем работы всех смет
        const { data: works } = await supabaseAdmin
            .from('est_doc_works')
            .select('id, doc_id, wbs_id, work_id, volume, price, amount, is_excluded, sort_order')
            .in('doc_id', docIds)
            .eq('is_excluded', false);

        if (!works || works.length === 0) {
            return res.json({ doc: docs[0], project, wbs: wbsList, works: [], dependencies: [], distributions: [], criticalPath: {} });
        }

        // Подтягиваем локализованные имена работ
        const workIds = works.map(w => w.work_id).filter(Boolean);
        const { data: jobsList } = workIds.length > 0 ? await supabaseAdmin
            .from('jobs')
            .select('id, code, name_id, dic_measures(id, code)')
            .in('id', workIds) : { data: [] };

        const { data: jobsCasList } = workIds.length > 0 ? await supabaseAdmin
            .from('jobs_cas')
            .select('id, code, name_id, dic_measures(id, code)')
            .in('id', workIds) : { data: [] };

        const jobsMap = {};
        (jobsList || []).forEach(j => { jobsMap[j.id] = j; });
        (jobsCasList || []).forEach(j => { jobsMap[j.id] = j; });

        const allWorkNameIds = Array.from(new Set(
            works.flatMap(w => [w.work_id, jobsMap[w.work_id]?.name_id]).filter(Boolean)
        ));

        const { data: workLocs } = allWorkNameIds.length > 0 ? await supabaseAdmin
            .from('localization')
            .select('object_id, locale, name')
            .eq('object_name', isAz ? 'jobs_cas' : 'jobs')
            .in('object_id', allWorkNameIds) : { data: [] };

        const workLocMap = {};
        (workLocs || []).forEach(l => {
            if (!workLocMap[l.object_id]) workLocMap[l.object_id] = {};
            workLocMap[l.object_id][l.locale] = l.name;
        });

        const allMeasureIds = Array.from(new Set([
            ...(jobsList || []).map(j => j.dic_measures?.id),
            ...(jobsCasList || []).map(j => j.dic_measures?.id)
        ])).filter(Boolean);

        const { data: measureLocs } = allMeasureIds.length > 0 ? await supabaseAdmin.from('localization')
            .select('object_id, locale, name')
            .eq('object_name', 'dic_measures')
            .in('object_id', allMeasureIds) : { data: [] };

        const measureLocMap = {};
        (measureLocs || []).forEach(l => {
            if (!measureLocMap[l.object_id]) measureLocMap[l.object_id] = {};
            measureLocMap[l.object_id][l.locale] = l.name;
        });

        // Загружаем расписание для всех смет
        const { data: dbSchedList } = await supabaseAdmin
            .from('est_doc_schedules')
            .select('*')
            .in('doc_id', docIds);

        const docScheduleStore = {};
        (dbSchedList || []).forEach(item => {
            if (item.work_id) {
                docScheduleStore[item.work_id] = {
                    start_date: item.start_date,
                    duration_days: item.duration_days,
                    assignee_id: item.assignee_id
                };
            }
        });

        // Загружаем ответственных ГПР из новой таблицы
        const { data: dbGprAssignees } = await supabaseAdmin
            .from('est_gpr_assignees')
            .select('*')
            .in('doc_id', docIds);

        const gprAssigneeMap = {};
        (dbGprAssignees || []).forEach(item => {
            gprAssigneeMap[item.work_id] = {
                assignee_type: item.assignee_type,
                assignee_id: item.assignee_id,
                assignee_name: item.assignee_name
            };
        });

        let projectStartDate = (project && project.start_date) ? project.start_date.split('T')[0] : new Date().toISOString().split('T')[0];

        const formattedWorks = works.map(w => {
            const job = jobsMap[w.work_id] || {};
            const names = workLocMap[w.work_id] || workLocMap[job.name_id] || {};
            const measureId = job.dic_measures?.id;
            const unitNames = measureLocMap[measureId] || {};
            const rawName = names[lang] || names.ru || names.en || '';
            // Код работы уже приходит отдельным полем `code` — не дублируем его в `name`.
            const jobName = rawName || 'Строительные работы';
            const unitName = unitNames[lang] || unitNames.ru || job.dic_measures?.code || 'ед.';
            
            const schedItem = docScheduleStore[w.id] || docScheduleStore[w.work_id] || {};
            const itemStartDate = (schedItem.start_date) ? schedItem.start_date.split('T')[0] : null;
            const duration = schedItem.duration_days ? parseInt(schedItem.duration_days, 10) : null;

            const gprAssignee = gprAssigneeMap[w.id] || {};
            const finalType = gprAssignee.assignee_type || 'employee';
            const finalId = gprAssignee.assignee_id || schedItem.assignee_id || null;
            
            // Если ответственный ГПР не задан, а в КП задан assignee_id - подтягиваем его имя по умолчанию
            let finalName = '';
            if (finalType === 'department' || finalType === 'contractor') {
                finalName = gprAssignee.assignee_name || '';
            } else if (finalId) {
                finalName = profilesMap[finalId] || 'Ответственный';
            }

            return {
                id: w.id,
                doc_id: w.doc_id,
                wbs_id: w.wbs_id,
                work_id: w.work_id,
                name: jobName,
                code: job.code || '',
                volume: w.volume,
                unit: unitName,
                start_date: itemStartDate,
                duration_days: duration,
                assignee_id: finalId,
                assignee_type: finalType,
                assignee_name: finalName
            };
        });

        // Загружаем зависимости для всех смет
        const { data: dbDeps } = await supabaseAdmin
            .from('est_work_dependencies')
            .select('*')
            .in('doc_id', docIds);

        // Рассчитываем критический путь
        let cp = {};
        const validWorksForCp = formattedWorks.filter(w => w.start_date && w.duration_days);
        if (validWorksForCp.length === formattedWorks.length) {
            try {
                const worksList = validWorksForCp.map(w => ({
                    id: w.id,
                    base_start_date: w.start_date,
                    duration_days: w.duration_days
                }));
                const calculatedSchedules = {};
                validWorksForCp.forEach(w => {
                    calculatedSchedules[w.id] = {
                        start_date: w.start_date,
                        duration_days: w.duration_days
                    };
                });
                cp = calculateCriticalPath(worksList, dbDeps || [], calculatedSchedules, projectStartDate);
            } catch (e) {
                console.warn('[GPR CP CALC FALLBACK]:', e.message);
            }
        }

        // Загружаем распределение объемов для всех смет
        let distributions = [];
        try {
            const { data: dbDists, error: dbDistsErr } = await supabaseAdmin
                .from('est_work_volume_distribution')
                .select('*')
                .in('doc_id', docIds);
            if (!dbDistsErr && dbDists) {
                distributions = dbDists;
            } else {
                const store = readVolumeDistributionsStore();
                docIds.forEach(id => {
                    if (store[id]) {
                        distributions = [...distributions, ...store[id]];
                    }
                });
            }
        } catch (err) {
            const store = readVolumeDistributionsStore();
            docIds.forEach(id => {
                if (store[id]) {
                    distributions = [...distributions, ...store[id]];
                }
            });
        }

        // 9. Автоматическое распределение ГПР по умолчанию на весь период при чтении данных
        try {
            const store = readVolumeDistributionsStore();
            let hasNewAutoDists = false;
            const newDistsToInsert = [];
            const workIdsToDelete = [];

            for (const w of formattedWorks) {
                if (!w.start_date || !w.duration_days) continue;

                // Вычисляем дату окончания
                const startD = new Date(w.start_date);
                const endD = new Date(startD);
                endD.setDate(endD.getDate() + parseInt(w.duration_days, 10) - 1);
                const endDateStr = endD.toISOString().split('T')[0];

                const wDists = distributions.filter(d => d.work_id === w.id);

                const noDists = wDists.length === 0;
                const isDefault = wDists.length === 1 && Number(wDists[0].volume) === Number(w.volume);

                // Если распределения нет совсем, или если оно дефолтное, но даты не совпадают с КП
                const needsUpdate = isDefault && (wDists[0].period_start !== w.start_date || wDists[0].period_end !== endDateStr);

                if (noDists || needsUpdate) {
                    hasNewAutoDists = true;
                    if (needsUpdate) {
                        workIdsToDelete.push(w.id);
                    }
                    newDistsToInsert.push({
                        doc_id: w.doc_id,
                        work_id: w.id,
                        period_type: 'custom',
                        period_start: w.start_date,
                        period_end: endDateStr,
                        volume: Number(w.volume) || 0,
                        period_label: 'Период выполнения'
                    });
                }
            }

            if (hasNewAutoDists) {
                // Чистим старые в массиве distributions и БД
                if (workIdsToDelete.length > 0) {
                    distributions = distributions.filter(d => !workIdsToDelete.includes(d.work_id));
                    await supabaseAdmin
                        .from('est_work_volume_distribution')
                        .delete()
                        .in('work_id', workIdsToDelete);
                    
                    docIds.forEach(id => {
                        if (store[id]) {
                            store[id] = store[id].filter(d => !workIdsToDelete.includes(d.work_id));
                        }
                    });
                }

                // Добавляем новые в массив distributions
                distributions = [...distributions, ...newDistsToInsert];

                // Пишем новые в БД
                const { error: insErr } = await supabaseAdmin
                    .from('est_work_volume_distribution')
                    .insert(newDistsToInsert);
                if (insErr) {
                    console.warn('[DB GPR READ AUTO-DIST INSERT WARNING]:', insErr.message);
                }

                // Пишем новые в локальный JSON
                newDistsToInsert.forEach(d => {
                    if (!store[d.doc_id]) store[d.doc_id] = [];
                    store[d.doc_id].push({
                        work_id: d.work_id,
                        period_type: d.period_type,
                        period_start: d.period_start,
                        period_end: d.period_end,
                        volume: d.volume,
                        period_label: d.period_label
                    });
                });
                writeVolumeDistributionsStore(store);
            }
        } catch (autoDistErr) {
            console.error('[AUTO GPR READ DISTRIBUTION ERROR]:', autoDistErr);
        }

        res.json({
            doc: docs[0],
            docs: docs,
            project,
            wbs: wbsList,
            works: formattedWorks,
            dependencies: dbDeps || [],
            distributions: distributions,
            criticalPath: cp
        });

    } catch (err) {
        console.error('[GET GPR DATA ERROR]:', err);
        res.status(500).json({ error: 'Ошибка сервера при получении данных ГПР: ' + err.message });
    }
});

// 2. Сохранить распределение объемов для работы
router.post('/gpr-save', async (req, res) => {
    try {
        const { docId, workId, periodType, periods, assigneeId, assigneeType, assigneeName } = req.body;

        if (!docId || !workId || !periodType || !Array.isArray(periods)) {
            return res.status(400).json({ error: 'Некорректные параметры запроса' });
        }

        if (await checkIfDocLocked(docId)) {
            return res.status(400).json({ error: 'Редактирование запрещено: смета заблокирована' });
        }

        // 1. Пытаемся сохранить в базу данных
        let dbSaved = false;
        try {
            // Удаляем старые распределения для работы
            await supabaseAdmin
                .from('est_work_volume_distribution')
                .delete()
                .eq('work_id', workId);

            const rowsToInsert = periods.map(p => ({
                doc_id: docId,
                work_id: workId,
                period_type: periodType,
                period_start: p.period_start,
                period_end: p.period_end,
                volume: Number(p.volume) || 0,
                period_label: p.period_label
            }));

            if (rowsToInsert.length > 0) {
                const { error: insErr } = await supabaseAdmin
                    .from('est_work_volume_distribution')
                    .insert(rowsToInsert);
                if (insErr) throw insErr;
            }

            // Обновляем ответственного ГПР в новой таблице
            if (assigneeType) {
                await supabaseAdmin
                    .from('est_gpr_assignees')
                    .upsert({
                        doc_id: docId,
                        work_id: workId,
                        assignee_id: assigneeId || null,
                        assignee_type: assigneeType,
                        assignee_name: assigneeName || null,
                        updated_at: new Date().toISOString()
                    }, { onConflict: 'doc_id,work_id' });
            }

            dbSaved = true;
        } catch (dbErr) {
            console.warn('[DB GPR SAVE WARNING - FALLING BACK TO FILE]:', dbErr.message);
        }

        // 2. ВСЕГДА пишем в локальный JSON-файл для 100% надежности
        const store = readVolumeDistributionsStore();
        if (!store[docId]) store[docId] = [];
        
        // Очищаем старые локальные распределения для этой работы
        store[docId] = store[docId].filter(d => d.work_id !== workId);

        // Добавляем новые
        const localRows = periods.map(p => ({
            work_id: workId,
            period_type: periodType,
            period_start: p.period_start,
            period_end: p.period_end,
            volume: Number(p.volume) || 0,
            period_label: p.period_label
        }));
        store[docId] = [...store[docId], ...localRows];
        writeVolumeDistributionsStore(store);

        res.json({
            success: true,
            message: 'Распределение объемов успешно сохранено',
            dbSaved
        });

    } catch (err) {
        console.error('[SAVE GPR VOLUME DISTRIBUTION ERROR]:', err);
        res.status(500).json({ error: 'Ошибка сервера при сохранении объемов: ' + err.message });
    }
});

// =========================================================================
// БЛОК 4: ПЛАНОВЫЕ ВЕРСИИ И ИХ УТВЕРЖДЕНИЕ (US-06-001 / US-06-002)
// =========================================================================

// POST /api/estimates/:docId/create-plan - Создать плановую версию сметы
router.post('/:docId/create-plan', async (req, res) => {
    try {
        const { docId } = req.params;
        const userId = req.user?.id || null;

        // 1. Получаем родительскую смету
        const { data: parentDoc, error: parentErr } = await supabaseAdmin
            .from('est_documents')
            .select('*')
            .eq('id', docId)
            .maybeSingle();

        if (parentErr || !parentDoc) {
            return res.status(404).json({ error: 'Рабочая смета не найдена' });
        }

        if (parentDoc.status !== 'draft') {
            return res.status(400).json({ error: 'Плановая версия может быть создана только на основании Черновика' });
        }

        // 2. Проверяем наличие уже сформированных активных плановых версий (BR-08)
        const { data: activePlans, error: activeErr } = await supabaseAdmin
            .from('est_documents')
            .select('id, status')
            .eq('parent_doc_id', docId)
            .in('status', ['planned_formed', 'planned_review', 'planned_approved']);

        if (activePlans && activePlans.length > 0) {
            return res.status(400).json({ 
                error: 'Нельзя создать новую плановую версию: уже существует активная плановая смета в статусе Сформирована, На утверждении или Утверждена' 
            });
        }

        // 3. Считаем общее количество плановых версий для определения порядкового номера
        const { count, error: countErr } = await supabaseAdmin
            .from('est_documents')
            .select('*', { count: 'exact', head: true })
            .eq('parent_doc_id', docId);

        const nextVersion = (count || 0) + 1;

        // 4. Вставляем заголовок новой плановой сметы
        const { data: newDoc, error: insErr } = await supabaseAdmin
            .from('est_documents')
            .insert([{
                project_id: parentDoc.project_id,
                organization_id: parentDoc.organization_id,
                status: 'planned_formed', // Сформирована
                total_amount: parentDoc.total_amount,
                region_id: parentDoc.region_id,
                currency_id: parentDoc.currency_id,
                project_uuid: parentDoc.project_uuid,
                object_id: parentDoc.object_id,
                zone: parentDoc.zone,
                phase: parentDoc.phase,
                discipline: parentDoc.discipline,
                parent_doc_id: docId,
                estimate_type: 'planned',
                plan_version: nextVersion,
                plan_created_by: userId,
                plan_created_at: new Date().toISOString()
            }])
            .select()
            .single();

        if (insErr || !newDoc) {
            throw new Error(insErr ? insErr.message : 'Не удалось создать заголовок плановой сметы');
        }

        const newDocId = newDoc.id;

        // 5. Копируем WBS-дерево
        const { data: wbsNodes, error: wbsErr } = await supabaseAdmin
            .from('est_wbs')
            .select('*')
            .eq('doc_id', docId);
        if (wbsErr) throw wbsErr;

        const oldWbsToNewWbs = {};
        let remainingNodes = [...(wbsNodes || [])];
        let safetyCounter = 0;

        while (remainingNodes.length > 0 && safetyCounter < 1000) {
            safetyCounter++;
            const nextBatch = [];
            const deferred = [];

            for (const node of remainingNodes) {
                if (!node.parent_id || oldWbsToNewWbs[node.parent_id]) {
                    nextBatch.push(node);
                } else {
                    deferred.push(node);
                }
            }

            if (nextBatch.length === 0) {
                // Если остались нераспознанные сиротские вершины, вставим их как корень
                for (const node of remainingNodes) {
                    node.parent_id = null;
                    nextBatch.push(node);
                }
            }

            for (const node of nextBatch) {
                const { data: newNode, error: insWbsErr } = await supabaseAdmin
                    .from('est_wbs')
                    .insert([{
                        doc_id: newDocId,
                        parent_id: node.parent_id ? oldWbsToNewWbs[node.parent_id] : null,
                        name: node.name,
                        type: node.type,
                        sort_order: node.sort_order,
                        is_excluded: node.is_excluded
                    }])
                    .select()
                    .single();

                if (insWbsErr) throw insWbsErr;
                oldWbsToNewWbs[node.id] = newNode.id;
            }

            remainingNodes = remainingNodes.filter(n => !oldWbsToNewWbs[n.id]);
        }

        // 6. Копируем работы
        const { data: docWorks, error: worksErr } = await supabaseAdmin
            .from('est_doc_works')
            .select('*')
            .eq('doc_id', docId);
        if (worksErr) throw worksErr;

        const oldWorkToNewWork = {};
        for (const w of (docWorks || [])) {
            const { data: newWork, error: insWorkErr } = await supabaseAdmin
                .from('est_doc_works')
                .insert([{
                    doc_id: newDocId,
                    wbs_id: oldWbsToNewWbs[w.wbs_id] || null,
                    work_id: w.work_id,
                    volume: w.volume,
                    price: w.price,
                    amount: w.amount,
                    sort_order: w.sort_order,
                    is_excluded: w.is_excluded
                }])
                .select()
                .single();

            if (insWorkErr) throw insWorkErr;
            oldWorkToNewWork[w.id] = newWork.id;
        }

        // 7. Копируем ресурсы
        const { data: docResources, error: resErr } = await supabaseAdmin
            .from('est_doc_resources')
            .select('*')
            .eq('doc_id', docId);
        if (resErr) throw resErr;

        if (docResources && docResources.length > 0) {
            const rowsToInsert = docResources.map(r => ({
                doc_id: newDocId,
                work_id: oldWorkToNewWork[r.work_id] || null,
                resource_id: r.resource_id,
                norm: r.norm,
                quantity: r.quantity,
                price: r.price,
                amount: r.amount,
                source: r.source,
                is_excluded: r.is_excluded
            }));

            const { error: insResErr } = await supabaseAdmin
                .from('est_doc_resources')
                .insert(rowsToInsert);
            if (insResErr) throw insResErr;
        }

        // 8. Копируем коэффициенты
        const { data: coeffs, error: coeffErr } = await supabaseAdmin
            .from('est_coefficients')
            .select('*')
            .eq('doc_id', docId);
        if (coeffErr) throw coeffErr;

        if (coeffs && coeffs.length > 0) {
            const coeffRows = coeffs.map(c => ({
                doc_id: newDocId,
                name: c.name,
                type: c.type,
                value_percent: c.value_percent,
                target_type: c.target_type,
                target_id: c.target_type === 'work' ? (oldWorkToNewWork[c.target_id] || null) : c.target_id
            }));

            const { error: insCoeffErr } = await supabaseAdmin
                .from('est_coefficients')
                .insert(coeffRows);
            if (insCoeffErr) throw insCoeffErr;
        }

        // 8.1 Копируем календарный план (est_doc_schedules)
        const { data: schedules, error: schedErr } = await supabaseAdmin
            .from('est_doc_schedules')
            .select('*')
            .eq('doc_id', docId);
        if (schedErr) throw schedErr;

        if (schedules && schedules.length > 0) {
            const schedRows = schedules
                .map(s => {
                    const newWorkId = oldWorkToNewWork[s.work_id];
                    if (!newWorkId) return null;
                    return {
                        doc_id: newDocId,
                        work_id: newWorkId,
                        start_date: s.start_date,
                        duration_days: s.duration_days,
                        assignee_id: s.assignee_id
                    };
                })
                .filter(Boolean);

            if (schedRows.length > 0) {
                const { error: insSchedErr } = await supabaseAdmin
                    .from('est_doc_schedules')
                    .insert(schedRows);
                if (insSchedErr) throw insSchedErr;
            }
        }

        // 8.2 Копируем связи и зависимости (est_work_dependencies)
        const { data: deps, error: depsErr } = await supabaseAdmin
            .from('est_work_dependencies')
            .select('*')
            .eq('doc_id', docId);
        if (depsErr) throw depsErr;

        if (deps && deps.length > 0) {
            const depRows = deps
                .map(d => {
                    const newPredecessorId = oldWorkToNewWork[d.predecessor_id];
                    const newSuccessorId = oldWorkToNewWork[d.successor_id];
                    if (!newPredecessorId || !newSuccessorId) return null;
                    return {
                        doc_id: newDocId,
                        predecessor_id: newPredecessorId,
                        successor_id: newSuccessorId,
                        lag: d.lag,
                        type: d.type
                    };
                })
                .filter(Boolean);

            if (depRows.length > 0) {
                const { error: insDepsErr } = await supabaseAdmin
                    .from('est_work_dependencies')
                    .insert(depRows);
                if (insDepsErr) throw insDepsErr;
            }
        }

        // 8.3 Копируем ответственных ГПР (est_gpr_assignees)
        const { data: gprAssignees, error: gprErr } = await supabaseAdmin
            .from('est_gpr_assignees')
            .select('*')
            .eq('doc_id', docId);
        if (gprErr) throw gprErr;

        if (gprAssignees && gprAssignees.length > 0) {
            const gprRows = gprAssignees
                .map(g => {
                    const newWorkId = oldWorkToNewWork[g.work_id];
                    if (!newWorkId) return null;
                    return {
                        doc_id: newDocId,
                        work_id: newWorkId,
                        assignee_id: g.assignee_id,
                        assignee_type: g.assignee_type,
                        assignee_name: g.assignee_name,
                        updated_at: g.updated_at
                    };
                })
                .filter(Boolean);

            if (gprRows.length > 0) {
                const { error: insGprErr } = await supabaseAdmin
                    .from('est_gpr_assignees')
                    .insert(gprRows);
                if (insGprErr) throw insGprErr;
            }
        }

        // 9. Добавляем события в историю изменений
        await supabaseAdmin
            .from('est_document_history')
            .insert([
                {
                    doc_id: docId,
                    user_id: userId,
                    event: `Создана плановая версия сметы: Плановая ver. ${nextVersion}`,
                    comment: `Плановая версия сметы зафиксирована с ID: ${newDocId}`
                },
                {
                    doc_id: newDocId,
                    user_id: userId,
                    event: 'Сформирована',
                    comment: `Создана плановая версия ver. ${nextVersion} на основании рабочей сметы`
                }
            ]);

        res.json({
            success: true,
            message: `Плановая версия сметы ver. ${nextVersion} успешно сформирована.`,
            planDocId: newDocId
        });

    } catch (err) {
        console.error('[CREATE PLAN ERROR]:', err);
        res.status(500).json({ error: 'Не удалось создать плановую версию. Повторите попытку позже.' });
    }
});

// GET /api/estimates/:docId/history - получить историю изменений сметы
router.get('/:docId/history', async (req, res) => {
    try {
        const { docId } = req.params;

        // История хранится по каждому документу отдельно (черновик и каждая плановая
        // версия — свой doc_id). Чтобы видеть полную цепочку событий независимо от того,
        // где её открыли, собираем всю "семью": черновик + все его плановые версии.
        const { data: doc } = await supabaseAdmin
            .from('est_documents')
            .select('id, parent_doc_id')
            .eq('id', docId)
            .maybeSingle();

        const rootId = doc?.parent_doc_id || docId;

        const { data: family } = await supabaseAdmin
            .from('est_documents')
            .select('id, estimate_type, plan_version')
            .or(`id.eq.${rootId},parent_doc_id.eq.${rootId}`);

        const docsMap = {};
        (family || []).forEach(d => { docsMap[d.id] = d; });

        const docIds = (family || []).map(d => d.id);
        if (!docIds.includes(docId)) docIds.push(docId);

        const { data, error } = await supabaseAdmin
            .from('est_document_history')
            .select(`
                id,
                doc_id,
                event,
                comment,
                created_at,
                user_id,
                profiles:user_id (id, first_name, last_name, role)
            `)
            .in('doc_id', docIds)
            .order('created_at', { ascending: true });

        if (error) throw error;

        // Помечаем каждое событие меткой версии, к которой оно относится
        // (Рабочая версия / Плановая версия N / Фактическая версия)
        const enriched = (data || []).map(h => {
            const relatedDoc = docsMap[h.doc_id];
            let versionLabel = 'Рабочая версия';
            if (relatedDoc?.estimate_type === 'planned') {
                versionLabel = `Плановая версия ${relatedDoc.plan_version || ''}`.trim();
            } else if (relatedDoc?.estimate_type === 'actual') {
                versionLabel = 'Фактическая версия';
            }
            return { ...h, version_label: versionLabel };
        });

        res.json(enriched);
    } catch (e) {
        console.error('[FETCH HISTORY ERROR]:', e);
        res.status(500).json({ error: e.message });
    }
});

// POST /api/estimates/:docId/submit-review - отправить на утверждение
router.post('/:docId/submit-review', async (req, res) => {
    try {
        const { docId } = req.params;
        const { approverId, comment } = req.body;
        const userId = req.user?.id || null;

        if (!approverId) {
            return res.status(400).json({ error: 'Необходимо указать утверждающее лицо (Финансового директора)' });
        }

        // 1. Проверяем смету
        const { data: est, error: fetchErr } = await supabaseAdmin
            .from('est_documents')
            .select(`
                id, status, plan_version, project_id, project_uuid, object_id, region_id,
                projects:project_uuid (id, name, region_id),
                project_objects:object_id (id, name)
            `)
            .eq('id', docId)
            .maybeSingle();

        if (fetchErr || !est) {
            return res.status(404).json({ error: 'Смета не найдена' });
        }

        if (est.status !== 'planned_formed') {
            return res.status(400).json({ error: 'На утверждение можно отправить только смету в статусе Сформирована' });
        }

        // Проверки на наличие Календарного плана и ГПР отключены по запросу пользователя.

        // 2. Проверяем роль утверждающего
        const { data: approverProfile, error: approverErr } = await supabaseAdmin
            .from('profiles')
            .select('id, first_name, last_name, role')
            .eq('id', approverId)
            .maybeSingle();

        if (approverErr || !approverProfile) {
            return res.status(400).json({ error: 'Выбранный утверждающий не найден в системе' });
        }

        if (approverProfile.role !== 'financial_director') {
            return res.status(400).json({ error: 'Утверждающим лицом может быть только Финансовый директор' });
        }

        // Получаем информацию об отправителе (сметчике)
        let submitterName = 'Сметчик';
        if (userId) {
            const { data: userProfile } = await supabaseAdmin
                .from('profiles')
                .select('first_name, last_name')
                .eq('id', userId)
                .maybeSingle();
            if (userProfile) {
                submitterName = `${userProfile.first_name || ''} ${userProfile.last_name || ''}`.trim() || 'Сметчик';
            }
        }

        const approverName = `${approverProfile.first_name || ''} ${approverProfile.last_name || ''}`.trim() || 'Финансовый директор';
        const projectName = est.projects?.name || 'Без проекта';
        const objectName = est.project_objects?.name || 'Без объекта';
        const nowStr = new Date().toISOString();
        const dateStr = new Date().toLocaleDateString('ru-RU');

        // 3. Обновляем статус и метаданные сметы
        const { error: updErr } = await supabaseAdmin
            .from('est_documents')
            .update({ 
                status: 'planned_review',
                plan_approver_id: approverId,
                plan_submitted_by: userId,
                plan_submitted_at: nowStr,
                plan_submit_comment: comment || null
            })
            .eq('id', docId);

        if (updErr) throw updErr;

        // 4. Добавляем запись в историю
        await supabaseAdmin
            .from('est_document_history')
            .insert([{
                doc_id: docId,
                user_id: userId,
                event: 'Отправлена на утверждение',
                comment: `Отправлена на утверждение (утверждающий: ${approverName})${comment ? `. Комментарий: ${comment}` : ''}`
            }]);

        // 5. Создаем уведомление (project_notifications.project_id — UUID, берём из project_uuid, а не из текстового кода project_id)
        const messageText = `Сметчик ${submitterName} в ${dateStr} отправил на утверждение плановую смету вер. ${est.plan_version || '1.0'} (Название: ${est.project_id}, Проект: ${projectName}, Объект: ${objectName}).`;

        if (est.project_uuid) {
            await supabaseAdmin
                .from('project_notifications')
                .insert([{
                    project_id: est.project_uuid,
                    user_id: approverId,
                    message_code: 'ESTIMATE_APPROVAL_NOTIFICATION',
                    message_text: messageText,
                    estimate_doc_id: docId
                }]);
        }

        res.json({
            success: true,
            message: 'Смета успешно отправлена на утверждение финансовому директору',
            approver: { id: approverProfile.id, first_name: approverProfile.first_name, last_name: approverProfile.last_name }
        });
    } catch (e) {
        console.error('[SUBMIT REVIEW ERROR]:', e);
        res.status(500).json({ error: e.message });
    }
});

// POST /api/estimates/:docId/approve-plan - утвердить смету
router.post('/:docId/approve-plan', async (req, res) => {
    try {
        const { docId } = req.params;
        const userId = req.user?.id || null;
        const userRole = req.user?.role || null;

        const { data: est, error: fetchErr } = await supabaseAdmin
            .from('est_documents')
            .select('status, parent_doc_id, plan_approver_id, plan_submitted_by, plan_version, project_id, project_uuid')
            .eq('id', docId)
            .maybeSingle();

        if (fetchErr || !est) {
            return res.status(404).json({ error: 'Смета не найдена' });
        }

        // BR-04: утверждать может только назначенный утверждающий или admin
        if (userRole !== 'admin' && est.plan_approver_id !== userId) {
            return res.status(403).json({ error: 'У вас нет прав на утверждение этой плановой версии' });
        }

        if (est.status !== 'planned_review') {
            return res.status(400).json({ error: 'Утвердить можно только смету, находящуюся на утверждении' });
        }

        // Сохраняем изменения объемов и ресурсов, если они были переданы финансовым директором
        await saveApproverCorrections(docId, req.body || {});

        const nowStr = new Date().toISOString();

        // Обновляем текущую смету на planned_approved
        const { error: updErr } = await supabaseAdmin
            .from('est_documents')
            .update({
                status: 'planned_approved',
                plan_decided_by: userId,
                plan_decided_at: nowStr
            })
            .eq('id', docId);

        if (updErr) throw updErr;

        // Деактивируем предыдущие утвержденные плановые сметы родителя, если есть
        if (est.parent_doc_id) {
            await supabaseAdmin
                .from('est_documents')
                .update({ status: 'planned_inactive' })
                .eq('parent_doc_id', est.parent_doc_id)
                .eq('status', 'planned_approved')
                .not('id', 'eq', docId);
        }

        await supabaseAdmin
            .from('est_document_history')
            .insert([{
                doc_id: docId,
                user_id: userId,
                event: 'Утверждена',
                comment: 'Плановая версия сметы успешно утверждена утверждающим лицом'
            }]);

        // Уведомляем сметчика, отправившего версию на утверждение
        if (est.plan_submitted_by && est.project_uuid) {
            await supabaseAdmin
                .from('project_notifications')
                .insert([{
                    project_id: est.project_uuid,
                    user_id: est.plan_submitted_by,
                    message_code: 'ESTIMATE_DECISION_NOTIFICATION',
                    message_text: `Плановая смета «${est.project_id}» вер. ${est.plan_version || '1'} утверждена.`,
                    estimate_doc_id: docId
                }]);
        }

        res.json({ success: true, message: 'Плановая версия сметы успешно утверждена' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/estimates/:docId/reject-plan - отклонить смету
router.post('/:docId/reject-plan', async (req, res) => {
    try {
        const { docId } = req.params;
        const { comment } = req.body;
        const userId = req.user?.id || null;
        const userRole = req.user?.role || null;

        // BR-08 / AC-3: причина отклонения обязательна
        if (!comment || !comment.trim()) {
            return res.status(400).json({ error: 'Укажите причину отклонения' });
        }

        const { data: est, error: fetchErr } = await supabaseAdmin
            .from('est_documents')
            .select('status, plan_approver_id, plan_submitted_by, plan_version, project_id, project_uuid')
            .eq('id', docId)
            .maybeSingle();

        if (fetchErr || !est) {
            return res.status(404).json({ error: 'Смета не найдена' });
        }

        // BR-04: отклонять может только назначенный утверждающий или admin
        if (userRole !== 'admin' && est.plan_approver_id !== userId) {
            return res.status(403).json({ error: 'У вас нет прав на отклонение этой плановой версии' });
        }

        if (est.status !== 'planned_review') {
            return res.status(400).json({ error: 'Отклонить можно только смету, находящуюся на утверждении' });
        }

        // Сохраняем изменения объемов и ресурсов, если они были переданы финансовым директором
        await saveApproverCorrections(docId, req.body || {});

        const nowStr = new Date().toISOString();

        const { error: updErr } = await supabaseAdmin
            .from('est_documents')
            .update({
                status: 'planned_rejected',
                rejection_reason: comment.trim(),
                plan_decided_by: userId,
                plan_decided_at: nowStr
            })
            .eq('id', docId);

        if (updErr) throw updErr;

        await supabaseAdmin
            .from('est_document_history')
            .insert([{
                doc_id: docId,
                user_id: userId,
                event: 'Отклонена',
                comment: `Отклонена (причина: ${comment.trim()})`
            }]);

        // Уведомляем сметчика, отправившего версию на утверждение
        if (est.plan_submitted_by && est.project_uuid) {
            await supabaseAdmin
                .from('project_notifications')
                .insert([{
                    project_id: est.project_uuid,
                    user_id: est.plan_submitted_by,
                    message_code: 'ESTIMATE_DECISION_NOTIFICATION',
                    message_text: `Плановая смета «${est.project_id}» вер. ${est.plan_version || '1'} отклонена. Причина: ${comment.trim()}`,
                    estimate_doc_id: docId
                }]);
        }

        res.json({ success: true, message: 'Плановая версия сметы отклонена' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/estimates/:docId/deactivate-plan - деактивировать плановую версию (US-06-004)
router.post('/:docId/deactivate-plan', async (req, res) => {
    try {
        const { docId } = req.params;
        const userId = req.user?.id || null;
        const userRole = req.user?.role || null;

        // BR: доступно сметчику/admin (та же роль, что имеет право редактировать смету)
        if (userRole !== 'admin' && userRole !== 'estimator') {
            return res.status(403).json({ error: 'У вас нет прав на деактивацию плановой версии' });
        }

        const { data: est, error: fetchErr } = await supabaseAdmin
            .from('est_documents')
            .select('status, estimate_type')
            .eq('id', docId)
            .maybeSingle();

        if (fetchErr || !est) {
            return res.status(404).json({ error: 'Смета не найдена' });
        }

        // BR-01: деактивировать можно только плановую версию
        if (est.estimate_type !== 'planned') {
            return res.status(400).json({ error: 'Деактивировать можно только плановую версию сметы' });
        }

        // BR-02 / АС-2: только в статусах "Сформирована" или "Утверждена"
        if (!['planned_formed', 'planned_approved'].includes(est.status)) {
            return res.status(400).json({ error: 'Деактивация недоступна для текущего статуса плановой версии' });
        }

        // BR-03/04/05: наличие фактической сметы (любого статуса), созданной на основании этой плановой версии
        const { data: actualChildren, error: actualErr } = await supabaseAdmin
            .from('est_documents')
            .select('id')
            .eq('parent_doc_id', docId)
            .eq('estimate_type', 'actual')
            .limit(1);

        if (actualErr) throw actualErr;

        if (actualChildren && actualChildren.length > 0) {
            return res.status(400).json({ error: 'Деактивация невозможна. На основании данной плановой версии уже создана фактическая смета' });
        }

        const nowStr = new Date().toISOString();

        const { error: updErr } = await supabaseAdmin
            .from('est_documents')
            .update({
                status: 'planned_inactive',
                plan_deactivated_by: userId,
                plan_deactivated_at: nowStr
            })
            .eq('id', docId);

        if (updErr) throw updErr;

        await supabaseAdmin
            .from('est_document_history')
            .insert([{
                doc_id: docId,
                user_id: userId,
                event: 'Деактивирована',
                comment: 'Плановая версия сметы деактивирована сметчиком'
            }]);

        res.json({ success: true, message: 'Плановая версия сметы успешно деактивирована' });
    } catch (e) {
        console.error('[DEACTIVATE PLAN ERROR]:', e);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;


