-- ============================================================================
-- Accounting project — post-import setup  (RUN LAST, after data is copied in)
-- ----------------------------------------------------------------------------
-- Run this AFTER 01_schema.sql AND after all rows have been copied into the new
-- project. It installs the two things we intentionally held back so they would
-- not interfere with the data copy:
--
--   1. The deposits BEFORE INSERT trigger — held back because it OVERWRITES
--      current_value / interest_accrued / last_compounded_at on every insert.
--      If it existed during import, your copied snapshots would be recomputed.
--      (Existing copied rows are untouched — the trigger only fires on NEW
--       inserts going forward.)
--   2. The weekly pg_cron compounding job — held back so it can't run mid-setup.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. BEFORE INSERT trigger on deposits (function defined in 01_schema.sql)
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_deposit_set_current_value ON public.deposits;
CREATE TRIGGER trg_deposit_set_current_value
BEFORE INSERT ON public.deposits
FOR EACH ROW
EXECUTE FUNCTION public.deposit_set_current_value();

-- AFTER INSERT: seed the interest-accrual trail for back-dated deposits (0009).
-- Held back during import for the same reason — it would write ledger rows for
-- copied deposits before the backfill step runs.
DROP TRIGGER IF EXISTS trg_deposit_accrue_on_insert ON public.deposits;
CREATE TRIGGER trg_deposit_accrue_on_insert
AFTER INSERT ON public.deposits
FOR EACH ROW
EXECUTE FUNCTION public.deposit_accrue_on_insert();

-- ---------------------------------------------------------------------------
-- 2. Weekly compounding cron — Monday 00:00 UTC.
--    Requires pg_cron. If CREATE EXTENSION errors with "permission denied",
--    enable pg_cron from the Supabase dashboard (Database → Extensions) first,
--    then re-run this file.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Idempotent: drop any existing job with this name, then schedule exactly one.
DO $$
DECLARE v_id BIGINT;
BEGIN
    FOR v_id IN SELECT jobid FROM cron.job WHERE jobname = 'deposit-weekly-compound' LOOP
        PERFORM cron.unschedule(v_id);
    END LOOP;
END $$;

SELECT cron.schedule(
    'deposit-weekly-compound',
    '0 0 * * 1',
    $$SELECT public.run_weekly_interest_job();$$
);

-- ---------------------------------------------------------------------------
-- 3. One-time backfill of the interest-accrual trail (0009) for all copied
--    deposits. Idempotent (ON CONFLICT DO NOTHING inside). Run after the data
--    copy so every historical week is recorded.
-- ---------------------------------------------------------------------------
SELECT public.accrue_all_deposit_weeks();
