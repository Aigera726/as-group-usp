// Клиент к отдельному модулю MDM (управление мастер-данными, порт 9009,
// см. C:\MDM) — п.7 из списка задач: когда в Смете заводят новый ресурс,
// он должен пройти через Движок Дедупликации MDM и, если найден готовый
// эталон, вернуть его сюда (global_guid), а не просто повиснуть только
// в Смете.
//
// MDM проверяет подпись JWT своим собственным MDM_JWT_SECRET (см.
// C:\MDM\backend\.env, поле JWT_SECRET) — это НЕ тот JWT_SECRET, которым
// подписаны токены пользователей Сметы, поэтому здесь отдельный секрет
// (module-to-module доверие, как и остальные прямые REST-вызовы между
// модулями экосистемы — см. приёмку Закупки -> Склад).
const jwt = require('jsonwebtoken');

const MDM_API_URL = process.env.MDM_API_URL || 'http://127.0.0.1:9009/api/v1';
const MDM_JWT_SECRET = process.env.MDM_JWT_SECRET || '';

function mdmServiceToken() {
    return jwt.sign(
        { sub: 'estimates-service', email: 'estimates-service@internal', app_metadata: { role: 'user', organization_id: 'org-asg' } },
        MDM_JWT_SECRET,
        { expiresIn: '5m' }
    );
}

async function mdmFetch(path, options = {}) {
    if (!MDM_JWT_SECRET) throw new Error('MDM_JWT_SECRET не задан в .env');
    const res = await fetch(`${MDM_API_URL}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${mdmServiceToken()}`,
            ...(options.headers || {}),
        },
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`MDM ${options.method || 'GET'} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
    }
    return res.json();
}

// Отправляет вновь заведённый ресурс в MDM как заявку (Процесс А из ТЗ MDM).
// entityType — всегда 'resource': этот роут пишет в generic erp.resources,
// который MDM синхронизирует именно под этим типом (см. erpClient.js в MDM).
async function submitResource({ localId, rawName, article, unit }) {
    return mdmFetch('/requests', {
        method: 'POST',
        body: JSON.stringify({
            source_system: 'USP',
            entity_type: 'resource',
            raw_name: rawName,
            local_id: localId,
            raw_attributes: { article: article || null, unit: unit || null },
        }),
    });
}

// Проверка статуса позже (например, конфликт решился Стюардом уже после
// создания ресурса в Смете) — по тому же local_id, без хранения doubling
// состояния в самой Смете.
async function findResourceMatch(localId) {
    const data = await mdmFetch(`/requests?source_system=USP&local_id=${encodeURIComponent(localId)}`);
    return data?.rows?.[0] || null;
}

module.exports = { submitResource, findResourceMatch };
