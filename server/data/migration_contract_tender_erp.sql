-- =========================================================================
-- МИГРАЦИЯ: Тендерная сумма договора и распределение по видам работ
-- ЗАПУСТИТЬ В SQL EDITOR STUDIO (http://10.66.0.105:8000)
-- =========================================================================

-- 1. На договоре: тендерная сумма и какие виды ресурсов участвуют в распределении
--    (материалы / трудовые ресурсы / машины и механизмы — любая комбинация).
ALTER TABLE erp.contracts
  ADD COLUMN IF NOT EXISTS tender_amount numeric,
  ADD COLUMN IF NOT EXISTS tender_resource_types text[];

-- 2. Результат распределения тендерной суммы по работам договора — считается на
--    сервере (см. POST /api/contracts/:id/tender-distribution) и сохраняется сюда,
--    чтобы не пересчитывать каждый раз и хранить историю коэффициента.
CREATE TABLE IF NOT EXISTS erp.contract_tender_distribution (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid NOT NULL REFERENCES erp.contracts(id) ON DELETE CASCADE,
    est_doc_work_id uuid NOT NULL REFERENCES erp.est_doc_works(id) ON DELETE CASCADE,
    work_name text,
    original_amount numeric NOT NULL,   -- Sᵢ: сумма по выбранным видам ресурсов из исходной сметы
    coefficient numeric NOT NULL,       -- k = S_тендер / S_смета
    distributed_amount numeric NOT NULL, -- Sᵢ_новая = Sᵢ × k
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE (contract_id, est_doc_work_id)
);

CREATE INDEX IF NOT EXISTS idx_tender_dist_contract ON erp.contract_tender_distribution(contract_id);

COMMENT ON TABLE erp.contract_tender_distribution IS
  'Распределение тендерной суммы договора по работам, пропорционально их доле в исходной смете (только по выбранным видам ресурсов). k = S_тендер / S_смета, Sᵢ_новая = Sᵢ × k.';

GRANT ALL ON erp.contract_tender_distribution TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
