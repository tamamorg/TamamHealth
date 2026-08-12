/**
 * TamamHealth sync-worker
 *
 * Polls CouchDB `_changes` for every tamamhealth_* database listed in the
 * platform's DB_TABLE_MAP and posts batches to the platform's /api/sync
 * webhook so PostgreSQL analytics tables stay current with the durable
 * CouchDB store.
 *
 * Architectural place:
 *   PouchDB (browser) -- replication --> CouchDB (durable, this server)
 *                                              |
 *                                              v  GET _changes?since=&include_docs=true
 *                                       sync-worker (this process)
 *                                              |
 *                                              v  POST /api/sync (HMAC-signed)
 *                                       platform Next.js app
 *                                              |
 *                                              v
 *                                       PostgreSQL (analytics)
 *
 * Design choices:
 *   - Pull, not push. CouchDB DOES support the `_changes?feed=continuous`
 *     mode, but pulling lets us survive CouchDB restarts without orchestrating
 *     a long-lived HTTP connection, and lets us throttle independently of
 *     CouchDB's outbound capacity.
 *   - State is per-database last-seen `seq` persisted to a JSON file. The
 *     /api/sync route ALSO persists last_seq into the sync_metadata Postgres
 *     table; if our local state file is lost we recover those signed
 *     checkpoints before polling.
 *   - Replay-resistant HMAC-SHA-256 over timestamp, nonce, method, path, and
 *     JSON payload, matching platform/src/lib/sync-auth.ts.
 *   - Self-contained. The Dockerfile pulls in nothing but Node.
 */

import { createHmac, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// ---------- Constants ----------------------------------------------------

/**
 * Hardcoded fallback list of databases. Mirrors DB_TABLE_MAP in
 * platform/src/app/api/sync/route.ts. We attempt to read that file at
 * startup (best-effort) and fall back to this set if the platform source is
 * not on disk (the worker container does not bundle the platform tree).
 */
const FALLBACK_DBS = Object.freeze([
  'tamamhealth_patients',
  'tamamhealth_hospitals',
  'tamamhealth_medical_records',
  'tamamhealth_lab_results',
  'tamamhealth_referrals',
  'tamamhealth_disease_alerts',
  'tamamhealth_prescriptions',
  'tamamhealth_births',
  'tamamhealth_deaths',
  'tamamhealth_immunizations',
  'tamamhealth_anc',
  'tamamhealth_facility_assessments',
  'tamamhealth_audit_log',
  'tamamhealth_organizations',
  // Phase 2 analytics writeback (added 2026-05). Keep aligned with
  // DB_TABLE_MAP in platform/src/app/api/sync/route.ts.
  'tamamhealth_problems',
  'tamamhealth_triage',
  'tamamhealth_appointments',
  'tamamhealth_follow_ups',
  // Phase 3 analytics writeback (added 2026-05). Messaging, financial
  // revenue cycle, regulatory append-only, operations, HR, infrastructure.
  'tamamhealth_messages',
  'tamamhealth_controlled_substance_log',
  'tamamhealth_pharmacy_inventory',
  'tamamhealth_telehealth',
  'tamamhealth_wards',
  'tamamhealth_blood_bank',
  'tamamhealth_emergency_plans',
  'tamamhealth_assets',
  'tamamhealth_staff_schedules',
  'tamamhealth_leave_requests',
  'tamamhealth_payroll_entries',
  'tamamhealth_patient_feedback',
  'tamamhealth_billing',
  'tamamhealth_fee_schedule',
  'tamamhealth_insurance_policies',
  'tamamhealth_eligibility_checks',
  'tamamhealth_charges',
  'tamamhealth_claims',
  'tamamhealth_adjustments',
  'tamamhealth_payments',
  'tamamhealth_refunds',
  'tamamhealth_payment_plans',
  'tamamhealth_invoices',
  'tamamhealth_ledger',
  // Nutrition screening writeback (SAM/MAM MCH indicator). Keep aligned with
  // DB_TABLE_MAP in platform/src/app/api/sync/route.ts.
  'tamamhealth_nutrition_screenings',
  // Program enrollment writeback (ART/TB/PMTCT/ANC/Nutrition/EPI/NCD care-cascade
  // indicators). Keep aligned with DB_TABLE_MAP in platform/src/app/api/sync/route.ts.
  'tamamhealth_program_enrollments',
]);

/**
 * Try to read DB names off the platform's route.ts. If the platform tree is
 * present at runtime (local docker-compose with bind mounts, or a developer's
 * machine), we'll auto-pick up newly-added databases without needing to redeploy
 * the worker. Otherwise, fall back to the constant above.
 */
async function loadDbList() {
  const candidatePaths = [
    process.env.PLATFORM_SYNC_ROUTE_PATH,
    '/app/platform/src/app/api/sync/route.ts',
    '../platform/src/app/api/sync/route.ts',
  ].filter(Boolean);

  for (const path of candidatePaths) {
    try {
      const src = await readFile(path, 'utf8');
      // Extract identifiers between the DB_TABLE_MAP { ... }; block.
      // The route.ts uses `tamamhealth_<name>: '<table>'` entries, so a
      // simple regex over keys suffices and is more robust than parsing TS.
      const blockMatch = src.match(/DB_TABLE_MAP[^{]*{([\s\S]*?)};/);
      if (!blockMatch) continue;
      const keys = [...blockMatch[1].matchAll(/(tamamhealth_[A-Za-z0-9_]+)\s*:/g)]
        .map((m) => m[1]);
      if (keys.length) {
        log('info', `loaded ${keys.length} db names from ${path}`);
        return Object.freeze([...new Set(keys)]);
      }
    } catch {
      // try next
    }
  }
  log('info', `using fallback db list (${FALLBACK_DBS.length} entries)`);
  return FALLBACK_DBS;
}

// ---------- Logging ------------------------------------------------------

function log(level, msg, extra) {
  const ts = new Date().toISOString();
  const line = extra
    ? `${ts} [${level}] ${msg} ${JSON.stringify(extra)}`
    : `${ts} [${level}] ${msg}`;
  // 'critical' goes to stderr alongside 'error': log shippers and alerting
  // rules key off the stream, so a CRITICAL line on stdout would be filed as
  // routine output and never page anyone.
  if (level === 'error' || level === 'critical') console.error(line);
  else console.log(line);
}

// ---------- Env validation ----------------------------------------------

function readEnv() {
  const errors = [];
  const required = ['COUCHDB_URL', 'COUCHDB_WEBHOOK_SECRET', 'PLATFORM_SYNC_URL'];
  const out = {};
  for (const k of required) {
    const v = process.env[k];
    if (!v) errors.push(`missing required env: ${k}`);
    else out[k] = v;
  }
  out.COUCHDB_USER = process.env.COUCHDB_USER || '';
  out.COUCHDB_PASSWORD = process.env.COUCHDB_PASSWORD || '';
  if (Boolean(out.COUCHDB_USER) !== Boolean(out.COUCHDB_PASSWORD)) {
    errors.push('COUCHDB_USER and COUCHDB_PASSWORD must either both be set or both be unset');
  }
  if (out.COUCHDB_WEBHOOK_SECRET && out.COUCHDB_WEBHOOK_SECRET.length < 32) {
    errors.push('COUCHDB_WEBHOOK_SECRET must be >=32 chars (matches platform/src/app/api/sync/route.ts)');
  }
  out.POLL_INTERVAL_MS = Number.parseInt(process.env.POLL_INTERVAL_MS || '5000', 10);
  out.BATCH_SIZE = Number.parseInt(process.env.BATCH_SIZE || '100', 10);
  out.STATE_FILE = process.env.STATE_FILE || '/var/lib/sync-worker/state.json';
  out.HEARTBEAT_FILE = process.env.HEARTBEAT_FILE || '/var/lib/sync-worker/heartbeat.json';
  out.BACKOFF_MS = Number.parseInt(process.env.BACKOFF_MS || '30000', 10);
  out.REQUEST_TIMEOUT_MS = Number.parseInt(process.env.REQUEST_TIMEOUT_MS || '15000', 10);
  if (process.env.REQUIRE_HTTPS === 'true' && out.PLATFORM_SYNC_URL) {
    try {
      if (new URL(out.PLATFORM_SYNC_URL).protocol !== 'https:') {
        errors.push('PLATFORM_SYNC_URL must use https:// when REQUIRE_HTTPS=true');
      }
    } catch {
      errors.push('PLATFORM_SYNC_URL is not a valid URL');
    }
  }
  if (!Number.isFinite(out.POLL_INTERVAL_MS) || out.POLL_INTERVAL_MS < 100) {
    errors.push('POLL_INTERVAL_MS must be a positive number >=100');
  }
  if (!Number.isFinite(out.BATCH_SIZE) || out.BATCH_SIZE < 1 || out.BATCH_SIZE > 10000) {
    errors.push('BATCH_SIZE must be between 1 and 10000');
  }
  if (!Number.isFinite(out.REQUEST_TIMEOUT_MS) || out.REQUEST_TIMEOUT_MS < 1000 || out.REQUEST_TIMEOUT_MS > 120000) {
    errors.push('REQUEST_TIMEOUT_MS must be between 1000 and 120000');
  }
  return { env: out, errors };
}

// ---------- State persistence -------------------------------------------

/**
 * State shape: { [dbName]: { seq: string, lastUpdated: string } }
 * We persist after every successful POST so a crash mid-tick replays at most
 * one batch per db.
 */
async function loadState(path) {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    log('error', `state file read failed (${path}): ${err.message} — starting from zero`);
    return {};
  }
}

/**
 * Recover per-database sequence numbers from the platform when the local
 * state file is gone (KAN-55 / MED-06).
 *
 * The state file lives on a container volume. Lose it — an ephemeral restart,
 * a recreated volume — and `loadState()` returns `{}`, which makes every one of
 * the ~46 databases replay from seq=0. That re-posts the entire history of
 * every patient record and prescription through /api/sync. The route's upserts
 * are keyed on document id so a correct replay is idempotent, but it is a large
 * unnecessary load and any gap in that idempotency corrupts analytics.
 *
 * `GET /api/sync` already reports `last_seq` per database from the
 * `sync_metadata` Postgres table, which the POST handler writes on every batch.
 * That is the same checkpoint, held somewhere the container cannot lose.
 *
 * Best-effort: if the platform or Postgres is unreachable we return null and
 * the caller falls back to a full replay with a CRITICAL log line. Refusing to
 * start would be worse — the worker would never catch up at all.
 *
 * Derives the status URL from PLATFORM_SYNC_URL so there is nothing new to
 * configure (the POST target and the GET source are the same endpoint).
 */
function buildSignedHeaders({ secret, method, url, body = '' }) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID();
  const pathname = new URL(url).pathname;
  const canonical = [timestamp, nonce, method.toUpperCase(), pathname, body].join('\n');
  const signature = 'sha256=' + createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
  return {
    'x-tamamhealth-signature': signature,
    'x-tamamhealth-timestamp': timestamp,
    'x-tamamhealth-nonce': nonce,
  };
}

async function recoverStateFromPlatform(syncUrl, secret, timeoutMs = 15000) {
  try {
    const res = await fetch(syncUrl, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...buildSignedHeaders({ secret, method: 'GET', url: syncUrl }),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      log('warn', `state recovery: /api/sync returned HTTP ${res.status}`);
      return null;
    }
    const body = await res.json();
    const rows = Array.isArray(body?.databases) ? body.databases : [];
    if (rows.length === 0) return null;

    const state = {};
    for (const row of rows) {
      // last_seq comes back as a string (CouchDB seqs are opaque strings, and
      // Postgres returns the column as text). Keep it opaque — never coerce to
      // a number, CouchDB 3 seqs look like "42-g1AAAA...".
      if (row?.db_name && row?.last_seq != null && String(row.last_seq) !== '0') {
        state[row.db_name] = { seq: String(row.last_seq) };
      }
    }
    return Object.keys(state).length > 0 ? state : null;
  } catch (err) {
    log('warn', `state recovery failed: ${err.message}`);
    return null;
  }
}

async function saveState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  // Atomic-ish write: write to .tmp then rename. Avoids partial writes on
  // SIGKILL during fs.writeFile().
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
  // Node's fs.rename is atomic on POSIX.
  const { rename } = await import('node:fs/promises');
  await rename(tmp, path);
}

async function saveHeartbeat(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify({ ...payload, timestamp: new Date().toISOString() }), 'utf8');
  const { rename } = await import('node:fs/promises');
  await rename(tmp, path);
}

// ---------- HTTP helpers ------------------------------------------------

/**
 * Split a CouchDB URL like `http://user:pass@couchdb:5984` into a
 * credential-free base URL plus an Authorization header. Node's fetch
 * rejects URLs that embed user/password ("Request cannot be constructed
 * from a URL that includes credentials"), so we have to lift the creds
 * out before issuing any request.
 *
 * Idempotent: a URL with no creds round-trips unchanged with `authHeader`
 * set to null.
 *
 * Returns the base URL with no trailing slash so callers can append
 * `/<db>/_changes` without worrying about double-slashes.
 */
function splitCouchAuth(rawUrl) {
  const u = new URL(rawUrl);
  let authHeader = null;
  if (u.username || u.password) {
    const user = decodeURIComponent(u.username);
    const pass = decodeURIComponent(u.password);
    authHeader = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
    u.username = '';
    u.password = '';
  }
  // Strip the trailing slash that `URL` adds when there's no path.
  const base = u.toString().replace(/\/$/, '');
  return { base, authHeader };
}

async function fetchChanges({ couchUrl, couchUser, couchPassword, db, since, batchSize, timeoutMs }) {
  const { base, authHeader } = splitCouchAuth(couchUrl);
  // CouchDB accepts since=0 as the "from the beginning" sentinel.
  const url = new URL(`${base}/${db}/_changes`);
  url.searchParams.set('since', since || '0');
  url.searchParams.set('include_docs', 'true');
  url.searchParams.set('limit', String(batchSize));
  // CouchDB's default is `feed=normal`; explicit for clarity.
  url.searchParams.set('feed', 'normal');

  const headers = {};
  if (couchUser && couchPassword) {
    headers.authorization = 'Basic ' + Buffer.from(`${couchUser}:${couchPassword}`).toString('base64');
  } else if (authHeader) {
    headers.authorization = authHeader;
  }

  const res = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // Note: never include the URL or auth header in this message — admin
    // credentials would leak into logs that ship to stdout / Loki / etc.
    throw new Error(`couchdb _changes ${db} HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function postSync({ syncUrl, secret, db, changes, timeoutMs }) {
  const payload = JSON.stringify({ db, changes });
  const res = await fetch(syncUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...buildSignedHeaders({ secret, method: 'POST', url: syncUrl, body: payload }),
    },
    body: payload,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(`/api/sync HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { ok: true }; }
  return parsed;
}

// ---------- Per-db poll cycle -------------------------------------------

async function pollDatabase({ env, state, db }) {
  const since = state[db]?.seq || '0';
  const result = await fetchChanges({
    couchUrl: env.COUCHDB_URL,
    couchUser: env.COUCHDB_USER,
    couchPassword: env.COUCHDB_PASSWORD,
    db,
    since,
    batchSize: env.BATCH_SIZE,
    timeoutMs: env.REQUEST_TIMEOUT_MS || 15000,
  });
  const changes = Array.isArray(result.results) ? result.results : [];

  if (changes.length === 0) {
    return { db, processed: 0, advancedTo: since };
  }

  // Map CouchDB's _changes shape to the route.ts expectation. CouchDB returns
  // { results: [{ seq, id, changes: [{rev}], doc, deleted }], last_seq, pending }
  const mapped = changes.map((c) => ({
    id: c.id,
    seq: typeof c.seq === 'string' || typeof c.seq === 'number' ? String(c.seq) : '',
    doc: c.doc,
    deleted: !!c.deleted,
  }));

  const resp = await postSync({
    syncUrl: env.PLATFORM_SYNC_URL,
    secret: env.COUCHDB_WEBHOOK_SECRET,
    db,
    changes: mapped,
    timeoutMs: env.REQUEST_TIMEOUT_MS || 15000,
  });

  // CouchDB's `last_seq` is authoritative; fall back to the final entry's seq.
  const newSeq = String(result.last_seq ?? mapped[mapped.length - 1]?.seq ?? since);

  // Fail-forward guard: if /api/sync reported per-doc errors, do NOT silently
  // advance the checkpoint past them — that was permanent, un-retried data
  // loss (a mapper/schema mismatch dropped every affected doc once, forever).
  // Instead hold the checkpoint so the batch retries next tick; after a bounded
  // number of attempts, advance past and loudly dead-letter it, so a single
  // permanently-bad doc can't stall the whole database's stream forever.
  const errorCount = resp && typeof resp.errors === 'number' ? resp.errors : 0;
  if (errorCount > 0) {
    const MAX_ERROR_RETRIES = 5;
    const retries = (state[db]?.errorRetries || 0) + 1;
    if (retries < MAX_ERROR_RETRIES) {
      log('error', `${db}: /api/sync reported ${errorCount} error(s); holding checkpoint for retry`, { since, retry: retries, max: MAX_ERROR_RETRIES });
      state[db] = { seq: since, errorRetries: retries, lastUpdated: new Date().toISOString() };
      return { db, processed: changes.length, advancedTo: since, response: resp, heldForRetry: true };
    }
    log('error', `${db}: DEAD-LETTER — ${errorCount} doc(s) failed ${MAX_ERROR_RETRIES} retries; advancing past to unblock the stream. Those docs did NOT reach national analytics — investigate /api/sync logs`, { from: since, to: newSeq });
    state[db] = { seq: newSeq, errorRetries: 0, lastUpdated: new Date().toISOString() };
    return { db, processed: changes.length, advancedTo: newSeq, response: resp, deadLettered: errorCount };
  }

  state[db] = { seq: newSeq, errorRetries: 0, lastUpdated: new Date().toISOString() };
  return { db, processed: changes.length, advancedTo: newSeq, response: resp };
}

// ---------- Main loop ----------------------------------------------------

export async function runOnce({ env, state, dbs }) {
  let totalProcessed = 0;
  let totalErrors = 0;
  for (const db of dbs) {
    try {
      const r = await pollDatabase({ env, state, db });
      if (r.processed > 0) {
        log('info', `synced ${r.processed} change(s) from ${db}, seq=${r.advancedTo}`);
      }
      totalProcessed += r.processed;
    } catch (err) {
      totalErrors += 1;
      log('error', `db=${db} poll failed: ${err.message}`);
    }
  }
  return { totalProcessed, totalErrors };
}

async function mainLoop({ env, dbs }) {
  let state = await loadState(env.STATE_FILE);
  await saveHeartbeat(env.HEARTBEAT_FILE, { status: 'starting', databases: dbs.length });

  // Empty state means either a genuine first run or a lost state file. We
  // cannot tell them apart locally, so ask the platform for the checkpoints it
  // holds in Postgres before deciding to replay everything (KAN-55).
  if (Object.keys(state).length === 0) {
    log('warn', `no local state at ${env.STATE_FILE} — attempting recovery from the platform's sync_metadata`);
    const recovered = await recoverStateFromPlatform(
      env.PLATFORM_SYNC_URL,
      env.COUCHDB_WEBHOOK_SECRET,
      env.REQUEST_TIMEOUT_MS,
    );
    if (recovered) {
      state = recovered;
      log('info', `state recovered for ${Object.keys(recovered).length} database(s); resuming from stored checkpoints`);
      // Write it back immediately so a crash before the first successful poll
      // doesn't send us round the same recovery loop.
      await saveState(env.STATE_FILE, state).catch((err) =>
        log('warn', `could not persist recovered state: ${err.message}`),
      );
    } else {
      log(
        'critical',
        `RECOVERING FROM SEQ=0 — no local state file and no usable checkpoints from the platform. ` +
        `All ${dbs.length} databases will replay their FULL history through /api/sync. ` +
        `This is expected on a genuine first run; on a restart it means the state volume was lost ` +
        `and analytics rows will be re-upserted. Verify STATE_FILE is on a persistent volume.`,
      );
    }
  }

  log('info', `worker starting; dbs=${dbs.length}, batch=${env.BATCH_SIZE}, interval=${env.POLL_INTERVAL_MS}ms, state=${env.STATE_FILE}`);

  let consecutiveFailures = 0;
  let stopping = false;

  // Graceful shutdown: persist state then exit.
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    log('info', `received ${signal}; flushing state and exiting`);
    try {
      await saveState(env.STATE_FILE, state);
    } catch (err) {
      log('error', `state flush failed during shutdown: ${err.message}`);
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });

  while (!stopping) {
    const tickStart = Date.now();
    const { totalProcessed, totalErrors } = await runOnce({ env, state, dbs });

    // Persist state after every tick — even if some dbs failed, the ones
    // that succeeded should not be re-played.
    try {
      await saveState(env.STATE_FILE, state);
    } catch (err) {
      log('error', `state file write failed: ${err.message}`);
    }
    await saveHeartbeat(env.HEARTBEAT_FILE, {
      status: totalErrors > 0 ? 'degraded' : 'ok',
      totalProcessed,
      totalErrors,
    }).catch((err) => log('error', `heartbeat write failed: ${err.message}`));

    if (totalErrors > 0 && totalProcessed === 0) {
      consecutiveFailures += 1;
    } else {
      consecutiveFailures = 0;
    }

    const elapsed = Date.now() - tickStart;
    let sleep = Math.max(0, env.POLL_INTERVAL_MS - elapsed);
    if (consecutiveFailures >= 3) {
      log('error', `${consecutiveFailures} consecutive empty-failure ticks; backing off ${env.BACKOFF_MS}ms`);
      sleep = env.BACKOFF_MS;
    }
    await new Promise((r) => setTimeout(r, sleep));
  }
}

// ---------- Entry --------------------------------------------------------

// Only run when invoked directly (not when imported by tests).
const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();

if (isMain) {
  const { env, errors } = readEnv();
  if (errors.length) {
    for (const e of errors) console.error(`[sync-worker] ${e}`);
    console.error('[sync-worker] required env: COUCHDB_URL, COUCHDB_WEBHOOK_SECRET (>=32 chars), PLATFORM_SYNC_URL');
    console.error('[sync-worker] optional env: POLL_INTERVAL_MS (default 5000), BATCH_SIZE (default 100), STATE_FILE, HEARTBEAT_FILE, BACKOFF_MS (default 30000), REQUEST_TIMEOUT_MS (default 15000), REQUIRE_HTTPS');
    process.exit(2);
  }
  loadDbList()
    .then((dbs) => mainLoop({ env, dbs }))
    .catch((err) => {
      log('error', `fatal: ${err.stack || err.message}`);
      process.exit(1);
    });
}

// Exports for tests.
export {
  buildSignedHeaders,
  loadDbList,
  readEnv,
  loadState,
  saveState,
  saveHeartbeat,
  pollDatabase,
  recoverStateFromPlatform,
  splitCouchAuth,
  FALLBACK_DBS,
};
