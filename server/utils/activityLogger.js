const fs = require('fs');
const path = require('path');

// Простой файловый журнал действий в УСП (Смета) — без базы, по одному JSON-объекту
// в строке (JSONL), один файл в день. Читается любым текстовым редактором или `jq`.
const LOG_DIR = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// Кэш названий регионов, чтобы не делать лишний запрос к БД на каждый залогированный запрос.
let regionNameCache = {};
let regionCacheLoadedAt = 0;
const REGION_CACHE_TTL_MS = 60 * 60 * 1000;

async function getRegionNames(profileId, supabaseAdmin) {
    if (!profileId || !supabaseAdmin) return '';
    try {
        const now = Date.now();
        if (now - regionCacheLoadedAt > REGION_CACHE_TTL_MS) {
            // dic_regions не хранит название напрямую — оно в localization
            // (object_name='dic_regions', object_id=dic_regions.id, locale='ru').
            const { data: locs } = await supabaseAdmin
                .from('localization')
                .select('object_id, name')
                .eq('object_name', 'dic_regions')
                .eq('locale', 'ru');
            regionNameCache = {};
            (locs || []).forEach(l => { regionNameCache[l.object_id] = l.name; });
            regionCacheLoadedAt = now;
        }
        const { data: links } = await supabaseAdmin.from('profile_regions').select('region_id').eq('profile_id', profileId);
        return (links || []).map(l => regionNameCache[l.region_id]).filter(Boolean).join(', ');
    } catch {
        return '';
    }
}

// Фоновый опрос (уведомления и т.п. каждые 10 сек с фронта) — не реальное действие
// пользователя, только засоряет журнал повторами. Список путей исключений держим здесь.
const NOISY_PATH_PATTERNS = [/\/notifications(\?|$)/];

function logActivity(entry) {
    if (NOISY_PATH_PATTERNS.some(re => re.test(entry.path || ''))) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), system: 'smeta', ...entry }) + '\n';
    const fileName = `smeta-${new Date().toISOString().slice(0, 10)}.log`;
    fs.appendFile(path.join(LOG_DIR, fileName), line, err => {
        if (err) console.error('[ActivityLogger] Не удалось записать лог:', err.message);
    });
}

module.exports = { logActivity, getRegionNames };
