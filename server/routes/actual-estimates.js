const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../supabase');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

// POST /api/estimates/:docId/create-actual - создать фактическую версию сметы (US-06-005)
// :docId — id утверждённой плановой версии, на основании которой создаётся факт.
router.post('/:docId/create-actual', async (req, res) => {
    try {
        const { docId } = req.params;
        const userId = req.user?.id || null;
        const userRole = req.user?.role || null;

        if (userRole !== 'admin' && userRole !== 'estimator') {
            return res.status(403).json({ error: 'У вас нет прав на создание фактической версии сметы' });
        }

        // 1. Получаем плановую версию — источник
        const { data: planDoc, error: planErr } = await supabaseAdmin
            .from('est_documents')
            .select('*')
            .eq('id', docId)
            .maybeSingle();

        if (planErr || !planDoc) {
            return res.status(404).json({ error: 'Плановая версия сметы не найдена' });
        }

        // BR-01/03, АС-1: только на основании плановой версии в статусе "Утверждена"
        if (planDoc.estimate_type !== 'planned' || planDoc.status !== 'planned_approved') {
            return res.status(400).json({ error: 'Фактическая версия может быть создана только на основании утвержденной плановой версии сметы' });
        }

        // 2. АС-2: проверяем, что фактическая версия ещё не создана для этой плановой
        const { data: existingActual } = await supabaseAdmin
            .from('est_documents')
            .select('id')
            .eq('parent_doc_id', docId)
            .eq('estimate_type', 'actual')
            .limit(1);

        if (existingActual && existingActual.length > 0) {
            return res.status(400).json({ error: 'Для данной плановой версии сметы фактическая версия уже создана' });
        }

        // 3. Создаём заголовок фактической сметы
        const { data: newDoc, error: insErr } = await supabaseAdmin
            .from('est_documents')
            .insert([{
                project_id: planDoc.project_id,
                organization_id: planDoc.organization_id,
                status: 'actual_formed', // Сформирована
                total_amount: planDoc.total_amount,
                region_id: planDoc.region_id,
                currency_id: planDoc.currency_id,
                project_uuid: planDoc.project_uuid,
                object_id: planDoc.object_id,
                zone: planDoc.zone,
                phase: planDoc.phase,
                discipline: planDoc.discipline,
                parent_doc_id: docId,
                estimate_type: 'actual',
                plan_created_by: userId,
                plan_created_at: new Date().toISOString()
            }])
            .select()
            .single();

        if (insErr || !newDoc) {
            throw new Error(insErr ? insErr.message : 'Не удалось создать заголовок фактической сметы');
        }

        const newDocId = newDoc.id;

        // 4. Копируем WBS-дерево
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

            for (const node of remainingNodes) {
                if (!node.parent_id || oldWbsToNewWbs[node.parent_id]) {
                    nextBatch.push(node);
                }
            }

            if (nextBatch.length === 0) {
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

        // 5. Копируем работы (плановые значения переносятся как есть; факт изначально равен плану — сметчик правит его отдельно)
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
                    fact_volume: w.volume,
                    fact_amount: w.amount,
                    sort_order: w.sort_order,
                    is_excluded: w.is_excluded
                }])
                .select()
                .single();

            if (insWorkErr) throw insWorkErr;
            oldWorkToNewWork[w.id] = newWork.id;
        }

        // 6. Копируем ресурсы (факт изначально равен плану — сметчик правит его отдельно)
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
                fact_norm: r.norm,
                fact_quantity: r.quantity,
                fact_price: r.price,
                fact_amount: r.amount,
                is_excluded: r.is_excluded
            }));

            const { error: insResErr } = await supabaseAdmin
                .from('est_doc_resources')
                .insert(rowsToInsert);
            if (insResErr) throw insResErr;
        }

        // 7. Копируем коэффициенты
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

        // 7.1 Копируем календарный план (est_doc_schedules)
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

        // 7.2 Копируем связи и зависимости (est_work_dependencies)
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

        // 7.3 Копируем ответственных ГПР (est_gpr_assignees)
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

        // 8. История изменений
        await supabaseAdmin
            .from('est_document_history')
            .insert([
                {
                    doc_id: docId,
                    user_id: userId,
                    event: 'Создана фактическая версия сметы',
                    comment: `Фактическая версия сметы зафиксирована с ID: ${newDocId}`
                },
                {
                    doc_id: newDocId,
                    user_id: userId,
                    event: 'Сформирована',
                    comment: 'Создана фактическая версия сметы на основании утвержденной плановой версии'
                }
            ]);

        res.json({
            success: true,
            message: 'Фактическая версия сметы успешно сформирована.',
            actualDocId: newDocId
        });
    } catch (err) {
        console.error('[CREATE ACTUAL ERROR]:', err);
        res.status(500).json({ error: 'Не удалось создать фактическую версию сметы. Повторите попытку позже.' });
    }
});

module.exports = router;
