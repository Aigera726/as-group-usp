const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ quiet: true });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error('Отсутствуют переменные окружения SUPABASE_URL или SUPABASE_SERVICE_ROLE_KEY');
}

const rawAdmin = createClient(supabaseUrl, supabaseKey, { db: { schema: 'erp' } });

// Клиент оборачивается, чтобы журнал видел разницу «было → стало» (§3.4 ТЗ).
//
// Обёртка прозрачна: таблицы вне списка журналируемых проходят нетронутыми, а
// пока в цепочке нет .update(), поведение в точности прежнее. Любая ошибка
// внутри обёртки отменяет только разницу - запрос выполняется обычным путём.
// Маршруты при этом не меняются: их 131, и править каждый было бы и дольше, и
// опаснее.
const { wrapClient } = require('./journal/journal-diff');
const supabaseAdmin = wrapClient(rawAdmin);

module.exports = { supabaseAdmin, rawAdmin };
