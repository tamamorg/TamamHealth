-- ============================================================================
-- 0013 — Retention for the append-only analytics trail.
--
-- `audit_log` grows without bound. Nothing in the platform ever removed a row,
-- and nothing declared how long one should be kept, which is both a capacity
-- problem (it is the highest-volume table in the analytics database, taking a
-- row for every PHI read) and a compliance one: a health regulator generally
-- asks how long audit records are retained, and "forever, by omission" is not
-- an answer anybody chose.
--
-- WHAT THIS DOES NOT DO: it does not schedule itself. Deleting audit history on
-- a timer nobody configured is exactly the kind of surprise this codebase
-- avoids elsewhere, and the correct window is a policy decision that varies by
-- jurisdiction. This migration provides the mechanism and the index that makes
-- it cheap; the operator chooses the window and the schedule.
--
-- To run it (see docs/OPERATOR-RUNBOOK.md):
--
--   SELECT prune_audit_log(2555);   -- keep 7 years, the usual clinical floor
--
-- Wire it to pg_cron, a systemd timer, or the nightly backup job. It reports
-- how many rows it removed and refuses a window short enough to look like a
-- mistake.
--
-- The device-side half of this lives in `lib/services/audit-retention.ts`,
-- which trims each tablet's local copy to 90 days once those entries are
-- confirmed upstream. The two are independent: the server is the trail of
-- record, the device only needs a recent window.
-- ============================================================================

-- Deleting by date is a sequential scan without this; with it the delete only
-- touches the rows it removes. `created_at` is the column the analytics
-- projection writes (see FIELD_MAPPERS in app/api/sync/route.ts) — the CouchDB
-- document calls it `timestamp`, and they are not the same name.
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at);

-- A floor, not a default. 90 days is far below any clinical retention rule, so
-- a caller passing a smaller number has almost certainly made an error — a
-- missing shell variable expanding to 0, say — and the cost of being wrong here
-- is unrecoverable.
CREATE OR REPLACE FUNCTION prune_audit_log(retain_days integer)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  removed integer;
BEGIN
  IF retain_days IS NULL OR retain_days < 90 THEN
    RAISE EXCEPTION 'prune_audit_log: refusing to retain less than 90 days (got %)', retain_days;
  END IF;

  DELETE FROM audit_log
  WHERE created_at < (now() - make_interval(days => retain_days));

  GET DIAGNOSTICS removed = ROW_COUNT;
  RAISE NOTICE 'prune_audit_log: removed % rows older than % days', removed, retain_days;
  RETURN removed;
END;
$$;
