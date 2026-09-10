-- =========================================================================
-- МИГРАЦИЯ: US-10-01 Оперфакт (операционный факт по работам)
-- ЗАПУСТИТЬ В SQL EDITOR STUDIO (http://10.66.0.105:8000)
-- =========================================================================

CREATE TABLE IF NOT EXISTS erp.est_operational_facts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Источник
    external_id text,                                              -- ID оперфакта во внешней системе (mobile.reports.id)
    assignment_id uuid REFERENCES erp.contract_assignments(id) ON DELETE SET NULL,

    -- Сопоставленные сущности (снимок на момент поступления)
    project_id uuid REFERENCES erp.projects(id) ON DELETE CASCADE,
    project_name text,
    object_id uuid REFERENCES erp.project_objects(id) ON DELETE SET NULL,
    object_name text,
    contract_id uuid REFERENCES erp.contracts(id) ON DELETE SET NULL,
    contract_number text,
    contractor_id uuid REFERENCES erp.contractors(id) ON DELETE SET NULL,
    doc_work_id uuid REFERENCES erp.est_doc_works(id) ON DELETE SET NULL,
    work_name text,

    -- Исполнитель
    executor_type text NOT NULL DEFAULT 'counterparty' CHECK (executor_type IN ('counterparty', 'organization')),
    department_or_contractor text,                                 -- название контрагента ИЛИ отдела
    executor_name text,                                            -- ФИО исполнителя

    -- Объёмы/сумма
    reported_volume numeric NOT NULL DEFAULT 0,                    -- заявленный факт (из мобильного)
    unit text,
    amount numeric,
    plan_volume numeric,                                           -- план работы на момент поступления
    confirmed_volume numeric,                                      -- объём, принятый пользователем (может отличаться от reported_volume)
    remaining_volume numeric,                                      -- план - (сумма подтверждённых фактов, включая этот) на момент подтверждения

    -- Даты
    planned_date date,
    execution_date date,
    confirmed_at timestamptz,
    confirmed_by uuid REFERENCES erp.profiles(id) ON DELETE SET NULL,
    rejection_reason text,

    -- Прочее
    documents jsonb DEFAULT '[]'::jsonb,                           -- [{url, type, lat, lon}, ...]
    status text NOT NULL DEFAULT 'pending_approval'
        CHECK (status IN ('pending_approval', 'approved', 'rejected', 'matching_error')),
    matching_error_details text,

    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oper_facts_project ON erp.est_operational_facts(project_id);
CREATE INDEX IF NOT EXISTS idx_oper_facts_doc_work ON erp.est_operational_facts(doc_work_id);
CREATE INDEX IF NOT EXISTS idx_oper_facts_status ON erp.est_operational_facts(status);
CREATE INDEX IF NOT EXISTS idx_oper_facts_external_id ON erp.est_operational_facts(external_id);

COMMENT ON TABLE erp.est_operational_facts IS 'Оперфакты (US-10-01) — операционные факты по работам, поступившие из мобильного приложения (через contract_assignments) либо заведённые вручную для внутренних бригад, до подтверждения пользователем УСП';

GRANT ALL ON erp.est_operational_facts TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
