-- ============================================================================
-- Altura Accounting — COMPLETE DATABASE SCHEMA (single file)
-- ----------------------------------------------------------------------------
-- Run this once on a fresh Supabase project's SQL editor to create the entire
-- database: extension, enum, functions, tables (in dependency order), indexes,
-- triggers, Row-Level Security policies, and the default "Altura" company.
--
-- Idempotent: safe to re-run (CREATE ... IF NOT EXISTS / OR REPLACE / guarded).
-- Company ids are alphanumeric:  'cmp_' + 10 random base62 chars.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Extensions & enum
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

DO $$
BEGIN
    CREATE TYPE public.user_role AS ENUM ('admin', 'user');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Company-id generator  ('cmp_' + 10 random base62 chars) — needed by the
--    clients.id default, so it must exist before the clients table.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gen_company_id() RETURNS text
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    alphabet CONSTANT text := '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    result   text := '';
    i        int;
BEGIN
    FOR i IN 1..10 LOOP
        result := result || substr(alphabet, 1 + floor(random() * 62)::int, 1);
    END LOOP;
    RETURN 'cmp_' || result;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. clients (companies)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.clients (
    id             TEXT NOT NULL DEFAULT public.gen_company_id(),
    name           TEXT NOT NULL,
    wallet_address TEXT,
    api_key        TEXT DEFAULT ('ak_' || replace(gen_random_uuid()::text, '-', '')),
    api_secret     TEXT DEFAULT (('sk_' || replace(gen_random_uuid()::text, '-', '')) || replace(gen_random_uuid()::text, '-', '')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT clients_pkey PRIMARY KEY (id),
    CONSTRAINT clients_name_key UNIQUE (name)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_api_key ON public.clients USING btree (api_key);

-- ---------------------------------------------------------------------------
-- 3. profiles  (keyed to auth.users; copied for completeness, not read at runtime)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id         UUID NOT NULL,
    email      TEXT,
    role       public.user_role NOT NULL DEFAULT 'user'::public.user_role,
    client_id  TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT profiles_pkey PRIMARY KEY (id),
    CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users (id) ON DELETE CASCADE,
    CONSTRAINT profiles_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_profiles_client_id ON public.profiles USING btree (client_id);

-- ---------------------------------------------------------------------------
-- 4. accounting_users — this app's own users (role + company). Source of truth.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.accounting_users (
    id         UUID NOT NULL,
    email      TEXT,
    role       TEXT NOT NULL DEFAULT 'user'::text,
    client_id  TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT accounting_users_pkey PRIMARY KEY (id),
    CONSTRAINT accounting_users_id_fkey FOREIGN KEY (id) REFERENCES auth.users (id) ON DELETE CASCADE,
    CONSTRAINT accounting_users_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients (id) ON DELETE SET NULL,
    CONSTRAINT accounting_users_role_check CHECK (role = ANY (ARRAY['admin'::text, 'user'::text]))
);

CREATE INDEX IF NOT EXISTS idx_accounting_users_client_id ON public.accounting_users USING btree (client_id);

-- ---------------------------------------------------------------------------
-- 5. RLS helper functions (SECURITY DEFINER -> bypass RLS, avoid recursion).
--    LANGUAGE sql, so they reference accounting_users — defined after it exists.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.accounting_users
        WHERE id = auth.uid() AND role = 'admin'
    );
$$;

CREATE OR REPLACE FUNCTION public.current_client_id()
RETURNS TEXT LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
    SELECT client_id FROM public.accounting_users WHERE id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- 6. Interest math + trigger functions.
--    Interest = 0.5% compounded per complete Mon–Sun week:
--        value = principal * 1.005 ^ weeks
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_weeks_since(
    p_deposit_date DATE,
    p_as_of        TIMESTAMPTZ DEFAULT NOW()
) RETURNS INT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    v_dow            INT;
    v_days_to_mon    INT;
    v_first_monday   DATE;
    v_interest_start DATE;
    v_today          DATE;
BEGIN
    v_dow := EXTRACT(ISODOW FROM p_deposit_date)::INT;
    v_days_to_mon := CASE WHEN v_dow = 1 THEN 7 ELSE 8 - v_dow END;
    v_first_monday   := p_deposit_date + v_days_to_mon;
    v_interest_start := v_first_monday + 7;
    v_today          := (p_as_of AT TIME ZONE 'UTC')::DATE;

    IF v_today < v_interest_start THEN
        RETURN 0;
    END IF;
    RETURN FLOOR((v_today - v_interest_start) / 7)::INT + 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.compute_current_value(
    p_principal    NUMERIC,
    p_deposit_date DATE,
    p_rate         NUMERIC DEFAULT 0.005,
    p_as_of        TIMESTAMPTZ DEFAULT NOW()
) RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
    SELECT ROUND(
        p_principal * POWER(1 + p_rate, public.complete_weeks_since(p_deposit_date, p_as_of)),
        2
    );
$$;

CREATE OR REPLACE FUNCTION public.refresh_deposit_current_value(p_deposit_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_amount    NUMERIC;
    v_date      DATE;
    v_rate      NUMERIC;
    v_withdrawn NUMERIC;
    v_remaining NUMERIC;
    v_cv        NUMERIC;
BEGIN
    SELECT d.amount, d.deposit_date, COALESCE(d.interest_rate, 0.005)
      INTO v_amount, v_date, v_rate
      FROM public.deposits d
     WHERE d.id = p_deposit_id;
    IF NOT FOUND THEN RETURN; END IF;

    SELECT COALESCE(SUM(wa.principal_withdrawn), 0)
      INTO v_withdrawn
      FROM public.withdrawal_allocations wa
      JOIN public.withdrawals w ON w.id = wa.withdrawal_id
     WHERE wa.deposit_id = p_deposit_id
       AND w.status <> 'rejected';

    v_remaining := GREATEST(v_amount - v_withdrawn, 0);
    v_cv        := public.compute_current_value(v_remaining, v_date, v_rate, NOW());

    UPDATE public.deposits
       SET current_value      = v_cv,
           interest_accrued   = GREATEST(v_cv - v_remaining, 0),
           last_compounded_at = NOW()
     WHERE id = p_deposit_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_all_deposit_current_values()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_count INT := 0;
    v_id    UUID;
BEGIN
    FOR v_id IN
        SELECT d.id FROM public.deposits d
         WHERE NOT EXISTS (SELECT 1 FROM public.closures c WHERE c.deposit_id = d.id)
    LOOP
        PERFORM public.refresh_deposit_current_value(v_id);
        v_count := v_count + 1;
    END LOOP;
    RETURN v_count;
END;
$$;

-- BEFORE INSERT trigger fn: seed current_value / interest on new deposits.
CREATE OR REPLACE FUNCTION public.deposit_set_current_value()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_cv NUMERIC;
BEGIN
    IF NEW.interest_rate IS NULL THEN
        NEW.interest_rate := 0.005;
    END IF;
    v_cv := public.compute_current_value(NEW.amount, NEW.deposit_date, NEW.interest_rate, NOW());
    NEW.current_value      := v_cv;
    NEW.interest_accrued   := GREATEST(v_cv - NEW.amount, 0);
    NEW.last_compounded_at := NOW();
    RETURN NEW;
END;
$$;

-- Append-only weekly interest ledger builder.
CREATE OR REPLACE FUNCTION public.accrue_deposit_weeks(p_deposit_id UUID)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_client_id      TEXT;
    v_amount         NUMERIC;
    v_date           DATE;
    v_rate           NUMERIC;
    v_withdrawn      NUMERIC;
    v_base           NUMERIC;
    v_dow            INT;
    v_days_to_mon    INT;
    v_first_monday   DATE;
    v_interest_start DATE;
    v_weeks          INT;
    v_k              INT;
    v_accrual        DATE;
    v_opening        NUMERIC;
    v_closing        NUMERIC;
    v_inserted       INT := 0;
BEGIN
    SELECT d.client_id, d.amount, d.deposit_date, COALESCE(d.interest_rate, 0.005)
      INTO v_client_id, v_amount, v_date, v_rate
      FROM public.deposits d
     WHERE d.id = p_deposit_id;
    IF NOT FOUND THEN RETURN 0; END IF;

    SELECT COALESCE(SUM(wa.principal_withdrawn), 0)
      INTO v_withdrawn
      FROM public.withdrawal_allocations wa
      JOIN public.withdrawals w ON w.id = wa.withdrawal_id
     WHERE wa.deposit_id = p_deposit_id
       AND w.status <> 'rejected';

    v_base  := GREATEST(v_amount - v_withdrawn, 0);
    v_weeks := public.complete_weeks_since(v_date, NOW());
    IF v_weeks < 1 THEN RETURN 0; END IF;

    v_dow            := EXTRACT(ISODOW FROM v_date)::INT;
    v_days_to_mon    := CASE WHEN v_dow = 1 THEN 7 ELSE 8 - v_dow END;
    v_first_monday   := v_date + v_days_to_mon;
    v_interest_start := v_first_monday + 7;

    FOR v_k IN 1..v_weeks LOOP
        v_accrual := v_interest_start + (v_k - 1) * 7;
        v_opening := ROUND(v_base * POWER(1 + v_rate, v_k - 1), 2);
        v_closing := ROUND(v_base * POWER(1 + v_rate, v_k), 2);

        INSERT INTO public.deposit_interest_accruals (
            deposit_id, client_id, week_number,
            period_start, period_end, accrual_date,
            interest_rate, principal_base,
            opening_value, interest_amount, closing_value
        ) VALUES (
            p_deposit_id, v_client_id, v_k,
            v_accrual - 7, v_accrual - 1, v_accrual,
            v_rate, v_base,
            v_opening, v_closing - v_opening, v_closing
        )
        ON CONFLICT (deposit_id, week_number) DO NOTHING;

        IF FOUND THEN v_inserted := v_inserted + 1; END IF;
    END LOOP;

    RETURN v_inserted;
END;
$$;

CREATE OR REPLACE FUNCTION public.accrue_all_deposit_weeks()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_total INT := 0;
    v_id    UUID;
BEGIN
    FOR v_id IN
        SELECT d.id FROM public.deposits d
         WHERE NOT EXISTS (SELECT 1 FROM public.closures c WHERE c.deposit_id = d.id)
    LOOP
        v_total := v_total + public.accrue_deposit_weeks(v_id);
    END LOOP;
    RETURN v_total;
END;
$$;

-- Weekly job (wire to pg_cron): refresh current values + extend the ledger.
CREATE OR REPLACE FUNCTION public.run_weekly_interest_job()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM public.refresh_all_deposit_current_values();
    PERFORM public.accrue_all_deposit_weeks();
END;
$$;

-- AFTER INSERT trigger fn: seed the ledger for back-dated deposits.
CREATE OR REPLACE FUNCTION public.deposit_accrue_on_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM public.accrue_deposit_weeks(NEW.id);
    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. deposits  (+ triggers, now that the trigger functions exist)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deposits (
    id                 UUID NOT NULL DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL,
    client_id          TEXT NOT NULL DEFAULT 'cmp_ZVsWOFqVpB'::text,
    amount             NUMERIC(20, 2) NOT NULL,
    deposit_date       DATE NOT NULL,
    interest_rate      NUMERIC(8, 6) NOT NULL DEFAULT 0.005,
    current_value      NUMERIC(20, 2),
    interest_accrued   NUMERIC(20, 2) NOT NULL DEFAULT 0,
    last_compounded_at TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT deposits_pkey PRIMARY KEY (id),
    CONSTRAINT deposits_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients (id) ON DELETE RESTRICT,
    CONSTRAINT deposits_amount_check CHECK (amount > (0)::numeric)
);

CREATE INDEX IF NOT EXISTS idx_deposits_client_id ON public.deposits USING btree (client_id);

DROP TRIGGER IF EXISTS trg_deposit_set_current_value ON public.deposits;
CREATE TRIGGER trg_deposit_set_current_value
    BEFORE INSERT ON public.deposits
    FOR EACH ROW EXECUTE FUNCTION public.deposit_set_current_value();

DROP TRIGGER IF EXISTS trg_deposit_accrue_on_insert ON public.deposits;
CREATE TRIGGER trg_deposit_accrue_on_insert
    AFTER INSERT ON public.deposits
    FOR EACH ROW EXECUTE FUNCTION public.deposit_accrue_on_insert();

-- ---------------------------------------------------------------------------
-- 8. closures
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.closures (
    id                UUID NOT NULL DEFAULT gen_random_uuid(),
    deposit_id        UUID NOT NULL,
    user_id           UUID NOT NULL,
    client_id         TEXT NOT NULL DEFAULT 'cmp_ZVsWOFqVpB'::text,
    principal         NUMERIC(20, 2) NOT NULL,
    interest_redeemed NUMERIC(20, 2) NOT NULL DEFAULT 0,
    total_payout      NUMERIC(20, 2) NOT NULL,
    weeks_elapsed     INTEGER NOT NULL DEFAULT 0,
    closure_date      DATE NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT closures_pkey PRIMARY KEY (id),
    CONSTRAINT closures_deposit_id_fkey FOREIGN KEY (deposit_id) REFERENCES public.deposits (id) ON DELETE RESTRICT,
    CONSTRAINT closures_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients (id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_closures_deposit_id ON public.closures USING btree (deposit_id);
CREATE INDEX IF NOT EXISTS idx_closures_client_id  ON public.closures USING btree (client_id);

-- ---------------------------------------------------------------------------
-- 9. withdrawals
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.withdrawals (
    id              UUID NOT NULL DEFAULT gen_random_uuid(),
    client_id       TEXT NOT NULL,
    user_id         UUID NOT NULL,
    amount          NUMERIC(20, 2) NOT NULL,
    interest_paid   NUMERIC(20, 2) NOT NULL DEFAULT 0,
    total_payout    NUMERIC(20, 2) NOT NULL,
    withdrawal_date DATE NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending'::text,
    tx_hash         TEXT,
    wallet_address  TEXT,
    approved_by     UUID,
    approved_at     TIMESTAMPTZ,
    rejected_reason TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT withdrawals_pkey PRIMARY KEY (id),
    CONSTRAINT withdrawals_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients (id) ON DELETE RESTRICT,
    CONSTRAINT withdrawals_amount_check CHECK (amount > (0)::numeric),
    CONSTRAINT withdrawals_status_check CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]))
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_status    ON public.withdrawals USING btree (status);
CREATE INDEX IF NOT EXISTS idx_withdrawals_client_id ON public.withdrawals USING btree (client_id);

-- ---------------------------------------------------------------------------
-- 10. withdrawal_allocations  (per-deposit slice of each withdrawal, FIFO)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.withdrawal_allocations (
    id                  UUID NOT NULL DEFAULT gen_random_uuid(),
    withdrawal_id       UUID NOT NULL,
    deposit_id          UUID NOT NULL,
    principal_withdrawn NUMERIC(20, 2) NOT NULL,
    interest_withdrawn  NUMERIC(20, 2) NOT NULL DEFAULT 0,
    weeks_elapsed       INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT withdrawal_allocations_pkey PRIMARY KEY (id),
    CONSTRAINT withdrawal_allocations_withdrawal_id_fkey FOREIGN KEY (withdrawal_id) REFERENCES public.withdrawals (id) ON DELETE CASCADE,
    CONSTRAINT withdrawal_allocations_deposit_id_fkey FOREIGN KEY (deposit_id) REFERENCES public.deposits (id) ON DELETE RESTRICT,
    CONSTRAINT withdrawal_allocations_principal_withdrawn_check CHECK (principal_withdrawn > (0)::numeric)
);

CREATE INDEX IF NOT EXISTS idx_withdrawal_allocations_withdrawal_id ON public.withdrawal_allocations USING btree (withdrawal_id);
CREATE INDEX IF NOT EXISTS idx_withdrawal_allocations_deposit_id    ON public.withdrawal_allocations USING btree (deposit_id);

-- ---------------------------------------------------------------------------
-- 11. deposit_interest_accruals  (append-only per-week interest trail)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deposit_interest_accruals (
    id              UUID NOT NULL DEFAULT gen_random_uuid(),
    deposit_id      UUID NOT NULL,
    client_id       TEXT NOT NULL,
    week_number     INTEGER NOT NULL,
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    accrual_date    DATE NOT NULL,
    interest_rate   NUMERIC(8, 6) NOT NULL,
    principal_base  NUMERIC(20, 2) NOT NULL,
    opening_value   NUMERIC(20, 2) NOT NULL,
    interest_amount NUMERIC(20, 2) NOT NULL,
    closing_value   NUMERIC(20, 2) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT deposit_interest_accruals_pkey PRIMARY KEY (id),
    CONSTRAINT deposit_interest_accruals_deposit_id_week_number_key UNIQUE (deposit_id, week_number),
    CONSTRAINT deposit_interest_accruals_deposit_id_fkey FOREIGN KEY (deposit_id) REFERENCES public.deposits (id) ON DELETE CASCADE,
    CONSTRAINT deposit_interest_accruals_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients (id)
);

CREATE INDEX IF NOT EXISTS idx_accruals_deposit_id   ON public.deposit_interest_accruals USING btree (deposit_id);
CREATE INDEX IF NOT EXISTS idx_accruals_accrual_date ON public.deposit_interest_accruals USING btree (accrual_date);
CREATE INDEX IF NOT EXISTS idx_accruals_client_id    ON public.deposit_interest_accruals USING btree (client_id);

-- ---------------------------------------------------------------------------
-- 12. Withdrawal RPCs + API-credential regenerate
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_withdrawal(
    p_client_id       TEXT,
    p_withdrawal_date DATE,
    p_allocations     JSONB
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_withdrawal_id   UUID;
    v_alloc           JSONB;
    v_deposit_id      UUID;
    v_principal       NUMERIC;
    v_interest        NUMERIC;
    v_remaining       NUMERIC;
    v_total_principal NUMERIC := 0;
    v_total_interest  NUMERIC := 0;
    v_uid             UUID := auth.uid();
    v_wallet          TEXT;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

    IF NOT (public.is_admin() OR public.current_client_id() = p_client_id) THEN
        RAISE EXCEPTION 'Not authorized to withdraw from this company';
    END IF;

    SELECT wallet_address INTO v_wallet FROM public.clients WHERE id = p_client_id;
    IF v_wallet IS NULL OR btrim(v_wallet) = '' THEN
        RAISE EXCEPTION 'This company has no withdrawal wallet address set';
    END IF;

    IF p_allocations IS NULL
       OR jsonb_typeof(p_allocations) <> 'array'
       OR jsonb_array_length(p_allocations) = 0 THEN
        RAISE EXCEPTION 'No allocations provided';
    END IF;

    FOR v_alloc IN SELECT jsonb_array_elements(p_allocations)
    LOOP
        v_deposit_id := (v_alloc->>'deposit_id')::UUID;
        v_principal  := ROUND((v_alloc->>'principal_withdrawn')::NUMERIC, 2);
        v_interest   := ROUND(COALESCE((v_alloc->>'interest_withdrawn')::NUMERIC, 0), 2);

        IF v_principal <= 0 THEN
            RAISE EXCEPTION 'Withdrawal principal must be positive';
        END IF;

        SELECT d.amount
             - COALESCE((SELECT SUM(wa.principal_withdrawn)
                           FROM public.withdrawal_allocations wa
                           JOIN public.withdrawals w ON w.id = wa.withdrawal_id
                          WHERE wa.deposit_id = d.id
                            AND w.status <> 'rejected'), 0)
          INTO v_remaining
          FROM public.deposits d
         WHERE d.id = v_deposit_id AND d.client_id = p_client_id
         FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Deposit % does not belong to this company', v_deposit_id;
        END IF;

        IF EXISTS (SELECT 1 FROM public.closures c WHERE c.deposit_id = v_deposit_id) THEN
            RAISE EXCEPTION 'Deposit % is already closed', v_deposit_id;
        END IF;

        IF v_principal > v_remaining + 0.005 THEN
            RAISE EXCEPTION 'Withdrawal exceeds remaining principal for deposit %', v_deposit_id;
        END IF;

        v_total_principal := v_total_principal + v_principal;
        v_total_interest  := v_total_interest + v_interest;
    END LOOP;

    INSERT INTO public.withdrawals
        (client_id, user_id, amount, interest_paid, total_payout, withdrawal_date, wallet_address, status)
    VALUES
        (p_client_id, v_uid, v_total_principal, v_total_interest,
         v_total_principal + v_total_interest, p_withdrawal_date, v_wallet, 'pending')
    RETURNING id INTO v_withdrawal_id;

    FOR v_alloc IN SELECT jsonb_array_elements(p_allocations)
    LOOP
        INSERT INTO public.withdrawal_allocations
            (withdrawal_id, deposit_id, principal_withdrawn, interest_withdrawn, weeks_elapsed)
        VALUES (
            v_withdrawal_id,
            (v_alloc->>'deposit_id')::UUID,
            ROUND((v_alloc->>'principal_withdrawn')::NUMERIC, 2),
            ROUND(COALESCE((v_alloc->>'interest_withdrawn')::NUMERIC, 0), 2),
            COALESCE((v_alloc->>'weeks_elapsed')::INT, 0)
        );
        PERFORM public.refresh_deposit_current_value((v_alloc->>'deposit_id')::UUID);
    END LOOP;

    RETURN v_withdrawal_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_withdrawal(TEXT, DATE, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_withdrawal(
    p_withdrawal_id UUID,
    p_tx_hash       TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Only admins can approve withdrawals';
    END IF;

    IF p_tx_hash IS NULL OR btrim(p_tx_hash) = '' THEN
        RAISE EXCEPTION 'A transaction hash is required to approve';
    END IF;

    UPDATE public.withdrawals
       SET status          = 'approved',
           tx_hash         = btrim(p_tx_hash),
           approved_by     = auth.uid(),
           approved_at     = NOW(),
           rejected_reason = NULL
     WHERE id = p_withdrawal_id
       AND status = 'pending';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Withdrawal not found or not pending';
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_withdrawal(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_withdrawal(
    p_withdrawal_id UUID,
    p_reason        TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_deposit_id UUID;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Only admins can reject withdrawals';
    END IF;

    UPDATE public.withdrawals
       SET status          = 'rejected',
           rejected_reason = NULLIF(btrim(COALESCE(p_reason, '')), ''),
           approved_by     = auth.uid(),
           approved_at     = NOW()
     WHERE id = p_withdrawal_id
       AND status = 'pending';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Withdrawal not found or not pending';
    END IF;

    FOR v_deposit_id IN
        SELECT DISTINCT deposit_id
          FROM public.withdrawal_allocations
         WHERE withdrawal_id = p_withdrawal_id
    LOOP
        PERFORM public.refresh_deposit_current_value(v_deposit_id);
    END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_withdrawal(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.regenerate_company_api_credentials(p_client_id TEXT)
RETURNS TABLE(api_key TEXT, api_secret TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_key    TEXT := 'ak_' || replace(gen_random_uuid()::text, '-', '');
    v_secret TEXT := 'sk_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
BEGIN
    IF NOT (public.is_admin() OR public.current_client_id() = p_client_id) THEN
        RAISE EXCEPTION 'Not authorized to manage this company''s API credentials';
    END IF;

    UPDATE public.clients
       SET api_key = v_key, api_secret = v_secret
     WHERE id = p_client_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Company not found';
    END IF;

    RETURN QUERY SELECT v_key, v_secret;
END;
$$;

GRANT EXECUTE ON FUNCTION public.regenerate_company_api_credentials(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 13. Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles
    FOR SELECT USING (id = auth.uid());

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clients_select" ON public.clients;
CREATE POLICY "clients_select" ON public.clients
    FOR SELECT USING (public.is_admin() OR id = public.current_client_id());
DROP POLICY IF EXISTS "clients_admin_write" ON public.clients;
CREATE POLICY "clients_admin_write" ON public.clients
    FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

ALTER TABLE public.accounting_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "accounting_users_select" ON public.accounting_users;
CREATE POLICY "accounting_users_select" ON public.accounting_users
    FOR SELECT USING (public.is_admin() OR id = auth.uid());
DROP POLICY IF EXISTS "accounting_users_admin_write" ON public.accounting_users;
CREATE POLICY "accounting_users_admin_write" ON public.accounting_users
    FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

ALTER TABLE public.deposits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deposits_select" ON public.deposits;
CREATE POLICY "deposits_select" ON public.deposits
    FOR SELECT USING (public.is_admin() OR client_id = public.current_client_id());
DROP POLICY IF EXISTS "deposits_admin_write" ON public.deposits;
CREATE POLICY "deposits_admin_write" ON public.deposits
    FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

ALTER TABLE public.closures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "closures_select" ON public.closures;
CREATE POLICY "closures_select" ON public.closures
    FOR SELECT USING (public.is_admin() OR client_id = public.current_client_id());
DROP POLICY IF EXISTS "closures_admin_write" ON public.closures;
CREATE POLICY "closures_admin_write" ON public.closures
    FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "withdrawals_select" ON public.withdrawals;
CREATE POLICY "withdrawals_select" ON public.withdrawals
    FOR SELECT USING (public.is_admin() OR client_id = public.current_client_id());
DROP POLICY IF EXISTS "withdrawals_admin_write" ON public.withdrawals;
CREATE POLICY "withdrawals_admin_write" ON public.withdrawals
    FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

ALTER TABLE public.withdrawal_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "withdrawal_allocations_select" ON public.withdrawal_allocations;
CREATE POLICY "withdrawal_allocations_select" ON public.withdrawal_allocations
    FOR SELECT USING (
        public.is_admin()
        OR EXISTS (
            SELECT 1 FROM public.withdrawals w
            WHERE w.id = withdrawal_id
              AND w.client_id = public.current_client_id()
        )
    );
DROP POLICY IF EXISTS "withdrawal_allocations_admin_write" ON public.withdrawal_allocations;
CREATE POLICY "withdrawal_allocations_admin_write" ON public.withdrawal_allocations
    FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

ALTER TABLE public.deposit_interest_accruals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "accruals_select" ON public.deposit_interest_accruals;
CREATE POLICY "accruals_select" ON public.deposit_interest_accruals
    FOR SELECT USING (public.is_admin() OR client_id = public.current_client_id());
DROP POLICY IF EXISTS "accruals_admin_write" ON public.deposit_interest_accruals;
CREATE POLICY "accruals_admin_write" ON public.deposit_interest_accruals
    FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- 14. Seed the default "Altura" company at the fixed id the app expects
--     (src/lib/supabase.ts -> ALTURA_CLIENT_ID = 'cmp_ZVsWOFqVpB').
-- ---------------------------------------------------------------------------
INSERT INTO public.clients (id, name)
VALUES ('cmp_ZVsWOFqVpB', 'Altura')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- End of schema. Next: create an admin via scripts/seed-admin.mjs, then
-- (optionally) schedule run_weekly_interest_job() with pg_cron.
-- ============================================================================
