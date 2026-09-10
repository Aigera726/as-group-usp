-- =========================================================================
-- МИГРАЦИЯ: ИСТОРИЯ ЦЕН РЕСУРСОВ + РОЛЬ pricer + РЕГИОНЫ ПРОФИЛЯ (схема erp)
-- Адаптировано из версии для public — просто public. -> erp.
-- ЗАПУСТИТЬ В SQL EDITOR STUDIO (http://10.66.0.105:8000)
-- =========================================================================

-- 0. Найдено при полном сравнении схем: не хватало колонки bank_account у contractors
ALTER TABLE erp.contractors ADD COLUMN IF NOT EXISTS bank_account text;

-- 1. Таблица истории изменения цен
CREATE TABLE IF NOT EXISTS erp.resource_price_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_id UUID NOT NULL,
    region_id UUID REFERENCES erp.dic_regions(id) ON DELETE CASCADE, -- NULL для глобальных ресурсов Баку
    old_price NUMERIC,
    new_price NUMERIC NOT NULL,
    changed_by UUID REFERENCES erp.profiles(id) ON DELETE SET NULL,
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE erp.resource_price_history IS 'История изменения стоимости ресурсов в разрезе регионов';
COMMENT ON COLUMN erp.resource_price_history.resource_id IS 'Ссылка на ресурс (из resources, Labor_cas, Machine_cas, Materials_cas)';
COMMENT ON COLUMN erp.resource_price_history.region_id IS 'Ссылка на регион (NULL для ресурсов Баку)';
COMMENT ON COLUMN erp.resource_price_history.old_price IS 'Предыдущая стоимость ресурса (NULL, если цена устанавливается впервые)';
COMMENT ON COLUMN erp.resource_price_history.new_price IS 'Новая установленная стоимость ресурса';
COMMENT ON COLUMN erp.resource_price_history.changed_by IS 'Ссылка на профиль пользователя, изменившего цену (profiles.id)';
COMMENT ON COLUMN erp.resource_price_history.changed_at IS 'Дата и время изменения цены';

-- 2. Индекс
CREATE INDEX IF NOT EXISTS idx_res_price_history_res_reg
ON erp.resource_price_history(resource_id, region_id);

-- 3. Обновляем разрешённые роли profiles (добавляем pricer)
ALTER TABLE erp.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE erp.profiles ADD CONSTRAINT profiles_role_check CHECK (
  role = ANY (ARRAY[
    'admin'::text,
    'manager'::text,
    'director'::text,
    'estimator'::text,
    'employee'::text,
    'rop'::text,
    'senior_manager'::text,
    'lawyer'::text,
    'marketing'::text,
    'call_center'::text,
    'financial_director'::text,
    'pricer'::text
  ])
);

-- 4. Таблица связи сотрудников с разрешёнными регионами
CREATE TABLE IF NOT EXISTS erp.profile_regions (
    profile_id UUID REFERENCES erp.profiles(id) ON DELETE CASCADE,
    region_id UUID REFERENCES erp.dic_regions(id) ON DELETE CASCADE,
    PRIMARY KEY (profile_id, region_id)
);

COMMENT ON TABLE erp.profile_regions IS 'Связь сотрудников с разрешенными для них регионами (для ограничения редактирования цен)';

NOTIFY pgrst, 'reload schema';
