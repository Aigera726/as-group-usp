const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../supabase');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

// Имя/ед.изм. работы через work_id -> jobs/jobs_cas (тот же паттерн, что в contracts.js).
// Принимает lang, чтобы название работы и ед.измерения отображались на текущем языке
// интерфейса, а не всегда на русском (US-10-01: данные из справочников должны переводиться).
async function getWorkNameAndUnit(workId, lang = 'ru') {
    if (!workId) return { name: null, unit: null };

    const [{ data: job }, { data: jobCas }] = await Promise.all([
        supabaseAdmin.from('jobs').select('id, code, dic_measures(id, code)').eq('id', workId).maybeSingle(),
        supabaseAdmin.from('jobs_cas').select('id, code, dic_measures(id, code)').eq('id', workId).maybeSingle()
    ]);
    const job_ = job || jobCas;
    if (!job_) return { name: null, unit: null };

    const [{ data: nameLoc }, { data: measureLoc }] = await Promise.all([
        supabaseAdmin.from('localization').select('name, locale').in('object_name', ['jobs', 'jobs_cas']).eq('object_id', workId),
        job_.dic_measures?.id
            ? supabaseAdmin.from('localization').select('name, locale').eq('object_name', 'dic_measures').eq('object_id', job_.dic_measures.id)
            : Promise.resolve({ data: [] })
    ]);
    const pickLang = (rows) => (rows || []).find(r => r.locale === lang)?.name
        || (rows || []).find(r => r.locale === 'ru')?.name
        || (rows || [])[0]?.name
        || null;

    return {
        name: pickLang(nameLoc) || job_.code || 'Работа',
        unit: pickLang(measureLoc) || ''
    };
}

// Сумма подтверждённых (не отклонённых) оперфактов по конкретной работе сметы —
// именно так считается "Факт" по US-10-01 (п.6): не последнее значение, а сумма подтверждений.
async function recalcWorkFact(docWorkId) {
    if (!docWorkId) return;

    const { data: work, error: workErr } = await supabaseAdmin
        .from('est_doc_works')
        .select('id, price')
        .eq('id', docWorkId)
        .maybeSingle();
    if (workErr || !work) return;

    const { data: confirmedFacts, error: factsErr } = await supabaseAdmin
        .from('est_operational_facts')
        .select('confirmed_volume')
        .eq('doc_work_id', docWorkId)
        .eq('status', 'approved');
    if (factsErr) throw factsErr;

    const factVolume = (confirmedFacts || []).reduce((sum, f) => sum + Number(f.confirmed_volume || 0), 0);
    const factAmount = factVolume * Number(work.price || 0);

    await supabaseAdmin
        .from('est_doc_works')
        .update({ fact_volume: factVolume, fact_amount: factAmount })
        .eq('id', docWorkId);
}

// Основная логика приёма оперфакта — используется и реальным эндпоинтом /incoming,
// и симулятором /test-simulate, чтобы не дублировать сопоставление/расчёты.
async function createOperFact(payload) {
    const {
        external_id, assignment_id, executor_type: bodyExecutorType,
        project_id: bodyProjectId, object_id: bodyObjectId, doc_work_id: bodyDocWorkId,
        department_or_contractor, executor_name,
        reported_quantity, execution_date, planned_date, formed_at, documents
    } = payload;

    // ── Валидация обязательных полей поступления (US-10-01, раздел 2) ──
    // Единица измерения и Сумма сюда не входят — они рассчитываются на стороне УСП (AC-06).
    const requiredMissing = [];
    if (!external_id) requiredMissing.push('external_id (ID оперфакта)');
    if (!assignment_id && !bodyDocWorkId) requiredMissing.push('assignment_id или doc_work_id (Работа)');
    if (!executor_name) requiredMissing.push('executor_name (Исполнитель)');
    if (reported_quantity == null || isNaN(Number(reported_quantity))) requiredMissing.push('reported_quantity (Фактический объём)');
    if (!execution_date) requiredMissing.push('execution_date (Дата выполнения)');
    if (!formed_at) requiredMissing.push('formed_at (Дата формирования)');
    if (!assignment_id && !bodyExecutorType) requiredMissing.push('executor_type (Тип исполнителя)');

    if (requiredMissing.length > 0) {
        const err = new Error('Не заполнены обязательные поля: ' + requiredMissing.join(', '));
        err.status = 400;
        throw err;
    }

    let matchErrors = [];
    let executorType = assignment_id ? 'counterparty' : (bodyExecutorType || 'organization');
    let projectId = bodyProjectId || null;
    let objectId = bodyObjectId || null;
    let contractId = null;
    let contractorId = null;
    let contractNumber = null;
    let docWorkId = bodyDocWorkId || null;
    let projectName = null;
    let objectName = null;
    let departmentOrContractor = department_or_contractor || null;
    let finalAssignmentId = assignment_id || null;

    // ── Сценарий "Контрагент" (через assignment_id) ──
    if (assignment_id) {
        executorType = 'counterparty';
        const { data: assignment } = await supabaseAdmin
            .from('contract_assignments')
            .select('id, contract_id, est_doc_work_id, work_name')
            .eq('id', assignment_id)
            .maybeSingle();

        if (!assignment) {
            matchErrors.push(`Назначение (assignment_id: ${assignment_id}) не найдено`);
            finalAssignmentId = null;
        } else {
            docWorkId = assignment.est_doc_work_id;
            if (!docWorkId) matchErrors.push('Назначение не привязано к работе фактической сметы');

            const { data: contract } = await supabaseAdmin
                .from('contracts')
                .select('id, project_id, object_id, contractor_id, contract_number')
                .eq('id', assignment.contract_id)
                .maybeSingle();

            if (!contract) {
                matchErrors.push('Договор не найден');
            } else {
                contractId = contract.id;
                projectId = contract.project_id;
                objectId = contract.object_id;
                contractorId = contract.contractor_id;
                contractNumber = contract.contract_number;

                if (contractorId) {
                    const { data: contractor } = await supabaseAdmin
                        .from('contractors')
                        .select('company_name')
                        .eq('id', contractorId)
                        .maybeSingle();
                    departmentOrContractor = contractor?.company_name || null;
                }
            }
        }
    } else {
        // ── Сценарий "Организация/отдел" (прямые идентификаторы) ──
        if (!projectId) matchErrors.push('Проект не найден (project_id не указан)');
        if (!objectId) matchErrors.push('Объект не найден (object_id не указан)');
        if (!docWorkId) matchErrors.push('Работа не найдена (doc_work_id не указан)');
        if (!departmentOrContractor) matchErrors.push('Не указан отдел (department_or_contractor)');
    }

    // ── Проверяем, что проект/объект реально существуют ──
    // Если не найдены — обнуляем ID перед вставкой (на project_id/object_id есть FK,
    // несуществующий id иначе завалит INSERT ошибкой БД вместо аккуратного matching_error).
    if (projectId) {
        const { data: proj } = await supabaseAdmin.from('projects').select('id, name').eq('id', projectId).maybeSingle();
        if (!proj) { matchErrors.push(`Проект не найден в базе (id: ${projectId})`); projectId = null; }
        else projectName = proj.name;
    }
    if (objectId) {
        const { data: obj } = await supabaseAdmin.from('project_objects').select('id, name').eq('id', objectId).maybeSingle();
        if (!obj) { matchErrors.push(`Объект не найден в базе (id: ${objectId})`); objectId = null; }
        else objectName = obj.name;
    }

    let planVolume = null;
    let unit = null;
    let workName = null;
    let price = 0;

    if (docWorkId) {
        const { data: work } = await supabaseAdmin
            .from('est_doc_works')
            .select('id, work_id, volume, price, doc_id, est_documents(estimate_type)')
            .eq('id', docWorkId)
            .maybeSingle();

        if (!work) {
            matchErrors.push(`Работа не найдена в фактической смете (id: ${docWorkId})`);
            docWorkId = null;
        } else if (work.est_documents?.estimate_type !== 'actual') {
            matchErrors.push('Работа найдена, но не относится к фактической версии сметы');
            docWorkId = null;
        } else {
            planVolume = Number(work.volume || 0);
            price = Number(work.price || 0);
            const info = await getWorkNameAndUnit(work.work_id);
            workName = info.name;
            unit = info.unit;
        }
    }

    const status = matchErrors.length > 0 ? 'matching_error' : 'pending_approval';

    // Остаток на момент поступления = план - уже подтверждённые ранее факты по этой работе
    let remainingVolume = null;
    if (docWorkId && planVolume != null) {
        const { data: confirmedFacts } = await supabaseAdmin
            .from('est_operational_facts')
            .select('confirmed_volume')
            .eq('doc_work_id', docWorkId)
            .eq('status', 'approved');
        const confirmedSum = (confirmedFacts || []).reduce((s, f) => s + Number(f.confirmed_volume || 0), 0);
        remainingVolume = planVolume - confirmedSum;
    }

    const insertRow = {
        external_id: external_id || null,
        assignment_id: finalAssignmentId,
        project_id: projectId,
        project_name: projectName,
        object_id: objectId,
        object_name: objectName,
        contract_id: contractId,
        contract_number: contractNumber,
        contractor_id: contractorId,
        doc_work_id: docWorkId,
        work_name: workName,
        executor_type: executorType,
        department_or_contractor: departmentOrContractor,
        executor_name: executor_name || null,
        reported_volume: Number(reported_quantity),
        unit,
        amount: Number(reported_quantity) * price,
        plan_volume: planVolume,
        remaining_volume: remainingVolume,
        planned_date: planned_date || null,
        execution_date: execution_date || null,
        formed_at,
        documents: documents || [],
        status,
        matching_error_details: matchErrors.length > 0 ? matchErrors.join('; ') : null
    };

    const { data: created, error: insertErr } = await supabaseAdmin
        .from('est_operational_facts')
        .insert([insertRow])
        .select()
        .single();
    if (insertErr) throw insertErr;

    return created;
}

// ─────────────────────────────────────────────────────────────────────────────
// Мост «мобилка → Оперфакт».
//
// Мобильное приложение (as-app) пишет отчёты о выполнении в mobile.reports
// (офлайн-синк через WatermelonDB) — это отдельная таблица, никак не связанная
// с erp.est_operational_facts. Ничего автоматически не переносит одно в другое,
// поэтому опрашиваем mobile.reports сами и заводим по каждому новому отчёту
// оперфакт через ту же самую логику сопоставления, что и у /oper-facts/incoming
// (createOperFact) — чтобы не дублировать бизнес-правила в двух местах.
//
// Идемпотентность: используем report.id как external_id и просто пропускаем
// отчёты, для которых оперфакт уже создан (при перезапуске/повторном опросе
// дублей не будет).
// ─────────────────────────────────────────────────────────────────────────────
const MOBILE_REPORTS_POLL_INTERVAL_MS = 15000;

async function resolveExecutorName(profileId) {
    if (!profileId) return null;
    const { data } = await supabaseAdmin.from('profiles').select('first_name, last_name').eq('id', profileId).maybeSingle();
    if (!data) return null;
    return [data.first_name, data.last_name].filter(Boolean).join(' ') || null;
}

async function pollMobileReports() {
    try {
        const { data: reports, error: reportsErr } = await supabaseAdmin
            .schema('mobile')
            .from('reports')
            .select('id, assignment_id, reported_by, reported_quantity, comment, photo_uri, created_at, updated_at');
        if (reportsErr) {
            // Не спамим лог на каждый тик, если грант ещё не выдан — одна строка достаточно информативна.
            if (reportsErr.code === '42501') return;
            throw reportsErr;
        }
        if (!reports || reports.length === 0) return;

        const { data: existing, error: existingErr } = await supabaseAdmin
            .from('est_operational_facts')
            .select('external_id')
            .not('external_id', 'is', null);
        if (existingErr) throw existingErr;
        const knownIds = new Set((existing || []).map(r => r.external_id));

        const newReports = reports.filter(r => !knownIds.has(r.id));
        if (newReports.length === 0) return;

        for (const report of newReports) {
            try {
                const executorName = await resolveExecutorName(report.reported_by) || 'Исполнитель мобильного приложения';
                const dateOnly = (report.created_at || new Date().toISOString()).slice(0, 10);
                await createOperFact({
                    external_id: report.id,
                    assignment_id: report.assignment_id,
                    executor_name: executorName,
                    reported_quantity: report.reported_quantity,
                    execution_date: dateOnly,
                    formed_at: report.updated_at || report.created_at,
                    documents: report.photo_uri ? [{ url: report.photo_uri }] : []
                });
                console.log(`[Mobile→OperFact] Создан оперфакт из mobile.reports (${report.id})`);
            } catch (err) {
                console.error(`[Mobile→OperFact] Не удалось создать оперфакт из отчёта ${report.id}:`, err.message);
            }
        }
    } catch (err) {
        console.error('[Mobile→OperFact] Ошибка опроса mobile.reports:', err.message);
    }
}

setInterval(pollMobileReports, MOBILE_REPORTS_POLL_INTERVAL_MS);
pollMobileReports();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/estimates/oper-facts — список с фильтрами
// ─────────────────────────────────────────────────────────────────────────────
router.get('/oper-facts', async (req, res) => {
    try {
        const { project_id, object_id, contract_id, status, search, lang } = req.query;
        const locale = ['ru', 'en', 'ka', 'az'].includes(lang) ? lang : 'ru';

        let query = supabaseAdmin
            .from('est_operational_facts')
            .select('*')
            .order('created_at', { ascending: false });

        if (project_id) query = query.eq('project_id', project_id);
        if (object_id) query = query.eq('object_id', object_id);
        if (contract_id) query = query.eq('contract_id', contract_id);
        if (status) query = query.eq('status', status);

        const { data, error } = await query;
        if (error) throw error;

        let rows = data || [];

        // Название работы/ед.измерения хранятся как снимок на момент поступления оперфакта
        // (обычно на русском). Пересчитываем их на текущий язык интерфейса при каждом чтении,
        // чтобы при переключении языка данные из справочников менялись, а не оставались как есть.
        const workIds = [...new Set(rows.map(r => r.doc_work_id).filter(Boolean))];
        if (workIds.length > 0) {
            const infoByWorkId = {};
            await Promise.all(workIds.map(async (docWorkId) => {
                const { data: work } = await supabaseAdmin
                    .from('est_doc_works')
                    .select('work_id')
                    .eq('id', docWorkId)
                    .maybeSingle();
                if (work?.work_id) {
                    infoByWorkId[docWorkId] = await getWorkNameAndUnit(work.work_id, locale);
                }
            }));
            rows = rows.map(r => {
                const info = infoByWorkId[r.doc_work_id];
                if (!info) return r;
                return { ...r, work_name: info.name || r.work_name, unit: info.unit || r.unit };
            });
        }

        if (search && search.trim()) {
            const q = search.trim().toLowerCase();
            rows = rows.filter(r =>
                (r.work_name || '').toLowerCase().includes(q) ||
                (r.executor_name || '').toLowerCase().includes(q) ||
                (r.department_or_contractor || '').toLowerCase().includes(q) ||
                (r.external_id || '').toLowerCase().includes(q) ||
                (r.contract_number || '').toLowerCase().includes(q)
            );
        }

        const kpi = {
            total: rows.length,
            pending_approval: rows.filter(r => r.status === 'pending_approval').length,
            approved: rows.filter(r => r.status === 'approved').length,
            matching_error: rows.filter(r => r.status === 'matching_error').length
        };

        res.json({ data: rows, kpi });
    } catch (err) {
        console.error('[OPER-FACTS LIST ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/estimates/oper-facts/incoming — приём оперфакта
// Сценарий "Контрагент": { external_id, assignment_id, reported_quantity, execution_date, documents }
// Сценарий "Организация/отдел": { external_id, project_id, object_id, doc_work_id, department_or_contractor,
//                                  executor_name, reported_quantity, execution_date, documents }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/oper-facts/incoming', async (req, res) => {
    try {
        const created = await createOperFact(req.body);
        res.status(201).json(created);
    } catch (err) {
        console.error('[OPER-FACTS INCOMING ERROR]:', err.message);
        res.status(err.status || 500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/estimates/oper-facts/:id/approve — подтверждение
// ─────────────────────────────────────────────────────────────────────────────
router.post('/oper-facts/:id/approve', async (req, res) => {
    try {
        const { id } = req.params;
        const { confirmed_volume } = req.body;

        const { data: fact, error: fetchErr } = await supabaseAdmin
            .from('est_operational_facts')
            .select('*')
            .eq('id', id)
            .maybeSingle();
        if (fetchErr) throw fetchErr;
        if (!fact) return res.status(404).json({ error: 'Оперфакт не найден' });

        // AC-01: подтвердить можно только оперфакт в статусе "На подтверждении"
        if (fact.status !== 'pending_approval') {
            return res.status(400).json({ error: 'Подтвердить можно только оперфакт в статусе «На подтверждении»' });
        }

        // ── Проверка 1 (AC-02): работа действительно закреплена за исполнителем оперфакта ──
        // ── Проверка 2 (AC-03): работа относится именно к указанному в оперфакте договору ──
        // Обе проверки — только для сценария "Контрагент"; для "Организация/отдел" договора нет.
        if (fact.executor_type === 'counterparty') {
            const { data: contractorAssignments } = await supabaseAdmin
                .from('contract_assignments')
                .select('id, contract_id, contracts!inner(contractor_id)')
                .eq('est_doc_work_id', fact.doc_work_id)
                .eq('contracts.contractor_id', fact.contractor_id);

            if (!contractorAssignments || contractorAssignments.length === 0) {
                return res.status(400).json({ error: 'Невозможно подтвердить факт. Работа не предусмотрена для указанного исполнителя' });
            }

            const matchesContract = contractorAssignments.some(a => a.contract_id === fact.contract_id);
            if (!matchesContract) {
                return res.status(400).json({ error: 'Невозможно подтвердить факт. Работа не предусмотрена указанным договором' });
            }
        }

        // ── Проверка 3 (AC-04/05/06): подтв.факт + текущий оперфакт <= план ──
        // Получаем АКТУАЛЬНЫЕ значения прямо сейчас — не из снимка, сделанного при поступлении,
        // т.к. с момента поступления могли подтвердить другие оперфакты по этой же работе.
        const { data: workNow, error: workNowErr } = await supabaseAdmin
            .from('est_doc_works')
            .select('id, volume, price')
            .eq('id', fact.doc_work_id)
            .maybeSingle();
        if (workNowErr || !workNow) {
            return res.status(400).json({ error: 'Работа фактической сметы больше не найдена' });
        }
        const planVolumeNow = Number(workNow.volume || 0);

        const { data: confirmedNow } = await supabaseAdmin
            .from('est_operational_facts')
            .select('confirmed_volume')
            .eq('doc_work_id', fact.doc_work_id)
            .eq('status', 'approved');
        const confirmedSumNow = (confirmedNow || []).reduce((s, f) => s + Number(f.confirmed_volume || 0), 0);

        const volumeToConfirm = confirmed_volume != null ? Number(confirmed_volume) : Number(fact.reported_volume);
        const availableRemaining = planVolumeNow - confirmedSumNow;

        if (confirmedSumNow + volumeToConfirm > planVolumeNow) {
            return res.status(400).json({
                error: `Невозможно подтвердить факт. Фактический объем превышает плановый. Доступный остаток: ${availableRemaining}`
            });
        }

        // ── Всё пройдено — подтверждаем ──
        const { data: updated, error: updErr } = await supabaseAdmin
            .from('est_operational_facts')
            .update({
                status: 'approved',
                confirmed_volume: volumeToConfirm,
                confirmed_at: new Date().toISOString(),
                confirmed_by: req.user.id,
                remaining_volume: planVolumeNow - (confirmedSumNow + volumeToConfirm),
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single();
        if (updErr) throw updErr;

        // Факт по работе = сумма подтверждённых оперфактов (US-10-01, п.6)
        await recalcWorkFact(fact.doc_work_id);

        // Обновляем "Остаток" у остальных (ещё не подтверждённых) оперфактов этой же работы
        const finalConfirmedSum = confirmedSumNow + volumeToConfirm;
        await supabaseAdmin
            .from('est_operational_facts')
            .update({ remaining_volume: planVolumeNow - finalConfirmedSum })
            .eq('doc_work_id', fact.doc_work_id)
            .neq('status', 'approved');

        res.json(updated);
    } catch (err) {
        console.error('[OPER-FACTS APPROVE ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/estimates/oper-facts/:id/reject — отклонение
// ─────────────────────────────────────────────────────────────────────────────
router.post('/oper-facts/:id/reject', async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        if (!reason || !reason.trim()) {
            return res.status(400).json({ error: 'Укажите причину отклонения' });
        }

        // AC-01: отклонить можно только оперфакт в статусе "На подтверждении"
        const { data: fact, error: fetchErr } = await supabaseAdmin
            .from('est_operational_facts')
            .select('status')
            .eq('id', id)
            .maybeSingle();
        if (fetchErr) throw fetchErr;
        if (!fact) return res.status(404).json({ error: 'Оперфакт не найден' });
        if (fact.status !== 'pending_approval') {
            return res.status(400).json({ error: 'Отклонить можно только оперфакт в статусе «На подтверждении»' });
        }

        const { data: updated, error } = await supabaseAdmin
            .from('est_operational_facts')
            .update({
                status: 'rejected',
                rejection_reason: reason.trim(),
                confirmed_by: req.user.id,
                confirmed_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;

        res.json(updated);
    } catch (err) {
        console.error('[OPER-FACTS REJECT ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
