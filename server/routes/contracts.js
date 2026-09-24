const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../supabase');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function forbidden(res, msg = 'Недостаточно прав') {
    return res.status(403).json({ error: msg });
}

// Работы в est_doc_works.work_id ссылаются на каталоги jobs/jobs_cas (не на несуществующую
// таблицу work_catalogs) — имя и ед. измерения приходят через localization/dic_measures,
// как и в estimates.js. Возвращает { [work_id]: { name, unit } }.
async function getWorkCatalogInfo(workIds) {
    const result = {};
    if (!workIds || workIds.length === 0) return result;

    const [{ data: jobsList }, { data: jobsCasList }] = await Promise.all([
        supabaseAdmin.from('jobs').select('id, code, name_id, dic_measures(id, code)').in('id', workIds),
        supabaseAdmin.from('jobs_cas').select('id, code, name_id, dic_measures(id, code)').in('id', workIds)
    ]);

    const jobsMap = {};
    (jobsList || []).forEach(j => { jobsMap[j.id] = j; });
    (jobsCasList || []).forEach(j => { jobsMap[j.id] = j; });

    const measureIds = Array.from(new Set(Object.values(jobsMap).map(j => j.dic_measures?.id).filter(Boolean)));

    // Локализация названия работы хранится по object_id = сам work_id (не jobs.name_id)
    const [{ data: nameLocs }, { data: measureLocs }] = await Promise.all([
        supabaseAdmin.from('localization').select('object_id, locale, name').in('object_name', ['jobs', 'jobs_cas']).in('object_id', workIds),
        measureIds.length > 0
            ? supabaseAdmin.from('localization').select('object_id, locale, name').eq('object_name', 'dic_measures').in('object_id', measureIds)
            : Promise.resolve({ data: [] })
    ]);

    const nameMap = {};
    (nameLocs || []).forEach(l => { if (l.locale === 'ru' || !nameMap[l.object_id]) nameMap[l.object_id] = l.name; });
    const measureMap = {};
    (measureLocs || []).forEach(l => { if (l.locale === 'ru' || !measureMap[l.object_id]) measureMap[l.object_id] = l.name; });

    for (const workId of workIds) {
        const job = jobsMap[workId];
        if (!job) continue;
        result[workId] = {
            name: nameMap[workId] || job.code || 'Работа',
            unit: measureMap[job.dic_measures?.id] || ''
        };
    }
    return result;
}

// Ресурсы в est_doc_resources.resource_id ссылаются на каталоги resources/Labor_cas/Machine_cas/
// Materials_cas (не на несуществующую таблицу est_resources) — как и в estimates.js.
// Возвращает { [resource_id]: { name, unit, type } }.
async function getResourceCatalogInfo(resourceIds) {
    const result = {};
    if (!resourceIds || resourceIds.length === 0) return result;

    const [{ data: resList }, { data: laborList }, { data: machineList }, { data: materialList }] = await Promise.all([
        supabaseAdmin.from('resources').select('id, code, dic_measures(id, code), dic_resource_types(id, code)').in('id', resourceIds),
        supabaseAdmin.from('Labor_cas').select('id, code, dic_measures(id, code), dic_resource_types(id, code)').in('id', resourceIds),
        supabaseAdmin.from('Machine_cas').select('id, code, dic_measures(id, code), dic_resource_types(id, code)').in('id', resourceIds),
        supabaseAdmin.from('Materials_cas').select('id, code, dic_measures(id, code), dic_resource_types(id, code)').in('id', resourceIds)
    ]);

    const resMap = {};
    [...(resList || []), ...(laborList || []), ...(machineList || []), ...(materialList || [])].forEach(r => { resMap[r.id] = r; });

    const measureIds = Array.from(new Set(Object.values(resMap).map(r => r.dic_measures?.id).filter(Boolean)));
    const typeIds = Array.from(new Set(Object.values(resMap).map(r => r.dic_resource_types?.id).filter(Boolean)));

    const [{ data: nameLocs }, { data: measureLocs }, { data: typeLocs }] = await Promise.all([
        supabaseAdmin.from('localization').select('object_id, locale, name').in('object_name', ['resources', 'Labor_cas', 'Machine_cas', 'Materials_cas']).in('object_id', resourceIds),
        measureIds.length > 0
            ? supabaseAdmin.from('localization').select('object_id, locale, name').eq('object_name', 'dic_measures').in('object_id', measureIds)
            : Promise.resolve({ data: [] }),
        typeIds.length > 0
            ? supabaseAdmin.from('localization').select('object_id, locale, name').eq('object_name', 'dic_resource_types').in('object_id', typeIds)
            : Promise.resolve({ data: [] })
    ]);

    const nameMap = {};
    (nameLocs || []).forEach(l => { if (l.locale === 'ru' || !nameMap[l.object_id]) nameMap[l.object_id] = l.name; });
    const measureMap = {};
    (measureLocs || []).forEach(l => { if (l.locale === 'ru' || !measureMap[l.object_id]) measureMap[l.object_id] = l.name; });
    const typeMap = {};
    (typeLocs || []).forEach(l => { if (l.locale === 'ru' || !typeMap[l.object_id]) typeMap[l.object_id] = l.name; });

    for (const resourceId of resourceIds) {
        const res = resMap[resourceId];
        if (!res) continue;
        result[resourceId] = {
            name: nameMap[resourceId] || res.code || 'Ресурс',
            unit: measureMap[res.dic_measures?.id] || res.dic_measures?.code || '',
            type: typeMap[res.dic_resource_types?.id] || res.dic_resource_types?.code || '',
            // Код справочника (не локализованное имя) — по нему определяем категорию
            // ресурса для распределения тендерной суммы: 10.100.=трудовые, 10.120.=машины,
            // 10.130.=материалы (см. RESOURCE_TYPE_CODE_TO_CATEGORY ниже).
            type_code: res.dic_resource_types?.code || ''
        };
    }
    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// КОНТРАГЕНТЫ
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/contracts/contractors — список контрагентов
router.get('/contractors', async (req, res) => {
    try {
        const { search } = req.query;
        let q = supabaseAdmin
            .from('contractors')
            .select('*')
            .eq('is_active', true)
            .order('company_name');

        if (search) {
            q = q.ilike('company_name', `%${search}%`);
        }

        const { data, error } = await q;
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        console.error('[CONTRACTORS GET]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/contracts/contractors — создать контрагента
router.post('/contractors', async (req, res) => {
    try {
        const { company_name, bin_iin, contact_person, phone, email, address, notes, bank_account, rs } = req.body;
        if (!company_name) return res.status(400).json({ error: 'Название компании обязательно' });

        const { data, error } = await supabaseAdmin
            .from('contractors')
            .insert([{ 
                company_name, 
                bin_iin, 
                contact_person, 
                phone, 
                email, 
                address, 
                notes, 
                bank_account: bank_account || rs 
            }])
            .select()
            .single();
        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('[CONTRACTOR CREATE]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// АНАЛИТИКА (ПЕРЕД :id чтобы не перехватывалось)
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/contracts/distribution-summary?project_id=&object_id=&doc_id=
// Проверяет, попадает ли договор в фильтр по подрядчику/периоду (АС-5: фильтрация отчёта
// по проекту, объекту, подрядчику, периоду — первые два фильтруются на уровне смет выше).
function contractMatchesFilters(contract, contractorId, dateFrom, dateTo) {
    if (!contract) return false;
    if (contractorId && contract.contractor_id !== contractorId) return false;
    if (dateFrom && contract.date_start && contract.date_start < dateFrom) return false;
    if (dateTo && contract.date_start && contract.date_start > dateTo) return false;
    return true;
}

router.get('/distribution-summary', async (req, res) => {
    try {
        const { project_id, object_id, doc_id, contractor_id, date_from, date_to } = req.query;

        // 1. Находим сметы по проекту/объекту
        let docQuery = supabaseAdmin
            .from('est_documents')
            .select('id, project_uuid, object_id, zone, phase, discipline, total_amount');

        if (doc_id) {
            docQuery = docQuery.eq('id', doc_id);
        } else if (project_id) {
            docQuery = docQuery.eq('project_uuid', project_id);
            if (object_id) docQuery = docQuery.eq('object_id', object_id);
        }

        const { data: docs, error: docsErr } = await docQuery;
        if (docsErr) throw docsErr;

        if (!docs || docs.length === 0) return res.json({ works: [], resources: [], summary: {} });

        const docIds = docs.map(d => d.id);

        // 2. Берём работы из смет
        const { data: works, error: worksErr } = await supabaseAdmin
            .from('est_doc_works')
            .select('id, doc_id, work_id, volume, amount')
            .in('doc_id', docIds)
            .eq('is_excluded', false);
        if (worksErr) throw worksErr;

        const workCatalogInfo = await getWorkCatalogInfo((works || []).map(w => w.work_id).filter(Boolean));
        const workIds = (works || []).map(w => w.id);

        // 3. Получаем назначения по этим работам
        let assignedMap = {};
        let contractsByWork = {};
        if (workIds.length > 0) {
            const { data: assignments } = await supabaseAdmin
                .from('contract_assignments')
                .select(`
                    id, est_doc_work_id, assigned_quantity, unit_price, total_price, status,
                    contracts:contract_id (id, contract_number, status, contractor_id, date_start, date_end, contractors:contractor_id (company_name))
                `)
                .in('est_doc_work_id', workIds)
                .eq('assignment_type', 'WORK')
                .neq('status', 'CANCELLED');

            for (const a of (assignments || []).filter(a => contractMatchesFilters(a.contracts, contractor_id, date_from, date_to))) {
                const wid = a.est_doc_work_id;
                if (!assignedMap[wid]) assignedMap[wid] = 0;
                assignedMap[wid] += Number(a.assigned_quantity || 0);
                if (!contractsByWork[wid]) contractsByWork[wid] = [];
                contractsByWork[wid].push({
                    contract_id: a.contracts?.id,
                    contract_number: a.contracts?.contract_number,
                    contractor: a.contracts?.contractors?.company_name,
                    quantity: a.assigned_quantity,
                    unit_price: a.unit_price,
                    total_price: a.total_price,
                    status: a.contracts?.status,
                });
            }
        }

        // 4. Ресурсы из смет
        const { data: resources } = await supabaseAdmin
            .from('est_doc_resources')
            .select('id, doc_id, work_id, resource_id, quantity, price, amount')
            .in('doc_id', docIds)
            .eq('is_excluded', false);

        const resourceCatalogInfo = await getResourceCatalogInfo((resources || []).map(r => r.resource_id).filter(Boolean));

        // 5. Назначения ресурсов
        const resourceIds = (resources || []).map(r => r.id);
        let resAssignedMap = {};
        let contractsByResource = {};
        if (resourceIds.length > 0) {
            const { data: resAssignments } = await supabaseAdmin
                .from('contract_assignments')
                .select(`
                    id, est_doc_resource_id, assigned_quantity, unit_price, status,
                    contracts:contract_id (id, contract_number, status, contractor_id, date_start, date_end, contractors:contractor_id (company_name))
                `)
                .in('est_doc_resource_id', resourceIds)
                .eq('assignment_type', 'RESOURCE')
                .neq('status', 'CANCELLED');

            for (const a of (resAssignments || []).filter(a => contractMatchesFilters(a.contracts, contractor_id, date_from, date_to))) {
                const rid = a.est_doc_resource_id;
                if (!resAssignedMap[rid]) resAssignedMap[rid] = 0;
                resAssignedMap[rid] += Number(a.assigned_quantity || 0);
                if (!contractsByResource[rid]) contractsByResource[rid] = [];
                contractsByResource[rid].push({
                    contract_id: a.contracts?.id,
                    contract_number: a.contracts?.contract_number,
                    contractor: a.contracts?.contractors?.company_name,
                    quantity: a.assigned_quantity,
                    unit_price: a.unit_price,
                });
            }
        }

        // 6. Формируем ответ
        const worksResult = (works || []).map(w => {
            const totalQty = Number(w.volume || 0);
            const assignedQty = assignedMap[w.id] || 0;
            const remaining = Math.max(0, totalQty - assignedQty);
            const pct = totalQty > 0 ? Math.round((assignedQty / totalQty) * 100) : 0;
            return {
                id: w.id,
                doc_id: w.doc_id,
                name: workCatalogInfo[w.work_id]?.name || 'Работа без имени',
                unit: workCatalogInfo[w.work_id]?.unit || '',
                total_quantity: totalQty,
                assigned_quantity: assignedQty,
                remaining_quantity: remaining,
                assigned_percent: pct,
                amount: Number(w.amount || 0),
                contracts: contractsByWork[w.id] || [],
            };
        });

        const resourcesResult = (resources || []).map(r => {
            const totalQty = Number(r.quantity || 0);
            const assignedQty = resAssignedMap[r.id] || 0;
            const remaining = Math.max(0, totalQty - assignedQty);
            const pct = totalQty > 0 ? Math.round((assignedQty / totalQty) * 100) : 0;
            return {
                id: r.id,
                doc_id: r.doc_id,
                work_id: r.work_id,
                name: resourceCatalogInfo[r.resource_id]?.name || 'Ресурс',
                type: resourceCatalogInfo[r.resource_id]?.type || '',
                unit: resourceCatalogInfo[r.resource_id]?.unit || '',
                total_quantity: totalQty,
                assigned_quantity: assignedQty,
                remaining_quantity: remaining,
                assigned_percent: pct,
                amount: Number(r.amount || 0),
                contracts: contractsByResource[r.id] || [],
            };
        });

        // Итоговые цифры
        const totalWorksCount = worksResult.length;
        const assignedWorksCount = worksResult.filter(w => w.assigned_quantity > 0).length;
        const totalWorksAmount = worksResult.reduce((s, w) => s + w.amount, 0);
        const assignedWorksAmount = worksResult.reduce((s, w) => {
            return s + (w.contracts || []).reduce((c, a) => c + Number(a.total_price || 0), 0);
        }, 0);

        res.json({
            works: worksResult,
            resources: resourcesResult,
            summary: {
                total_works: totalWorksCount,
                assigned_works: assignedWorksCount,
                unassigned_works: totalWorksCount - assignedWorksCount,
                assigned_percent: totalWorksCount > 0 ? Math.round((assignedWorksCount / totalWorksCount) * 100) : 0,
                total_amount: totalWorksAmount,
                assigned_amount: assignedWorksAmount,
            }
        });
    } catch (err) {
        console.error('[DISTRIBUTION SUMMARY]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/contracts/works-for-assignment?project_id=&object_id=&doc_id=
router.get('/works-for-assignment', async (req, res) => {
    try {
        const { project_id, object_id, doc_id } = req.query;

        let docQuery = supabaseAdmin.from('est_documents').select('id, zone, phase, discipline');
        if (doc_id) {
            docQuery = docQuery.eq('id', doc_id);
        } else {
            if (!project_id) return res.status(400).json({ error: 'project_id required' });
            docQuery = docQuery.eq('project_uuid', project_id);
            if (object_id) docQuery = docQuery.eq('object_id', object_id);
            // Договор заключается на основании реально выполненных объёмов — только фактическая версия сметы
            docQuery = docQuery.eq('estimate_type', 'actual');
        }
        docQuery = docQuery.neq('status', 'archived');

        const { data: docs } = await docQuery;
        if (!docs || docs.length === 0) return res.json([]);

        const docIds = docs.map(d => d.id);

        const { data: works, error } = await supabaseAdmin
            .from('est_doc_works')
            .select('id, doc_id, work_id, volume, amount, price')
            .in('doc_id', docIds)
            .eq('is_excluded', false)
            .order('doc_id');
        if (error) throw error;

        const workCatalogInfo = await getWorkCatalogInfo((works || []).map(w => w.work_id).filter(Boolean));
        const workIds = (works || []).map(w => w.id);
        let assignedMap = {};
        if (workIds.length > 0) {
            const { data: assignments } = await supabaseAdmin
                .from('contract_assignments')
                .select('est_doc_work_id, assigned_quantity')
                .in('est_doc_work_id', workIds)
                .eq('assignment_type', 'WORK')
                .neq('status', 'CANCELLED');

            for (const a of (assignments || [])) {
                const wid = a.est_doc_work_id;
                if (!assignedMap[wid]) assignedMap[wid] = 0;
                assignedMap[wid] += Number(a.assigned_quantity || 0);
            }
        }

        // Разбивка цены работы на "с материалами" / "без материалов" — нужна, чтобы при
        // назначении работы договору цена за единицу считалась автоматически в зависимости
        // от чекбокса "С материалами" (см. contract_assignments.with_materials): если без
        // материалов — в стоимость входят только трудовые и машины/механизмы.
        let materialSumByWork = {};
        let laborMachineSumByWork = {};
        if (workIds.length > 0) {
            const { data: workResources } = await supabaseAdmin
                .from('est_doc_resources')
                .select('work_id, resource_id, amount')
                .in('work_id', workIds)
                .eq('is_excluded', false);

            const resourceIds = Array.from(new Set((workResources || []).map(r => r.resource_id).filter(Boolean)));
            const resourceInfo = await getResourceCatalogInfo(resourceIds);

            (workResources || []).forEach(r => {
                const category = RESOURCE_TYPE_CODE_TO_CATEGORY[resourceInfo[r.resource_id]?.type_code];
                const amount = Number(r.amount || 0);
                if (category === 'material') {
                    materialSumByWork[r.work_id] = (materialSumByWork[r.work_id] || 0) + amount;
                } else {
                    // labor/machine/неизвестная категория — считаем "не материалом" по умолчанию,
                    // чтобы неучтённый ресурс не потерялся молча ни в одной из двух цен.
                    laborMachineSumByWork[r.work_id] = (laborMachineSumByWork[r.work_id] || 0) + amount;
                }
            });
        }

        const result = (works || []).map(w => {
            const totalQty = Number(w.volume || 0);
            const assignedQty = assignedMap[w.id] || 0;
            const remaining = Math.max(0, totalQty - assignedQty);
            const laborMachineSum = laborMachineSumByWork[w.id] || 0;
            const materialSum = materialSumByWork[w.id] || 0;
            // Цена за единицу объёма работы — полная (с материалами) и без материалов.
            // Делим на объём по смете (не на назначенный), т.к. это расценка "за единицу".
            const priceWithMaterials = totalQty > 0 ? (laborMachineSum + materialSum) / totalQty : Number(w.price || 0);
            const priceWithoutMaterials = totalQty > 0 ? laborMachineSum / totalQty : 0;
            return {
                id: w.id,
                doc_id: w.doc_id,
                name: workCatalogInfo[w.work_id]?.name || 'Работа',
                unit: workCatalogInfo[w.work_id]?.unit || '',
                total_quantity: totalQty,
                assigned_quantity: assignedQty,
                remaining_quantity: remaining,
                assigned_percent: totalQty > 0 ? Math.round((assignedQty / totalQty) * 100) : 0,
                price: Number(w.price || 0),
                price_with_materials: priceWithMaterials,
                price_without_materials: priceWithoutMaterials,
                amount: Number(w.amount || 0),
            };
        });

        res.json(result);
    } catch (err) {
        console.error('[WORKS FOR ASSIGNMENT]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/contracts/resources-for-assignment?project_id=&object_id=&doc_id=
router.get('/resources-for-assignment', async (req, res) => {
    try {
        const { project_id, object_id, doc_id } = req.query;

        let docQuery = supabaseAdmin.from('est_documents').select('id');
        if (doc_id) {
            docQuery = docQuery.eq('id', doc_id);
        } else {
            if (!project_id) return res.status(400).json({ error: 'project_id required' });
            docQuery = docQuery.eq('project_uuid', project_id);
            if (object_id) docQuery = docQuery.eq('object_id', object_id);
            // Договор заключается на основании реально выполненных объёмов — только фактическая версия сметы
            docQuery = docQuery.eq('estimate_type', 'actual');
        }

        const { data: docs } = await docQuery;
        if (!docs || docs.length === 0) return res.json([]);

        const docIds = docs.map(d => d.id);

        const { data: resources, error } = await supabaseAdmin
            .from('est_doc_resources')
            .select('id, doc_id, work_id, resource_id, quantity, price, amount')
            .in('doc_id', docIds)
            .eq('is_excluded', false)
            .order('doc_id');
        if (error) throw error;

        const resourceCatalogInfo = await getResourceCatalogInfo((resources || []).map(r => r.resource_id).filter(Boolean));
        const resourceIds = (resources || []).map(r => r.id);
        let assignedMap = {};
        if (resourceIds.length > 0) {
            const { data: assignments } = await supabaseAdmin
                .from('contract_assignments')
                .select('est_doc_resource_id, assigned_quantity')
                .in('est_doc_resource_id', resourceIds)
                .eq('assignment_type', 'RESOURCE')
                .neq('status', 'CANCELLED');

            for (const a of (assignments || [])) {
                const rid = a.est_doc_resource_id;
                if (!assignedMap[rid]) assignedMap[rid] = 0;
                assignedMap[rid] += Number(a.assigned_quantity || 0);
            }
        }

        const result = (resources || []).map(r => {
            const totalQty = Number(r.quantity || 0);
            const assignedQty = assignedMap[r.id] || 0;
            return {
                id: r.id,
                doc_id: r.doc_id,
                work_id: r.work_id,
                name: resourceCatalogInfo[r.resource_id]?.name || 'Ресурс',
                type: resourceCatalogInfo[r.resource_id]?.type || '',
                unit: resourceCatalogInfo[r.resource_id]?.unit || '',
                total_quantity: totalQty,
                assigned_quantity: assignedQty,
                remaining_quantity: Math.max(0, totalQty - assignedQty),
                assigned_percent: totalQty > 0 ? Math.round((assignedQty / totalQty) * 100) : 0,
                price: Number(r.price || 0),
                amount: Number(r.amount || 0),
            };
        });

        res.json(result);
    } catch (err) {
        console.error('[RESOURCES FOR ASSIGNMENT]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// ДОГОВОРА — РЕЕСТР
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/contracts/list
router.get('/list', async (req, res) => {
    try {
        const { project_id, object_id, status, contractor_id, contract_type } = req.query;

        let q = supabaseAdmin
            .from('contracts')
            .select(`
                *,
                contractors:contractor_id (id, company_name, bin_iin, phone, email, contact_person, bank_account, address),
                projects:project_id (id, name, code),
                project_objects:object_id (id, name),
                dic_currencies:currency_id (id, code, symbol)
            `)
            .order('created_at', { ascending: false });

        if (project_id) q = q.eq('project_id', project_id);
        if (object_id) q = q.eq('object_id', object_id);
        if (status) q = q.eq('status', status);
        if (contractor_id) q = q.eq('contractor_id', contractor_id);
        if (contract_type) q = q.eq('contract_type', contract_type);

        const { data, error } = await q;
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        console.error('[CONTRACTS LIST]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/contracts — создать черновик договора
router.post('/', async (req, res) => {
    try {
        const {
            project_id, object_id, contractor_id,
            contract_number, contract_name, contract_type,
            contract_mode, date_start, date_end, total_amount, notes, currency_id,
            tender_amount, tender_resource_types
        } = req.body;

        if (!project_id || !contractor_id) {
            return res.status(400).json({ error: 'project_id и contractor_id обязательны' });
        }

        const { data, error } = await supabaseAdmin
            .from('contracts')
            .insert([{
                project_id,
                object_id: object_id || null,
                contractor_id,
                contract_number: contract_number || null,
                contract_name: contract_name || null,
                contract_type: contract_type || 'SUBCONTRACT',
                contract_mode: contract_mode || 'STANDARD',
                status: 'DRAFT',
                date_start: date_start || null,
                date_end: date_end || null,
                total_amount: total_amount || 0,
                notes: notes || null,
                currency_id: currency_id || null,
                created_by: req.user?.id || null,
                tender_amount: tender_amount || null,
                tender_resource_types: Array.isArray(tender_resource_types) && tender_resource_types.length > 0 ? tender_resource_types : null,
            }])
            .select(`
                *,
                contractors:contractor_id (id, company_name, bin_iin, phone, email, contact_person, bank_account, address),
                projects:project_id (id, name, code),
                project_objects:object_id (id, name),
                dic_currencies:currency_id (id, code, symbol)
            `)
            .single();

        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('[CONTRACT CREATE]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// ДОГОВОР — ОДИНОЧНЫЕ ОПЕРАЦИИ
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/contracts/:id
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { data, error } = await supabaseAdmin
            .from('contracts')
            .select(`
                *,
                contractors:contractor_id (id, company_name, bin_iin, contact_person, phone, email, bank_account, address),
                projects:project_id (id, name, code),
                project_objects:object_id (id, name),
                dic_currencies:currency_id (id, code, symbol)
            `)
            .eq('id', id)
            .single();
        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Договор не найден' });

        // История согласования
        const { data: approvals } = await supabaseAdmin
            .from('contract_approvals')
            .select('*')
            .eq('contract_id', id)
            .order('created_at', { ascending: true });

        res.json({ ...data, approvals: approvals || [] });
    } catch (err) {
        console.error('[CONTRACT GET]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/contracts/:id — обновить реквизиты
router.patch('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Только черновики можно редактировать свободно
        const { data: existing } = await supabaseAdmin
            .from('contracts')
            .select('status')
            .eq('id', id)
            .single();

        if (existing && !['DRAFT', 'REVISION'].includes(existing.status)) {
            return forbidden(res, 'Редактирование разрешено только для черновиков');
        }

        const allowed = ['contract_number', 'contract_name', 'contract_type', 'contract_mode',
            'date_start', 'date_end', 'total_amount', 'notes', 'object_id',
            'tender_amount', 'tender_resource_types'];
        const updateData = {};
        const body = req.body || {};
        for (const key of allowed) {
            if (body[key] !== undefined) updateData[key] = body[key];
        }
        updateData.updated_at = new Date().toISOString();

        const { data, error } = await supabaseAdmin
            .from('contracts')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('[CONTRACT PATCH]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/contracts/:id/submit — отправить на согласование
router.post('/:id/submit', async (req, res) => {
    try {
        const { id } = req.params;

        const { data: contract } = await supabaseAdmin
            .from('contracts')
            .select('status')
            .eq('id', id)
            .single();

        if (!contract) return res.status(404).json({ error: 'Договор не найден' });
        if (!['DRAFT', 'REVISION'].includes(contract.status)) {
            return res.status(400).json({ error: 'Только черновик можно отправить на согласование' });
        }

        await supabaseAdmin.from('contracts').update({
            status: 'PENDING_APPROVAL',
            updated_at: new Date().toISOString()
        }).eq('id', id);

        await supabaseAdmin.from('contract_approvals').insert([{
            contract_id: id,
            action: 'SUBMITTED',
            performed_by: req.user?.id || null,
            comment: req.body?.comment || null,
        }]);

        res.json({ success: true, status: 'PENDING_APPROVAL' });
    } catch (err) {
        console.error('[CONTRACT SUBMIT]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/contracts/:id/approve — согласовать (только director)
router.post('/:id/approve', async (req, res) => {
    try {
        if (!['director', 'manager', 'admin'].includes(req.user?.role)) {
            return forbidden(res, 'Согласование доступно только для руководителей');
        }

        const { id } = req.params;

        const { data: contract } = await supabaseAdmin
            .from('contracts')
            .select('status')
            .eq('id', id)
            .single();

        if (!contract) return res.status(404).json({ error: 'Договор не найден' });
        if (contract.status !== 'PENDING_APPROVAL') {
            return res.status(400).json({ error: 'Договор не ожидает согласования' });
        }

        await supabaseAdmin.from('contracts').update({
            status: 'APPROVED',
            approved_by: req.user?.id,
            approved_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        }).eq('id', id);

        await supabaseAdmin.from('contract_approvals').insert([{
            contract_id: id,
            action: 'APPROVED',
            performed_by: req.user?.id,
            comment: req.body?.comment || null,
        }]);

        res.json({ success: true, status: 'APPROVED' });
    } catch (err) {
        console.error('[CONTRACT APPROVE]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/contracts/:id/reject — отклонить
router.post('/:id/reject', async (req, res) => {
    try {
        if (!['director', 'manager', 'admin'].includes(req.user?.role)) {
            return forbidden(res, 'Отклонение доступно только для руководителей');
        }

        const { id } = req.params;
        const { comment } = req.body || {};

        await supabaseAdmin.from('contracts').update({
            status: 'REVISION',
            updated_at: new Date().toISOString(),
        }).eq('id', id);

        await supabaseAdmin.from('contract_approvals').insert([{
            contract_id: id,
            action: 'REJECTED',
            performed_by: req.user?.id,
            comment: comment || null,
        }]);

        res.json({ success: true, status: 'REVISION' });
    } catch (err) {
        console.error('[CONTRACT REJECT]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// НАЗНАЧЕНИЯ
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/contracts/:id/assignments
router.get('/:id/assignments', async (req, res) => {
    try {
        const { id } = req.params;
        const { data, error } = await supabaseAdmin
            .from('contract_assignments')
            .select('*')
            .eq('contract_id', id)
            .order('created_at');
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        console.error('[ASSIGNMENTS GET]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/contracts/:id/assignments — batch-сохранение назначений
router.post('/:id/assignments', async (req, res) => {
    try {
        const { id } = req.params;
        const { assignments } = req.body || {}; // Array of assignment objects

        if (!Array.isArray(assignments) || assignments.length === 0) {
            return res.status(400).json({ error: 'Массив назначений пуст' });
        }

        const { data: contract } = await supabaseAdmin
            .from('contracts')
            .select('status, contract_type')
            .eq('id', id)
            .single();

        if (!contract) return res.status(404).json({ error: 'Договор не найден' });

        // Целостность данных: сумма закреплённых по всем договорам объёмов на одну работу/ресурс
        // не должна превышать общий объём по смете — проверяем на сервере, т.к. фронтенд можно обойти.
        const workIds = Array.from(new Set(assignments.map(a => a.est_doc_work_id).filter(Boolean)));
        const resourceIds = Array.from(new Set(assignments.map(a => a.est_doc_resource_id).filter(Boolean)));

        const [existingWorkAssignments, existingResAssignments, workRows, resRows] = await Promise.all([
            workIds.length > 0
                ? supabaseAdmin.from('contract_assignments').select('est_doc_work_id, assigned_quantity').in('est_doc_work_id', workIds).eq('assignment_type', 'WORK').neq('status', 'CANCELLED')
                : Promise.resolve({ data: [] }),
            resourceIds.length > 0
                ? supabaseAdmin.from('contract_assignments').select('est_doc_resource_id, assigned_quantity').in('est_doc_resource_id', resourceIds).eq('assignment_type', 'RESOURCE').neq('status', 'CANCELLED')
                : Promise.resolve({ data: [] }),
            workIds.length > 0
                ? supabaseAdmin.from('est_doc_works').select('id, volume').in('id', workIds)
                : Promise.resolve({ data: [] }),
            resourceIds.length > 0
                ? supabaseAdmin.from('est_doc_resources').select('id, quantity').in('id', resourceIds)
                : Promise.resolve({ data: [] })
        ]);

        const alreadyAssignedByWork = {};
        (existingWorkAssignments.data || []).forEach(a => {
            alreadyAssignedByWork[a.est_doc_work_id] = (alreadyAssignedByWork[a.est_doc_work_id] || 0) + Number(a.assigned_quantity || 0);
        });
        const alreadyAssignedByResource = {};
        (existingResAssignments.data || []).forEach(a => {
            alreadyAssignedByResource[a.est_doc_resource_id] = (alreadyAssignedByResource[a.est_doc_resource_id] || 0) + Number(a.assigned_quantity || 0);
        });
        const totalByWork = {};
        (workRows.data || []).forEach(w => { totalByWork[w.id] = Number(w.volume || 0); });
        const totalByResource = {};
        (resRows.data || []).forEach(r => { totalByResource[r.id] = Number(r.quantity || 0); });

        // Новые назначения в этом же батче тоже накапливаются (одна работа может встретиться
        // несколько раз, если пользователь распределяет её сразу на несколько договоров за раз).
        const newlyAddedByWork = {};
        const newlyAddedByResource = {};
        for (const a of assignments) {
            const qty = Number(a.assigned_quantity || 0);
            if (a.est_doc_work_id) {
                const total = totalByWork[a.est_doc_work_id] ?? null;
                const already = (alreadyAssignedByWork[a.est_doc_work_id] || 0) + (newlyAddedByWork[a.est_doc_work_id] || 0);
                if (total != null) {
                    const remaining = Math.max(0, total - already);
                    if (qty > remaining + 1e-9) {
                        return res.status(400).json({ error: `Объём "${a.work_name || 'работы'}" (${qty}) превышает доступный остаток (${remaining})` });
                    }
                }
                newlyAddedByWork[a.est_doc_work_id] = (newlyAddedByWork[a.est_doc_work_id] || 0) + qty;
            }
            if (a.est_doc_resource_id) {
                const total = totalByResource[a.est_doc_resource_id] ?? null;
                const already = (alreadyAssignedByResource[a.est_doc_resource_id] || 0) + (newlyAddedByResource[a.est_doc_resource_id] || 0);
                if (total != null) {
                    const remaining = Math.max(0, total - already);
                    if (qty > remaining + 1e-9) {
                        return res.status(400).json({ error: `Объём "${a.resource_name || 'ресурса'}" (${qty}) превышает доступный остаток (${remaining})` });
                    }
                }
                newlyAddedByResource[a.est_doc_resource_id] = (newlyAddedByResource[a.est_doc_resource_id] || 0) + qty;
            }
        }

        const toInsert = assignments.map(a => ({
            contract_id: id,
            assignment_type: a.assignment_type || (contract.contract_type === 'SUPPLY' ? 'RESOURCE' : 'WORK'),
            est_doc_work_id: a.est_doc_work_id || null,
            est_doc_resource_id: a.est_doc_resource_id || null,
            work_name: a.work_name || null,
            work_unit: a.work_unit || null,
            resource_name: a.resource_name || null,
            resource_unit: a.resource_unit || null,
            resource_spec: a.resource_spec || null,
            total_quantity: Number(a.total_quantity || 0),
            assigned_quantity: Number(a.assigned_quantity || 0),
            unit_price: Number(a.unit_price || 0),
            with_materials: Boolean(a.with_materials),
            notes: a.notes || null,
            status: 'PLANNED',
        }));

        const { data, error } = await supabaseAdmin
            .from('contract_assignments')
            .insert(toInsert)
            .select();
        if (error) throw error;

        res.json(data);
    } catch (err) {
        console.error('[ASSIGNMENTS POST]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Код справочника видов ресурсов (dic_resource_types.code) → категория для распределения
// тендерной суммы. Те же коды, что используются в dictionaries.js для разбора каталогов
// Labor_cas/Machine_cas/Materials_cas.
const RESOURCE_TYPE_CODE_TO_CATEGORY = {
    '10.100.': 'labor',
    '10.120.': 'machine',
    '10.130.': 'material'
};

// Общая логика расчёта — вынесена отдельно, чтобы ей могли пользоваться и
// предпросмотр (до сохранения договора), и финальный расчёт с сохранением.
//
// Формула: Sᵢ — сумма выбранных видов ресурсов по работе i из исходной сметы,
// S_смета — сумма Sᵢ по всем переданным работам, k = S_тендер / S_смета,
// Sᵢ_новая = Sᵢ × k. Сумма всех Sᵢ_новая автоматически равна S_тендер.
async function calculateTenderDistribution(workIds, tenderAmount, selectedCategories) {
    if (workIds.length === 0) {
        const err = new Error('Не выбрано ни одной работы — сначала отметьте работы в списке');
        err.status = 400;
        throw err;
    }

    const { data: resources } = await supabaseAdmin
        .from('est_doc_resources')
        .select('work_id, resource_id, amount')
        .in('work_id', workIds)
        .eq('is_excluded', false);

    const resourceIds = Array.from(new Set((resources || []).map(r => r.resource_id).filter(Boolean)));
    const resourceInfo = await getResourceCatalogInfo(resourceIds);

    // getWorkCatalogInfo принимает id из каталога работ (jobs/jobs_cas), а не id строки
    // сметы (est_doc_works.id) — нужно сначала получить catalog work_id по каждой строке.
    const { data: estDocWorksRows } = await supabaseAdmin
        .from('est_doc_works')
        .select('id, work_id')
        .in('id', workIds);
    const catalogWorkIdByDocWorkId = {};
    (estDocWorksRows || []).forEach(w => { catalogWorkIdByDocWorkId[w.id] = w.work_id; });
    const catalogWorkIds = Array.from(new Set(Object.values(catalogWorkIdByDocWorkId).filter(Boolean)));
    const catalogWorkInfo = await getWorkCatalogInfo(catalogWorkIds);
    const workInfo = {};
    workIds.forEach(wid => { workInfo[wid] = catalogWorkInfo[catalogWorkIdByDocWorkId[wid]] || null; });

    // Sᵢ по каждой работе — сумма только тех ресурсов, чья категория выбрана
    const sByWork = {};
    workIds.forEach(wid => { sByWork[wid] = 0; });
    (resources || []).forEach(r => {
        const category = RESOURCE_TYPE_CODE_TO_CATEGORY[resourceInfo[r.resource_id]?.type_code];
        if (category && selectedCategories.includes(category)) {
            sByWork[r.work_id] = (sByWork[r.work_id] || 0) + Number(r.amount || 0);
        }
    });

    const sourceTotal = Object.values(sByWork).reduce((sum, v) => sum + v, 0);
    if (sourceTotal <= 0) {
        const err = new Error('По выбранным видам ресурсов в смете отмеченных работ ничего не найдено — распределять нечего');
        err.status = 400;
        throw err;
    }

    const coefficient = tenderAmount / sourceTotal;

    return {
        tender_amount: tenderAmount,
        source_total: sourceTotal,
        coefficient,
        distribution: workIds.map(wid => ({
            est_doc_work_id: wid,
            work_name: workInfo[wid]?.name || null,
            original_amount: sByWork[wid],
            coefficient,
            distributed_amount: sByWork[wid] * coefficient
        })).sort((a, b) => b.distributed_amount - a.distributed_amount)
    };
}

// POST /api/contracts/tender-distribution-preview — тот же расчёт, но БЕЗ сохранённого
// договора и назначений: работает прямо по списку отмеченных работ на шаге "Позиции",
// пока договор ещё не сохранён. Нужен, чтобы пользователь видел результат сразу, а не
// только после сохранения всего договора целиком.
router.post('/tender-distribution-preview', async (req, res) => {
    try {
        const { work_ids, tender_amount, resource_types } = req.body || {};

        const tenderAmount = Number(tender_amount);
        if (!tenderAmount || tenderAmount <= 0) {
            return res.status(400).json({ error: 'Укажите тендерную сумму больше нуля' });
        }
        const selectedCategories = Array.isArray(resource_types) ? resource_types.filter(Boolean) : [];
        if (selectedCategories.length === 0) {
            return res.status(400).json({ error: 'Выберите хотя бы один вид ресурсов для распределения' });
        }
        const workIds = Array.isArray(work_ids) ? Array.from(new Set(work_ids.filter(Boolean))) : [];

        const result = await calculateTenderDistribution(workIds, tenderAmount, selectedCategories);
        res.json(result);
    } catch (err) {
        console.error('[TENDER DISTRIBUTION PREVIEW]', err.message);
        res.status(err.status || 500).json({ error: err.message });
    }
});

// POST /api/contracts/:id/tender-distribution — тот же расчёт, но по работам, уже
// назначенным сохранённому договору, и с сохранением результата в базу.
router.post('/:id/tender-distribution', async (req, res) => {
    try {
        const { id } = req.params;
        const { tender_amount, resource_types } = req.body || {};

        const tenderAmount = Number(tender_amount);
        if (!tenderAmount || tenderAmount <= 0) {
            return res.status(400).json({ error: 'Укажите тендерную сумму больше нуля' });
        }
        const selectedCategories = Array.isArray(resource_types) ? resource_types.filter(Boolean) : [];
        if (selectedCategories.length === 0) {
            return res.status(400).json({ error: 'Выберите хотя бы один вид ресурсов для распределения' });
        }

        const { data: contract } = await supabaseAdmin.from('contracts').select('id').eq('id', id).single();
        if (!contract) return res.status(404).json({ error: 'Договор не найден' });

        // Работы, назначенные этому договору
        const { data: workAssignments } = await supabaseAdmin
            .from('contract_assignments')
            .select('est_doc_work_id')
            .eq('contract_id', id)
            .eq('assignment_type', 'WORK')
            .not('est_doc_work_id', 'is', null);

        const workIds = Array.from(new Set((workAssignments || []).map(a => a.est_doc_work_id)));
        if (workIds.length === 0) {
            return res.status(400).json({ error: 'У договора нет назначенных работ — сначала назначьте позиции на шаге "Позиции"' });
        }

        const result = await calculateTenderDistribution(workIds, tenderAmount, selectedCategories);

        const rows = result.distribution.map(row => ({
            contract_id: id,
            est_doc_work_id: row.est_doc_work_id,
            work_name: row.work_name,
            original_amount: row.original_amount,
            coefficient: row.coefficient,
            distributed_amount: row.distributed_amount,
            updated_at: new Date().toISOString()
        }));

        const { data: saved, error: upsertErr } = await supabaseAdmin
            .from('contract_tender_distribution')
            .upsert(rows, { onConflict: 'contract_id,est_doc_work_id' })
            .select();
        if (upsertErr) throw upsertErr;

        await supabaseAdmin.from('contracts').update({
            tender_amount: tenderAmount,
            tender_resource_types: selectedCategories,
            updated_at: new Date().toISOString()
        }).eq('id', id);

        res.json({
            tender_amount: result.tender_amount,
            source_total: result.source_total,
            coefficient: result.coefficient,
            distribution: (saved || []).sort((a, b) => b.distributed_amount - a.distributed_amount)
        });
    } catch (err) {
        console.error('[TENDER DISTRIBUTION POST]', err.message);
        res.status(err.status || 500).json({ error: err.message });
    }
});

// GET /api/contracts/:id/tender-distribution — прочитать сохранённое распределение
router.get('/:id/tender-distribution', async (req, res) => {
    try {
        const { id } = req.params;
        const { data, error } = await supabaseAdmin
            .from('contract_tender_distribution')
            .select('*')
            .eq('contract_id', id)
            .order('distributed_amount', { ascending: false });
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        console.error('[TENDER DISTRIBUTION GET]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/contracts/assignments/:assignId
router.delete('/assignments/:assignId', async (req, res) => {
    try {
        const { assignId } = req.params;
        const { error } = await supabaseAdmin
            .from('contract_assignments')
            .delete()
            .eq('id', assignId);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        console.error('[ASSIGNMENT DELETE]', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
