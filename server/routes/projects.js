const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../supabase');
const { authMiddleware } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// --- ЛОГГЕР С IP И ДЕТАЛЯМИ ---
router.use((req, res, next) => {
    if (req.originalUrl.endsWith('/notifications') || req.originalUrl.includes('/notifications?')) {
        return next();
    }
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [IP: ${ip}] ${req.method} ${req.originalUrl}`);
    next();
});

// --- MIDDLEWARE АВТОРИЗАЦИИ ЧЕРЕЗ SUPABASE ---
// --- SELF-HEALING LOCALIZATION FOR DOCUMENT TYPES ---
const healDocumentTypesLocalization = async () => {
    try {
        const targetDocTypes = {
            drawing:       { ru: 'Чертеж',       en: 'Drawing',       ka: 'ნახაზი',          az: 'Cizgi' },
            estimate:      { ru: 'Смета',        en: 'Estimate',      ka: 'ხარჯთაღრიცხვა',   az: 'Smeta' },
            act:           { ru: 'Акт',          en: 'Act',           ka: 'აქტი',            az: 'Akt' },
            permit:        { ru: 'Разрешение',   en: 'Permit',        ka: 'ნებართვა',         az: 'İcazə' },
            contract:      { ru: 'Договор',       en: 'Contract',      ka: 'ხელშეკრულება',   az: 'Müqavilə' },
            specification: { ru: 'Спецификация', en: 'Specification', ka: 'სპეციფიკაცია',  az: 'Spesifikasiya' },
            other:         { ru: 'Другое',        en: 'Other',         ka: 'სხვა',           az: 'Digər' }
        };

        // 1. Ensure codes exist in dic_document_types
        const { data: existingTypes } = await supabaseAdmin.from('dic_document_types').select('id, code');
        const existingCodesMap = {};
        (existingTypes || []).forEach(t => { existingCodesMap[t.code] = t.id; });

        for (const code of Object.keys(targetDocTypes)) {
            if (!existingCodesMap[code]) {
                const { data: newRow, error: insertErr } = await supabaseAdmin
                    .from('dic_document_types')
                    .insert({ code })
                    .select('id, code')
                    .single();
                if (!insertErr && newRow) {
                    existingCodesMap[newRow.code] = newRow.id;
                }
            }
        }

        // 2. Fetch all document types to build localization rows safely
        const { data: allDocTypes } = await supabaseAdmin.from('dic_document_types').select('id, code');
        if (!allDocTypes || allDocTypes.length === 0) return;

        const docTypeIds = allDocTypes.map(d => d.id);
        const { data: existingLocs } = await supabaseAdmin
            .from('localization')
            .select('id, object_id, locale')
            .eq('object_name', 'dic_document_types')
            .in('object_id', docTypeIds);

        const existingLocsSet = new Set((existingLocs || []).map(l => `${l.object_id}_${l.locale}`));

        for (const dt of allDocTypes) {
            const transObj = targetDocTypes[dt.code];
            if (!transObj) continue;

            for (const locale of ['ru', 'en', 'ka', 'az']) {
                const name = transObj[locale];
                if (name) {
                    const key = `${dt.id}_${locale}`;
                    if (existingLocsSet.has(key)) {
                        await supabaseAdmin
                            .from('localization')
                            .update({ name })
                            .eq('object_name', 'dic_document_types')
                            .eq('object_id', dt.id)
                            .eq('locale', locale);
                    } else {
                        await supabaseAdmin
                            .from('localization')
                            .insert({
                                object_name: 'dic_document_types',
                                object_id: dt.id,
                                locale,
                                name
                            });
                    }
                }
            }
        }
        console.log("Self-healing for 4-language document types completed safely without ON CONFLICT!");
    } catch (err) {
        console.error("Database self-healing failed:", err.message);
    }
};

// Run self-healing
setTimeout(healDocumentTypesLocalization, 1000);

router.use(authMiddleware);


// --- SELF-HEALING REGION COUNTRY CODES & WBS TEMPLATES FOR GEORGIA AND AZERBAIJAN (BAKU) ---
const healCountryWbsTemplates = async () => {
    try {
        const { data: countries } = await supabaseAdmin.from('dic_countries').select('id, code');
        if (!countries || countries.length === 0) return;

        const geCountry = countries.find(c => c.code === 'GE');
        const azCountry = countries.find(c => c.code === 'AZ');

        if (!geCountry || !azCountry) return;

        // 1. Link dic_regions to dic_countries using country_id column
        const { data: regions } = await supabaseAdmin.from('dic_regions').select('id, code, country_id');
        if (regions && regions.length > 0) {
            for (const r of regions) {
                const targetCountryId = r.code === 'BA' ? azCountry.id : geCountry.id;
                if (r.country_id !== targetCountryId) {
                    await supabaseAdmin
                        .from('dic_regions')
                        .update({ country_id: targetCountryId })
                        .eq('id', r.id);
                }
            }
        }

        // 2. Link existing wbs_templates items to Georgia (GE) country_id if country_id is null
        const { data: header } = await supabaseAdmin
            .from('wbs_template_headers')
            .select('id')
            .eq('code', 'residential_commercial')
            .maybeSingle();

        if (header) {
            const { data: nullItems } = await supabaseAdmin
                .from('wbs_templates')
                .select('id')
                .eq('template_id', header.id)
                .is('country_id', null);

            for (const item of (nullItems || [])) {
                await supabaseAdmin
                    .from('wbs_templates')
                    .update({ country_id: geCountry.id })
                    .eq('id', item.id);
            }
        }
    } catch (err) {
        console.error("Country WBS self-healing failed:", err.message);
    }
};

setTimeout(healCountryWbsTemplates, 1500);

const parseCoordinate = (val) => {
    if (val === null || val === undefined || String(val).trim() === '') return null;
    const parsed = parseFloat(val);
    return isNaN(parsed) ? null : parsed;
};

// --- 1. СПИСОК ПРОЕКТОВ С ЛОКАЛИЗАЦИЕЙ ---
router.get('/projects', async (req, res) => {
    try {
        const { lang, show_inactive } = req.query;
        const locale = ['ru', 'en', 'ka', 'az'].includes(lang) ? lang : 'ru';

        // Получаем проекты
        let queryBuilder = supabaseAdmin
            .from('projects')
            .select(`
                *,
                dic_regions (id, code),
                profiles (id, first_name, last_name)
            `)
            .is('deleted_at', null);

        if (show_inactive !== 'true') {
            queryBuilder = queryBuilder.eq('is_active', true);
        }

        if (req.user.role !== 'admin') {
            const { data: userRegs, error: regErr } = await supabaseAdmin
                .from('profile_regions')
                .select('region_id')
                .eq('profile_id', req.user.id);
            
            if (regErr) throw regErr;
            const allowedRegionIds = (userRegs || []).map(r => r.region_id);
            queryBuilder = queryBuilder.in('region_id', allowedRegionIds.length > 0 ? allowedRegionIds : ['00000000-0000-0000-0000-000000000000']);
        }

        if (req.user.role === 'director') {
            // Директор видит проекты, где он является утверждающим
            const { data: approverRows, error: appError } = await supabaseAdmin
                .from('project_approvers')
                .select('project_id, action')
                .eq('approval_user_id', req.user.id)
                .in('action', ['ON_APPROVAL', 'APPROVED']);

            if (appError) throw appError;

            const projectIds = [...new Set((approverRows || []).map(r => r.project_id))];
            queryBuilder = queryBuilder
                .in('status', ['under_approval', 'approved', 'active', 'suspended', 'completed'])
                .in('id', projectIds.length > 0 ? projectIds : ['00000000-0000-0000-0000-000000000000']);
        }

        if (req.user.role === 'estimator') {
            queryBuilder = queryBuilder.in('status', ['approved', 'active', 'suspended', 'completed']);
        }

        const { data: projects, error } = await queryBuilder.order('created_at', { ascending: false });

        if (error) throw error;

        // Загружаем соответствие кодов справочников и ID для локализации
        const { data: objTypes } = await supabaseAdmin.from('dic_project_object_types').select('id, code');
        const { data: customers } = await supabaseAdmin.from('dic_project_customers').select('id, code');
        const { data: statuses } = await supabaseAdmin.from('dic_project_statuses').select('id, code');
        const { data: estStatuses } = await supabaseAdmin.from('dic_estimate_statuses').select('id, code');

        // Получаем переводы для всех этих справочников
        const { data: locs } = await supabaseAdmin
            .from('localization')
            .select('object_name, object_id, locale, name')
            .in('object_name', [
                'dic_project_object_types',
                'dic_project_customers',
                'dic_project_statuses',
                'dic_estimate_statuses',
                'dic_regions'
            ]);

        const locMap = {};
        (locs || []).forEach(l => {
            if (!locMap[l.object_name]) locMap[l.object_name] = {};
            if (!locMap[l.object_name][l.object_id]) locMap[l.object_name][l.object_id] = {};
            locMap[l.object_name][l.object_id][l.locale] = l.name;
        });

        const objTypesMap = {};
        (objTypes || []).forEach(o => objTypesMap[o.code] = o.id);

        const customersMap = {};
        (customers || []).forEach(c => customersMap[c.code] = c.id);

        const statusesMap = {};
        (statuses || []).forEach(s => statusesMap[s.code] = s.id);

        const estStatusesMap = {};
        (estStatuses || []).forEach(e => estStatusesMap[e.code] = e.id);

        const formattedProjects = (projects || []).map(p => {
            const objTypeId = objTypesMap[p.object_type];
            const custId = customersMap[p.customer];
            const statusId = statusesMap[p.status];
            const estStatusId = estStatusesMap[p.estimate_status];

            const localizedObjectType = locMap['dic_project_object_types']?.[objTypeId]?.[locale] || p.object_type;
            const localizedCustomer = locMap['dic_project_customers']?.[custId]?.[locale] || p.customer;
            const localizedStatus = locMap['dic_project_statuses']?.[statusId]?.[locale] || p.status;
            const localizedEstStatus = locMap['dic_estimate_statuses']?.[estStatusId]?.[locale] || p.estimate_status;
            const localizedRegion = locMap['dic_regions']?.[p.region_id]?.[locale] || p.dic_regions?.code || '';

            return {
                ...p,
                object_type_name: localizedObjectType,
                customer_name: localizedCustomer,
                status_name: localizedStatus,
                estimate_status_name: localizedEstStatus,
                region_name: localizedRegion,
                manager_name: p.profiles ? `${p.profiles.first_name} ${p.profiles.last_name}` : (p.custom_manager_name || '')
            };
        });

        let finalProjects = formattedProjects;

        if (req.user.role === 'director') {
            const projectIds = formattedProjects.map(p => p.id);
            if (projectIds.length > 0) {
                // Получаем все записи в project_approvers для этих проектов
                const { data: approvers } = await supabaseAdmin
                    .from('project_approvers')
                    .select('*')
                    .in('project_id', projectIds)
                    .in('action', ['ON_APPROVAL', 'APPROVED'])
                    .order('date', { ascending: false });

                const latestOnApproval = {};
                const hasApproved = {};

                (approvers || []).forEach(a => {
                    if (a.action === 'ON_APPROVAL' && !latestOnApproval[a.project_id]) {
                        latestOnApproval[a.project_id] = a;
                    }
                    if (a.action === 'APPROVED' && a.approval_user_id === req.user.id) {
                        hasApproved[a.project_id] = true;
                    }
                });

                finalProjects = formattedProjects.filter(p => {
                    if (p.status === 'under_approval') {
                        const latest = latestOnApproval[p.id];
                        return latest && latest.approval_user_id === req.user.id;
                    } else {
                        // Для утвержденных проектов показываем только те, которые утвердил этот директор
                        return hasApproved[p.id];
                    }
                });
            } else {
                finalProjects = [];
            }
        }

        res.json(finalProjects);
    } catch (err) {
        console.error('[GET PROJECTS ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- 1.1. ПОЛУЧЕНИЕ СТАТИСТИКИ ДЛЯ ВСЕХ ПОЛЬЗОВАТЕЛЕЙ ---
router.get('/projects/stats', async (req, res) => {
    try {
        const { data: allProjects, error } = await supabaseAdmin
            .from('projects')
            .select('status, is_active')
            .is('deleted_at', null);

        if (error) throw error;

        const activeList = (allProjects || []).filter(p => p.is_active);
        const inactiveCount = (allProjects || []).filter(p => !p.is_active).length;

        const total = activeList.length;
        const activeCount = activeList.filter(p => p.status === 'active' || p.status === 'approved').length;
        const prospectCount = activeList.filter(p => p.status === 'prospect' || p.status === 'under_approval' || p.status === 'approval_rejected').length;

        res.json({
            total,
            active: activeCount,
            prospect: prospectCount,
            has_inactive: inactiveCount > 0
        });
    } catch (err) {
        console.error('[GET PROJECTS STATS ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- 2. СПРАВОЧНИКИ ДЛЯ СОЗДАНИЯ ПРОЕКТА ---
router.get('/projects/dictionaries', async (req, res) => {
    try {
        const { lang } = req.query;
        const locale = ['ru', 'en', 'ka', 'az'].includes(lang) ? lang : 'ru';

        let allowedRegionIds = null;
        if (req.user.role !== 'admin') {
            const { data: userRegs } = await supabaseAdmin
                .from('profile_regions')
                .select('region_id')
                .eq('profile_id', req.user.id);
            allowedRegionIds = (userRegs || []).map(r => r.region_id);
        }

        let regionsQuery = supabaseAdmin.from('dic_regions').select('id, code, country_id');
        if (allowedRegionIds) {
            regionsQuery = regionsQuery.in('id', allowedRegionIds.length > 0 ? allowedRegionIds : ['00000000-0000-0000-0000-000000000000']);
        }
        const { data: regions } = await regionsQuery;

        const regionCountryIds = [...new Set((regions || []).map(r => r.country_id).filter(Boolean))];
        const { data: countries } = await supabaseAdmin.from('dic_countries').select('id, code').in('id', regionCountryIds.length > 0 ? regionCountryIds : ['c01d223e-6a62-4497-a887-46c393b4b7f2']);
        const { data: managers } = await supabaseAdmin
            .from('profiles')
            .select('id, first_name, last_name, role, profile_regions(region_id)')
            .eq('role', 'estimator');
        const { data: objTypes } = await supabaseAdmin.from('dic_project_object_types').select('id, code');
        const { data: customers } = await supabaseAdmin.from('dic_project_customers').select('id, code');
        const { data: statuses } = await supabaseAdmin.from('dic_project_statuses').select('id, code');
        const { data: docTypes } = await supabaseAdmin.from('dic_document_types').select('id, code');

        const { data: locs } = await supabaseAdmin
            .from('localization')
            .select('object_name, object_id, locale, name')
            .in('object_name', [
                'dic_regions',
                'dic_countries',
                'dic_project_object_types',
                'dic_project_customers',
                'dic_project_statuses',
                'dic_document_types'
            ]);

        const locMap = {};
        (locs || []).forEach(l => {
            if (!locMap[l.object_name]) locMap[l.object_name] = {};
            if (!locMap[l.object_name][l.object_id]) locMap[l.object_name][l.object_id] = {};
            locMap[l.object_name][l.object_id][l.locale] = l.name;
        });

        const formattedRegions = (regions || []).map(r => ({
            id: r.id,
            code: r.code,
            country_id: r.country_id,
            name: locMap['dic_regions']?.[r.id]?.[locale] || r.code
        }));

        const countryDefaults = {
            GE: { ru: 'Грузия', en: 'Georgia', ka: 'საქართველო', az: 'Gürcüstan' },
            AZ: { ru: 'Азербайджан', en: 'Azerbaijan', ka: 'აზერბაიჯანი', az: 'Azərbaycan' }
        };

        const formattedCountries = (countries || []).map(c => {
            const defs = countryDefaults[c.code];
            const name = locMap['dic_countries']?.[c.id]?.[locale] || (defs ? (defs[locale] || defs.ru) : c.code);
            return {
                id: c.id,
                code: c.code,
                name
            };
        });

        const formattedObjTypes = (objTypes || []).map(t => ({
            id: t.id,
            code: t.code,
            name: locMap['dic_project_object_types']?.[t.id]?.[locale] || t.code
        }));

        const formattedCustomers = (customers || []).map(c => ({
            id: c.id,
            code: c.code,
            name: locMap['dic_project_customers']?.[c.id]?.[locale] || c.code
        }));

        const formattedStatuses = (statuses || []).map(s => ({
            id: s.id,
            code: s.code,
            name: locMap['dic_project_statuses']?.[s.id]?.[locale] || s.code
        }));

        const formattedDocTypes = (docTypes || []).map(dt => ({
            id: dt.id,
            code: dt.code,
            name: locMap['dic_document_types']?.[dt.id]?.[locale] || dt.code
        }));

        // Генерация следующего кода проекта
        const { data: latestProj } = await supabaseAdmin
            .from('projects')
            .select('code')
            .order('created_at', { ascending: false })
            .limit(1);

        let nextNum = 1;
        if (latestProj && latestProj.length > 0) {
            const lastCode = latestProj[0].code;
            const match = lastCode.match(/PRJ-(\d+)/);
            if (match) {
                nextNum = parseInt(match[1]) + 1;
            }
        }
        const nextCode = `PRJ-${String(nextNum).padStart(3, '0')}`;

        res.json({
            countries: formattedCountries,
            regions: formattedRegions,
            managers: managers || [],
            object_types: formattedObjTypes,
            customers: formattedCustomers,
            statuses: formattedStatuses,
            next_code: nextCode
        });
    } catch (err) {
        console.error('[PROJECT DIC ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- 3. СОЗДАНИЕ НОВОГО ПРОЕКТА ---
router.post('/projects', async (req, res) => {
    try {
        const { code, name, object_type, customer, region_id, start_date, end_date, manager_id, custom_manager_name, documents, organization_id } = req.body;

        // Валидация АС-2
        if (!name?.trim() || !object_type || !customer || !region_id || !start_date || (!manager_id && !custom_manager_name?.trim())) {
            return res.status(400).json({ error: 'Заполните обязательные данные' });
        }

        // 1. Определение кода проекта (автогенерация или ручной ввод)
        let projectCode = code?.trim();
        if (!projectCode) {
            const { data: latestProj } = await supabaseAdmin
                .from('projects')
                .select('code')
                .order('created_at', { ascending: false })
                .limit(1);

            let nextNum = 1;
            if (latestProj && latestProj.length > 0) {
                const lastCode = latestProj[0].code;
                const match = lastCode.match(/PRJ-(\d+)/);
                if (match) {
                    nextNum = parseInt(match[1]) + 1;
                }
            }
            projectCode = `PRJ-${String(nextNum).padStart(3, '0')}`;
        }

        // 2. Проверка уникальности кода проекта (АС-3)
        const { data: existing } = await supabaseAdmin
            .from('projects')
            .select('id')
            .eq('code', projectCode)
            .maybeSingle();

        if (existing) {
            return res.status(400).json({ error: 'Проект с указанным кодом уже существует' });
        }

        // 3. Сохранение проекта
        const { latitude, longitude, address } = req.body;
        const insertData = {
            code: projectCode,
            name: name.trim(),
            object_type,
            customer,
            region_id,
            status: 'prospect', // Перспективный
            estimate_status: 'not_started', // Не начато
            manager_id: manager_id || null,
            documents: documents || [],
            start_date,
            end_date: end_date || null,
            is_active: true,
            organization_id: organization_id || '741be209-ad6f-4483-92ee-298a36899bcf',
            latitude: parseCoordinate(latitude),
            longitude: parseCoordinate(longitude),
            address: address || null
        };

        if (custom_manager_name?.trim()) {
            insertData.custom_manager_name = custom_manager_name.trim();
        }

        let { data: newProj, error: insErr } = await supabaseAdmin
            .from('projects')
            .insert([insertData])
            .select()
            .single();

        if (insErr && insErr.code === '42703') {
            console.warn('[WARNING] Column missing in projects table. Retrying insert dynamically.');
            const retryData = { ...insertData };
            if (insErr.message.includes('address')) {
                delete retryData.address;
            } else {
                delete retryData.custom_manager_name;
                delete retryData.address;
                delete retryData.latitude;
                delete retryData.longitude;
            }
            const retry = await supabaseAdmin
                .from('projects')
                .insert([retryData])
                .select()
                .single();
            newProj = retry.data;
            insErr = retry.error;

            if (insErr && insErr.code === '42703') {
                const finalData = { ...retryData };
                delete finalData.custom_manager_name;
                delete finalData.address;
                delete finalData.latitude;
                delete finalData.longitude;
                const finalRetry = await supabaseAdmin
                    .from('projects')
                    .insert([finalData])
                    .select()
                    .single();
                newProj = finalRetry.data;
                insErr = finalRetry.error;
            }
        }

        if (insErr) throw insErr;

        res.status(201).json(newProj);
    } catch (err) {
        console.error('[CREATE PROJECT ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- 4. УДАЛЕНИЕ ПРОЕКТА И СВЯЗАННОЙ СМЕТЫ (HARD DELETE / DEACTIVATE) ---
router.delete('/projects/:id', async (req, res) => {
    try {
        const { id } = req.params;

        if (req.user.role !== 'admin' && req.user.role !== 'manager') {
            return res.status(403).json({ error: 'У вас нет прав на удаление проектов' });
        }

        // Если роль - Менеджер: выполняем деактивацию (мягкое удаление)
        if (req.user.role === 'manager') {
            const { data: proj, error: findErr } = await supabaseAdmin
                .from('projects')
                .select('status')
                .eq('id', id)
                .single();

            if (findErr || !proj) {
                return res.status(404).json({ error: 'Проект не найден' });
            }

            // Менеджер может деактивировать любой проект, кроме утвержденного
            if (proj.status === 'approved') {
                return res.status(403).json({ error: 'Деактивировать утвержденный проект невозможно' });
            }

            const { data: updatedProj, error: updErr } = await supabaseAdmin
                .from('projects')
                .update({ is_active: false, status: 'inactive' })
                .eq('id', id)
                .select()
                .single();

            if (updErr) throw updErr;
            return res.json({ success: true, deactivated: true, message: 'Проект успешно деактивирован', data: updatedProj });
        }

        // Если роль - Администратор: выполняем жесткое каскадное удаление
        // 1. Сначала удаляем сметы, привязанные к этому проекту
        const { error: estErr } = await supabaseAdmin
            .from('est_documents')
            .delete()
            .eq('project_uuid', id);

        if (estErr) throw estErr;

        // 2. Затем удаляем сам проект из таблицы projects
        const { error: projErr } = await supabaseAdmin
            .from('projects')
            .delete()
            .eq('id', id);

        if (projErr) throw projErr;

        res.json({ success: true, deleted: true, message: 'Проект и связанные сметы успешно удалены' });
    } catch (err) {
        console.error('[DELETE PROJECT ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- 4.0.1. АКТИВАЦИЯ ДЕАКТИВИРОВАННОГО ПРОЕКТА ---
router.post('/projects/:id/activate', async (req, res) => {
    try {
        const { id } = req.params;

        if (req.user.role !== 'admin' && req.user.role !== 'manager') {
            return res.status(403).json({ error: 'У вас нет прав на активацию проектов' });
        }

        const { data: updatedProj, error: updErr } = await supabaseAdmin
            .from('projects')
            .update({ is_active: true, status: 'prospect' })
            .eq('id', id)
            .select()
            .single();

        if (updErr) throw updErr;

        res.json({ success: true, activated: true, message: 'Проект успешно активирован', data: updatedProj });
    } catch (err) {
        console.error('[ACTIVATE PROJECT ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- 4.1. ОБНОВЛЕНИЕ ДАННЫХ ПРОЕКТА ---
router.put('/projects/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, object_type, customer, region_id, start_date, end_date, manager_id, custom_manager_name, status, documents, latitude, longitude, address } = req.body;

        // Валидация АС-2
        if (!name?.trim() || !object_type || !customer || !region_id || !start_date || (!manager_id && !custom_manager_name?.trim())) {
            return res.status(400).json({ error: 'Заполните обязательные данные' });
        }

        // Ролевые ограничения (АС-7)
        if (req.user.role !== 'admin' && req.user.role !== 'manager') {
            return res.status(403).json({ error: 'У вас нет прав на редактирование проектов' });
        }

        // Получаем текущее состояние проекта из базы для проверки
        const { data: dbProj, error: getErr } = await supabaseAdmin
            .from('projects')
            .select('status, documents')
            .eq('id', id)
            .single();

        if (getErr || !dbProj) {
            return res.status(404).json({ error: 'Проект не найден' });
        }

        // Ограничения для Менеджера (BR-3)
        if (req.user.role === 'manager') {
            if (dbProj.status !== 'prospect' && dbProj.status !== 'approval_rejected') {
                return res.status(403).json({ error: 'Редактирование проекта заблокировано, так как он находится на утверждении или уже утвержден' });
            }
        }

        const updateData = {
            name: name.trim(),
            object_type,
            customer,
            region_id,
            manager_id: manager_id || null,
            start_date,
            end_date: end_date || null,
            latitude: latitude !== undefined ? parseCoordinate(latitude) : undefined,
            longitude: longitude !== undefined ? parseCoordinate(longitude) : undefined,
            address: address !== undefined ? address : undefined,
            updated_at: new Date()
        };

        if (req.user.role === 'manager') {
            updateData.status = 'prospect';
            updateData.documents = documents || dbProj.documents || [];
        } else {
            updateData.status = status || dbProj.status;
            updateData.documents = documents || dbProj.documents || [];
        }

        if (custom_manager_name !== undefined) {
            updateData.custom_manager_name = custom_manager_name ? custom_manager_name.trim() : null;
        }

        let { data: updatedProj, error: updErr } = await supabaseAdmin
            .from('projects')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (updErr && updErr.code === '42703') {
            console.warn('[WARNING] Column missing in projects table. Retrying update dynamically.');
            const retryData = { ...updateData };
            if (updErr.message.includes('address')) {
                delete retryData.address;
            } else {
                delete retryData.custom_manager_name;
                delete retryData.address;
                delete retryData.latitude;
                delete retryData.longitude;
            }
            const retry = await supabaseAdmin
                .from('projects')
                .update(retryData)
                .eq('id', id)
                .select()
                .single();
            updatedProj = retry.data;
            updErr = retry.error;

            if (updErr && updErr.code === '42703') {
                const finalData = { ...retryData };
                delete finalData.custom_manager_name;
                delete finalData.address;
                delete finalData.latitude;
                delete finalData.longitude;
                const finalRetry = await supabaseAdmin
                    .from('projects')
                    .update(finalData)
                    .eq('id', id)
                    .select()
                    .single();
                updatedProj = finalRetry.data;
                updErr = finalRetry.error;
            }
        }

        if (updErr) throw updErr;

        // --- АВТОМАТИЧЕСКИЙ ПЕРЕНОС ВАЛЮТЫ И РЕГИОНА В СМЕТЫ ПРОЕКТА ---
        try {
            if (region_id) {
                // 1. Находим country_id по региону
                const { data: reg } = await supabaseAdmin
                    .from('dic_regions')
                    .select('id, country_id')
                    .eq('id', region_id)
                    .maybeSingle();
                
                if (reg && reg.country_id) {
                    // 2. Находим валюту по стране
                    const { data: country } = await supabaseAdmin
                        .from('dic_countries')
                        .select('id, currency_id')
                        .eq('id', reg.country_id)
                        .maybeSingle();
                    
                    if (country && country.currency_id) {
                        // 3. Обновляем все связанные сметы (est_documents)
                        await supabaseAdmin
                            .from('est_documents')
                            .update({
                                region_id: region_id,
                                currency_id: country.currency_id
                            })
                            .eq('project_uuid', id);
                        console.log(`[PROJECT EDIT] Updated region and currency for all estimates under project ${id} to region ${region_id}, currency ${country.currency_id}`);
                    }
                }
            }
        } catch (err) {
            console.error('[WARNING] Failed to propagate currency and region to estimates on project update:', err.message);
        }

        res.json(updatedProj);
    } catch (err) {
        console.error('[UPDATE PROJECT ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- 4.2. ЗАГРУЗКА РЕАЛЬНЫХ ФАЙЛОВ ПРОЕКТА ---
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = path.join(__dirname, '../uploads');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        let orig = file.originalname;
        try {
            orig = Buffer.from(file.originalname, 'latin1').toString('utf8');
        } catch (e) {}
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + orig);
    }
});

const allowedExtensions = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.dwg', '.dxf', '.jpg', '.jpeg', '.png', '.zip', '.rar'];

const fileFilter = (req, file, cb) => {
    let orig = file.originalname;
    try {
        orig = Buffer.from(file.originalname, 'latin1').toString('utf8');
    } catch (e) {}
    const ext = path.extname(orig).toLowerCase();
    if (allowedExtensions.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error('Недопустимый формат файла. Допустимые форматы: PDF, DOC, DOCX, XLS, XLSX, DWG, DXF, JPG, JPEG, PNG, ZIP, RAR'), false);
    }
};

const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB (BR-12)
});

router.post('/projects/upload', upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Файл не загружен или имеет неверный формат' });
        }
        let orig = req.file.originalname;
        try {
            orig = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
        } catch (e) {}
        res.json({ filename: req.file.filename, originalName: orig });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 5. СОЗДАНИЕ СМЕТЫ ДЛЯ ПРОЕКТА ---
router.post('/projects/:id/create-estimate', async (req, res) => {
    try {
        const { id } = req.params;
        const { organization_id, lang, objectId, zone, phase, discipline } = req.body;

        const { data: proj, error: pErr } = await supabaseAdmin
            .from('projects')
            .select('*')
            .eq('id', id)
            .single();

        if (pErr || !proj) {
            return res.status(404).json({ error: 'Проект не найден' });
        }

        // Проверка дубля: смета с такими же проектом/объектом/зоной/фазой/дисциплиной уже
        // существует — не создаём вторую копию, а сообщаем фронтенду, какую открыть.
        // Дисциплина сравнивается строгим равенством ("все дисциплины" — это отдельное
        // самостоятельное значение, а не зонтик над конкретными): "все дисциплины" конфликтует
        // только с другой сметой "для всех дисциплин", а конкретная дисциплина (например,
        // "Фасад") — только с такой же конкретной, но не с "все дисциплины" и не с другими
        // конкретными дисциплинами той же зоны/фазы.
        // Этот мастер всегда создаёт "Рабочую" версию (estimate_type='work'), поэтому сравнение
        // ведём только среди других "Рабочих" смет — "Плановая"/"Фактическая" версии того же
        // конструктива создаются намеренно (кнопки "Создать плановую/фактическую версию") с теми
        // же зоной/фазой/дисциплиной и дублями не являются.
        if (zone && phase) {
            let dupQuery = supabaseAdmin
                .from('est_documents')
                .select('id, discipline')
                .eq('project_uuid', id)
                .eq('estimate_type', 'work')
                .eq('zone', zone)
                .eq('phase', phase);
            dupQuery = (objectId && objectId !== 'legacy')
                ? dupQuery.eq('object_id', objectId)
                : dupQuery.is('object_id', null);
            dupQuery = discipline ? dupQuery.eq('discipline', discipline) : dupQuery.is('discipline', null);

            // Не .maybeSingle() — тот падает с ошибкой, если совпадений больше одного (а в базе
            // уже накопились старые дубли до этой проверки), и тогда сравнение молча "не находило"
            // существующую смету. Просто смотрим, есть ли вообще хоть одна подходящая запись.
            const { data: existingRows, error: dupErr } = await dupQuery;
            if (dupErr) throw dupErr;
            const existing = (existingRows || [])[0];
            if (existing) {
                return res.status(409).json({ error: 'DUPLICATE_ESTIMATE', existingId: existing.id });
            }
        }

        // 1. Находим регион проекта и получаем его country_id из dic_regions
        let projectCountryId = null;
        let projectCurrencyId = null;
        if (proj.region_id) {
            const { data: reg } = await supabaseAdmin
                .from('dic_regions')
                .select('id, code, country_id')
                .eq('id', proj.region_id)
                .maybeSingle();
            if (reg) {
                projectCountryId = reg.country_id;
                
                // Получаем валюту для этой страны
                if (reg.country_id) {
                    const { data: country } = await supabaseAdmin
                        .from('dic_countries')
                        .select('id, currency_id')
                        .eq('id', reg.country_id)
                        .maybeSingle();
                    if (country) {
                        projectCurrencyId = country.currency_id;
                    }
                }
            }
        }

        // 2. Находим заголовок шаблона WBS по Типу объекта проекта (proj.object_type)
        let { data: templateHeader } = await supabaseAdmin
            .from('wbs_template_headers')
            .select('*')
            .eq('code', proj.object_type || '')
            .maybeSingle();

        if (!templateHeader) {
            const { data: firstHeader } = await supabaseAdmin
                .from('wbs_template_headers')
                .select('*')
                .limit(1)
                .maybeSingle();
            templateHeader = firstHeader;
        }

        let templates = [];
        let templatesToCopy = [];
        if (templateHeader) {
            const { data: tList, error: tErr } = await supabaseAdmin
                .from('wbs_templates')
                .select('*')
                .eq('template_id', templateHeader.id)
                .order('sort_order');
            
            if (tErr) {
                console.error('Error fetching templates:', tErr);
            } else {
                templates = tList || [];
                
                // Find starting node based on discipline, phase, or zone
                let startNode = null;
                if (discipline) {
                    startNode = templates.find(t => 
                        t.type === 'Discipline' && (
                            t.name_ru === discipline ||
                            t.name_en === discipline ||
                            t.name_ka === discipline ||
                            t.name_az === discipline
                        )
                    );
                }
                if (!startNode && phase) {
                    startNode = templates.find(t => 
                        t.type === 'Phase' && (
                            t.name_ru === phase ||
                            t.name_en === phase ||
                            t.name_ka === phase ||
                            t.name_az === phase
                        )
                    );
                }
                if (!startNode && zone) {
                    startNode = templates.find(t => 
                        t.type === 'Facility/Zone' && (
                            t.name_ru === zone ||
                            t.name_en === zone ||
                            t.name_ka === zone ||
                            t.name_az === zone
                        )
                    );
                }

                // Collect path nodes (Zone, Phase, Discipline) upwards from startNode
                if (startNode) {
                    const pathNodes = [];
                    let curr = startNode;
                    while (curr) {
                        pathNodes.unshift(curr);
                        if (curr.parent_id) {
                            curr = templates.find(t => t.id === curr.parent_id);
                            if (curr && (curr.type === 'Project' || curr.type === 'project')) {
                                curr = null;
                            }
                        } else {
                            curr = null;
                        }
                    }
                    
                    // Add path nodes to copy
                    templatesToCopy.push(...pathNodes);

                    // Collect descendants recursively
                    const collectDescendants = (parentNodeId) => {
                        const children = templates.filter(t => t.parent_id === parentNodeId);
                        children.forEach(c => {
                            templatesToCopy.push(c);
                            collectDescendants(c.id);
                        });
                    };
                    collectDescendants(startNode.id);
                } else {
                    // Fallback: copy all nodes of levels 5, 6, 7
                    templatesToCopy = templates.filter(t => 
                        ['Work Package', 'Activity Group', 'Activity Type', 'work_package', 'construct', 'subconstruct'].includes(t.type)
                    );
                }
            }
        }

        const { data: newDoc, error: docErr } = await supabaseAdmin
            .from('est_documents')
            .insert([{
                project_id: proj.name,
                project_uuid: proj.id,
                organization_id: organization_id || proj.organization_id || '741be209-ad6f-4483-92ee-298a36899bcf',
                status: 'draft',
                total_amount: 0,
                date: new Date(),
                region_id: proj.region_id,
                currency_id: projectCurrencyId, // Валюта по стране
                is_template_added: templatesToCopy.length > 0,
                object_id: (objectId && objectId !== 'legacy') ? objectId : null,
                zone: zone || null,
                phase: phase || null,
                discipline: discipline || null,
                created_by: req.user?.id || null
            }])
            .select()
            .single();

        if (docErr) throw docErr;

        // Копируем структуру WBS в est_wbs, если шаблоны найдены
        if (templatesToCopy.length > 0) {
            const crypto = require('crypto');
            const tempToEstMap = {};
            templatesToCopy.forEach(temp => {
                tempToEstMap[temp.id] = crypto.randomUUID();
            });

            const wbsRecords = templatesToCopy.map(temp => {
                const newId = tempToEstMap[temp.id];
                
                // If parent is also in the copied nodes, use its new UUID
                let newParentId = null;
                if (temp.parent_id && tempToEstMap[temp.parent_id]) {
                    newParentId = tempToEstMap[temp.parent_id];
                }

                // Map WBS types, fallback to template's original type
                let wbsType = temp.type || 'section';
                if (temp.type === 'Work Package' || temp.type === 'work_package') {
                    wbsType = 'work_package';
                } else if (temp.type === 'Activity Group' || temp.type === 'activity_group') {
                    wbsType = 'construct';
                } else if (temp.type === 'Activity Type' || temp.type === 'activity_type') {
                    wbsType = 'subconstruct';
                }

                let nameField = 'name_ru';
                if (['ru', 'en', 'ka', 'az', 'tr'].includes(lang)) {
                    nameField = `name_${lang}`;
                }
                const displayName = temp[nameField] || temp.name_ru || temp.code;

                return {
                    id: newId,
                    doc_id: newDoc.id,
                    parent_id: newParentId,
                    name: displayName,
                    type: wbsType,
                    sort_order: temp.sort_order
                };
            });

            const { error: insErr } = await supabaseAdmin
                .from('est_wbs')
                .insert(wbsRecords);

            if (insErr) {
                console.error("Error inserting auto-applied WBS templates:", insErr);
                throw insErr;
            }

            // Связываем проект с шаблоном в project_template
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

            const { error: ptErr } = await supabaseAdmin
                .from('project_template')
                .insert([{
                    project_id: proj.id,
                    template_id: templateHeader.id,
                    created_by: createdBy
                }]);
            
            if (ptErr) {
                console.error("Error inserting project_template link:", ptErr);
            }
        }

        // 2. Обновляем статус сметы в проекте на Черновик
        await supabaseAdmin
            .from('projects')
            .update({ estimate_status: 'draft' })
            .eq('id', id);

        res.json(newDoc);
    } catch (err) {
        console.error('[CREATE ESTIMATE ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- 6. ПОЛУЧЕНИЕ СМЕТЫ ПРОЕКТА (ДЛЯ ПЕРЕХОДА) ---
router.get('/projects/:id/estimate', async (req, res) => {
    try {
        const { id } = req.params;
        const { data: doc, error } = await supabaseAdmin
            .from('est_documents')
            .select('id')
            .eq('project_uuid', id)
            .limit(1)
            .maybeSingle();

        if (error) throw error;
        res.json(doc || null);
    } catch (err) {
        console.error('[GET PROJECT ESTIMATE ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- Получить список утверждающих директоров ---
router.get('/directors', async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('profiles')
            .select('id, first_name, last_name, role')
            .eq('role', 'director');
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        console.error('[GET DIRECTORS ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- Отправить проект на утверждение ---
router.post('/projects/:id/send-for-approval', async (req, res) => {
    try {
        const { id } = req.params;
        const { approval_user_id } = req.body;

        if (!approval_user_id) {
            return res.status(400).json({ error: 'Не указан утверждающий директор' });
        }

        // 1. Получаем проект
        const { data: proj, error: getErr } = await supabaseAdmin
            .from('projects')
            .select('*')
            .eq('id', id)
            .single();

        if (getErr || !proj) {
            return res.status(404).json({ error: 'Проект не найден' });
        }

        // BR-1: На утверждение может быть отправлен только проект со статусом «Перспективный» или «Отклонен в утверждении»
        if (proj.status !== 'prospect' && proj.status !== 'approval_rejected') {
            return res.status(400).json({ error: 'PROJECT_STATUS_INVALID' });
        }

        // Выполняем вставку в project_approvers, project_notifications и обновление проекта параллельно
        const message_text = `Проект №${proj.code} был отправлен на ваше утверждение. Пожалуйста, рассмотрите проект и примите решение.`;

        const [approverRes, notifyRes, updateRes] = await Promise.all([
            supabaseAdmin.from('project_approvers').insert([{
                project_id: id,
                user_id: req.user.id || 'admin-dev-id',
                approval_user_id,
                action: 'ON_APPROVAL',
                notification_sent: true
            }]),
            supabaseAdmin.from('project_notifications').insert([{
                project_id: id,
                user_id: approval_user_id,
                message_code: 'PROJECT_APPROVAL_NOTIFICATION',
                message_text
            }]),
            supabaseAdmin.from('projects').update({ status: 'under_approval' }).eq('id', id)
        ]);

        if (approverRes.error) throw approverRes.error;
        if (notifyRes.error) throw notifyRes.error;
        if (updateRes.error) throw updateRes.error;

        res.json({ success: true, message_code: 'PROJECT_SENT_FOR_APPROVAL' });
    } catch (err) {
        console.error('[SEND FOR APPROVAL ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- Утверждение проекта (Директор) ---
router.post('/projects/:id/approve', async (req, res) => {
    try {
        const { id } = req.params;

        // BR-1: Утвердить проект может только директор или админ
        if (req.user.role !== 'admin' && req.user.role !== 'director') {
            return res.status(403).json({ error: 'У вас нет прав на утверждение проектов' });
        }

        // 1. Получаем проект
        const { data: proj, error: getErr } = await supabaseAdmin
            .from('projects')
            .select('*')
            .eq('id', id)
            .single();

        if (getErr || !proj) {
            return res.status(404).json({ error: 'Проект не найден' });
        }

        // BR-2: Кнопки «Утвердить» и «Отклонить утверждение» доступны только для проектов со статусом «На утверждении»
        if (proj.status !== 'under_approval') {
            return res.status(400).json({ error: 'Кнопки утверждения доступны только для проектов со статусом "На утверждении"' });
        }

        // 2. Получаем последнюю запись из project_approvers для этого проекта со статусом ON_APPROVAL
        const { data: lastApprover } = await supabaseAdmin
            .from('project_approvers')
            .select('*')
            .eq('project_id', id)
            .eq('action', 'ON_APPROVAL')
            .order('date', { ascending: false })
            .limit(1)
            .maybeSingle();

        const senderUserId = lastApprover ? lastApprover.user_id : proj.manager_id || req.user.id;

        // Выполняем операции параллельно:
        // 1. Запись в project_approvers ( APPROVED )
        // 2. Обновление проекта ( статус approved )
        // 3. Пакетная вставка всех уведомлений
        
        const insertApproverPromise = supabaseAdmin.from('project_approvers').insert([{
            project_id: id,
            user_id: senderUserId,
            approval_user_id: req.user.id,
            action: 'APPROVED',
            notification_sent: true
        }]);

        const updateProjectPromise = supabaseAdmin.from('projects').update({ status: 'approved' }).eq('id', id);

        const notificationsToInsert = [];

        // Уведомление менеджеру
        notificationsToInsert.push({
            project_id: id,
            user_id: senderUserId,
            message_code: 'PROJECT_APPROVED_MANAGER_NOTIFICATION',
            message_text: `Проект №${proj.code} ${proj.name} был утвержден.`
        });

        // Уведомление руководителю проекта (назначенному сметчику)
        if (proj.manager_id) {
            notificationsToInsert.push({
                project_id: id,
                user_id: proj.manager_id,
                message_code: 'PROJECT_APPROVED_NOTIFICATION',
                message_text: `Проект ${proj.code} ${proj.name} был утвержден. Вы можете приступить к подготовке сметы.`
            });
        }


        const insertNotificationsPromise = supabaseAdmin.from('project_notifications').insert(notificationsToInsert);

        const [approverRes, updateRes, notifyRes] = await Promise.all([
            insertApproverPromise,
            updateProjectPromise,
            insertNotificationsPromise
        ]);

        if (approverRes.error) throw approverRes.error;
        if (updateRes.error) throw updateRes.error;
        if (notifyRes.error) throw notifyRes.error;

        res.json({ success: true, message_code: 'PROJECT_APPROVED_SUCCESS' });
    } catch (err) {
        console.error('[APPROVE PROJECT ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- Отклонение утверждения проекта (Директор) ---
router.post('/projects/:id/reject', async (req, res) => {
    try {
        const { id } = req.params;
        const { comment } = req.body;

        // BR-1: Отклонить проект может только директор или админ
        if (req.user.role !== 'admin' && req.user.role !== 'director') {
            return res.status(403).json({ error: 'У вас нет прав на отклонение проектов' });
        }

        // BR-6: При отклонении проекта указание комментария является обязательным.
        if (!comment || !comment.trim()) {
            return res.status(400).json({ error: 'При отклонении проекта указание комментария является обязательным' });
        }

        // 1. Получаем проект
        const { data: proj, error: getErr } = await supabaseAdmin
            .from('projects')
            .select('*')
            .eq('id', id)
            .single();

        if (getErr || !proj) {
            return res.status(404).json({ error: 'Проект не найден' });
        }

        // BR-2: Кнопки «Утвердить» и «Отклонить утверждение» доступны только для проектов со статусом «На утверждении»
        if (proj.status !== 'under_approval') {
            return res.status(400).json({ error: 'Кнопки утверждения доступны только для проектов со статусом "На утверждении"' });
        }

        // 2. Получаем последнюю запись из project_approvers для этого проекта со статусом ON_APPROVAL
        const { data: lastApprover } = await supabaseAdmin
            .from('project_approvers')
            .select('*')
            .eq('project_id', id)
            .eq('action', 'ON_APPROVAL')
            .order('date', { ascending: false })
            .limit(1)
            .maybeSingle();

        const senderUserId = lastApprover ? lastApprover.user_id : proj.manager_id || req.user.id;

        const approverInsert = {
            project_id: id,
            user_id: senderUserId,
            approval_user_id: req.user.id,
            action: 'REJECTED',
            comment: comment.trim(),
            notification_sent: true
        };

        // Выполняем запись approvers, обновление проекта и отправку уведомления параллельно
        const insertApproverPromise = supabaseAdmin.from('project_approvers').insert([approverInsert]);
        const updateProjectPromise = supabaseAdmin.from('projects').update({ status: 'approval_rejected' }).eq('id', id);
        const insertNotificationPromise = supabaseAdmin.from('project_notifications').insert([{
            project_id: id,
            user_id: senderUserId,
            message_code: 'PROJECT_REJECTED_NOTIFICATION',
            message_text: `Проект ${proj.code} ${proj.name} был отклонен. Причина отклонения: ${comment.trim()}.`
        }]);

        const [approverRes, updateRes, notifyRes] = await Promise.all([
            insertApproverPromise,
            updateProjectPromise,
            insertNotificationPromise
        ]);

        if (approverRes.error && approverRes.error.code === '42703') {
            console.warn('[WARNING] Column comment does not exist in project_approvers. Retrying insert without comment.');
            delete approverInsert.comment;
            const retryRes = await supabaseAdmin.from('project_approvers').insert([approverInsert]);
            if (retryRes.error) throw retryRes.error;
        } else if (approverRes.error) {
            throw approverRes.error;
        }

        if (updateRes.error) throw updateRes.error;
        if (notifyRes.error) throw notifyRes.error;

        res.json({ success: true, message_code: 'PROJECT_REJECTED_SUCCESS' });
    } catch (err) {
        console.error('[REJECT PROJECT ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- ПОЛУЧИТЬ СПИСОК ВСЕХ СОТРУДНИКОВ (ТОЛЬКО АДМИН) ---
router.get('/employees', async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Доступ разрешен только администраторам' });
        }

        // 1. Получаем все профили
        const { data: profiles, error: profErr } = await supabaseAdmin
            .from('profiles')
            .select('id, first_name, last_name, role, organization_id, created_at')
            .order('created_at', { ascending: false });

        if (profErr) throw profErr;

        // 2. Получаем email из auth.users
        const { data: { users }, error: authErr } = await supabaseAdmin.auth.admin.listUsers();
        if (authErr) throw authErr;

        // Создаем карту email-адресов
        const emailMap = {};
        users.forEach(u => {
            emailMap[u.id] = u.email;
        });

        // Объединяем профили с email
        const result = (profiles || []).map(p => ({
            ...p,
            email: emailMap[p.id] || ''
        }));

        res.json(result);
    } catch (err) {
        console.error('[GET EMPLOYEES ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- ИЗМЕНИТЬ РОЛЬ СОТРУДНИКА (ТОЛЬКО АДМИН) ---
router.patch('/employees/:id/role', async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Доступ разрешен только администраторам' });
        }

        const { id } = req.params;
        const { role } = req.body;

        const validRoles = ['employee', 'estimator', 'manager', 'director', 'financial_director', 'admin'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({ error: 'Недопустимая роль' });
        }

        // Запрет изменять роль самому себе
        if (id === req.user.id) {
            return res.status(400).json({ error: 'Вы не можете изменить свою собственную роль' });
        }

        const { error } = await supabaseAdmin
            .from('profiles')
            .update({ role })
            .eq('id', id);

        if (error) throw error;

        res.json({ success: true });
    } catch (err) {
        console.error('[CHANGE ROLE ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- 11. ПОЛУЧЕНИЕ СПИСКА ОБЪЕКТОВ ДЛЯ ПРОЕКТА ---
router.get('/projects/:id/objects', async (req, res) => {
    try {
        const { id } = req.params;

        // Fetch objects with their estimates and responsible profile details
        const { data: objects, error: objError } = await supabaseAdmin
            .from('project_objects')
            .select(`
                *,
                profiles:responsible_id (id, first_name, last_name),
                est_documents (id, status, total_amount, date, zone, phase, discipline)
            `)
            .eq('project_id', id)
            .order('created_at', { ascending: true });

        if (objError) throw objError;

        // Map and resolve single estimate per object.
        // "Структура WBS" / "Календарное планирование" объекта используют служебную
        // WBS-шаблон смету (zone/phase/discipline = null), созданную автоматически при
        // создании объекта — а не обычные сметы из раздела "Смета", которые с ней не связаны.
        const resolvedObjects = (objects || []).map(obj => {
            const docs = obj.est_documents || [];
            const estimate = docs.find(d => !d.zone && !d.phase && !d.discipline) || null;
            return {
                id: obj.id,
                project_id: obj.project_id,
                name: obj.name,
                description: obj.description,
                address: obj.address,
                latitude: obj.latitude,
                longitude: obj.longitude,
                responsible_id: obj.responsible_id,
                responsible_name: obj.profiles 
                    ? `${obj.profiles.first_name} ${obj.profiles.last_name}` 
                    : (obj.custom_responsible_name || ''),
                created_at: obj.created_at,
                estimate: estimate ? {
                    id: estimate.id,
                    status: estimate.status,
                    total_amount: estimate.total_amount,
                    date: estimate.date
                } : null
            };
        });

        // Backward compatibility: fetch any estimates with object_id IS NULL
        const { data: legacyEstimates, error: legError } = await supabaseAdmin
            .from('est_documents')
            .select('id, status, total_amount, date')
            .eq('project_uuid', id)
            .is('object_id', null);

        if (legError) throw legError;

        if (legacyEstimates && legacyEstimates.length > 0) {
            resolvedObjects.unshift({
                id: 'legacy',
                project_id: id,
                name: 'Общий этап',
                description: 'Смета созданная до привязки к объектам',
                address: '',
                latitude: null,
                longitude: null,
                responsible_id: null,
                responsible_name: '',
                created_at: new Date(0).toISOString(),
                estimate: {
                    id: legacyEstimates[0].id,
                    status: legacyEstimates[0].status,
                    total_amount: legacyEstimates[0].total_amount,
                    date: legacyEstimates[0].date
                }
            });
        }

        res.json(resolvedObjects);
    } catch (err) {
        console.error('[GET PROJECT OBJECTS ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- 12. ДОБАВЛЕНИЕ НОВОГО ОБЪЕКТА В ПРОЕКТ ---
router.post('/projects/:id/objects', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, address, latitude, longitude, responsible_id, custom_responsible_name } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Имя объекта является обязательным полем' });
        }

        let finalRespId = responsible_id || null;
        let finalRespCustom = custom_responsible_name || null;

        // If not specified, default to project's manager
        if (!finalRespId && !finalRespCustom) {
            const { data: proj } = await supabaseAdmin
                .from('projects')
                .select('manager_id, custom_manager_name')
                .eq('id', id)
                .single();
            if (proj) {
                finalRespId = proj.manager_id || null;
                finalRespCustom = proj.custom_manager_name || null;
            }
        }

        const { data: newObj, error: insertError } = await supabaseAdmin
            .from('project_objects')
            .insert([{
                project_id: id,
                name,
                description,
                address,
                latitude: parseCoordinate(latitude),
                longitude: parseCoordinate(longitude),
                responsible_id: finalRespId,
                custom_responsible_name: finalRespCustom
            }])
            .select()
            .single();

        if (insertError) throw insertError;

        // Auto-create WBS estimate for the object immediately and copy project template
        let newDoc = null;
        try {
            const { data: proj } = await supabaseAdmin
                .from('projects')
                .select('*')
                .eq('id', id)
                .single();

            if (proj) {
                // Find template header by object type
                let { data: templateHeader } = await supabaseAdmin
                    .from('wbs_template_headers')
                    .select('*')
                    .eq('code', proj.object_type || '')
                    .maybeSingle();

                if (!templateHeader) {
                    const { data: firstHeader } = await supabaseAdmin
                        .from('wbs_template_headers')
                        .select('*')
                        .limit(1)
                        .maybeSingle();
                    templateHeader = firstHeader;
                }

                let templatesToCopy = [];
                if (templateHeader) {
                    const { data: tList } = await supabaseAdmin
                        .from('wbs_templates')
                        .select('*')
                        .eq('template_id', templateHeader.id)
                        .order('sort_order');
                    templatesToCopy = tList || [];
                }

                // Create the estimate document
                const { data: createdDoc, error: docErr } = await supabaseAdmin
                    .from('est_documents')
                    .insert([{
                        project_id: proj.name,
                        project_uuid: proj.id,
                        organization_id: proj.organization_id || '741be209-ad6f-4483-92ee-298a36899bcf',
                        status: 'draft',
                        total_amount: 0,
                        date: new Date(),
                        region_id: proj.region_id,
                        is_template_added: templatesToCopy.length > 0,
                        object_id: newObj.id,
                        zone: null,
                        phase: null,
                        discipline: null
                    }])
                    .select()
                    .single();

                if (!docErr && createdDoc) {
                    newDoc = createdDoc;

                    if (templatesToCopy.length > 0) {
                        const crypto = require('crypto');
                        const tempToEstMap = {};
                        templatesToCopy.forEach(temp => {
                            tempToEstMap[temp.id] = crypto.randomUUID();
                        });

                        const wbsRecords = templatesToCopy.map(temp => {
                            const newId = tempToEstMap[temp.id];
                            let newParentId = null;
                            if (temp.parent_id && tempToEstMap[temp.parent_id]) {
                                newParentId = tempToEstMap[temp.parent_id];
                            }

                            let wbsType = temp.type || 'section';
                            if (temp.type === 'Work Package' || temp.type === 'work_package') {
                                wbsType = 'work_package';
                            } else if (temp.type === 'Activity Group' || temp.type === 'activity_group') {
                                wbsType = 'construct';
                            } else if (temp.type === 'Activity Type' || temp.type === 'activity_type') {
                                wbsType = 'subconstruct';
                            }

                            // Default language for names: rus/en/ka/az
                            const displayName = temp.name_ru || temp.name_en || temp.name_ka || temp.name_az || temp.code;

                            return {
                                id: newId,
                                doc_id: newDoc.id,
                                parent_id: newParentId,
                                name: displayName,
                                type: wbsType,
                                sort_order: temp.sort_order
                            };
                        });

                        await supabaseAdmin
                            .from('est_wbs')
                            .insert(wbsRecords);
                    }
                }
            }
        } catch (autoErr) {
            console.error('[AUTO CREATE ESTIMATE ERROR ON OBJECT CREATION]:', autoErr.message);
        }

        // Fetch profiles info for returned object
        let respName = '';
        if (newObj.responsible_id) {
            const { data: prof } = await supabaseAdmin
                .from('profiles')
                .select('first_name, last_name')
                .eq('id', newObj.responsible_id)
                .single();
            if (prof) respName = `${prof.first_name} ${prof.last_name}`;
        } else {
            respName = newObj.custom_responsible_name || '';
        }

        res.json({
            ...newObj,
            responsible_name: respName,
            estimate: newDoc
        });
    } catch (err) {
        console.error('[CREATE PROJECT OBJECT ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- 13. УДАЛЕНИЕ ОБЪЕКТА ---
router.delete('/projects/:id/objects/:objectId', async (req, res) => {
    try {
        const { objectId } = req.params;

        // Check if there is an estimate and if it is in approved or under_approval status
        const { data: ests } = await supabaseAdmin
            .from('est_documents')
            .select('status')
            .eq('object_id', objectId);

        const estimate = ests?.[0];
        if (estimate && estimate.status !== 'draft') {
            return res.status(400).json({ error: 'Нельзя удалить объект с согласованной или утвержденной сметой' });
        }
        
        const { error } = await supabaseAdmin
            .from('project_objects')
            .delete()
            .eq('id', objectId);

        if (error) throw error;

        res.json({ success: true });
    } catch (err) {
        console.error('[DELETE PROJECT OBJECT ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- 14. РЕДАКТИРОВАНИЕ ОБЪЕКТА ---
router.put('/projects/:id/objects/:objectId', async (req, res) => {
    try {
        const { objectId } = req.params;
        const { name, description, address, latitude, longitude, responsible_id, custom_responsible_name } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Имя объекта является обязательным полем' });
        }

        // Check if there is an estimate and if it is in approved or under_approval status
        const { data: ests } = await supabaseAdmin
            .from('est_documents')
            .select('status')
            .eq('object_id', objectId);

        const estimate = ests?.[0];
        if (estimate && estimate.status !== 'draft') {
            return res.status(400).json({ error: 'Нельзя редактировать объект с согласованной или утвержденной сметой' });
        }

        const { data, error } = await supabaseAdmin
            .from('project_objects')
            .update({
                name,
                description,
                address,
                latitude: parseCoordinate(latitude),
                longitude: parseCoordinate(longitude),
                responsible_id: responsible_id || null,
                custom_responsible_name: custom_responsible_name || null
            })
            .eq('id', objectId)
            .select()
            .single();

        if (error) throw error;

        // Fetch profiles info for returned object
        let respName = '';
        if (data.responsible_id) {
            const { data: prof } = await supabaseAdmin
                .from('profiles')
                .select('first_name, last_name')
                .eq('id', data.responsible_id)
                .single();
            if (prof) respName = `${prof.first_name} ${prof.last_name}`;
        } else {
            respName = data.custom_responsible_name || '';
        }

        res.json({
            ...data,
            responsible_name: respName
        });
    } catch (err) {
        console.error('[UPDATE PROJECT OBJECT ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- PSD DOCUMENT CRUD ENDPOINTS ---

// GET: Fetch all documents for an object
router.get('/projects/:id/objects/:objectId/documents', async (req, res) => {
    try {
        const { objectId } = req.params;
        const { data, error } = await supabaseAdmin
            .from('object_documents')
            .select('*')
            .eq('object_id', objectId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        const docs = data || [];
        if (docs.length === 0) {
            return res.json([]);
        }

        // Fetch profiles and document types in memory to avoid postgrest relation joining issues
        const userIds = [...new Set(docs.flatMap(d => [d.created_by, d.updated_by]).filter(Boolean))];
        const profilesMap = {};
        if (userIds.length > 0) {
            const { data: profs } = await supabaseAdmin
                .from('profiles')
                .select('id, first_name, last_name')
                .in('id', userIds);

            (profs || []).forEach(p => {
                profilesMap[p.id] = p;
            });
        }

        const { data: docTypes } = await supabaseAdmin.from('dic_document_types').select('id, code');
        const docTypesMap = {};
        (docTypes || []).forEach(dt => {
            docTypesMap[dt.id] = dt.code;
        });

        const enriched = docs.map(d => ({
            ...d,
            type_code: docTypesMap[d.type_id] || d.type_id,
            created_by_profile: profilesMap[d.created_by] || null,
            updated_by_profile: profilesMap[d.updated_by] || null
        }));

        res.json(enriched);
    } catch (err) {
        console.error('[GET DOCUMENTS ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST: Create a document
router.post('/projects/:id/objects/:objectId/documents', async (req, res) => {
    try {
        const { objectId } = req.params;
        const { name, type_id, version, file_path, doc_url, notes } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Поле "Название" обязательно для заполнения' });
        }
        if (!type_id) {
            return res.status(400).json({ error: 'Поле "Тип" обязательно для заполнения' });
        }
        if (!file_path && !doc_url) {
            return res.status(400).json({ error: 'Загрузите файл или укажите ссылку на документ' });
        }

        const userId = req.user?.id;
        
        let finalTypeId = type_id;
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(type_id);
        if (!isUuid && type_id) {
            const { data: dt } = await supabaseAdmin
                .from('dic_document_types')
                .select('id')
                .eq('code', type_id)
                .maybeSingle();
            if (dt && dt.id) {
                finalTypeId = dt.id;
            } else {
                const { data: fallbackDt } = await supabaseAdmin
                    .from('dic_document_types')
                    .select('id')
                    .limit(1)
                    .maybeSingle();
                if (fallbackDt && fallbackDt.id) {
                    finalTypeId = fallbackDt.id;
                }
            }
        }

        const { data, error } = await supabaseAdmin
            .from('object_documents')
            .insert({
                name: name.trim(),
                type_id: finalTypeId,
                version: version || '1.0',
                file_path: file_path || null,
                doc_url: doc_url || null,
                notes: notes || null,
                object_id: objectId,
                created_by: userId,
                updated_by: userId
            })
            .select('*')
            .single();

        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('[POST DOCUMENT ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// PUT: Update a document
router.put('/projects/:id/objects/:objectId/documents/:docId', async (req, res) => {
    try {
        const { docId } = req.params;
        const { name, type_id, version, file_path, doc_url, notes } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Поле "Название" обязательно для заполнения' });
        }
        if (!type_id) {
            return res.status(400).json({ error: 'Поле "Тип" обязательно для заполнения' });
        }
        if (!file_path && !doc_url) {
            return res.status(400).json({ error: 'Загрузите файл или укажите ссылку на документ' });
        }

        const userId = req.user?.id;

        let finalTypeId = type_id;
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(type_id);
        if (!isUuid && type_id) {
            const { data: dt } = await supabaseAdmin
                .from('dic_document_types')
                .select('id')
                .eq('code', type_id)
                .maybeSingle();
            if (dt && dt.id) {
                finalTypeId = dt.id;
            } else {
                const { data: fallbackDt } = await supabaseAdmin
                    .from('dic_document_types')
                    .select('id')
                    .limit(1)
                    .maybeSingle();
                if (fallbackDt && fallbackDt.id) {
                    finalTypeId = fallbackDt.id;
                }
            }
        }

        const { data, error } = await supabaseAdmin
            .from('object_documents')
            .update({
                name: name.trim(),
                type_id: finalTypeId,
                version: version || '1.0',
                file_path: file_path || null,
                doc_url: doc_url || null,
                notes: notes || null,
                updated_by: userId,
                updated_at: new Date().toISOString()
            })
            .eq('id', docId)
            .select('*')
            .single();

        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('[PUT DOCUMENT ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// DELETE: Delete a document
router.delete('/projects/:id/objects/:objectId/documents/:docId', async (req, res) => {
    try {
        const { docId } = req.params;

        const { error } = await supabaseAdmin
            .from('object_documents')
            .delete()
            .eq('id', docId);

        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        console.error('[DELETE DOCUMENT ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});


// =============================================================
// УВЕДОМЛЕНИЯ
// =============================================================

// GET /notifications — список уведомлений текущего пользователя
router.get('/notifications', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.json([]);

        const { data, error } = await supabaseAdmin
            .from('project_notifications')
            .select('*, projects(id, code, name)')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        console.error('[GET NOTIFICATIONS ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// PATCH /notifications/:id/read — отметить одно уведомление как прочитанное
router.patch('/notifications/:id/read', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;

        const { error } = await supabaseAdmin
            .from('project_notifications')
            .update({ is_read: true })
            .eq('id', id)
            .eq('user_id', userId);

        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        console.error('[READ NOTIFICATION ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /notifications/read-all — отметить все уведомления пользователя как прочитанные
router.post('/notifications/read-all', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.json({ success: true });

        const { error } = await supabaseAdmin
            .from('project_notifications')
            .update({ is_read: true })
            .eq('user_id', userId)
            .eq('is_read', false);

        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        console.error('[READ ALL NOTIFICATIONS ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

