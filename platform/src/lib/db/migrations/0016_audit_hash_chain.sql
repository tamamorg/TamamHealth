-- Tamper evidence for the server's audit trail.
--
-- CouchDB refuses to rewrite or delete an audit row, and the analytics copy
-- only ever inserts (ConflictPolicy.APPEND_ONLY). Neither stops someone with
-- database access editing a row directly, which is what a regulator asks about.
--
--   1. `audit_log` now refuses UPDATE and DELETE. Retention still works:
--      `prune_audit_log` is the one path allowed through, and it leaves a
--      checkpoint saying what it removed.
--   2. Every inserted row is chained into `audit_chain`: its hash covers the
--      row and the hash before it, so changing or removing any row breaks
--      every link after it. `verify_audit_chain()` reports the first break.
--
-- The chain uses an AFTER INSERT trigger on purpose. BEFORE INSERT also fires
-- for the duplicates `ON CONFLICT DO NOTHING` then drops, which would chain
-- rows that do not exist.
--
-- A database superuser can disable triggers or rewrite the whole chain, so
-- this is evidence, not prevention, and it needs a copy kept elsewhere:
-- `audit_chain_head()` is the value to record outside this database. Backups
-- already carry a dated copy of the chain.

CREATE TABLE IF NOT EXISTS audit_chain (
  seq BIGSERIAL PRIMARY KEY,
  audit_id TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  row_hash TEXT NOT NULL,
  chained_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_chain_audit_id ON audit_chain (audit_id);

-- One row per prune, so a gap at the start of the chain has an explanation.
CREATE TABLE IF NOT EXISTS audit_chain_checkpoint (
  id BIGSERIAL PRIMARY KEY,
  pruned_through_seq BIGINT NOT NULL,
  anchor_hash TEXT NOT NULL,
  rows_removed INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION audit_row_hash(prev TEXT, rec audit_log)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT encode(sha256(convert_to(jsonb_build_array(
    prev, rec.id, rec.action, rec.user_id, rec.username, rec.details, rec.success,
    rec.org_id, to_char(rec.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.USZ')
  )::text, 'UTF8')), 'hex');
$$;

CREATE OR REPLACE FUNCTION audit_chain_append()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  prev TEXT;
BEGIN
  -- One link at a time: two concurrent rows must not share a predecessor.
  PERFORM pg_advisory_xact_lock(hashtext('audit_chain'));
  SELECT row_hash INTO prev FROM audit_chain ORDER BY seq DESC LIMIT 1;
  prev := COALESCE(prev, 'genesis');
  INSERT INTO audit_chain (audit_id, prev_hash, row_hash)
    VALUES (NEW.id, prev, audit_row_hash(prev, NEW));
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION audit_log_refuse_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('tamamhealth.audit_prune', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_log is append-only: % refused', TG_OP;
END;
$$;

-- Rows already stored join the chain once, oldest first, before the guards
-- start. Safe to re-run: a chained row is skipped.
DO $$
DECLARE
  rec audit_log;
  prev TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('audit_chain'));
  SELECT row_hash INTO prev FROM audit_chain ORDER BY seq DESC LIMIT 1;
  prev := COALESCE(prev, 'genesis');
  FOR rec IN
    SELECT a.* FROM audit_log a
    WHERE NOT EXISTS (SELECT 1 FROM audit_chain c WHERE c.audit_id = a.id)
    ORDER BY a.created_at, a.id
  LOOP
    INSERT INTO audit_chain (audit_id, prev_hash, row_hash) VALUES (rec.id, prev, audit_row_hash(prev, rec));
    prev := audit_row_hash(prev, rec);
  END LOOP;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_chain_append ON audit_log;
CREATE TRIGGER trg_audit_chain_append AFTER INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_chain_append();

DROP TRIGGER IF EXISTS trg_audit_log_refuse_change ON audit_log;
CREATE TRIGGER trg_audit_log_refuse_change BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_refuse_change();

DROP TRIGGER IF EXISTS trg_audit_log_refuse_truncate ON audit_log;
CREATE TRIGGER trg_audit_log_refuse_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_refuse_change();

-- Retention keeps its 90-day floor. Only whole leading runs of the chain go, so
-- what remains still verifies from the checkpoint's anchor.
CREATE OR REPLACE FUNCTION prune_audit_log(retain_days integer)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  cutoff_seq BIGINT;
  anchor TEXT;
  removed integer;
BEGIN
  IF retain_days IS NULL OR retain_days < 90 THEN
    RAISE EXCEPTION 'prune_audit_log: refusing to retain less than 90 days (got %)', retain_days;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('audit_chain'));
  SELECT MIN(c.seq) - 1 INTO cutoff_seq
    FROM audit_chain c JOIN audit_log a ON a.id = c.audit_id
    WHERE a.created_at >= (now() - make_interval(days => retain_days));
  IF cutoff_seq IS NULL THEN
    SELECT MAX(seq) INTO cutoff_seq FROM audit_chain;
  END IF;
  IF cutoff_seq IS NULL OR cutoff_seq < 1 THEN
    RETURN 0;
  END IF;
  SELECT row_hash INTO anchor FROM audit_chain WHERE seq <= cutoff_seq ORDER BY seq DESC LIMIT 1;
  IF anchor IS NULL THEN
    RETURN 0;
  END IF;

  PERFORM set_config('tamamhealth.audit_prune', 'on', true);
  DELETE FROM audit_log a USING audit_chain c WHERE c.audit_id = a.id AND c.seq <= cutoff_seq;
  GET DIAGNOSTICS removed = ROW_COUNT;
  PERFORM set_config('tamamhealth.audit_prune', 'off', true);
  DELETE FROM audit_chain WHERE seq <= cutoff_seq;

  IF removed > 0 THEN
    INSERT INTO audit_chain_checkpoint (pruned_through_seq, anchor_hash, rows_removed)
      VALUES (cutoff_seq, anchor, removed);
  END IF;
  RAISE NOTICE 'prune_audit_log: removed % rows older than % days', removed, retain_days;
  RETURN removed;
END;
$$;

-- Walks the chain. `ok` is false at the first link that does not hold, and
-- `problem` says why. Reads the whole trail, so run it off-peak.
CREATE OR REPLACE FUNCTION verify_audit_chain()
RETURNS TABLE (ok BOOLEAN, rows_checked BIGINT, first_bad_seq BIGINT, problem TEXT)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  link audit_chain;
  entry audit_log;
  expected_prev TEXT;
  checked BIGINT := 0;
  orphans BIGINT;
BEGIN
  SELECT anchor_hash INTO expected_prev FROM audit_chain_checkpoint ORDER BY id DESC LIMIT 1;
  expected_prev := COALESCE(expected_prev, 'genesis');
  FOR link IN SELECT * FROM audit_chain ORDER BY seq LOOP
    IF link.prev_hash <> expected_prev THEN
      RETURN QUERY SELECT FALSE, checked, link.seq, 'the link to the previous row is broken: a chain row was removed or replaced'::text;
      RETURN;
    END IF;
    SELECT * INTO entry FROM audit_log WHERE id = link.audit_id;
    IF NOT FOUND THEN
      RETURN QUERY SELECT FALSE, checked, link.seq, 'an audit row is missing'::text;
      RETURN;
    END IF;
    IF audit_row_hash(link.prev_hash, entry) <> link.row_hash THEN
      RETURN QUERY SELECT FALSE, checked, link.seq, 'an audit row was changed'::text;
      RETURN;
    END IF;
    expected_prev := link.row_hash;
    checked := checked + 1;
  END LOOP;
  SELECT COUNT(*) INTO orphans FROM audit_log a
    WHERE NOT EXISTS (SELECT 1 FROM audit_chain c WHERE c.audit_id = a.id);
  IF orphans > 0 THEN
    RETURN QUERY SELECT FALSE, checked, NULL::bigint, (orphans || ' audit row(s) are outside the chain')::text;
    RETURN;
  END IF;
  RETURN QUERY SELECT TRUE, checked, NULL::bigint, NULL::text;
END;
$$;

-- The value to keep outside this database, so a rewritten chain shows.
CREATE OR REPLACE FUNCTION audit_chain_head()
RETURNS TABLE (seq BIGINT, row_hash TEXT, at TIMESTAMPTZ)
LANGUAGE sql
STABLE
AS $$
  SELECT c.seq, c.row_hash, now() FROM audit_chain c ORDER BY c.seq DESC LIMIT 1;
$$;
