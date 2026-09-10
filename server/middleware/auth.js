const { supabaseAdmin } = require('../supabase');
const { logActivity, getRegionNames } = require('../utils/activityLogger');
const audit = require('../journal/audit-client');

// --- MIDDLEWARE АВТОРИЗАЦИИ ЧЕРЕЗ SUPABASE ---
// Общий для всех route-файлов модуля (estimates.js, projects.js, dictionaries.js,
// actual-estimates.js), чтобы не дублировать логику и не рассинхронизировать роль
// (см. историю: app_metadata токена не обновлялся при смене роли через админку).
const authMiddleware = async (req, res, next) => {
    try {
        // Один и тот же запрос может пройти через несколько route-файлов, каждый из которых
        // подключает этот же middleware (см. комментарий выше) — без этой защиты действие
        // логировалось бы по разу на каждый такой файл.
        if (req._activityLogged) return next();
        req._activityLogged = true;

        const authHeader = req.headers.authorization;
        let token = null;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.split(' ')[1];
        } else if (req.query.token) {
            token = req.query.token;
        }

        if (!token || token === 'null' || token === 'undefined' || token.trim() === '') {
            // Режим локальной разработки/тестирования модуля
            req.user = {
                id: '3a3ade5b-2731-4de0-8163-44baef84904a',
                email: 'admin@dev.local',
                role: 'admin',
                organization_id: '741be209-ad6f-4483-92ee-298a36899bcf'
            };
            logActivity({ user: 'admin@dev.local (dev)', email: req.user.email, region: '', method: req.method, path: req.originalUrl });
            // Вход без пропуска - тоже вход, и в журнале он должен быть виден
            // именно как локальный: иначе действия dev-режима выглядели бы как
            // работа настоящего администратора.
            audit.recordSession('LOGIN', {
                entityType: 'estimates_session',
                reason: 'локальный режим без пропуска',
                actorId: req.user.id,
                actorEmail: req.user.email,
                actorName: 'admin@dev.local (локальный режим)',
                actorRole: req.user.role,
                organizationId: req.user.organization_id,
                ipAddress: req.ip || req.socket?.remoteAddress || '',
                userAgent: req.headers?.['user-agent'] || '',
            });
            return next();
        }

        // Проверяем токен через Supabase Auth
        const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
        if (authErr || !user) {
            console.error('[Auth] Supabase auth error:', authErr?.message);
            // Отказ - в раздел «Входы и отказы» общего журнала. Личность берётся
            // из непроверенного токена: сессия недействительна, но чей это был
            // пропуск, службе безопасности видеть надо. Сам токен в журнал не
            // попадает - по нему можно было бы войти.
            let claims = {};
            try {
                claims = JSON.parse(Buffer.from(String(token).split('.')[1] || '', 'base64url').toString('utf8')) || {};
            } catch {
                claims = {};
            }
            audit.recordSession('ACCESS_DENIED', {
                entityType: 'estimates_session',
                reason: authErr?.message || 'Невалидный токен или сессия истекла',
                actorId: claims.sub || '',
                actorEmail: claims.email || '',
                actorName: claims.email || '',
                actorRole: claims.app_metadata?.role || '',
                organizationId: claims.app_metadata?.organization_id || '',
                ipAddress: req.ip || req.socket?.remoteAddress || '',
                userAgent: req.headers?.['user-agent'] || '',
            });
            return res.status(401).json({ error: 'Невалидный токен или сессия истекла' });
        }

        req.user = user;

        // Роль и организация читаются из profiles (актуальный источник правды),
        // а не из app_metadata токена — тот не обновляется при смене роли через админку
        // и может годами хранить устаревшее значение.
        let role = user.app_metadata?.role || 'employee';
        let organization_id = user.app_metadata?.organization_id || '741be209-ad6f-4483-92ee-298a36899bcf';
        let fullName = user.email;
        try {
            const { data: profile } = await supabaseAdmin
                .from('profiles')
                .select('role, organization_id, first_name, last_name')
                .eq('id', user.id)
                .maybeSingle();
            if (profile) {
                role = profile.role || role;
                organization_id = profile.organization_id || organization_id;
                fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || user.email;
            }
        } catch (profileErr) {
            console.warn('[Auth] Не удалось прочитать роль из profiles, используем app_metadata:', profileErr.message);
        }

        req.user.role = role;
        req.user.organization_id = organization_id;

        // Простой файловый журнал: кто, откуда (регион), когда и что сделал в УСП (Смета).
        const regionNames = await getRegionNames(user.id, supabaseAdmin);
        logActivity({ user: fullName, email: user.email, region: regionNames, method: req.method, path: req.originalUrl });

        // Регион - на req.user, чтобы его подхватил middleware журнала как
        // часть личности. Читать его второй раз в журнале незачем: запрос к
        // справочнику регионов уже сделан здесь.
        req.user.region = regionNames || '';

        // Тот же вход - в общий журнал. Пропуск проверяется на каждом запросе,
        // поэтому recordSession сам отсекает повторы по личности на минуту:
        // иначе раздел «Входы и отказы» состоял бы из одной строки «вошёл»,
        // повторённой сотни раз за сессию.
        audit.recordSession('LOGIN', {
            entityType: 'estimates_session',
            actorId: user.id,
            actorEmail: user.email,
            actorName: fullName,
            actorRole: role,
            actorRegion: regionNames || '',
            organizationId: organization_id,
            ipAddress: req.ip || req.socket?.remoteAddress || '',
            userAgent: req.headers?.['user-agent'] || '',
        });

        next();
    } catch (err) {
        console.error('[Auth] Internal error:', err);
        res.status(500).json({ error: 'Internal Auth Error' });
    }
};

module.exports = { authMiddleware };