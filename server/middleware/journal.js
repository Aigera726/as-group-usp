/**
 * Отправка действий модуля Смет (в меню ERP - «УСП») в общий журнал на 9010.
 *
 * Здесь явная таблица шаблонов, а не карта по коллекциям. Причина в самих
 * адресах: /api/estimates/resource/:id - коллекция вторым сегментом, а
 * /api/estimates/approve вообще не про коллекцию, это действие над сметой из
 * тела запроса. Карта по коллекциям на таких адресах молча врала бы, поэтому
 * маршруты перечислены.
 *
 * Инвентаризация по §6 ТЗ снята с routes/{estimates,projects,contracts,
 * dictionaries,gpm,oper-facts,actual-estimates}.js.
 *
 * Свои механизмы модуля остаются как есть: таблица erp.estimate_audit_logs и
 * файл data/schedule_audit.json. Второй перезаписывается целиком и обрезается
 * до 1000 записей, то есть свою же историю стирает - общий журнал как раз и
 * закрывает эту дыру.
 */

'use strict';

const { createJournalMiddleware } = require('../journal/express-journal');

// Идентификатор в адресе: uuid, число или код. В шаблонах это группа 1 (или 2,
// где идентификаторов два).
const ID = '([^/]+)';

// Форма UUID. Нужна там, где по одному адресу ходят и объекты, и именованные
// ручки: /api/estimates/754d16b4-... это смета, а /api/estimates/profile - нет.
const UUID = '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})';

// Шаблоны без явного methods ловили бы и GET, а тогда «открыл проект»
// получалось из /api/estimates/projects/stats, а «открыл договор» - из
// /api/contracts/list: последний сегмент принимался за идентификатор. Поэтому
// все шаблоны правок ограничены мутирующими методами, а открытие объектов
// описано отдельно и только для адресов с UUID.
const MUT = ['POST', 'PUT', 'PATCH', 'DELETE'];

const journalMiddleware = createJournalMiddleware({
  routes: [
    // ---------------- Открытие объектов (переходы) -------------------------
    //
    // Идентификатор ограничен формой UUID намеренно. По адресу
    // /api/estimates/<что-то> ходят и именованные ручки - profile, directors,
    // estimators, templates, all-test, oper-facts, create, approve, - и без
    // этого ограничения открытием сметы считался бы заход на справочник.
    //
    // Это самый частый настоящий переход в модуле: сегодня пользователи
    // открыли три сметы и два проекта, и до этой правки в журнал не попал ни
    // один из них.
    { methods: 'GET', pattern: new RegExp('^/api/estimates/' + UUID + '$'), entityType: 'estimate', action: 'NAVIGATE', idGroup: 1 },
    { methods: 'GET', pattern: new RegExp('^/api/estimates/' + UUID + '/history$'), entityType: 'estimate', action: 'NAVIGATE', idGroup: 1 },
    { methods: 'GET', pattern: new RegExp('^/api/estimates/projects/' + UUID + '/objects$'), entityType: 'estimate_project', action: 'NAVIGATE', idGroup: 1 },
    { methods: 'GET', pattern: new RegExp('^/api/estimates/projects/' + UUID + '$'), entityType: 'estimate_project', action: 'NAVIGATE', idGroup: 1 },
    { methods: 'GET', pattern: new RegExp('^/api/contracts/' + UUID + '$'), entityType: 'estimate_contract', action: 'NAVIGATE', idGroup: 1 },
    { methods: 'GET', pattern: new RegExp('^/api/estimates/oper-facts/' + UUID + '$'), entityType: 'estimate_oper_fact', action: 'NAVIGATE', idGroup: 1 },

    // ---------------- Что в журнал НЕ идёт ---------------------------------
    //
    // Первым делом, до всех остальных шаблонов: POST не всегда означает
    // «что-то создали». Эти ручки считают и ничего не сохраняют, а журнал
    // записывал их как «создал договор подряда» - то есть утверждал неправду
    // о действии, которого не было. Ложная запись в журнале аудита хуже, чем
    // её отсутствие, поэтому расчёты исключены явно.
    // Приём нажатий из браузера сам событием не является: записывать его
    // значило бы, что журнал описывает себя. Стоит первым - если пропуск
    // просрочен, ручка ответит 401, а отказы пишутся даже на неразмеченных
    // маршрутах, и открытая вкладка давала бы отказ на каждую отправку.
    { pattern: /^\/api\/estimates\/journal\/ui$/, skip: true },
    { methods: MUT, pattern: /^\/api\/contracts\/tender-distribution-preview$/, skip: true },
    { methods: MUT, pattern: /^\/api\/estimates\/notifications\//, skip: true },

    // ---------------- Смета ------------------------------------------------
    { methods: 'POST', pattern: /^\/api\/estimates\/create$/, entityType: 'estimate', action: 'CREATE' },
    { methods: 'POST', pattern: new RegExp('^/api/estimates/' + ID + '/save$'), entityType: 'estimate', action: 'UPDATE', idGroup: 1 },
    { methods: 'POST', pattern: new RegExp('^/api/estimates/' + ID + '/create-version$'), entityType: 'estimate', action: 'CREATE', idGroup: 1 },
    { methods: 'POST', pattern: new RegExp('^/api/estimates/' + ID + '/submit-review$'), entityType: 'estimate', action: 'STATUS_CHANGE', idGroup: 1 },
    // Удаление сметы. Пропускать такое нельзя: это самое тяжёлое действие в
    // модуле, и именно его аудитор ищет первым. Идентификатор ограничен формой
    // UUID, чтобы под удаление не попал адрес именованной ручки.
    { methods: 'DELETE', pattern: new RegExp('^/api/estimates/' + UUID + '$'), entityType: 'estimate', action: 'DELETE', idGroup: 1 },

    // Календарный план сметы: создание, согласование, отклонение, отключение.
    { methods: 'POST', pattern: new RegExp('^/api/estimates/' + ID + '/create-plan$'), entityType: 'estimate_schedule', action: 'CREATE', idGroup: 1 },
    { methods: 'POST', pattern: new RegExp('^/api/estimates/' + ID + '/approve-plan$'), entityType: 'estimate_schedule', action: 'APPROVE', idGroup: 1 },
    { methods: 'POST', pattern: new RegExp('^/api/estimates/' + ID + '/reject-plan$'), entityType: 'estimate_schedule', action: 'REJECT', idGroup: 1 },
    { methods: 'POST', pattern: new RegExp('^/api/estimates/' + ID + '/deactivate-plan$'), entityType: 'estimate_schedule', action: 'STATUS_CHANGE', idGroup: 1 },

    // Сохранение графиков. Именно тот механизм, чей собственный журнал
    // (data/schedule_audit.json) перезаписывается по кругу и обрезается до
    // 1000 записей - здесь он попадает в неизменяемый журнал.
    { methods: 'POST', pattern: /^\/api\/estimates\/schedule-save$/, entityType: 'estimate_schedule', action: 'UPDATE' },
    { methods: 'POST', pattern: /^\/api\/estimates\/general-schedule-save$/, entityType: 'estimate_schedule', action: 'UPDATE' },
    { methods: 'POST', pattern: /^\/api\/estimates\/gpr-save$/, entityType: 'estimate_schedule', action: 'UPDATE' },

    // Распределение тендерной суммы по сохранённому договору - это правка
    // договора, в отличие от расчёта-предпросмотра выше.
    { methods: 'POST', pattern: new RegExp('^/api/contracts/' + ID + '/tender-distribution$'), entityType: 'estimate_contract', action: 'UPDATE', idGroup: 1 },
    { methods: 'POST', pattern: /^\/api\/estimates\/approve$/, entityType: 'estimate', action: 'APPROVE' },
    { methods: 'POST', pattern: new RegExp('^/api/estimates/' + ID + '/create-actual$'), entityType: 'estimate', action: 'CREATE', idGroup: 1 },

    // ---------------- Разделы WBS, работы, ресурсы, коэффициенты -----------
    { methods: MUT, pattern: new RegExp('^/api/estimates/wbs/' + ID + '/toggle-exclusion$'), entityType: 'estimate_wbs_node', action: 'STATUS_CHANGE', idGroup: 1 },
    { methods: MUT, pattern: new RegExp('^/api/estimates/wbs/' + ID + '$'), entityType: 'estimate_wbs_node', idGroup: 1 },
    { methods: 'POST', pattern: /^\/api\/estimates\/wbs$/, entityType: 'estimate_wbs_node', action: 'CREATE' },

    { methods: MUT, pattern: new RegExp('^/api/estimates/work/' + ID + '/toggle-exclusion$'), entityType: 'estimate_work', action: 'STATUS_CHANGE', idGroup: 1 },
    { methods: MUT, pattern: new RegExp('^/api/estimates/work/' + ID + '$'), entityType: 'estimate_work', idGroup: 1 },
    { methods: 'POST', pattern: /^\/api\/estimates\/work$/, entityType: 'estimate_work', action: 'CREATE' },

    { methods: MUT, pattern: new RegExp('^/api/estimates/resource/' + ID + '/toggle-exclusion$'), entityType: 'estimate_resource', action: 'STATUS_CHANGE', idGroup: 1 },
    { methods: MUT, pattern: new RegExp('^/api/estimates/resource/' + ID + '$'), entityType: 'estimate_resource', idGroup: 1 },
    { methods: 'POST', pattern: /^\/api\/estimates\/resource$/, entityType: 'estimate_resource', action: 'CREATE' },

    { methods: MUT, pattern: /^\/api\/estimates\/coefficients/, entityType: 'estimate_coefficient' },
    { methods: MUT, pattern: /^\/api\/estimates\/schedule/, entityType: 'estimate_schedule' },

    // ---------------- Оперативные факты ------------------------------------
    { methods: 'POST', pattern: /^\/api\/estimates\/oper-facts\/incoming$/, entityType: 'estimate_oper_fact', action: 'CREATE' },
    { methods: 'POST', pattern: new RegExp('^/api/estimates/oper-facts/' + ID + '/approve$'), entityType: 'estimate_oper_fact', action: 'APPROVE', idGroup: 1 },
    { methods: 'POST', pattern: new RegExp('^/api/estimates/oper-facts/' + ID + '/reject$'), entityType: 'estimate_oper_fact', action: 'REJECT', idGroup: 1 },

    // ---------------- Проекты и их объекты ---------------------------------
    { methods: MUT, pattern: new RegExp('^/api/estimates/projects/' + ID + '/objects/' + ID + '/documents$'), entityType: 'estimate_project_object', action: 'ATTACH_FILE', idGroup: 2 },
    // Правка и удаление уже прикреплённого документа. Удаление - REMOVE_FILE
    // из словаря §3.2: «удалил файл у объекта проекта». Шаблоны стоят после
    // общего, но с более длинным адресом, поэтому не конфликтуют: первое
    // совпадение выигрывает, а /documents$ и /documents/<id>$ разные адреса.
    { methods: 'DELETE', pattern: new RegExp('^/api/estimates/projects/' + ID + '/objects/' + ID + '/documents/' + ID + '$'), entityType: 'estimate_project_object', action: 'REMOVE_FILE', idGroup: 2 },
    { methods: ['PUT', 'PATCH'], pattern: new RegExp('^/api/estimates/projects/' + ID + '/objects/' + ID + '/documents/' + ID + '$'), entityType: 'estimate_project_object', action: 'UPDATE', idGroup: 2 },
    { methods: MUT, pattern: new RegExp('^/api/estimates/projects/' + ID + '/objects/' + ID + '$'), entityType: 'estimate_project_object', idGroup: 2 },
    { methods: 'POST', pattern: new RegExp('^/api/estimates/projects/' + ID + '/objects$'), entityType: 'estimate_project_object', action: 'CREATE', idGroup: 1 },

    { methods: 'POST', pattern: new RegExp('^/api/estimates/projects/' + ID + '/send-for-approval$'), entityType: 'estimate_project', action: 'STATUS_CHANGE', idGroup: 1 },
    { methods: 'POST', pattern: new RegExp('^/api/estimates/projects/' + ID + '/approve$'), entityType: 'estimate_project', action: 'APPROVE', idGroup: 1 },
    { methods: 'POST', pattern: new RegExp('^/api/estimates/projects/' + ID + '/reject$'), entityType: 'estimate_project', action: 'REJECT', idGroup: 1 },
    { methods: 'POST', pattern: new RegExp('^/api/estimates/projects/' + ID + '/activate$'), entityType: 'estimate_project', action: 'STATUS_CHANGE', idGroup: 1 },
    { methods: 'POST', pattern: new RegExp('^/api/estimates/projects/' + ID + '/create-estimate$'), entityType: 'estimate', action: 'CREATE', idGroup: 1 },
    { methods: 'POST', pattern: /^\/api\/estimates\/projects\/upload$/, entityType: 'estimate_project', action: 'IMPORT' },
    { methods: MUT, pattern: new RegExp('^/api/estimates/projects/' + ID + '$'), entityType: 'estimate_project', idGroup: 1 },
    { methods: 'POST', pattern: /^\/api\/estimates\/projects$/, entityType: 'estimate_project', action: 'CREATE' },
    { methods: MUT, pattern: new RegExp('^/api/estimates/employees/' + ID + '/role$'), entityType: 'estimate_project', action: 'UPDATE', idGroup: 1 },

    // ---------------- Договоры подряда -------------------------------------
    { methods: 'POST', pattern: /^\/api\/contracts\/contractors$/, entityType: 'estimate_contractor', action: 'CREATE' },
    { methods: 'DELETE', pattern: new RegExp('^/api/contracts/assignments/' + ID + '$'), entityType: 'estimate_assignment', action: 'DELETE', idGroup: 1 },
    { methods: 'POST', pattern: new RegExp('^/api/contracts/' + ID + '/assignments$'), entityType: 'estimate_assignment', action: 'CREATE', idGroup: 1 },
    { methods: 'POST', pattern: new RegExp('^/api/contracts/' + ID + '/submit$'), entityType: 'estimate_contract', action: 'STATUS_CHANGE', idGroup: 1 },
    { methods: 'POST', pattern: new RegExp('^/api/contracts/' + ID + '/approve$'), entityType: 'estimate_contract', action: 'APPROVE', idGroup: 1 },
    { methods: 'POST', pattern: new RegExp('^/api/contracts/' + ID + '/reject$'), entityType: 'estimate_contract', action: 'REJECT', idGroup: 1 },
    { methods: MUT, pattern: new RegExp('^/api/contracts/' + ID + '$'), entityType: 'estimate_contract', idGroup: 1 },
    { methods: 'POST', pattern: /^\/api\/contracts\/?$/, entityType: 'estimate_contract', action: 'CREATE' },

    // ---------------- Справочники ------------------------------------------
    { methods: MUT, pattern: new RegExp('^/api/dictionaries/works/' + ID + '$'), entityType: 'estimate_dict_work', idGroup: 1 },
    { methods: 'POST', pattern: /^\/api\/dictionaries\/works$/, entityType: 'estimate_dict_work', action: 'CREATE' },
    { methods: MUT, pattern: new RegExp('^/api/dictionaries/resources/' + ID + '$'), entityType: 'estimate_dict_resource', idGroup: 1 },
    { methods: 'POST', pattern: /^\/api\/dictionaries\/resources$/, entityType: 'estimate_dict_resource', action: 'CREATE' },
    { methods: MUT, pattern: new RegExp('^/api/dictionaries/prices/' + ID + '$'), entityType: 'estimate_price', idGroup: 1 },
    { methods: MUT, pattern: new RegExp('^/api/dictionaries/norms/' + ID + '$'), entityType: 'estimate_norm', idGroup: 1 },
    { methods: 'POST', pattern: /^\/api\/dictionaries\/norms$/, entityType: 'estimate_norm', action: 'CREATE' },
    { methods: MUT, pattern: new RegExp('^/api/dictionaries/wbs/templates/' + ID + '$'), entityType: 'estimate_wbs_template', idGroup: 1 },
    { methods: 'POST', pattern: /^\/api\/dictionaries\/wbs\/templates$/, entityType: 'estimate_wbs_template', action: 'CREATE' },
    { methods: MUT, pattern: new RegExp('^/api/dictionaries/measures/' + ID + '$'), entityType: 'estimate_measure', idGroup: 1 },
    { methods: 'POST', pattern: /^\/api\/dictionaries\/measures$/, entityType: 'estimate_measure', action: 'CREATE' },

    // ---------------- Потребность в материалах -----------------------------
    { methods: MUT, pattern: new RegExp('^/api/gpm/materials/demand/' + ID + '$'), entityType: 'estimate_material_demand', idGroup: 1 },
    { methods: 'POST', pattern: /^\/api\/gpm\/materials\/demand$/, entityType: 'estimate_material_demand', action: 'CREATE' },
  ],

  // Русские подписи полей: журнал читают глазами, и `name_ru` в нём выглядит
  // плохо. Общий словарь (название, статус, сумма...) уже в SDK, здесь - то,
  // что специфично для смет.
  fieldLabels: {
    name_ru: 'название',
    name_en: 'название (англ.)',
    name_ka: 'название (груз.)',
    name_az: 'название (азерб.)',
    doc_id: 'смета',
    wbs_id: 'раздел WBS',
    work_id: 'работа',
    resource_id: 'ресурс',
    project_id: 'проект',
    contractor_id: 'подрядчик',
    is_excluded: 'исключён',
    volume: 'объём',
    unit_price: 'цена за единицу',
    coefficient: 'коэффициент',
    norm: 'норма',
    measure_id: 'единица измерения',
    schedules: 'календарный план',
    start_date: 'начало',
    end_date: 'окончание',
    contract_number: 'номер договора',
    contract_sum: 'сумма договора',
  },

  // Личность. Модуль проверяет пропуск в middleware/auth.js и складывает
  // сотрудника в req.user. Если пропуска не было - событие всё равно пишется,
  // без автора: потерять факт действия хуже, чем не знать, кто его совершил.
  actorFrom(req) {
    const user = req.user || {};
    const meta = user.app_metadata || {};
    return {
      actorId: String(user.id || user.sub || user.email || ''),
      actorEmail: String(user.email || ''),
      actorName: String(user.name || user.full_name || user.email || ''),
      actorRole: String(user.role || meta.role || ''),
      // Регион читает auth-middleware (getRegionNames) и кладёт на req.user:
      // в модуле Смет сотрудники закреплены за регионами, и в журнале это
      // отдельная колонка.
      actorRegion: String(user.region || ''),
      organizationId: String(user.organization_id || meta.organization_id || ''),
    };
  },
});

module.exports = { journalMiddleware };
