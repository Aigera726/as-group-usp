const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ quiet: true });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error('Отсутствуют переменные окружения SUPABASE_URL или SUPABASE_SERVICE_ROLE_KEY');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseKey, { db: { schema: 'erp' } });

module.exports = { supabaseAdmin };
