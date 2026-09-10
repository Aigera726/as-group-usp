const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../supabase');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

// --- ПРОВЕРКА БЛОКИРОВКИ СМЕТЫ ---
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
            if (doc.status !== 'planned_formed') return true;
            
            // Если для неё уже создана фактическая смета, она тоже заблокирована
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
            if (doc.status !== 'actual_formed') return true;
            return false;
        }

        // 3. Рабочая версия сметы (work)
        const { data: activePlans } = await supabaseAdmin
            .from('est_documents')
            .select('id')
            .eq('parent_doc_id', docId)
            .eq('estimate_type', 'planned')
            .in('status', ['planned_formed', 'planned_review', 'planned_approved'])
            .limit(1);
        if (activePlans && activePlans.length > 0) return true;

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

// Получить список материалов из фактической сметы с расчетом остатка потребности
router.get('/materials', async (req, res) => {
    try {
        const { project_id, object_id, estimate_type = 'actual' } = req.query;
        if (!project_id || !object_id) {
            return res.status(400).json({ error: 'Параметры project_id и object_id обязательны' });
        }

        // 1. Ищем смету на основе выбранного типа
        let docQuery = supabaseAdmin
            .from('est_documents')
            .select('id, status, estimate_type, region_id, projects:project_uuid(region_id)')
            .eq('project_uuid', project_id)
            .eq('object_id', object_id)
            .eq('estimate_type', estimate_type);

        if (estimate_type === 'planned') {
            docQuery = docQuery.in('status', ['planned_formed', 'planned_review', 'planned_approved']);
        } else {
            docQuery = docQuery.in('status', ['actual_formed', 'actual_review', 'actual_approved']);
        }

        const { data: doc, error: docErr } = await docQuery
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        
        if (docErr) throw docErr;
        if (!doc) {
            return res.json({ doc: null, resources: [] });
        }

        const isReadonly = await checkIfDocLocked(doc.id);

        // Вычисляем страну проекта
        const regionId = doc.region_id || doc.projects?.region_id;
        let countryCode = 'GE';
        if (regionId) {
            const { data: reg } = await supabaseAdmin
                .from('dic_regions')
                .select('id, code, dic_countries(id, code)')
                .eq('id', regionId)
                .maybeSingle();
            if (reg?.dic_countries?.code) {
                countryCode = reg.dic_countries.code.toUpperCase();
            }
        }
        const isAz = countryCode === 'AZ';

        // 2. Получаем все ресурсы
        const { data: resources, error: resErr } = await supabaseAdmin
            .from('est_doc_resources')
            .select('*')
            .eq('doc_id', doc.id)
            .eq('is_excluded', false);

        if (resErr) throw resErr;
        if (!resources || resources.length === 0) {
            return res.json({ doc: { id: doc.id }, resources: [] });
        }

        // Получаем работы и локализуем их названия
        const { data: works, error: worksErr } = await supabaseAdmin
            .from('est_doc_works')
            .select('id, work_id')
            .eq('doc_id', doc.id);
        if (worksErr) throw worksErr;

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

        const worksNameMap = {};
        (works || []).forEach(w => {
            const job = jobsMap[w.work_id] || {};
            const names = workLocMap[w.work_id] || workLocMap[job.name_id] || {};
            const rawName = names.ru || names.en || names.ka || names.az || '';
            worksNameMap[w.id] = rawName ? `${job.code || ''} ${rawName}`.trim() : (job.code ? `${job.code} Работы` : 'Работы');
        });

        const resIds = resources.map(r => r.resource_id).filter(Boolean);
        let customResourcesMap = {};
        let resLocs = [];
        let azMaterialsSet = new Set();

        if (isAz) {
            if (resIds.length > 0) {
                const [laborRes, machineRes, materialRes] = await Promise.all([
                    supabaseAdmin.from('Labor_cas').select('id, code, dic_measures(id, code), dic_resource_types(id, code)').in('id', resIds),
                    supabaseAdmin.from('Machine_cas').select('id, code, dic_measures(id, code), dic_resource_types(id, code)').in('id', resIds),
                    supabaseAdmin.from('Materials_cas').select('id, code, dic_measures(id, code), dic_resource_types(id, code)').in('id', resIds)
                ]);
                
                (laborRes.data || []).forEach(r => { customResourcesMap[r.id] = r; });
                (machineRes.data || []).forEach(r => { customResourcesMap[r.id] = r; });
                (materialRes.data || []).forEach(r => { 
                    customResourcesMap[r.id] = r; 
                    azMaterialsSet.add(r.id);
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

        const resLocMap = {};
        resLocs.forEach(l => {
            if (!resLocMap[l.object_id]) resLocMap[l.object_id] = {};
            resLocMap[l.object_id][l.locale] = l.name;
        });

        // Загружаем названия единиц измерения
        const allMeasureIds = Array.from(new Set(
            Object.values(customResourcesMap).map(r => r.dic_measures?.id)
        )).filter(Boolean);

        const { data: measureLocs } = allMeasureIds.length > 0 ? await supabaseAdmin.from('localization')
            .select('object_id, locale, name')
            .eq('object_name', 'dic_measures')
            .in('object_id', allMeasureIds) : { data: [] };
        
        const measureLocMap = {};
        (measureLocs || []).forEach(l => {
            if (!measureLocMap[l.object_id]) measureLocMap[l.object_id] = {};
            measureLocMap[l.object_id][l.locale] = l.name;
        });

        // Фильтруем только материалы
        const materialsOnly = resources.filter(r => {
            const resObj = customResourcesMap[r.resource_id];
            if (!resObj) return false;

            if (isAz) {
                return azMaterialsSet.has(r.resource_id);
            } else {
                const tCode = resObj.dic_resource_types?.code;
                const rtId = resObj.dic_resource_types?.id;
                return rtId === 'dfd6e4a9-93c7-4053-a8ca-5382ae017771' || (tCode && tCode.startsWith('10.130.'));
            }
        });

        // 3. Получаем календарный план (est_doc_schedules) для определения периодов работ
        const { data: schedules, error: schedErr } = await supabaseAdmin
            .from('est_doc_schedules')
            .select('work_id, start_date, duration_days')
            .eq('doc_id', doc.id);
        
        const scheduleMap = {};
        if (!schedErr && schedules) {
            schedules.forEach(s => {
                if (s.work_id && s.start_date) {
                    const start = new Date(s.start_date);
                    const end = new Date(start);
                    end.setDate(start.getDate() + Math.max(0, parseInt(s.duration_days, 10) - 1));
                    scheduleMap[s.work_id] = {
                        start_date: s.start_date.split('T')[0],
                        end_date: end.toISOString().split('T')[0]
                    };
                }
            });
        }

        // Формируем итоговые строки
        // Количество определяется автоматически версией сметы: план -> plan_quantity, факт -> fact_quantity
        const resultResources = materialsOnly.map(r => {
            const planQty = Number(r.quantity || 0);
            const factQty = Number(r.fact_quantity != null ? r.fact_quantity : r.quantity || 0);
            const displayQty = estimate_type === 'actual' ? factQty : planQty;
            const resObj = customResourcesMap[r.resource_id] || {};
            const names = resLocMap[r.resource_id] || {};
            const measureId = resObj.dic_measures?.id;
            const unitNames = measureLocMap[measureId] || {};

            return {
                id: r.id,
                work_id: r.work_id,
                work_name: worksNameMap[r.work_id] || '',
                resource_id: r.resource_id,
                name: names.ru || names.en || names.ka || names.az || `Resource ${resObj.code || ''}`,
                name_en: names.en || '',
                name_ka: names.ka || '',
                name_az: names.az || '',
                unit: unitNames.ru || unitNames.en || unitNames.ka || unitNames.az || resObj.dic_measures?.code || 'PCS',
                unit_en: unitNames.en || '',
                unit_ka: unitNames.ka || '',
                unit_az: unitNames.az || '',
                source: r.source || 'norm',
                plan_quantity: planQty,
                fact_quantity: factQty,
                quantity: displayQty,
                work_start_date: scheduleMap[r.work_id]?.start_date || '',
                work_end_date: scheduleMap[r.work_id]?.end_date || ''
            };
        });

        res.json({
            doc: { id: doc.id, is_readonly: isReadonly, status: doc.status },
            resources: resultResources
        });

    } catch (err) {
        console.error('[GPM MATERIALS ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Создать новую позицию потребности
router.post('/materials/demand', async (req, res) => {
    try {
        const {
            project_id,
            object_id,
            doc_id,
            work_id,
            resource_id,
            quantity,
            start_date,
            end_date,
            comment
        } = req.body;

        if (!project_id || !object_id || !doc_id || !work_id || !resource_id || !quantity || !start_date || !end_date) {
            return res.status(400).json({ error: 'Все поля, кроме комментария, обязательны' });
        }

        // Проверяем блокировку документа
        const { data: checkDoc } = await supabaseAdmin
            .from('est_documents')
            .select('status, estimate_type')
            .eq('id', doc_id)
            .maybeSingle();

        if (await checkIfDocLocked(doc_id)) {
            return res.status(400).json({ error: 'Редактирование запрещено: смета заблокирована' });
        }

        const qtyToSave = Number(quantity);
        if (isNaN(qtyToSave) || qtyToSave <= 0) {
            return res.status(400).json({ error: 'Количество должно быть больше 0' });
        }

        // Проверяем лимит
        const { data: resRow, error: resErr } = await supabaseAdmin
            .from('est_doc_resources')
            .select('quantity')
            .eq('id', resource_id)
            .single();
        
        if (resErr || !resRow) {
            return res.status(404).json({ error: 'Ресурс сметы не найден' });
        }

        const { data: demands, error: demErr } = await supabaseAdmin
            .from('est_gpm_material_demands')
            .select('quantity')
            .eq('resource_id', resource_id);

        if (demErr) throw demErr;

        const alreadyTransferred = (demands || []).reduce((sum, d) => sum + Number(d.quantity), 0);
        const limit = Number(resRow.quantity);
        const remaining = Math.max(0, limit - alreadyTransferred);

        if (qtyToSave > remaining) {
            return res.status(400).json({ error: `Введенное количество (${qtyToSave}) превышает доступный остаток (${remaining})!` });
        }

        // Сохраняем в бд
        const { data, error: insErr } = await supabaseAdmin
            .from('est_gpm_material_demands')
            .insert([{
                project_uuid: project_id,
                object_id,
                doc_id,
                work_id,
                resource_id,
                quantity: qtyToSave,
                start_date,
                end_date,
                comment: comment || null,
                created_by: req.user?.id || null
            }])
            .select()
            .single();

        if (insErr) throw insErr;
        res.json(data);

    } catch (err) {
        console.error('[GPM DEMAND SAVE ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Получить историю внесенных потребностей
router.get('/materials/demand-list', async (req, res) => {
    try {
        const { project_id, object_id, estimate_type = 'actual' } = req.query;
        if (!project_id || !object_id) {
            return res.status(400).json({ error: 'Параметры project_id и object_id обязательны' });
        }

        // Вычисляем страну проекта для истории
        const { data: doc } = await supabaseAdmin
            .from('est_documents')
            .select('id, region_id, projects:project_uuid(region_id)')
            .eq('project_uuid', project_id)
            .eq('object_id', object_id)
            .eq('estimate_type', estimate_type)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        
        let countryCode = 'GE';
        if (doc) {
            const regionId = doc.region_id || doc.projects?.region_id;
            if (regionId) {
                const { data: reg } = await supabaseAdmin
                    .from('dic_regions')
                    .select('id, code, dic_countries(id, code)')
                    .eq('id', regionId)
                    .maybeSingle();
                if (reg?.dic_countries?.code) {
                    countryCode = reg.dic_countries.code.toUpperCase();
                }
            }
        }
        const isAz = countryCode === 'AZ';

        let query = supabaseAdmin
            .from('est_gpm_material_demands')
            .select('*')
            .eq('project_uuid', project_id)
            .eq('object_id', object_id);

        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) throw error;

        if (!data || data.length === 0) {
            return res.json([]);
        }

        // Загружаем связанные ресурсы сметы
        const estResIds = data.map(d => d.resource_id).filter(Boolean);
        const { data: estResources } = await supabaseAdmin
            .from('est_doc_resources')
            .select('id, resource_id, source')
            .in('id', estResIds);

        const estResMap = {};
        const estResSourceMap = {};
        (estResources || []).forEach(er => { 
            estResMap[er.id] = er.resource_id; 
            estResSourceMap[er.id] = er.source || 'norm';
        });

        const catalogResIds = Object.values(estResMap).filter(Boolean);
        let customResourcesMap = {};
        let resLocs = [];

        if (catalogResIds.length > 0) {
            if (isAz) {
                const [laborRes, machineRes, materialRes] = await Promise.all([
                    supabaseAdmin.from('Labor_cas').select('id, code, dic_measures(id, code)').in('id', catalogResIds),
                    supabaseAdmin.from('Machine_cas').select('id, code, dic_measures(id, code)').in('id', catalogResIds),
                    supabaseAdmin.from('Materials_cas').select('id, code, dic_measures(id, code)').in('id', catalogResIds)
                ]);
                const allCustomResources = [
                    ...(laborRes.data || []),
                    ...(machineRes.data || []),
                    ...(materialRes.data || [])
                ];
                allCustomResources.forEach(r => { customResourcesMap[r.id] = r; });
                const { data: locs } = await supabaseAdmin
                    .from('localization')
                    .select('object_id, locale, name')
                    .in('object_name', ['Labor_cas', 'Machine_cas', 'Materials_cas'])
                    .in('object_id', catalogResIds);
                resLocs = locs || [];
            } else {
                const { data: geRes } = await supabaseAdmin
                    .from('resources')
                    .select('id, code, dic_measures(id, code)')
                    .in('id', catalogResIds);
                (geRes || []).forEach(r => { customResourcesMap[r.id] = r; });
                const { data: locs } = await supabaseAdmin
                    .from('localization')
                    .select('object_id, locale, name')
                    .eq('object_name', 'resources')
                    .in('object_id', catalogResIds);
                resLocs = locs || [];
            }
        }

        const resLocMap = {};
        resLocs.forEach(l => {
            if (!resLocMap[l.object_id]) resLocMap[l.object_id] = {};
            resLocMap[l.object_id][l.locale] = l.name;
        });

        // Загружаем названия единиц измерения
        const allMeasureIds = Array.from(new Set(
            Object.values(customResourcesMap).map(r => r.dic_measures?.id)
        )).filter(Boolean);

        const { data: measureLocs } = allMeasureIds.length > 0 ? await supabaseAdmin.from('localization')
            .select('object_id, locale, name')
            .eq('object_name', 'dic_measures')
            .in('object_id', allMeasureIds) : { data: [] };
        
        const measureLocMap = {};
        (measureLocs || []).forEach(l => {
            if (!measureLocMap[l.object_id]) measureLocMap[l.object_id] = {};
            measureLocMap[l.object_id][l.locale] = l.name;
        });

        // Получаем работы
        const workIds = data.map(d => d.work_id).filter(Boolean);
        const { data: works } = workIds.length > 0 ? await supabaseAdmin
            .from('est_doc_works')
            .select('id, work_id')
            .in('id', workIds) : { data: [] };

        const workCatalogIds = (works || []).map(w => w.work_id).filter(Boolean);

        const { data: jobsList } = workCatalogIds.length > 0 ? await supabaseAdmin
            .from('jobs')
            .select('id, code, name_id')
            .in('id', workCatalogIds) : { data: [] };

        const { data: jobsCasList } = workCatalogIds.length > 0 ? await supabaseAdmin
            .from('jobs_cas')
            .select('id, code, name_id')
            .in('id', workCatalogIds) : { data: [] };

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

        const worksNameMap = {};
        (works || []).forEach(w => {
            const job = jobsMap[w.work_id] || {};
            const names = workLocMap[w.work_id] || workLocMap[job.name_id] || {};
            const rawName = names.ru || names.en || names.ka || names.az || '';
            worksNameMap[w.id] = rawName ? `${job.code || ''} ${rawName}`.trim() : (job.code ? `${job.code} Работы` : 'Работы');
        });

        const formatted = data.map(d => {
            const catalogId = estResMap[d.resource_id];
            const r = customResourcesMap[catalogId] || {};
            const names = resLocMap[catalogId] || {};
            const measureId = r.dic_measures?.id;
            const unitNames = measureLocMap[measureId] || {};

            return {
                id: d.id,
                quantity: Number(d.quantity),
                start_date: d.start_date,
                end_date: d.end_date,
                comment: d.comment,
                created_at: d.created_at,
                resource_name: names.ru || names.en || names.ka || names.az || `Resource ${r.code || ''}`,
                resource_unit: unitNames.ru || r.dic_measures?.code || 'PCS',
                work_name: worksNameMap[d.work_id] || '',
                source: estResSourceMap[d.resource_id] || 'norm'
            };
        });

        res.json(formatted);
    } catch (err) {
        console.error('[GPM DEMAND LIST ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Редактировать позицию потребности ГПМ
router.put('/materials/demand/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { quantity, start_date, end_date, comment } = req.body;

        if (!quantity || !start_date || !end_date) {
            return res.status(400).json({ error: 'Количество, дата начала и окончания обязательны' });
        }

        const qtyToSave = Number(quantity);
        if (isNaN(qtyToSave) || qtyToSave <= 0) {
            return res.status(400).json({ error: 'Количество должно быть больше 0' });
        }

        // 1. Получаем существующую запись потребности
        const { data: demand, error: demErr } = await supabaseAdmin
            .from('est_gpm_material_demands')
            .select('*')
            .eq('id', id)
            .maybeSingle();

        if (demErr || !demand) {
            return res.status(404).json({ error: 'Запись потребности не найдена' });
        }

        // 2. Проверяем блокировку сметы
        const { data: checkDoc } = await supabaseAdmin
            .from('est_documents')
            .select('status, estimate_type')
            .eq('id', demand.doc_id)
            .maybeSingle();

        if (await checkIfDocLocked(demand.doc_id)) {
            return res.status(400).json({ error: 'Редактирование запрещено: смета заблокирована' });
        }

        // 3. Проверяем доступный остаток (исключая текущую редактируемую запись)
        const { data: resRow, error: resErr } = await supabaseAdmin
            .from('est_doc_resources')
            .select('quantity')
            .eq('id', demand.resource_id)
            .single();

        if (resErr || !resRow) {
            return res.status(404).json({ error: 'Ресурс сметы не найден' });
        }

        const { data: otherDemands, error: othersErr } = await supabaseAdmin
            .from('est_gpm_material_demands')
            .select('quantity')
            .eq('resource_id', demand.resource_id)
            .neq('id', id);

        if (othersErr) throw othersErr;

        const alreadyTransferred = (otherDemands || []).reduce((sum, d) => sum + Number(d.quantity), 0);
        const limit = Number(resRow.quantity);
        const remaining = Math.max(0, limit - alreadyTransferred);

        if (qtyToSave > remaining) {
            return res.status(400).json({ error: `Введенное количество (${qtyToSave}) превышает доступный остаток (${remaining})!` });
        }

        // 4. Обновляем потребность
        const { data: updated, error: updErr } = await supabaseAdmin
            .from('est_gpm_material_demands')
            .update({
                quantity: qtyToSave,
                start_date,
                end_date,
                comment: comment || null
            })
            .eq('id', id)
            .select()
            .single();

        if (updErr) throw updErr;
        res.json({ success: true, data: updated });

    } catch (err) {
        console.error('[GPM DEMAND UPDATE ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Удалить позицию потребности ГПМ
router.delete('/materials/demand/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Получаем существующую запись потребности
        const { data: demand, error: demErr } = await supabaseAdmin
            .from('est_gpm_material_demands')
            .select('*')
            .eq('id', id)
            .maybeSingle();

        if (demErr || !demand) {
            return res.status(404).json({ error: 'Запись потребности не найдена' });
        }

        // 2. Проверяем блокировку сметы
        const { data: checkDoc } = await supabaseAdmin
            .from('est_documents')
            .select('status, estimate_type')
            .eq('id', demand.doc_id)
            .maybeSingle();

        if (await checkIfDocLocked(demand.doc_id)) {
            return res.status(400).json({ error: 'Редактирование запрещено: смета заблокирована' });
        }

        // 3. Удаляем запись
        const { error: delErr } = await supabaseAdmin
            .from('est_gpm_material_demands')
            .delete()
            .eq('id', id);

        if (delErr) throw delErr;
        res.json({ success: true });

    } catch (err) {
        console.error('[GPM DEMAND DELETE ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Получить распределение техники на основе календарного плана (GPR)
router.get('/machinery', async (req, res) => {
    try {
        const { project_id, object_id, estimate_type = 'actual' } = req.query;
        if (!project_id || !object_id) {
            return res.status(400).json({ error: 'Параметры project_id и object_id обязательны' });
        }

        // 1. Ищем смету выбранного типа
        let docQuery = supabaseAdmin
            .from('est_documents')
            .select('id, region_id, projects:project_uuid(region_id)')
            .eq('project_uuid', project_id)
            .eq('object_id', object_id)
            .eq('estimate_type', estimate_type);

        if (estimate_type === 'planned') {
            docQuery = docQuery.in('status', ['planned_formed', 'planned_review', 'planned_approved']);
        } else {
            docQuery = docQuery.in('status', ['actual_formed', 'actual_review', 'actual_approved']);
        }

        const { data: doc, error: docErr } = await docQuery
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        
        if (docErr) throw docErr;
        if (!doc) {
            return res.json([]);
        }

        // Вычисляем страну проекта
        const regionId = doc.region_id || doc.projects?.region_id;
        let countryCode = 'GE';
        if (regionId) {
            const { data: reg } = await supabaseAdmin
                .from('dic_regions')
                .select('id, code, dic_countries(id, code)')
                .eq('id', regionId)
                .maybeSingle();
            if (reg?.dic_countries?.code) {
                countryCode = reg.dic_countries.code.toUpperCase();
            }
        }
        const isAz = countryCode === 'AZ';

        // 2. Получаем график выполнения работ (est_doc_schedules)
        const { data: schedules, error: schedErr } = await supabaseAdmin
            .from('est_doc_schedules')
            .select('work_id, start_date, duration_days')
            .eq('doc_id', doc.id);

        if (schedErr) throw schedErr;
        if (!schedules || schedules.length === 0) {
            return res.json([]);
        }

        // 3. Получаем все ресурсы сметы
        const { data: resources, error: resErr } = await supabaseAdmin
            .from('est_doc_resources')
            .select('*')
            .eq('doc_id', doc.id)
            .eq('is_excluded', false);

        if (resErr) throw resErr;
        if (!resources || resources.length === 0) {
            return res.json([]);
        }

        // Получаем работы
        const { data: works, error: worksErr } = await supabaseAdmin
            .from('est_doc_works')
            .select('id, work_id')
            .eq('doc_id', doc.id);
        if (worksErr) throw worksErr;

        const workIds = (works || []).map(w => w.work_id).filter(Boolean);

        const { data: jobsList } = workIds.length > 0 ? await supabaseAdmin
            .from('jobs')
            .select('id, code, name_id')
            .in('id', workIds) : { data: [] };

        const { data: jobsCasList } = workIds.length > 0 ? await supabaseAdmin
            .from('jobs_cas')
            .select('id, code, name_id')
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

        const worksNameMap = {};
        (works || []).forEach(w => {
            const job = jobsMap[w.work_id] || {};
            const names = workLocMap[w.work_id] || workLocMap[job.name_id] || {};
            const rawName = names.ru || names.en || names.ka || names.az || '';
            worksNameMap[w.id] = rawName ? `${job.code || ''} ${rawName}`.trim() : (job.code ? `${job.code} Работы` : 'Работы');
        });

        const resIds = resources.map(r => r.resource_id).filter(Boolean);
        let customResourcesMap = {};
        let resLocs = [];
        let azMachinerySet = new Set();

        if (isAz) {
            if (resIds.length > 0) {
                const [laborRes, machineRes, materialRes] = await Promise.all([
                    supabaseAdmin.from('Labor_cas').select('id, code, dic_measures(id, code), dic_resource_types(id, code)').in('id', resIds),
                    supabaseAdmin.from('Machine_cas').select('id, code, dic_measures(id, code), dic_resource_types(id, code)').in('id', resIds),
                    supabaseAdmin.from('Materials_cas').select('id, code, dic_measures(id, code), dic_resource_types(id, code)').in('id', resIds)
                ]);
                
                (laborRes.data || []).forEach(r => { customResourcesMap[r.id] = r; });
                (machineRes.data || []).forEach(r => { 
                    customResourcesMap[r.id] = r; 
                    azMachinerySet.add(r.id);
                });
                (materialRes.data || []).forEach(r => { customResourcesMap[r.id] = r; });

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

        const resLocMap = {};
        resLocs.forEach(l => {
            if (!resLocMap[l.object_id]) resLocMap[l.object_id] = {};
            resLocMap[l.object_id][l.locale] = l.name;
        });

        // Загружаем названия единиц измерения
        const allMeasureIds = Array.from(new Set(
            Object.values(customResourcesMap).map(r => r.dic_measures?.id)
        )).filter(Boolean);

        const { data: measureLocs } = allMeasureIds.length > 0 ? await supabaseAdmin.from('localization')
            .select('object_id, locale, name')
            .eq('object_name', 'dic_measures')
            .in('object_id', allMeasureIds) : { data: [] };
        
        const measureLocMap = {};
        (measureLocs || []).forEach(l => {
            if (!measureLocMap[l.object_id]) measureLocMap[l.object_id] = {};
            measureLocMap[l.object_id][l.locale] = l.name;
        });

        // Фильтруем только технику
        const machineryOnly = resources.filter(r => {
            const resObj = customResourcesMap[r.resource_id];
            if (!resObj) return false;

            if (isAz) {
                return azMachinerySet.has(r.resource_id);
            } else {
                const tCode = resObj.dic_resource_types?.code;
                const rtId = resObj.dic_resource_types?.id;
                return rtId === '37571dbb-b0f7-4ab4-9449-ac8ce63b9c02' || (tCode && tCode.startsWith('10.120.'));
            }
        });

        // 4. Сопоставляем технику с датами выполнения работ
        const scheduleMap = {};
        schedules.forEach(s => {
            scheduleMap[s.work_id] = {
                start_date: s.start_date,
                duration_days: Number(s.duration_days)
            };
        });

        const result = [];
        machineryOnly.forEach(r => {
            const sched = scheduleMap[r.work_id];
            if (!sched || !sched.start_date) return;

            const start = new Date(sched.start_date);
            const end = new Date(start);
            end.setDate(start.getDate() + Math.max(0, sched.duration_days - 1));

            const startStr = sched.start_date;
            const endStr = end.toISOString().split('T')[0];

            const resObj = customResourcesMap[r.resource_id] || {};
            const names = resLocMap[r.resource_id] || {};
            const measureId = resObj.dic_measures?.id;
            const unitNames = measureLocMap[measureId] || {};

            const planQty = Number(r.quantity || 0);
            const factQty = Number(r.fact_quantity != null ? r.fact_quantity : r.quantity || 0);
            const displayQty = estimate_type === 'actual' ? factQty : planQty;

            result.push({
                id: r.id,
                resource_id: r.resource_id,
                name: names.ru || names.en || names.ka || names.az || `Machinery ${resObj.code || ''}`,
                name_en: names.en || '',
                name_ka: names.ka || '',
                name_az: names.az || '',
                plan_quantity: planQty,
                fact_quantity: factQty,
                quantity: displayQty,
                start_date: startStr,
                end_date: endStr,
                work_id: r.work_id,
                work_name: worksNameMap[r.work_id] || '',
                unit: unitNames.ru || resObj.dic_measures?.code || 'PCS',
                source: r.source || 'norm'
            });
        });

        res.json(result);
    } catch (err) {
        console.error('[GPM MACHINERY ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
