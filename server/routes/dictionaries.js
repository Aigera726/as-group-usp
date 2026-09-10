const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../supabase');
const crypto = require('crypto');
// --- АВТОРИЗАЦИЯ (общий middleware, см. middleware/auth.js) ---
// Применяется только к операциям записи (POST/PUT/DELETE) — GET-роуты
// справочников остаются публично читаемыми внутри модуля, как и раньше.
const { authMiddleware } = require('../middleware/auth');

// Пускает дальше только admin/manager — так же, как ограничено добавление проекта в сметах
const requireManager = (req, res, next) => {
    if (req.user.role !== 'admin' && req.user.role !== 'manager') {
        return res.status(403).json({ error: 'Недостаточно прав — редактирование справочников доступно только менеджеру или администратору' });
    }
    next();
};

// По ТЗ: "по другим справочникам добавлять/удалять записи может только супер администратор" —
// в отличие от проектов (там разрешён и менеджер), для Работ/Ресурсов/Единиц измерения
// это именно admin-only (в системе нет отдельной роли "супер администратор" — это role === 'admin')
const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Недостаточно прав — изменение этого справочника доступно только администратору' });
    }
    next();
};

// Helper to handle pagination for Supabase queries
async function getAllRows(queryBuilder, pageSize = 1000) {
    let allData = [];
    let from = 0;
    while (true) {
        const { data, error } = await queryBuilder.range(from, from + pageSize - 1);
        if (error) throw error;
        allData = allData.concat(data);
        if (data.length < pageSize) break;
        from += pageSize;
    }
    return allData;
}

// Как getAllRows, но постранично запрашивает несколько страниц параллельно —
// каждый запрос к Supabase занимает ~1с сети, и на больших таблицах (jobs_cas, localization)
// последовательный getAllRows превращался в десятки/сотни секунд ожидания.
// makeQuery — фабрика (не готовый query builder!), т.к. .range() нельзя безопасно
// вызывать параллельно на одном и том же builder-инстансе.
async function getAllRowsParallel(makeQuery, pageSize = 1000, concurrency = 8) {
    let allData = [];
    let from = 0;
    while (true) {
        const ranges = Array.from({ length: concurrency }, (_, i) => from + i * pageSize);
        const batchResults = await Promise.all(ranges.map(f => makeQuery().range(f, f + pageSize - 1)));
        let shortPageHit = false;
        for (const { data, error } of batchResults) {
            if (error) throw error;
            allData = allData.concat(data || []);
            if (!data || data.length < pageSize) shortPageHit = true;
        }
        from += concurrency * pageSize;
        if (shortPageHit) break;
    }
    return allData;
}

// --- РАБОТЫ ---

const WORK_TABLES = { GE: 'jobs', AZ: 'jobs_cas' };
const COUNTRY_LABELS = {
    GE: { ru: 'Грузия', en: 'Georgia', ka: 'საქართველო', az: 'Gürcüstan' },
    AZ: { ru: 'Азербайджан', en: 'Azerbaijan', ka: 'აზერბაიჯანი', az: 'Azərbaycan' },
};

let worksTableCache = {};
let worksTableCacheTime = {};

function invalidateWorksCache(tableName) {
    delete worksTableCache[tableName];
    delete worksTableCacheTime[tableName];
}

// Загружает и локализует ВСЕ строки одной таблицы работ (jobs или jobs_cas),
// включая неактивные — фильтрация по статусу теперь на совести вызывающего кода.
// Кэшируется на час на таблицу (те же тяжёлые джойны, что были раньше на страну) —
// каталог работ меняется редко, а любое редактирование (create/update/delete работы)
// сбрасывает кэш через invalidateWorksCache, так что стухнуть он не может.
const WORKS_CACHE_TTL_MS = 60 * 60 * 1000;
async function loadTableWorks(tableName) {
    const now = Date.now();
    if (worksTableCache[tableName] && worksTableCacheTime[tableName] && (now - worksTableCacheTime[tableName] < WORKS_CACHE_TTL_MS)) {
        return worksTableCache[tableName];
    }

    const isAz = tableName === 'jobs_cas';
    const normsTable = isAz ? 'jobs_norms_cas' : 'job_resource_norms';
    const normsData = await getAllRowsParallel(() => supabaseAdmin.from(normsTable).select('job_id').eq('is_active', true));
    const jobsWithNormsSet = new Set((normsData || []).map(n => n.job_id).filter(Boolean));

    const jobs = await getAllRowsParallel(() => supabaseAdmin.from(tableName).select('id, code, name_id, measure_id, is_active'));

    const measureIds = Array.from(new Set(jobs.map(j => j.measure_id).filter(Boolean)));
    const locMeasures = measureIds.length > 0 ? await getAllRows(
        supabaseAdmin.from('localization').select('id, object_id, locale, name').eq('object_name', 'dic_measures').in('object_id', measureIds)
    ) : [];

    const jobIds = jobs.map(j => j.id).filter(Boolean);
    const jobIdSet = new Set(jobIds);

    // Основной массовый выбор по object_name — быстрый индексированный запрос
    // вместо сотен мелких OR/IN-фильтров по конкретным id (было узким местом на jobs_cas, ~34к строк).
    let locJobs = await getAllRowsParallel(
        () => supabaseAdmin.from('localization').select('id, object_id, locale, name').eq('object_name', tableName)
    );
    locJobs = locJobs.filter(l => jobIdSet.has(l.object_id));

    // Резервный точечный докат для старых записей, где имя привязано только через name_id (id строки),
    // а не через object_id/object_name (см. память supabase_schema.md).
    const coveredJobIds = new Set(locJobs.map(l => l.object_id));
    const fallbackNameIds = jobs.filter(j => j.name_id && !coveredJobIds.has(j.id)).map(j => j.name_id);
    if (fallbackNameIds.length > 0) {
        const chunkSize = 300;
        for (let i = 0; i < fallbackNameIds.length; i += chunkSize) {
            const chunk = fallbackNameIds.slice(i, i + chunkSize);
            const { data: locChunk } = await supabaseAdmin.from('localization').select('id, object_id, locale, name').in('id', chunk);
            if (locChunk) locJobs = locJobs.concat(locChunk);
        }
    }

    const measureLocMap = {};
    locMeasures.forEach(l => {
        if (l.object_id) { if (!measureLocMap[l.object_id]) measureLocMap[l.object_id] = {}; measureLocMap[l.object_id][l.locale] = l.name; }
        if (l.id) { if (!measureLocMap[l.id]) measureLocMap[l.id] = {}; measureLocMap[l.id][l.locale] = l.name; }
    });
    const locMap = {};
    locJobs.forEach(l => {
        if (l.object_id) { if (!locMap[l.object_id]) locMap[l.object_id] = {}; locMap[l.object_id][l.locale] = l.name; }
        if (l.id) { if (!locMap[l.id]) locMap[l.id] = {}; locMap[l.id][l.locale] = l.name; }
    });

    const country = isAz ? 'AZ' : 'GE';
    const existingCodes = new Set();
    const result = [];

    jobs.forEach(j => {
        if (!j.code) return;
        // Внутри одной и той же таблицы код должен быть уникален — если встречаются
        // исторические дубли (было замечено в jobs_cas), оставляем первую запись
        if (existingCodes.has(j.code)) return;
        existingCodes.add(j.code);

        const names = locMap[j.id] || locMap[j.name_id] || {};
        const unitNames = measureLocMap[j.measure_id] || {};

        let rawTitle = names.ru || names.en || names.ka || names.az || '';
        if (rawTitle.startsWith(j.code)) rawTitle = rawTitle.substring(j.code.length).trim();
        if (!rawTitle) rawTitle = `Работа ${j.code}`;

        const unitStr = unitNames.ru || unitNames.en || 'PCS';

        result.push({
            id: j.id,
            code: String(j.code || ''),
            name: rawTitle,
            name_ru: names.ru || rawTitle,
            name_en: names.en || rawTitle,
            name_ka: names.ka || rawTitle,
            name_ge: names.ka || rawTitle,
            name_az: names.az || rawTitle,
            unit: unitStr,
            unit_ru: unitNames.ru || unitStr,
            unit_en: unitNames.en || unitStr,
            unit_ka: unitNames.ka || unitStr,
            unit_ge: unitNames.ka || unitStr,
            unit_az: unitNames.az || unitStr,
            measure_id: j.measure_id || null,
            has_norms: jobsWithNormsSet.has(j.id),
            is_active: !!j.is_active,
            country,
            table: tableName,
        });
    });

    result.sort((a, b) => (a.code || '').localeCompare(b.code || '', undefined, { numeric: true, sensitivity: 'base' }));

    worksTableCache[tableName] = result;
    worksTableCacheTime[tableName] = Date.now();
    return result;
}

// Получить все работы (с полной локализацией и кэшированием).
// Используется редактором сметы (всегда передаёт country/region_id конкретной сметы —
// поведение для него не меняется) и справочником норм (вызывает без параметров).
router.get('/works', async (req, res) => {
    try {
        let country = (req.query.country_code || req.query.country || '').toUpperCase();
        const regionId = req.query.region_id;
        // Страна была передана явно (в т.ч. через регион) — отличаем от случая
        // "параметров нет вообще", когда раньше молча подставлялась Грузия и
        // работы Азербайджана нигде не показывались.
        const countryWasExplicit = !!(req.query.country_code || req.query.country || regionId);

        if (!country && regionId) {
            const { data: reg } = await supabaseAdmin
                .from('dic_regions')
                .select('id, code, dic_countries(id, code)')
                .eq('id', regionId)
                .single();
            if (reg?.dic_countries?.code) country = reg.dic_countries.code.toUpperCase();
        }

        let combined;
        if (!countryWasExplicit) {
            // Ни страны, ни региона не передано — отдаём объединённый список обеих стран
            const [geWorks, azWorks] = await Promise.all([loadTableWorks('jobs'), loadTableWorks('jobs_cas')]);
            combined = geWorks.concat(azWorks);
        } else {
            if (!country) country = 'GE';
            const isAz = country === 'AZ';
            combined = await loadTableWorks(WORK_TABLES[isAz ? 'AZ' : 'GE']);
            // Тот же запасной вариант, что был раньше: если у явно запрошенной Грузии
            // нет ни одной активной работы, показываем Азербайджан вместо пустого списка
            if (!isAz && combined.filter(w => w.is_active).length === 0) {
                combined = await loadTableWorks('jobs_cas');
            }
        }

        const active = combined
            .filter(w => w.is_active)
            .sort((a, b) => (a.code || '').localeCompare(b.code || '', undefined, { numeric: true, sensitivity: 'base' }));

        res.json(active);
    } catch (err) {
        console.error('[Works Dictionary Error]:', err);
        res.status(500).json({ error: 'Ошибка загрузки справочника работ' });
    }
});

// Список работ с фильтрами и пагинацией — для справочника (страница "Работы").
// Отдельно от /works, чтобы не менять форму ответа для редактора сметы.
router.get('/works/list', async (req, res) => {
    try {
        const {
            country = '',
            region_id,
            code = '',
            name = '',
            measure_id = '',
            has_norm = '',
            status = 'active',
            page = '1',
            page_size = '20',
            lang = 'ru',
        } = req.query;

        let resolvedCountry = String(country).toUpperCase();
        if (!resolvedCountry && region_id) {
            const { data: reg } = await supabaseAdmin.from('dic_regions').select('id, dic_countries(code)').eq('id', region_id).maybeSingle();
            if (reg?.dic_countries?.code) resolvedCountry = reg.dic_countries.code.toUpperCase();
        }

        let all;
        if (resolvedCountry === 'AZ') all = await loadTableWorks('jobs_cas');
        else if (resolvedCountry === 'GE') all = await loadTableWorks('jobs');
        else {
            const [ge, az] = await Promise.all([loadTableWorks('jobs'), loadTableWorks('jobs_cas')]);
            all = ge.concat(az);
        }

        let filtered = all;
        if (status === 'active') filtered = filtered.filter(w => w.is_active);
        else if (status === 'inactive') filtered = filtered.filter(w => !w.is_active);

        if (code.trim()) {
            const q = code.trim().toLowerCase();
            filtered = filtered.filter(w => w.code.toLowerCase().includes(q));
        }
        if (name.trim()) {
            const q = name.trim().toLowerCase();
            filtered = filtered.filter(w =>
                (w.name_ru || '').toLowerCase().includes(q) ||
                (w.name_en || '').toLowerCase().includes(q) ||
                (w.name_ka || '').toLowerCase().includes(q) ||
                (w.name_az || '').toLowerCase().includes(q)
            );
        }
        if (measure_id) filtered = filtered.filter(w => w.measure_id === measure_id);
        if (has_norm === 'true') filtered = filtered.filter(w => w.has_norms);
        else if (has_norm === 'false') filtered = filtered.filter(w => !w.has_norms);

        filtered = filtered.slice().sort((a, b) => (a.code || '').localeCompare(b.code || '', undefined, { numeric: true, sensitivity: 'base' }));

        const total = filtered.length;
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const pageSize = [20, 50, 100].includes(parseInt(page_size, 10)) ? parseInt(page_size, 10) : 20;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const safePage = Math.min(pageNum, totalPages);
        const start = (safePage - 1) * pageSize;

        const items = filtered.slice(start, start + pageSize).map(w => ({
            ...w,
            name: w[`name_${lang}`] || w.name_ru || w.name,
            unit: w[`unit_${lang}`] || w.unit_ru || w.unit,
            region: (COUNTRY_LABELS[w.country] && COUNTRY_LABELS[w.country][lang]) || COUNTRY_LABELS[w.country]?.ru || w.country,
        }));

        res.json({ items, total, page: safePage, pageSize, totalPages });
    } catch (err) {
        console.error('[Works List Error]:', err);
        res.status(500).json({ error: err.message });
    }
});

// Создать работу — страна в теле запроса определяет, в какую таблицу писать (jobs/jobs_cas)
router.post('/works', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { country, code, measure_id, name_ru, name_en, name_ka, name_az } = req.body;
        const tableName = WORK_TABLES[String(country || '').toUpperCase()];
        if (!tableName) {
            return res.status(400).json({ error: 'Не указана страна (Азербайджан/Грузия)' });
        }
        if (!code || !name_ru || !measure_id) {
            return res.status(400).json({ error: 'Обязательные поля: code, measure_id, name_ru' });
        }

        const { data: existingCode } = await supabaseAdmin.from(tableName).select('id').eq('code', code).maybeSingle();
        if (existingCode) {
            return res.status(400).json({ error: 'Элемент с указанным кодом уже существует', code: 'CODE_EXISTS' });
        }

        const workId = crypto.randomUUID();

        const { data: anchorLoc, error: anchorErr } = await supabaseAdmin
            .from('localization')
            .insert({ object_name: tableName, object_id: workId, locale: 'ru', name: name_ru })
            .select('id')
            .single();
        if (anchorErr) throw anchorErr;

        const { error: workErr } = await supabaseAdmin
            .from(tableName)
            .insert({ id: workId, code, measure_id, name_id: anchorLoc.id });
        if (workErr) throw workErr;

        const extraLocs = [
            { locale: 'en', name: name_en },
            { locale: 'ka', name: name_ka },
            { locale: 'az', name: name_az },
        ].filter(l => l.name);
        if (extraLocs.length > 0) {
            const rows = extraLocs.map(l => ({ object_name: tableName, object_id: workId, locale: l.locale, name: l.name }));
            const { error: extraErr } = await supabaseAdmin.from('localization').insert(rows);
            if (extraErr) throw extraErr;
        }

        invalidateWorksCache(tableName);
        res.json({ message: 'Работа создана', id: workId, code, table: tableName });
    } catch (err) {
        console.error('[WORKS CREATE ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Обновить работу (код нередактируем — не принимается из тела запроса).
// Нужно знать таблицу (jobs/jobs_cas) — приходит вместе с формой, т.к. GET /works/list её отдаёт.
router.put('/works/:id', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { table, measure_id, name_ru, name_en, name_ka, name_az } = req.body;
        const tableName = (table === 'jobs' || table === 'jobs_cas') ? table : null;
        if (!tableName) {
            return res.status(400).json({ error: 'Не указана таблица работы (jobs/jobs_cas)' });
        }

        if (measure_id) {
            const { error: updErr } = await supabaseAdmin.from(tableName).update({ measure_id, updated_at: new Date().toISOString() }).eq('id', id);
            if (updErr) throw updErr;
        }

        const localeValues = { ru: name_ru, en: name_en, ka: name_ka, az: name_az };
        for (const [locale, name] of Object.entries(localeValues)) {
            if (!name) continue;
            const { data: existingLoc } = await supabaseAdmin
                .from('localization')
                .select('id')
                .eq('object_name', tableName)
                .eq('object_id', id)
                .eq('locale', locale)
                .maybeSingle();
            if (existingLoc) {
                await supabaseAdmin.from('localization').update({ name, updated_at: new Date().toISOString() }).eq('id', existingLoc.id);
            } else {
                await supabaseAdmin.from('localization').insert({ object_name: tableName, object_id: id, locale, name });
            }
        }

        invalidateWorksCache(tableName);
        res.json({ message: 'Работа обновлена', id });
    } catch (err) {
        console.error('[WORKS UPDATE ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Удалить (мягко деактивировать) работу — блокируем, если она используется в смете
router.delete('/works/:id', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const tableName = req.query.table === 'jobs_cas' ? 'jobs_cas' : (req.query.table === 'jobs' ? 'jobs' : null);
        if (!tableName) {
            return res.status(400).json({ error: 'Не указана таблица работы (jobs/jobs_cas)' });
        }

        // est_doc_works.work_id может указывать как на jobs, так и на jobs_cas —
        // проверяем использование в смете независимо от того, из какой это таблицы
        const { data: usage, error: usageErr } = await supabaseAdmin
            .from('est_doc_works')
            .select('id')
            .eq('work_id', id)
            .limit(1);
        if (usageErr) throw usageErr;

        if (usage && usage.length > 0) {
            return res.status(409).json({ error: 'Работа используется в смете', code: 'WORK_IN_USE' });
        }

        const { error } = await supabaseAdmin
            .from(tableName)
            .update({ is_active: false, deactivated_at: new Date().toISOString() })
            .eq('id', id);
        if (error) throw error;

        invalidateWorksCache(tableName);
        res.json({ message: 'Работа удалена из справочника', id });
    } catch (err) {
        console.error('[WORKS DELETE ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- РЕСУРСЫ ---

// Список ресурсов с фильтрами, пагинацией и ценой в разрезе региона.
// Реализует ТЗ "Ресурсы - Список ресурсов": фильтры (регион/код/название/тип/статус),
// пагинация (20/50/100, счётчики страниц), локализация по lang.
router.get('/resources/list', async (req, res) => {
    try {
        const {
            region_id,
            code = '',
            name = '',
            type_id,
            status = 'active', // 'active' | 'inactive' | 'all'
            page = '1',
            page_size = '20',
            lang = 'ru',
        } = req.query;

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const pageSize = [20, 50, 100].includes(parseInt(page_size, 10)) ? parseInt(page_size, 10) : 20;

        // Определяем страну по региону
        let country = 'GE';
        if (region_id) {
            const { data: reg } = await supabaseAdmin
                .from('dic_regions')
                .select('id, code, dic_countries(id, code)')
                .eq('id', region_id)
                .maybeSingle();
            if (reg?.dic_countries?.code) country = reg.dic_countries.code.toUpperCase();
        }
        const isAz = country === 'AZ';

        // 1. Фильтр по названию — если задан, находим подходящие ID через localization
        let matchedIds = null;
        if (name.trim()) {
            let locQuery = supabaseAdmin
                .from('localization')
                .select('object_id')
                .ilike('name', `%${name.trim()}%`);
            
            if (isAz) {
                locQuery = locQuery.in('object_name', ['Labor_cas', 'Machine_cas', 'Materials_cas']);
            } else {
                locQuery = locQuery.eq('object_name', 'resources');
            }

            const { data: locMatches, error: locMatchesErr } = await locQuery;
            
            if (locMatchesErr) {
                console.error('Error fetching localization matches:', locMatchesErr);
            }
            matchedIds = (locMatches || []).map(m => m.object_id);
            // Если ничего не нашлось, сразу отдаем пустой результат
            if (matchedIds.length === 0) {
                return res.json({
                    items: [],
                    total: 0,
                    page: pageNum,
                    pageSize,
                    totalPages: 1
                });
            }
        }

        let pageItems = [];
        let totalCount = 0;
        let totalPages = 1;
        let safePage = pageNum;

        if (isAz) {
            // Для Азербайджана (Баку)
            let targetCasTable = null;
            if (type_id) {
                const { data: typeRow } = await supabaseAdmin
                    .from('dic_resource_types')
                    .select('code')
                    .eq('id', type_id)
                    .maybeSingle();
                if (typeRow?.code === '10.100.') targetCasTable = 'Labor_cas';
                else if (typeRow?.code === '10.120.') targetCasTable = 'Machine_cas';
                else if (typeRow?.code === '10.130.') targetCasTable = 'Materials_cas';
            }

            if (targetCasTable) {
                let query = supabaseAdmin
                    .from(targetCasTable)
                    .select('id, code, is_active, type_id, measure_id, price, dic_measures(id, code), dic_resource_types(id, code)', { count: 'exact' });

                if (status === 'active') query = query.eq('is_active', true);
                if (status === 'inactive') query = query.eq('is_active', false);
                if (code.trim()) query = query.ilike('code', `%${code.trim()}%`);
                if (matchedIds) query = query.in('id', matchedIds);

                const startRange = (pageNum - 1) * pageSize;
                const endRange = pageNum * pageSize - 1;
                query = query.order('code').range(startRange, endRange);

                const { data: items, error: queryErr, count: total } = await query;
                if (queryErr) throw queryErr;

                pageItems = items || [];
                totalCount = total || 0;
                totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
                safePage = Math.min(pageNum, totalPages);
            } else {
                // Если тип не выбран — объединяем все три таблицы в памяти
                const [laborData, machineData, materialData] = await Promise.all([
                    supabaseAdmin.from('Labor_cas').select('id, code, is_active, type_id, measure_id, price, dic_measures(id, code), dic_resource_types(id, code)'),
                    supabaseAdmin.from('Machine_cas').select('id, code, is_active, type_id, measure_id, price, dic_measures(id, code), dic_resource_types(id, code)'),
                    supabaseAdmin.from('Materials_cas').select('id, code, is_active, type_id, measure_id, price, dic_measures(id, code), dic_resource_types(id, code)')
                ]);
                let combined = [
                    ...(laborData.data || []),
                    ...(machineData.data || []),
                    ...(materialData.data || [])
                ];

                if (status === 'active') combined = combined.filter(r => r.is_active === true);
                if (status === 'inactive') combined = combined.filter(r => r.is_active === false);
                if (code.trim()) combined = combined.filter(r => (r.code || '').toLowerCase().includes(code.trim().toLowerCase()));
                if (matchedIds) {
                    const matchedSet = new Set(matchedIds);
                    combined = combined.filter(r => matchedSet.has(r.id));
                }

                combined.sort((a, b) => (a.code || '').localeCompare(b.code || '', undefined, { numeric: true, sensitivity: 'base' }));

                totalCount = combined.length;
                totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
                safePage = Math.min(pageNum, totalPages);
                const startRange = (safePage - 1) * pageSize;
                pageItems = combined.slice(startRange, startRange + pageSize);
            }
        } else {
            // Для Грузии
            let query = supabaseAdmin
                .from('resources')
                .select('id, code, is_active, dic_measures(id, code), dic_resource_types(id, code)', { count: 'exact' });

            if (status === 'active') query = query.eq('is_active', true);
            if (status === 'inactive') query = query.eq('is_active', false);
            if (type_id) query = query.eq('type_id', type_id);
            if (code.trim()) query = query.ilike('code', `%${code.trim()}%`);
            if (matchedIds) query = query.in('id', matchedIds);

            const startRange = (pageNum - 1) * pageSize;
            const endRange = pageNum * pageSize - 1;
            query = query.order('code').range(startRange, endRange);

            const { data: items, error: queryErr, count: total } = await query;
            if (queryErr) throw queryErr;

            pageItems = items || [];
            totalCount = total || 0;
            totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
            safePage = Math.min(pageNum, totalPages);
        }

        if (pageItems.length === 0) {
            return res.json({
                items: [],
                total: totalCount,
                page: safePage,
                pageSize,
                totalPages
            });
        }

        // 3. Загружаем локализации ТОЛЬКО для элементов текущей страницы
        const pageObjectIds = pageItems.map(r => r.id);
        const locQuery = supabaseAdmin.from('localization')
            .select('object_id, locale, name')
            .in('object_name', isAz ? ['Labor_cas', 'Machine_cas', 'Materials_cas'] : ['resources'])
            .in('object_id', pageObjectIds);
            
        const typeLocQuery = supabaseAdmin.from('localization').select('object_id, locale, name').eq('object_name', 'dic_resource_types');
        const measureIds = Array.from(new Set(pageItems.map(r => r.dic_measures?.id).filter(Boolean)));
        const measureLocQuery = supabaseAdmin.from('localization').select('object_id, locale, name').eq('object_name', 'dic_measures').in('object_id', measureIds);

        const [locs, typeLocs, measureLocs] = await Promise.all([
            getAllRows(locQuery), getAllRows(typeLocQuery), getAllRows(measureLocQuery)
        ]);

        const buildMap = (rows) => {
            const map = {};
            rows.forEach(l => { if (!map[l.object_id]) map[l.object_id] = {}; map[l.object_id][l.locale] = l.name; });
            return map;
        };
        const nameMap = buildMap(locs);
        const typeMap = buildMap(typeLocs);
        const measureMap = buildMap(measureLocs);

        const pickLang = (names, fallbackCode) => (names && (names[lang] || names.ru || names.en)) || fallbackCode || '';

        let mapped = pageItems.map(r => {
            const names = nameMap[r.id] || {};
            const typeNames = typeMap[r.dic_resource_types?.id] || {};
            const measureNames = measureMap[r.dic_measures?.id] || {};
            return {
                id: r.id,
                code: r.code,
                name: pickLang(names, r.code),
                name_ru: names.ru || '',
                name_en: names.en || '',
                name_ka: names.ka || '',
                name_az: names.az || '',
                name_tr: names.tr || '',
                type_id: r.dic_resource_types?.id || null,
                type: pickLang(typeNames, r.dic_resource_types?.code),
                measure_id: r.dic_measures?.id || null,
                unit: pickLang(measureNames, r.dic_measures?.code),
                is_active: r.is_active ?? true
            };
        });

        // Получаем флаги активности, если статус не active (т.е. 'all' или 'inactive')
        if (status === 'all' || status === 'inactive') {
            const { data: activeFlags } = await supabaseAdmin.from('resources').select('id, is_active').in('id', pageObjectIds);
            const flagMap = {};
            (activeFlags || []).forEach(f => { flagMap[f.id] = f.is_active; });
            mapped = mapped.map(m => ({ ...m, is_active: flagMap[m.id] ?? true }));
        }

        // 4. Получаем цены для текущей страницы + название выбранного региона
        // (ресурс сам по себе не привязан к одному региону — цены у него по разным
        // регионам в resource_prices, поэтому колонка "Регион" в списке — это просто
        // регион, выбранный в фильтре, а не свойство самого ресурса)
        let regionName = null;
        if (region_id) {
            const { data: regionRow } = await supabaseAdmin.from('dic_regions').select('id, code').eq('id', region_id).maybeSingle();
            if (regionRow) {
                const { data: regionLocs } = await supabaseAdmin.from('localization').select('locale, name').eq('object_name', 'dic_regions').eq('object_id', regionRow.id);
                const regionNames = {};
                (regionLocs || []).forEach(l => { regionNames[l.locale] = l.name; });
                regionName = regionNames[lang] || regionNames.ru || regionNames.en || regionRow.code;
            }
        }

        if (pageItems.length > 0) {
            let priceQuery = supabaseAdmin
                .from('resource_prices')
                .select('resource_id, price, region_id, currency_id, dic_regions(id, code), dic_currencies(code, symbol)')
                .in('resource_id', pageObjectIds)
                .eq('is_active', true)
                .order('valid_from', { ascending: false });

            if (region_id) {
                priceQuery = priceQuery.eq('region_id', region_id);
            }

            const { data: prices } = await priceQuery;

            // Собираем все уникальные регионы из полученных цен
            const uniqueRegionIds = Array.from(new Set((prices || []).map(p => p.region_id).filter(Boolean)));
            const regionLocMap = {};
            if (uniqueRegionIds.length > 0) {
                const { data: regionLocs } = await supabaseAdmin
                    .from('localization')
                    .select('object_id, locale, name')
                    .eq('object_name', 'dic_regions')
                    .in('object_id', uniqueRegionIds);
                
                (regionLocs || []).forEach(l => {
                    if (!regionLocMap[l.object_id]) regionLocMap[l.object_id] = {};
                    regionLocMap[l.object_id][l.locale] = l.name;
                });
            }

            const pickRegionName = (p) => {
                if (!p.region_id) return null;
                const rNames = regionLocMap[p.region_id] || {};
                return rNames[lang] || rNames.ru || rNames.en || p.dic_regions?.code || null;
            };

            const resourcePricesMap = {};
            (prices || []).forEach(p => {
                if (!resourcePricesMap[p.resource_id]) resourcePricesMap[p.resource_id] = [];
                // Предотвращаем дубли по регионам (берем только последнюю активную цену)
                if (!resourcePricesMap[p.resource_id].some(existing => existing.region_id === p.region_id)) {
                    resourcePricesMap[p.resource_id].push({
                        price: Number(p.price),
                        region_id: p.region_id,
                        region: pickRegionName(p),
                        currency: p.dic_currencies?.symbol || p.dic_currencies?.code || null
                    });
                }
            });

            mapped.forEach(item => {
                const plist = resourcePricesMap[item.id] || [];
                item.pricesList = plist;
                if (region_id) {
                    const matchedPrice = plist.find(p => p.region_id === region_id);
                    if (matchedPrice) {
                        item.price = matchedPrice.price;
                        item.currency = matchedPrice.currency;
                        item.region = matchedPrice.region;
                    } else if (isAz) {
                        const basePrice = pageItems.find(pi => pi.id === item.id)?.price;
                        item.price = basePrice !== undefined ? Number(basePrice) : null;
                        item.currency = '₼';
                        item.region = regionName || 'Баку';
                    } else {
                        item.price = null;
                        item.currency = null;
                        item.region = null;
                    }
                } else {
                    if (isAz) {
                        const basePrice = pageItems.find(pi => pi.id === item.id)?.price;
                        item.price = basePrice !== undefined ? Number(basePrice) : null;
                        item.currency = '₼';
                        item.region = 'Азербайджан';
                    } else {
                        item.price = null;
                        item.currency = null;
                        item.region = null;
                    }
                }
            });
        } else {
            mapped.forEach(item => {
                item.pricesList = [];
                if (isAz) {
                    const basePrice = pageItems.find(pi => pi.id === item.id)?.price;
                    item.price = basePrice !== undefined ? Number(basePrice) : null;
                    item.currency = '₼';
                    item.region = 'Азербайджан';
                } else {
                    item.price = null;
                    item.currency = null;
                    item.region = null;
                }
            });
        }

        res.json({
            items: mapped,
            total: totalCount,
            page: safePage,
            pageSize,
            totalPages,
        });
    } catch (err) {
        console.error('[RESOURCES LIST ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

const typeMapping = {
    '10.100.': 'labor',
    '10.120.': 'machine',
    '10.130.': 'material'
};

// Получить первые 100 ресурсов (или отфильтрованные по типу с более высоким лимитом)
router.get('/resources', async (req, res) => {
    try {
        const { type } = req.query; // '10.100.', '10.120.', '10.130.'
        const regionId = req.query.region_id;
        let country = (req.query.country || req.query.country_code || '').toUpperCase();

        // Авто-определение страны по region_id, если параметр страны не передан впрямую
        if (!country && regionId) {
            const { data: reg } = await supabaseAdmin
                .from('dic_regions')
                .select('id, code, dic_countries(id, code)')
                .eq('id', regionId)
                .single();
            if (reg?.dic_countries?.code) {
                country = reg.dic_countries.code.toUpperCase();
            }
        }
        if (!country) country = 'GE';

        const isAz = country === 'AZ';

        let resources = [];
        if (isAz) {
            if (type) {
                let targetCasTable = 'Materials_cas';
                if (type === '10.100.') targetCasTable = 'Labor_cas';
                if (type === '10.120.') targetCasTable = 'Machine_cas';

                const { data: typeRow } = await supabaseAdmin
                    .from('dic_resource_types')
                    .select('id')
                    .eq('code', type)
                    .single();

                let query = supabaseAdmin
                    .from(targetCasTable)
                    .select('id, code, dic_measures(id, code), dic_resource_types(id, code)')
                    .order('code');

                if (typeRow) {
                    query = query.eq('type_id', typeRow.id);
                }
                
                if (type === '10.130.') query = query.limit(300);
                else query = query.limit(100);

                const { data, error } = await query;
                if (error) throw error;
                resources = data || [];
            } else {
                const [labor, machine, material] = await Promise.all([
                    supabaseAdmin.from('Labor_cas').select('id, code, dic_measures(id, code), dic_resource_types(id, code)').limit(50),
                    supabaseAdmin.from('Machine_cas').select('id, code, dic_measures(id, code), dic_resource_types(id, code)').limit(50),
                    supabaseAdmin.from('Materials_cas').select('id, code, dic_measures(id, code), dic_resource_types(id, code)').limit(50)
                ]);
                resources = [
                    ...(labor.data || []),
                    ...(machine.data || []),
                    ...(material.data || [])
                ];
            }
        } else {
            let queryBuilder = supabaseAdmin
                .from('resources')
                .select('id, code, dic_measures(id, code), dic_resource_types(id, code)')
                .eq('is_active', true)
                .order('code');

            if (type) {
                const { data: typeRow } = await supabaseAdmin
                    .from('dic_resource_types')
                    .select('id')
                    .eq('code', type)
                    .single();
                if (typeRow) {
                    queryBuilder = queryBuilder.eq('type_id', typeRow.id);
                }
                if (type === '10.130.') {
                    queryBuilder = queryBuilder.limit(300); // для материалов лимит 300
                }
            } else {
                queryBuilder = queryBuilder.limit(100);
            }

            const { data, error } = await queryBuilder;
            if (error) throw error;
            resources = data || [];
        }

        const ids = resources.map(r => r.id);
        const objectNames = isAz ? ['Labor_cas', 'Machine_cas', 'Materials_cas'] : ['resources'];
        const { data: locs, error: locErr } = await supabaseAdmin
            .from('localization')
            .select('object_id, locale, name')
            .in('object_name', objectNames)
            .in('object_id', ids);
        if (locErr) throw locErr;

        const allTypeIds = Array.from(new Set(resources.map(r => r.dic_resource_types?.id).filter(Boolean)));
        const { data: typeLocs } = allTypeIds.length > 0 ? await supabaseAdmin
            .from('localization')
            .select('object_id, locale, name')
            .eq('object_name', 'dic_resource_types')
            .in('object_id', allTypeIds) : { data: [] };

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

        const result = resources.map(r => {
            const names = locMap[r.id] || {};
            const typeId = r.dic_resource_types?.id;
            const typeNames = typeLocMap[typeId] || {};
            const measureId = r.dic_measures?.id;
            const unitNames = measureLocMap[measureId] || {};
            return {
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

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ПОИСК ресурсов по имени (на всех языках) и по коду
router.get('/resources/search', async (req, res) => {
    try {
        const { q, type } = req.query;
        const country = (req.query.country || req.query.country_code || '').toUpperCase();
        const isAz = country === 'AZ';
        if (!q || q.length < 2) return res.json([]);

        let uniqueIds = [];

        if (isAz) {
            const [laborCode, machineCode, materialCode] = await Promise.all([
                supabaseAdmin.from('Labor_cas').select('id').ilike('code', `%${q}%`).limit(30),
                supabaseAdmin.from('Machine_cas').select('id').ilike('code', `%${q}%`).limit(30),
                supabaseAdmin.from('Materials_cas').select('id').ilike('code', `%${q}%`).limit(30)
            ]);
            const codeIds = [
                ...(laborCode.data || []),
                ...(machineCode.data || []),
                ...(materialCode.data || [])
            ].map(r => r.id);

            const { data: resByName } = await supabaseAdmin
                .from('localization')
                .select('object_id')
                .in('object_name', ['Labor_cas', 'Machine_cas', 'Materials_cas'])
                .ilike('name', `%${q}%`)
                .limit(50);
            const nameIds = (resByName || []).map(l => l.object_id);
            uniqueIds = [...new Set([...codeIds, ...nameIds])].slice(0, 50);
        } else {
            const { data: resByCode } = await supabaseAdmin
                .from('resources')
                .select('id')
                .ilike('code', `%${q}%`)
                .limit(50);
            const { data: resByName } = await supabaseAdmin
                .from('localization')
                .select('object_id')
                .eq('object_name', 'resources')
                .ilike('name', `%${q}%`)
                .limit(50);
            const codeIds = (resByCode || []).map(r => r.id);
            const nameIds = (resByName || []).map(l => l.object_id);
            uniqueIds = [...new Set([...codeIds, ...nameIds])].slice(0, 50);
        }

        if (uniqueIds.length === 0) return res.json([]);

        let resources = [];
        if (isAz) {
            const [laborRes, machineRes, materialRes] = await Promise.all([
                supabaseAdmin.from('Labor_cas').select('id, code, dic_measures(id, code), dic_resource_types(id, code)').in('id', uniqueIds),
                supabaseAdmin.from('Machine_cas').select('id, code, dic_measures(id, code), dic_resource_types(id, code)').in('id', uniqueIds),
                supabaseAdmin.from('Materials_cas').select('id, code, dic_measures(id, code), dic_resource_types(id, code)').in('id', uniqueIds)
            ]);
            let merged = [
                ...(laborRes.data || []),
                ...(machineRes.data || []),
                ...(materialRes.data || [])
            ];
            if (type) {
                merged = merged.filter(r => r.dic_resource_types?.code === type);
            }
            resources = merged;
        } else {
            let queryBuilder = supabaseAdmin
                .from('resources')
                .select('id, code, dic_measures(id, code), dic_resource_types(id, code)')
                .eq('is_active', true)
                .in('id', uniqueIds);

            if (type) {
                const { data: typeRow } = await supabaseAdmin
                    .from('dic_resource_types')
                    .select('id')
                    .eq('code', type)
                    .single();
                if (typeRow) {
                    queryBuilder = queryBuilder.eq('type_id', typeRow.id);
                }
            }

            const { data, error: rErr } = await queryBuilder;
            if (rErr) throw rErr;
            resources = data || [];
        }

        const objectNames = isAz ? ['Labor_cas', 'Machine_cas', 'Materials_cas'] : ['resources'];
        const { data: locs, error: locsErr } = await supabaseAdmin
            .from('localization')
            .select('object_id, locale, name')
            .in('object_name', objectNames)
            .in('object_id', uniqueIds);
        if (locsErr) throw locsErr;

        // Раньше здесь тянулись ВСЕ строки localization для dic_resource_types/dic_measures
        // без фильтра — при частых вызовах (например, на каждое нажатие клавиши в поиске)
        // это било по производительности. Сужаем до реально встретившихся id.
        const typeIds = [...new Set(resources.map(r => r.dic_resource_types?.id).filter(Boolean))];
        const measureIds = [...new Set(resources.map(r => r.dic_measures?.id).filter(Boolean))];

        const { data: typeLocs } = typeIds.length > 0
            ? await supabaseAdmin.from('localization').select('object_id, locale, name').eq('object_name', 'dic_resource_types').in('object_id', typeIds)
            : { data: [] };

        const { data: measureLocs } = measureIds.length > 0
            ? await supabaseAdmin.from('localization').select('object_id, locale, name').eq('object_name', 'dic_measures').in('object_id', measureIds)
            : { data: [] };

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

        const result = resources.map(r => {
            const names = locMap[r.id] || {};
            const typeId = r.dic_resource_types?.id;
            const typeNames = typeLocMap[typeId] || {};
            const measureId = r.dic_measures?.id;
            const unitNames = measureLocMap[measureId] || {};
            return {
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

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Типы ресурсов — нужен для выбора в форме создания ресурса
router.get('/resource-types', async (req, res) => {
    try {
        const { data: types, error } = await supabaseAdmin.from('dic_resource_types').select('id, code').eq('is_active', true);
        if (error) throw error;

        const { data: locs } = await supabaseAdmin
            .from('localization')
            .select('object_id, locale, name')
            .eq('object_name', 'dic_resource_types');

        const locMap = {};
        (locs || []).forEach(l => {
            if (!locMap[l.object_id]) locMap[l.object_id] = {};
            locMap[l.object_id][l.locale] = l.name;
        });

        const result = types.map(t => {
            const names = locMap[t.id] || {};
            return { id: t.id, code: t.code, name: names.ru || names.en || t.code };
        });

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Создать ресурс
router.post('/resources', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { code, type_id, measure_id, name_ru, name_en, name_ka, name_az, name_tr, region_id, price } = req.body;
        if (!code || !type_id || !measure_id || !name_ru) {
            return res.status(400).json({ error: 'Обязательные поля: code, type_id, measure_id, name_ru' });
        }

        const { data: existingCode } = await supabaseAdmin.from('resources').select('id').eq('code', code).maybeSingle();
        if (existingCode) {
            return res.status(400).json({ error: 'Элемент с указанным кодом уже существует', code: 'CODE_EXISTS' });
        }

        // Проверка уникальности наименования (по русской локали, среди активных ресурсов)
        const { data: existingNameLoc } = await supabaseAdmin
            .from('localization')
            .select('object_id')
            .eq('object_name', 'resources')
            .eq('locale', 'ru')
            .eq('name', name_ru);
        if (existingNameLoc && existingNameLoc.length > 0) {
            const ids = existingNameLoc.map(l => l.object_id);
            const { data: activeMatch } = await supabaseAdmin.from('resources').select('id').in('id', ids).eq('is_active', true).limit(1);
            if (activeMatch && activeMatch.length > 0) {
                return res.status(400).json({ error: 'Элемент с указанным наименованием уже существует', code: 'NAME_EXISTS' });
            }
        }

        const resourceId = crypto.randomUUID();

        const { data: anchorLoc, error: anchorErr } = await supabaseAdmin
            .from('localization')
            .insert({ object_name: 'resources', object_id: resourceId, locale: 'ru', name: name_ru })
            .select('id')
            .single();
        if (anchorErr) throw anchorErr;

        const insertPayload = { id: resourceId, code, type_id, measure_id, name_id: anchorLoc.id };

        const { data: resource, error: resErr } = await supabaseAdmin
            .from('resources')
            .insert(insertPayload)
            .select('id, code')
            .single();
        if (resErr) throw resErr;

        const extraLocs = [
            { locale: 'en', name: name_en },
            { locale: 'ka', name: name_ka },
            { locale: 'az', name: name_az },
            { locale: 'tr', name: name_tr },
        ].filter(l => l.name);
        if (extraLocs.length > 0) {
            const rows = extraLocs.map(l => ({ object_name: 'resources', object_id: resourceId, locale: l.locale, name: l.name }));
            const { error: extraErr } = await supabaseAdmin.from('localization').insert(rows);
            if (extraErr) throw extraErr;
        }

        // Если указан регион и цена — сразу создаём первую запись цены для этого ресурса
        if (region_id && price !== undefined && price !== null && price !== '') {
            const { data: region } = await supabaseAdmin.from('dic_regions').select('country_id').eq('id', region_id).maybeSingle();
            const { data: country } = region
                ? await supabaseAdmin.from('dic_countries').select('currency_id').eq('id', region.country_id).maybeSingle()
                : { data: null };

            if (country?.currency_id) {
                await supabaseAdmin.from('resource_prices').insert({
                    resource_id: resourceId,
                    region_id,
                    currency_id: country.currency_id,
                    price: Number(price),
                    valid_from: new Date().toISOString(),
                });
            }
        }

        res.json({ message: 'Ресурс создан', id: resourceId, code: resource.code });
    } catch (err) {
        console.error('[RESOURCES CREATE ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Подсказка следующего кода для нового ресурса (для Грузии — по типу ресурса)
router.get('/resources/suggest-code', async (req, res) => {
    try {
        const { type_id } = req.query;
        if (!type_id) return res.status(400).json({ error: 'Не передан type_id' });

        const { data: siblings, error } = await supabaseAdmin.from('resources').select('code').eq('type_id', type_id);
        if (error) throw error;

        const numericCodes = (siblings || [])
            .map(s => parseInt(String(s.code).replace(/[^0-9]/g, ''), 10))
            .filter(n => !isNaN(n));

        const nextCode = numericCodes.length > 0 ? Math.max(...numericCodes) + 1 : 1;
        res.json({ suggested_code: String(nextCode) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Обновить ресурс
router.put('/resources/:id', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        // code сознательно не принимается из тела запроса — при редактировании
        // ресурса код нередактируем, даже если клиент его всё же пришлёт
        const { type_id, measure_id, name_ru, name_en, name_ka, name_az, name_tr } = req.body;

        if (name_ru) {
            const { data: existingNameLoc } = await supabaseAdmin
                .from('localization')
                .select('object_id')
                .eq('object_name', 'resources')
                .eq('locale', 'ru')
                .eq('name', name_ru);
            if (existingNameLoc && existingNameLoc.length > 0) {
                const otherIds = existingNameLoc.map(l => l.object_id).filter(oid => oid !== id);
                if (otherIds.length > 0) {
                    const { data: activeMatch } = await supabaseAdmin.from('resources').select('id').in('id', otherIds).eq('is_active', true).limit(1);
                    if (activeMatch && activeMatch.length > 0) {
                        return res.status(400).json({ error: 'Элемент с указанным наименованием уже существует', code: 'NAME_EXISTS' });
                    }
                }
            }
        }

        if (type_id || measure_id) {
            const updatePayload = { updated_at: new Date().toISOString() };
            if (type_id) updatePayload.type_id = type_id;
            if (measure_id) updatePayload.measure_id = measure_id;
            const { error: updErr } = await supabaseAdmin.from('resources').update(updatePayload).eq('id', id);
            if (updErr) throw updErr;
        }

        const localeValues = { ru: name_ru, en: name_en, ka: name_ka, az: name_az, tr: name_tr };
        for (const [locale, name] of Object.entries(localeValues)) {
            if (!name) continue;
            const { data: existingLoc } = await supabaseAdmin
                .from('localization')
                .select('id')
                .eq('object_name', 'resources')
                .eq('object_id', id)
                .eq('locale', locale)
                .maybeSingle();
            if (existingLoc) {
                await supabaseAdmin.from('localization').update({ name, updated_at: new Date().toISOString() }).eq('id', existingLoc.id);
            } else {
                await supabaseAdmin.from('localization').insert({ object_name: 'resources', object_id: id, locale, name });
            }
        }

        res.json({ message: 'Ресурс обновлён', id });
    } catch (err) {
        console.error('[RESOURCES UPDATE ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Удалить (мягко деактивировать) ресурс
router.delete('/resources/:id', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // Проверяем, используется ли ресурс хотя бы в одной смете — независимо от
        // статуса сметы и от того, помечена ли строка как исключённая (по ТЗ:
        // "если ресурс уже добавлен в какой-нибудь смете... система не удаляет его")
        const { data: usage, error: usageErr } = await supabaseAdmin
            .from('est_doc_resources')
            .select('id')
            .eq('resource_id', id)
            .limit(1);
        if (usageErr) throw usageErr;

        if (usage && usage.length > 0) {
            return res.status(409).json({ error: 'Ресурс добавлен в смете', code: 'RESOURCE_IN_USE' });
        }

        const { error } = await supabaseAdmin
            .from('resources')
            .update({ is_active: false, deactivated_at: new Date().toISOString() })
            .eq('id', id);
        if (error) throw error;
        res.json({ message: 'Ресурс успешно удален из справочника', id });
    } catch (err) {
        console.error('[RESOURCES DELETE ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- ЦЕНЫ ---

// Цены из Supabase (resource_prices)
router.get('/prices', async (req, res) => {
    try {
        const { resource_id, region_id, currency_id } = req.query;

        if (resource_id) {
            // Check if it is a Baku resource
            const [labor, machine, material] = await Promise.all([
                supabaseAdmin.from('Labor_cas').select('price').eq('id', resource_id).single(),
                supabaseAdmin.from('Machine_cas').select('price').eq('id', resource_id).single(),
                supabaseAdmin.from('Materials_cas').select('price').eq('id', resource_id).single()
            ]);
            const foundRow = labor.data || machine.data || material.data;
            if (foundRow) {
                const price = Number(foundRow.price || 0);
                return res.json({ resource_id, price });
            }

            let query = supabaseAdmin
                .from('resource_prices')
                .select('price, valid_from')
                .eq('resource_id', String(resource_id))
                .eq('is_active', true);
            
            if (region_id) query = query.eq('region_id', region_id);
            if (currency_id) query = query.eq('currency_id', currency_id);

            const { data, error } = await query
                .order('valid_from', { ascending: false })
                .limit(1);

            if (error) throw error;
            let price = Number(data?.[0]?.price);
            
            // Fallback if not found:
            if (isNaN(price)) {
                const { data: fb } = await supabaseAdmin
                    .from('resource_prices')
                    .select('price')
                    .eq('resource_id', String(resource_id))
                    .eq('is_active', true)
                    .order('valid_from', { ascending: false })
                    .limit(1);
                price = Number(fb?.[0]?.price ?? 0);
            }

            return res.json({
                resource_id: String(resource_id),
                price,
                found: true
            });
        }

        const { data, error } = await supabaseAdmin
            .from('resource_prices')
            .select('resource_id, price, valid_from')
            .eq('is_active', true)
            .order('valid_from', { ascending: false });

        if (error) throw error;

        const uniquePrices = {};
        (data || []).forEach(item => {
            const rid = String(item.resource_id);
            if (!uniquePrices[rid]) {
                uniquePrices[rid] = Number(item.price) || 0;
            }
        });

        res.json(uniquePrices);
    } catch (err) {
        console.error('[DICTIONARIES PRICES ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Получить одну цену
router.get('/prices/by-resource/:resourceId', async (req, res) => {
    try {
        const { resourceId } = req.params;
        const { data, error } = await supabaseAdmin
            .from('resource_prices')
            .select('price, valid_from')
            .eq('resource_id', String(resourceId))
            .eq('is_active', true)
            .order('valid_from', { ascending: false })
            .limit(1);

        if (error) throw error;
        res.json({
            resource_id: String(resourceId),
            price: Number(data?.[0]?.price ?? 0),
            found: data != null && data.length > 0
        });
    } catch (err) {
        console.error('[DICTIONARIES PRICE ONE ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Установить/изменить цену ресурса.
// Для ресурсов Баку (Labor_cas/Machine_cas/Materials_cas) цена — колонка прямо в таблице ресурса.
// Для ресурсов Грузии — новая активная запись в resource_prices (история по valid_from сохраняется).
router.put('/prices/:resourceId', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin' && req.user.role !== 'pricer') {
            return res.status(403).json({ error: 'Недостаточно прав — изменение цены доступно только администратору или ценовику' });
        }

        const { resourceId } = req.params;
        const price = Number(req.body.price);
        const { region_id, currency_id } = req.body;

        if (req.body.price === undefined || req.body.price === null || req.body.price === '') {
            return res.status(400).json({ error: 'Укажите цену ресурса' });
        }
        if (isNaN(price) || price < 0) {
            return res.status(400).json({ error: 'Цена не может быть отрицательной или некорректной' });
        }

        let oldPrice = null;
        let isCas = false;
        let activeCasTable = null;

        // 1. Проверяем ресурсы Баку
        for (const casTable of ['Labor_cas', 'Machine_cas', 'Materials_cas']) {
            const { data: found } = await supabaseAdmin.from(casTable).select('id, price').eq('id', resourceId).maybeSingle();
            if (found) {
                oldPrice = found.price !== null ? Number(found.price) : null;
                isCas = true;
                activeCasTable = casTable;
                break;
            }
        }

        // Проверка привязки регионов для роли pricer
        if (req.user.role === 'pricer') {
            const { data: allowedRegions, error: relErr } = await supabaseAdmin
                .from('profile_regions')
                .select('region_id, dic_regions(country_id, dic_countries(code))')
                .eq('profile_id', req.user.id);
            
            if (relErr) throw relErr;

            const allowedIds = (allowedRegions || []).map(r => r.region_id);
            const allowedCountries = (allowedRegions || []).map(r => r.dic_regions?.dic_countries?.code?.toUpperCase()).filter(Boolean);

            if (isCas) {
                if (!allowedCountries.includes('AZ')) {
                    return res.status(403).json({ error: 'У вас нет прав на редактирование цен ресурсов Азербайджана (Баку)' });
                }
            } else {
                if (region_id && !allowedIds.includes(region_id)) {
                    return res.status(403).json({ error: 'У вас нет прав на изменение цен в этом регионе' });
                }
                if (!region_id) {
                    return res.status(400).json({ error: 'Укажите конкретный регион для изменения цены' });
                }
            }
        }

        if (isCas && activeCasTable) {
            if (oldPrice !== null && Number(oldPrice) === Number(price)) {
                return res.json({ resource_id: resourceId, price, message: 'Цена совпадает с текущей. Изменения не требуются.', is_same: true });
            }
            const { error: updErr } = await supabaseAdmin.from(activeCasTable).update({ price }).eq('id', resourceId);
            if (updErr) throw updErr;

            // Логируем изменение в историю цен для Баку (region_id = null)
            const historyPayload = {
                resource_id: resourceId,
                region_id: null,
                old_price: oldPrice,
                new_price: price,
                changed_by: null,
                changed_at: new Date().toISOString()
            };

            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (req.user?.id && uuidRegex.test(req.user.id)) {
                const { data: userExists } = await supabaseAdmin.from('profiles').select('id').eq('id', req.user.id).maybeSingle();
                if (userExists) {
                    historyPayload.changed_by = req.user.id;
                }
            }

            const { error: histErr } = await supabaseAdmin.from('resource_price_history').insert(historyPayload);
            if (histErr) {
                console.error('[BAKU PRICE HISTORY LOG ERROR]:', histErr.message);
            }

            return res.json({ resource_id: resourceId, price, table: activeCasTable });
        }

        // 2. Для ресурсов Грузии (через таблицу resource_prices)
        // Получаем предыдущую активную цену
        const { data: oldPriceRow } = await supabaseAdmin
            .from('resource_prices')
            .select('price')
            .eq('resource_id', resourceId)
            .eq('region_id', region_id || null)
            .eq('is_active', true)
            .order('valid_from', { ascending: false })
            .limit(1)
            .maybeSingle();

        oldPrice = oldPriceRow ? Number(oldPriceRow.price) : null;

        if (oldPrice !== null && Number(oldPrice) === Number(price)) {
            return res.json({ resource_id: resourceId, price, message: 'Цена совпадает с текущей. Изменения не требуются.', is_same: true });
        }

        let resolvedCurrencyId = currency_id || null;
        if (!resolvedCurrencyId && region_id) {
            const { data: sameRegionPrice } = await supabaseAdmin
                .from('resource_prices')
                .select('currency_id')
                .eq('region_id', region_id)
                .eq('is_active', true)
                .limit(1)
                .maybeSingle();
            resolvedCurrencyId = sameRegionPrice?.currency_id || null;
        }
        if (!resolvedCurrencyId && region_id) {
            const { data: reg } = await supabaseAdmin.from('dic_regions').select('dic_countries(code)').eq('id', region_id).maybeSingle();
            const countryCode = reg?.dic_countries?.code?.toUpperCase();
            const currencyCode = countryCode === 'AZ' ? 'AZN' : countryCode === 'GE' ? 'GEL' : null;
            if (currencyCode) {
                const { data: curr } = await supabaseAdmin.from('dic_currencies').select('id').eq('code', currencyCode).maybeSingle();
                resolvedCurrencyId = curr?.id || null;
            }
        }
        if (!resolvedCurrencyId) {
            return res.status(400).json({ error: 'Не удалось определить валюту — передайте currency_id' });
        }

        // Деактивируем предыдущие цены в этом регионе
        await supabaseAdmin
            .from('resource_prices')
            .update({ is_active: false, valid_to: new Date().toISOString() })
            .eq('resource_id', resourceId)
            .eq('region_id', region_id || null)
            .eq('is_active', true);

        // Вставляем новую актуальную цену
        const { error: insErr } = await supabaseAdmin.from('resource_prices').insert({
            resource_id: String(resourceId),
            region_id: region_id || null,
            currency_id: resolvedCurrencyId,
            price,
            valid_from: new Date().toISOString(),
            is_active: true,
        });
        if (insErr) throw insErr;

        // Логируем изменение в историю цен
        const historyPayload = {
            resource_id: resourceId,
            region_id: region_id || null,
            old_price: oldPrice,
            new_price: price,
            changed_by: null,
            changed_at: new Date().toISOString()
        };

        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (req.user?.id && uuidRegex.test(req.user.id)) {
            const { data: userExists } = await supabaseAdmin.from('profiles').select('id').eq('id', req.user.id).maybeSingle();
            if (userExists) {
                historyPayload.changed_by = req.user.id;
            }
        }

        const { error: histErr } = await supabaseAdmin.from('resource_price_history').insert(historyPayload);
        if (histErr) {
            console.error('[GEORGIA PRICE HISTORY LOG ERROR]:', histErr.message);
        }

        res.json({ resource_id: resourceId, price, table: 'resource_prices' });
    } catch (err) {
        console.error('[DICTIONARIES PRICE UPDATE ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/dictionaries/profile/regions — получить список разрешенных регионов текущего ценовика
router.get('/profile/regions', authMiddleware, async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('profile_regions')
            .select('region_id')
            .eq('profile_id', req.user.id);
        
        if (error) throw error;
        res.json(data ? data.map(d => d.region_id) : []);
    } catch (err) {
        console.error('[PROFILE REGIONS FETCH ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/dictionaries/prices/:resourceId/history — получить историю изменения цен
router.get('/prices/:resourceId/history', authMiddleware, async (req, res) => {
    try {
        const { resourceId } = req.params;
        const { region_id } = req.query;

        // Проверяем, принадлежит ли ресурс к Азербайджану (CAS)
        const [labor, machine, material] = await Promise.all([
            supabaseAdmin.from('Labor_cas').select('id').eq('id', resourceId).maybeSingle(),
            supabaseAdmin.from('Machine_cas').select('id').eq('id', resourceId).maybeSingle(),
            supabaseAdmin.from('Materials_cas').select('id').eq('id', resourceId).maybeSingle()
        ]);
        const isCas = !!(labor.data || machine.data || material.data);

        let query = supabaseAdmin
            .from('resource_price_history')
            .select(`
                id,
                resource_id,
                region_id,
                old_price,
                new_price,
                changed_at,
                changed_by,
                dic_regions(id, code),
                profiles:changed_by (first_name, last_name)
            `)
            .eq('resource_id', resourceId)
            .order('changed_at', { ascending: false });

        if (isCas) {
            query = query.is('region_id', null);
        } else if (region_id && region_id !== '') {
            if (region_id === 'null') {
                query = query.is('region_id', null);
            } else {
                query = query.eq('region_id', region_id);
            }
        }

        const { data, error } = await query;
        if (error) throw error;

        // Локализация регионов для вывода в истории
        const uniqueRegionIds = Array.from(new Set((data || []).map(h => h.region_id).filter(Boolean)));
        let regionLocMap = {};
        if (uniqueRegionIds.length > 0) {
            const { data: regionLocs } = await supabaseAdmin
                .from('localization')
                .select('object_id, locale, name')
                .eq('object_name', 'dic_regions')
                .in('object_id', uniqueRegionIds);
            
            (regionLocs || []).forEach(l => {
                if (!regionLocMap[l.object_id]) regionLocMap[l.object_id] = {};
                regionLocMap[l.object_id][l.locale] = l.name;
            });
        }

        const lang = req.query.lang || 'ru';
        const mapped = (data || []).map(h => {
            let regionName = 'Баку';
            if (h.region_id) {
                const rNames = regionLocMap[h.region_id] || {};
                regionName = rNames[lang] || rNames.ru || rNames.en || h.dic_regions?.code || 'Грузия';
            }
            return {
                ...h,
                region_name: regionName
            };
        });

        res.json(mapped);
    } catch (err) {
        console.error('[PRICE HISTORY ERROR]:', err);
        res.status(500).json({ 
            error: err.message, 
            stack: err.stack,
            details: err.details || null,
            hint: err.hint || null,
            code: err.code || null
        });
    }
});

// --- НОРМАТИВЫ ---

// Получить нормативы для конкретной работы (с локализацией связанных ресурсов)
router.get('/norms/:workId', async (req, res) => {
    try {
        const { workId } = req.params;
        const country = (req.query.country_code || req.query.country || '').toUpperCase();
        const isAz = country === 'AZ';

        const normsTable = isAz ? 'jobs_norms_cas' : 'job_resource_norms';
        
        // Получаем нормативы работы
        const { data: norms, error } = await supabaseAdmin
            .from(normsTable)
            .select('id, job_id, resource_id, value_number')
            .eq('job_id', workId);
        
        if (error) throw error;
        if (!norms || norms.length === 0) return res.json([]);

        const resourceIds = norms.map(n => n.resource_id);
        
        let resources = [];
        let locs = [];
        if (isAz) {
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
            const { data: locData } = await supabaseAdmin
                .from('localization')
                .select('object_id, locale, name')
                .in('object_name', ['Labor_cas', 'Machine_cas', 'Materials_cas'])
                .in('object_id', resourceIds);
            locs = locData || [];
        } else {
            // Получаем детали ресурсов (Грузия)
            const { data: resData, error: rErr } = await supabaseAdmin
                .from('resources')
                .select('id, code, dic_measures(id, code), dic_resource_types(id, code)')
                .in('id', resourceIds);
            if (rErr) throw rErr;
            resources = resData || [];

            // Получаем переводы ресурсов (Грузия)
            const { data: locData, error: locErr } = await supabaseAdmin
                .from('localization')
                .select('object_id, locale, name')
                .eq('object_name', 'resources')
                .in('object_id', resourceIds);
            if (locErr) throw locErr;
            locs = locData || [];
        }

        const { data: typeLocs } = await supabaseAdmin
            .from('localization')
            .select('object_id, locale, name')
            .eq('object_name', 'dic_resource_types');

        const { data: measureLocs } = await supabaseAdmin
            .from('localization')
            .select('object_id, locale, name')
            .eq('object_name', 'dic_measures');

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

        const result = norms.map(n => {
            const resDetails = resMap[n.resource_id] || {};
            return {
                id: n.id,
                work_id: n.job_id,
                resource_id: n.resource_id,
                norm: Number(n.value_number) || 0,
                est_resources: resDetails
            };
        });

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Добавить норму (ресурс + расход на работу)
router.post('/norms', authMiddleware, requireManager, async (req, res) => {
    try {
        const { work_id, resource_id, norm } = req.body;
        if (!work_id || !resource_id || norm === undefined || norm === null) {
            return res.status(400).json({ error: 'Обязательные поля: work_id, resource_id, norm' });
        }

        const { data: existing } = await supabaseAdmin
            .from('job_resource_norms')
            .select('id')
            .eq('job_id', work_id)
            .eq('resource_id', resource_id)
            .maybeSingle();
        if (existing) {
            return res.status(400).json({ error: 'Этот ресурс уже добавлен в нормы этой работы — отредактируйте существующую запись' });
        }

        // measure_id берём с самого ресурса (единица, в которой указывается норма расхода)
        const { data: resource, error: resErr } = await supabaseAdmin.from('resources').select('measure_id').eq('id', resource_id).single();
        if (resErr) throw resErr;

        const { data: created, error } = await supabaseAdmin
            .from('job_resource_norms')
            .insert({ job_id: work_id, resource_id, measure_id: resource.measure_id, value_number: norm })
            .select('id')
            .single();
        if (error) throw error;

        res.json({ message: 'Норма добавлена', id: created.id });
    } catch (err) {
        console.error('[NORMS CREATE ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Обновить значение нормы
router.put('/norms/:id', authMiddleware, requireManager, async (req, res) => {
    try {
        const { id } = req.params;
        const { norm } = req.body;
        if (norm === undefined || norm === null) {
            return res.status(400).json({ error: 'Не передано новое значение normы' });
        }
        const { error } = await supabaseAdmin
            .from('job_resource_norms')
            .update({ value_number: norm, updated_at: new Date().toISOString() })
            .eq('id', id);
        if (error) throw error;
        res.json({ message: 'Норма обновлена', id });
    } catch (err) {
        console.error('[NORMS UPDATE ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Удалить норму (полностью — эта запись ни на что не ссылается извне)
router.delete('/norms/:id', authMiddleware, requireManager, async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await supabaseAdmin.from('job_resource_norms').delete().eq('id', id);
        if (error) throw error;
        res.json({ message: 'Норма удалена', id });
    } catch (err) {
        console.error('[NORMS DELETE ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- WBS (шаблоны структуры сметы по типу объекта) ---

// Заголовки шаблонов — фиксированный список, без CRUD (привязаны к типам объектов)
router.get('/wbs/headers', async (req, res) => {
    try {
        const { lang = 'ru' } = req.query;
        const { data: headers, error } = await supabaseAdmin
            .from('wbs_template_headers')
            .select('id, code, name_ru, name_en, name_ka, name_az, name_tr')
            .order('code');
        if (error) throw error;
        res.json(headers.map(h => ({
            id: h.id,
            code: h.code,
            name: h[`name_${lang}`] || h.name_ru || h.name_en || h.code,
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Этапы конкретного шаблона — с вычисленным уровнем вложенности по коду
router.get('/wbs/templates/:headerId', async (req, res) => {
    try {
        const { headerId } = req.params;
        const { lang = 'ru' } = req.query;
        const { data: templates, error } = await supabaseAdmin
            .from('wbs_templates')
            .select('id, code, name_ru, name_en, name_ka, name_az, name_tr, sort_order')
            .eq('template_id', headerId)
            .order('sort_order');
        if (error) throw error;

        const result = (templates || []).map(t => {
            const dotIdx = t.code.lastIndexOf('.');
            const parentCode = dotIdx === -1 ? null : t.code.substring(0, dotIdx);
            const level = (t.code.match(/\./g) || []).length;
            return { ...t, name: t[`name_${lang}`] || t.name_ru || t.name_en || t.code, parentCode, level };
        });

        // Сортируем так, чтобы дети шли сразу после родителя (человекочитаемое дерево)
        result.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Добавить этап (код генерируется автоматически на основе родителя)
router.post('/wbs/templates', authMiddleware, requireManager, async (req, res) => {
    try {
        const { template_id, parent_code, name_ru, name_en, name_ka, name_az, name_tr } = req.body;
        if (!template_id || !name_ru) {
            return res.status(400).json({ error: 'Обязательные поля: template_id, name_ru' });
        }

        const { data: siblings, error: sibErr } = await supabaseAdmin
            .from('wbs_templates')
            .select('code, sort_order')
            .eq('template_id', template_id);
        if (sibErr) throw sibErr;

        let newCode;
        let siblingCodes;
        if (parent_code) {
            siblingCodes = siblings.filter(s => s.code.lastIndexOf('.') === parent_code.length && s.code.startsWith(parent_code + '.'));
        } else {
            siblingCodes = siblings.filter(s => s.code.indexOf('.') === -1);
        }
        const lastSegments = siblingCodes.map(s => parseInt(s.code.split('.').pop(), 10)).filter(n => !isNaN(n));
        const nextNum = lastSegments.length > 0 ? Math.max(...lastSegments) + 1 : 1;
        newCode = parent_code ? `${parent_code}.${nextNum}` : `${nextNum}`;

        const maxSort = siblings.reduce((m, s) => Math.max(m, s.sort_order || 0), 0);

        const { data: created, error } = await supabaseAdmin
            .from('wbs_templates')
            .insert({
                template_id, code: newCode,
                name_ru, name_en: name_en || null, name_ka: name_ka || null, name_az: name_az || null, name_tr: name_tr || null,
                sort_order: maxSort + 1
            })
            .select('id, code')
            .single();
        if (error) throw error;

        res.json({ message: 'Этап добавлен', id: created.id, code: created.code });
    } catch (err) {
        console.error('[WBS CREATE ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Обновить этап (названия и порядок сортировки — код и родителя не меняем, чтобы не ломать иерархию)
router.put('/wbs/templates/:id', authMiddleware, requireManager, async (req, res) => {
    try {
        const { id } = req.params;
        const { name_ru, name_en, name_ka, name_az, name_tr, sort_order } = req.body;
        const payload = {};
        if (name_ru) payload.name_ru = name_ru;
        if (name_en !== undefined) payload.name_en = name_en || null;
        if (name_ka !== undefined) payload.name_ka = name_ka || null;
        if (name_az !== undefined) payload.name_az = name_az || null;
        if (name_tr !== undefined) payload.name_tr = name_tr || null;
        if (sort_order !== undefined && sort_order !== null && sort_order !== '') payload.sort_order = sort_order;

        const { error } = await supabaseAdmin.from('wbs_templates').update(payload).eq('id', id);
        if (error) throw error;
        res.json({ message: 'Этап обновлён', id });
    } catch (err) {
        console.error('[WBS UPDATE ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Удалить этап — только если у него нет дочерних этапов
router.delete('/wbs/templates/:id', authMiddleware, requireManager, async (req, res) => {
    try {
        const { id } = req.params;

        const { data: target, error: findErr } = await supabaseAdmin.from('wbs_templates').select('code, template_id').eq('id', id).single();
        if (findErr) throw findErr;

        const { data: children } = await supabaseAdmin
            .from('wbs_templates')
            .select('id')
            .eq('template_id', target.template_id)
            .like('code', `${target.code}.%`);

        if (children && children.length > 0) {
            return res.status(400).json({ error: `У этого этапа есть ${children.length} дочерних — сначала удалите их` });
        }

        const { error } = await supabaseAdmin.from('wbs_templates').delete().eq('id', id);
        if (error) throw error;
        res.json({ message: 'Этап удалён', id });
    } catch (err) {
        console.error('[WBS DELETE ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- СТРАНЫ ---
router.get('/countries', async (req, res) => {
    try {
        const countriesQuery = supabaseAdmin.from('dic_countries').select('id, code, currency_id').eq('is_active', true);
        const countries = await getAllRows(countriesQuery);

        const locQuery = supabaseAdmin.from('localization').select('object_id, locale, name').eq('object_name', 'dic_countries');
        const locs = await getAllRows(locQuery);

        const locMap = {};
        locs.forEach(l => { if (!locMap[l.object_id]) locMap[l.object_id] = {}; locMap[l.object_id][l.locale] = l.name; });

        const result = countries.map(c => {
            const names = locMap[c.id] || {};
            const name = names.ru || names.en || c.code;
            return {
                id: c.id,
                code: c.code,
                currency_id: c.currency_id,
                name,
                // Грузия определяется по коду ISO (GE) или по названию — на случай расхождений в данных
                isGeorgia: c.code === 'GE' || /груз|georgia/i.test(name),
            };
        });

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- СТРАНЫ ---
router.get('/countries', async (req, res) => {
    try {
        const countriesQuery = supabaseAdmin.from('dic_countries').select('id, code, currency_id');
        const countries = await getAllRows(countriesQuery);

        const locQuery = supabaseAdmin.from('localization').select('object_id, locale, name').eq('object_name', 'dic_countries');
        const locs = await getAllRows(locQuery);

        const locMap = {};
        locs.forEach(l => { if (!locMap[l.object_id]) locMap[l.object_id] = {}; locMap[l.object_id][l.locale] = l.name; });

        const result = countries.map(c => {
            const names = locMap[c.id] || {};
            return { id: c.id, code: c.code, currency_id: c.currency_id, name: names.ru || names.en || `Country ${c.code}` };
        });

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- РЕГИОНЫ ---
router.get('/regions', async (req, res) => {
    try {
        const regionsQuery = supabaseAdmin.from('dic_regions').select('id, code, country_id, dic_countries(code)').eq('is_active', true);
        const regions = await getAllRows(regionsQuery);

        const locQuery = supabaseAdmin.from('localization')
            .select('object_id, locale, name')
            .eq('object_name', 'dic_regions');
        const locs = await getAllRows(locQuery);

        const locMap = {};
        locs.forEach(l => {
            if (!locMap[l.object_id]) locMap[l.object_id] = {};
            locMap[l.object_id][l.locale] = l.name;
        });

        const result = regions.map(r => {
            const names = locMap[r.id] || {};
            return {
                id: r.id,
                code: r.code,
                country_id: r.country_id,
                country_code: r.dic_countries?.code || null,
                name: names.ru || names.en || names.ka || names.az || `Region ${r.code}`,
                name_en: names.en || '',
                name_ka: names.ka || '',
                name_ge: names.ka || '',
                name_az: names.az || ''
            };
        });

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ЕДИНИЦЫ ИЗМЕРЕНИЯ ---
router.get('/measures', async (req, res) => {
    try {
        const { lang = 'ru' } = req.query;
        const measuresQuery = supabaseAdmin.from('dic_measures').select('id, code').eq('is_active', true);
        const measures = await getAllRows(measuresQuery);

        const locQuery = supabaseAdmin.from('localization')
            .select('object_id, locale, name')
            .eq('object_name', 'dic_measures');
        const locs = await getAllRows(locQuery);

        const locMap = {};
        locs.forEach(l => {
            if (!locMap[l.object_id]) locMap[l.object_id] = {};
            locMap[l.object_id][l.locale] = l.name;
        });

        const result = measures.map(m => {
            const names = locMap[m.id] || {};
            return {
                id: m.id,
                code: m.code,
                // Отдаём и разрешённое отображаемое имя (name), и все локали по отдельности —
                // форма редактирования на клиенте читает name_ru/name_en/name_ka/name_az
                // напрямую из объекта строки списка (иначе поля названия оставались пустыми).
                name: names[lang] || names.ru || names.en || m.code,
                name_ru: names.ru || '',
                name_en: names.en || '',
                name_ka: names.ka || '',
                name_az: names.az || '',
            };
        });

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Создать единицу измерения
router.post('/measures', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { code, name_ru, name_en, name_ka, name_az } = req.body;
        if (!code || !name_ru) {
            return res.status(400).json({ error: 'Обязательные поля: code, name_ru' });
        }

        // Код всегда приводим к верхнему регистру — независимо от того, что прислал клиент
        const upperCode = String(code).trim().toUpperCase();

        const { data: existingCode } = await supabaseAdmin.from('dic_measures').select('id').eq('code', upperCode).maybeSingle();
        if (existingCode) {
            return res.status(400).json({ error: 'Элемент с указанным кодом уже существует', code: 'CODE_EXISTS' });
        }

        const measureId = crypto.randomUUID();

        const { data: anchorLoc, error: anchorErr } = await supabaseAdmin
            .from('localization')
            .insert({ object_name: 'dic_measures', object_id: measureId, locale: 'ru', name: name_ru })
            .select('id')
            .single();
        if (anchorErr) throw anchorErr;

        const { error: measureErr } = await supabaseAdmin
            .from('dic_measures')
            .insert({ id: measureId, code: upperCode, name_id: anchorLoc.id });
        if (measureErr) throw measureErr;

        const extraLocs = [
            { locale: 'en', name: name_en },
            { locale: 'ka', name: name_ka },
            { locale: 'az', name: name_az },
        ].filter(l => l.name);
        if (extraLocs.length > 0) {
            const rows = extraLocs.map(l => ({ object_name: 'dic_measures', object_id: measureId, locale: l.locale, name: l.name }));
            const { error: extraErr } = await supabaseAdmin.from('localization').insert(rows);
            if (extraErr) throw extraErr;
        }

        res.json({ message: 'Единица измерения создана', id: measureId, code: upperCode });
    } catch (err) {
        console.error('[MEASURES CREATE ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Обновить единицу измерения (код нередактируем — приходящее значение игнорируется,
// меняются только переводы названия)
router.put('/measures/:id', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { name_ru, name_en, name_ka, name_az } = req.body;

        const localeValues = { ru: name_ru, en: name_en, ka: name_ka, az: name_az };
        for (const [locale, name] of Object.entries(localeValues)) {
            if (!name) continue;
            const { data: existingLoc } = await supabaseAdmin
                .from('localization')
                .select('id')
                .eq('object_name', 'dic_measures')
                .eq('object_id', id)
                .eq('locale', locale)
                .maybeSingle();
            if (existingLoc) {
                await supabaseAdmin.from('localization').update({ name, updated_at: new Date().toISOString() }).eq('id', existingLoc.id);
            } else {
                await supabaseAdmin.from('localization').insert({ object_name: 'dic_measures', object_id: id, locale, name });
            }
        }

        await supabaseAdmin.from('dic_measures').update({ updated_at: new Date().toISOString() }).eq('id', id);

        res.json({ message: 'Единица измерения обновлена', id });
    } catch (err) {
        console.error('[MEASURES UPDATE ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Удалить (мягко деактивировать) единицу измерения
router.delete('/measures/:id', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        const { error } = await supabaseAdmin
            .from('dic_measures')
            .update({ is_active: false, deactivated_at: new Date().toISOString() })
            .eq('id', id);
        if (error) throw error;
        res.json({ message: 'Единица измерения удалена из справочника', id });
    } catch (err) {
        console.error('[MEASURES DELETE ERROR]:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- ВАЛЮТЫ ---
router.get('/currencies', async (req, res) => {
    try {
        const curQuery = supabaseAdmin.from('dic_currencies').select('id, code, symbol');
        const currencies = await getAllRows(curQuery);

        const locQuery = supabaseAdmin.from('localization')
            .select('object_id, locale, name')
            .eq('object_name', 'dic_currencies');
        const locs = await getAllRows(locQuery);

        const locMap = {};
        locs.forEach(l => {
            if (!locMap[l.object_id]) locMap[l.object_id] = {};
            locMap[l.object_id][l.locale] = l.name;
        });

        const result = currencies.map(c => {
            const names = locMap[c.id] || {};
            return {
                id: c.id,
                code: c.code,
                symbol: c.symbol,
                name: names.ru || names.en || names.ka || names.az || `Currency ${c.code}`,
                name_en: names.en || '',
                name_ka: names.ka || '',
                name_ge: names.ka || '',
                name_az: names.az || ''
            };
        });

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Прогрев кэша каталогов работ сразу при старте сервера — чтобы первый же
// реальный пользователь, открывший смету, не ждал 15-20 сек на холодных джойнах.
loadTableWorks('jobs').catch(err => console.error('[Works Cache Warmup GE Error]:', err.message));
loadTableWorks('jobs_cas').catch(err => console.error('[Works Cache Warmup AZ Error]:', err.message));

module.exports = router;