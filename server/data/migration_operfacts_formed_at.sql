-- Добавляет "Дата формирования оперфакта" — отдельно от created_at (момент записи в нашу
-- базу), это дата формирования оперфакта во внешней (мобильной) системе, по ТЗ US-10-01 п.2.
ALTER TABLE erp.est_operational_facts ADD COLUMN IF NOT EXISTS formed_at timestamptz;
COMMENT ON COLUMN erp.est_operational_facts.formed_at IS 'Дата формирования оперфакта во внешней системе (не путать с created_at — временем записи в УСП)';
NOTIFY pgrst, 'reload schema';
