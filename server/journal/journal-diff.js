'use strict';

// ВРЕМЕННАЯ ЗАГЛУШКА — восстановлена после случайного удаления оригинального
// journal-diff.js (не был закоммичен в git, оригинал не сохранился).
//
// Что теряется: точная разница «было → стало» по колонке .update() в журнале
// действий (§3.4 ТЗ) — вместо неё журнал вернётся к старому поведению
// (показывает то, что было отправлено в запросе, как было до появления
// этого файла).
//
// Что НЕ ломается: сама работа с базой — wrapClient() ничего не оборачивает,
// возвращает клиент как есть, поэтому все запросы (select/insert/update/delete)
// выполняются в точности как раньше, без всякого риска побочных эффектов.
//
// См. server/supabase.js и server/journal/express-journal.js — оба ожидают
// именно такой интерфейс: wrapClient, withCollector, collected.

const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

// Передаёт клиент без изменений — реальное сравнение «было → стало» не
// снимается, пока не восстановлен/переписан настоящий журналирующий обработчик.
function wrapClient(client) {
    return client;
}

// Держит контекст запроса в AsyncLocalStorage (как и раньше — express-journal.js
// оборачивает next() этим вызовом), но коллектор всегда пуст, так как
// wrapClient ничего не пишет в него.
function withCollector(fn) {
    return storage.run({ entries: [] }, fn);
}

// Всегда возвращает пустой массив — express-journal.js в этом случае просто
// использует значения, присланные в самом запросе (submitted), как это было
// до появления этого файла.
function collected() {
    const store = storage.getStore();
    return store ? store.entries : [];
}

module.exports = { wrapClient, withCollector, collected };
