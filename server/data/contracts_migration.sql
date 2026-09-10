-- ============================================================
-- МОДУЛЬ «ДОГОВОРА» — SQL для выполнения в Supabase
-- Выполнить: Supabase Dashboard → SQL Editor → Run
-- ============================================================

-- 1. КОНТРАГЕНТЫ
CREATE TABLE IF NOT EXISTS public.contractors (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name   TEXT NOT NULL,
    bin_iin        VARCHAR(12),
    contact_person TEXT,
    phone          TEXT,
    email          TEXT,
    address        TEXT,
    notes          TEXT,
    is_active      BOOLEAN DEFAULT TRUE,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- 2. ДОГОВОРА
CREATE TABLE IF NOT EXISTS public.contracts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID REFERENCES public.projects(id) ON DELETE CASCADE,
    object_id       UUID REFERENCES public.project_objects(id) ON DELETE SET NULL,
    contractor_id   UUID REFERENCES public.contractors(id) ON DELETE RESTRICT,
    contract_number TEXT,
    contract_name   TEXT,
    contract_type   TEXT NOT NULL DEFAULT 'SUBCONTRACT',  -- SUBCONTRACT | SUPPLY
    contract_mode   TEXT NOT NULL DEFAULT 'STANDARD',     -- STANDARD | OPEN
    status          TEXT NOT NULL DEFAULT 'DRAFT',        -- DRAFT | PENDING_APPROVAL | APPROVED | REVISION | ACTIVE | CLOSED
    date_start      DATE,
    date_end        DATE,
    total_amount    NUMERIC DEFAULT 0,
    signed_at       TIMESTAMPTZ,
    created_by      UUID,
    approved_by     UUID,
    approved_at     TIMESTAMPTZ,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 3. НАЗНАЧЕНИЯ РАБОТ/РЕСУРСОВ К ДОГОВОРУ
CREATE TABLE IF NOT EXISTS public.contract_assignments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id         UUID REFERENCES public.contracts(id) ON DELETE CASCADE,
    assignment_type     TEXT NOT NULL,              -- WORK | RESOURCE
    -- Ссылка на строку сметы (работа)
    est_doc_work_id     UUID REFERENCES public.est_doc_works(id) ON DELETE SET NULL,
    -- Ссылка на ресурс из сметы (поставка)
    est_doc_resource_id UUID REFERENCES public.est_doc_resources(id) ON DELETE SET NULL,
    -- Снимок данных (на случай если запись источника удалена)
    work_name           TEXT,
    work_unit           TEXT,
    resource_name       TEXT,
    resource_unit       TEXT,
    resource_spec       TEXT,
    -- Количество
    total_quantity      NUMERIC NOT NULL DEFAULT 0,
    assigned_quantity   NUMERIC NOT NULL DEFAULT 0,
    unit_price          NUMERIC DEFAULT 0,
    total_price         NUMERIC GENERATED ALWAYS AS (assigned_quantity * unit_price) STORED,
    -- Статус строки и флаги
    status              TEXT DEFAULT 'PLANNED',    -- PLANNED | IN_PROGRESS | DONE | CANCELLED
    with_materials      BOOLEAN DEFAULT FALSE,
    notes               TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- 4. ИСТОРИЯ СОГЛАСОВАНИЯ
CREATE TABLE IF NOT EXISTS public.contract_approvals (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id  UUID REFERENCES public.contracts(id) ON DELETE CASCADE,
    action       TEXT NOT NULL,   -- SUBMITTED | APPROVED | REJECTED | REVISION
    performed_by UUID,
    comment      TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 5. ИНДЕКСЫ ДЛЯ ПРОИЗВОДИТЕЛЬНОСТИ
CREATE INDEX IF NOT EXISTS idx_contracts_project_id
    ON public.contracts(project_id);
CREATE INDEX IF NOT EXISTS idx_contracts_contractor_id
    ON public.contracts(contractor_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status
    ON public.contracts(status);
CREATE INDEX IF NOT EXISTS idx_contract_assignments_contract_id
    ON public.contract_assignments(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_assignments_est_doc_work_id
    ON public.contract_assignments(est_doc_work_id);
CREATE INDEX IF NOT EXISTS idx_contract_assignments_est_doc_resource_id
    ON public.contract_assignments(est_doc_resource_id);

-- 6. RLS (Row Level Security)
ALTER TABLE public.contractors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_approvals ENABLE ROW LEVEL SECURITY;

-- Аутентифицированные пользователи видят все записи
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='contractors' AND policyname='auth_contractors') THEN
        CREATE POLICY "auth_contractors" ON public.contractors FOR ALL TO authenticated USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='contracts' AND policyname='auth_contracts') THEN
        CREATE POLICY "auth_contracts" ON public.contracts FOR ALL TO authenticated USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='contract_assignments' AND policyname='auth_assignments') THEN
        CREATE POLICY "auth_assignments" ON public.contract_assignments FOR ALL TO authenticated USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='contract_approvals' AND policyname='auth_approvals') THEN
        CREATE POLICY "auth_approvals" ON public.contract_approvals FOR ALL TO authenticated USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Service role (backend без ограничений)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='contractors' AND policyname='svc_contractors') THEN
        CREATE POLICY "svc_contractors" ON public.contractors FOR ALL TO service_role USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='contracts' AND policyname='svc_contracts') THEN
        CREATE POLICY "svc_contracts" ON public.contracts FOR ALL TO service_role USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='contract_assignments' AND policyname='svc_assignments') THEN
        CREATE POLICY "svc_assignments" ON public.contract_assignments FOR ALL TO service_role USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='contract_approvals' AND policyname='svc_approvals') THEN
        CREATE POLICY "svc_approvals" ON public.contract_approvals FOR ALL TO service_role USING (true);
    END IF;
END $$;

-- ============================================================
-- ГОТОВО. Проверка: должны появиться 4 таблицы:
-- contractors, contracts, contract_assignments, contract_approvals
-- ============================================================
