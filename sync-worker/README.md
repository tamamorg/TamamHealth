# sync-worker

Long-running Node 20 process that bridges **CouchDB** (the durable clinical
store) to **PostgreSQL** (the analytics store) via the platform's
`/api/sync` HMAC-signed webhook.

```
PouchDB (browser) -- replication --> CouchDB (durable, this server)
                                            |
                                            v   GET _changes?since=&include_docs=true
                                     sync-worker  (this process)
                                            |
                                            v   POST /api/sync (HMAC-signed)
                                     platform Next.js app
                                            |
                                            v
                                     PostgreSQL (analytics)
```

This is **not** redundant with CouchDB — the platform serves clinical data
out of PouchDB↔CouchDB, and PostgreSQL is downstream-only for cross-facility
reporting and long-horizon trend queries.

---

## Why a worker (vs. configuring CouchDB to push)?

CouchDB's `_changes?feed=continuous` mode would let the platform pull
directly. We chose a separate pull-style worker because:

1. **Restart isolation.** A platform restart doesn't lose the CouchDB
   connection — the worker holds it. A CouchDB restart doesn't drop a long-
   lived HTTP connection that the platform was relying on.
2. **Independent throttling.** If Postgres is slow, the worker backs off
   without blocking CouchDB.
3. **One-place HMAC.** The webhook secret only needs to live on the worker
   and the platform, not in CouchDB config.

---

## Environment

| Var                       | Required | Default                              | Notes                                                                                               |
|---------------------------|----------|--------------------------------------|-----------------------------------------------------------------------------------------------------|
| `COUCHDB_URL`             | yes      | —                                    | Credential-free internal CouchDB URL, e.g. `http://couchdb:5984`.                                    |
| `COUCHDB_USER`            | production | —                                  | CouchDB machine user. Set together with `COUCHDB_PASSWORD`; never embed it in the URL.                |
| `COUCHDB_PASSWORD`        | production | —                                  | CouchDB machine password.                                                                            |
| `COUCHDB_WEBHOOK_SECRET`  | yes      | —                                    | Min 32 chars. Shared with the platform; signs timestamp, nonce, method, path, and body.               |
| `PLATFORM_SYNC_URL`       | yes      | —                                    | Full HTTPS URL of `/api/sync`, e.g. `https://app.example.org/api/sync`.                              |
| `REQUIRE_HTTPS`           | production | `false`                             | Set `true` outside local development.                                                                |
| `POLL_INTERVAL_MS`        | no       | `5000`                               | Time between ticks. Min 100.                                                                         |
| `BATCH_SIZE`              | no       | `100`                                | Max changes per CouchDB request per database per tick.                                              |
| `STATE_FILE`              | no       | `/var/lib/sync-worker/state.json`    | Where last-seen seq per database is persisted. Mount a volume here.                                  |
| `BACKOFF_MS`              | no       | `30000`                              | Sleep duration after 3 consecutive failed ticks.                                                    |
| `REQUEST_TIMEOUT_MS`      | no       | `15000`                              | Timeout for CouchDB and platform requests.                                                           |
| `HEARTBEAT_FILE`          | no       | `/var/lib/sync-worker/heartbeat.json`| Container-health heartbeat written after every completed poll.                                      |
| `PLATFORM_SYNC_ROUTE_PATH`| no       | —                                    | Optional: read DB list off the platform's `route.ts` instead of the hardcoded fallback.             |

---

## Expected log lines

Healthy steady state, no traffic:

```
2026-05-09T12:00:00.000Z [info] worker starting; dbs=15, batch=100, interval=5000ms, state=/var/lib/sync-worker/state.json
2026-05-09T12:00:00.001Z [info] using fallback db list (15 entries)
```

When changes flow through:

```
2026-05-09T12:01:34.567Z [info] synced 12 change(s) from tamamhealth_patients, seq=42-abcdef
2026-05-09T12:01:34.890Z [info] synced 3 change(s) from tamamhealth_lab_results, seq=18-feedface
```

Recoverable error (single failed db, the others succeed):

```
2026-05-09T12:02:00.000Z [error] db=tamamhealth_audit_log poll failed: /api/sync HTTP 503: ...
```

Backoff (3 consecutive empty-failure ticks):

```
2026-05-09T12:02:30.000Z [error] 3 consecutive empty-failure ticks; backing off 30000ms
```

Fatal (missing env, exits non-zero immediately at startup):

```
[sync-worker] missing required env: COUCHDB_URL
[sync-worker] missing required env: PLATFORM_SYNC_URL
[sync-worker] required env: COUCHDB_URL, COUCHDB_WEBHOOK_SECRET (>=32 chars), PLATFORM_SYNC_URL
```

---

## Inspecting state

State is a plain JSON file. SSH to the EC2 host (or `docker exec` into the
container locally) and:

```bash
docker compose exec sync-worker cat /var/lib/sync-worker/state.json | jq
```

Output:

```json
{
  "tamamhealth_patients":     { "seq": "42-abcdef",   "lastUpdated": "2026-05-09T12:01:34.567Z" },
  "tamamhealth_lab_results":  { "seq": "18-feedface", "lastUpdated": "2026-05-09T12:01:34.890Z" }
}
```

Cross-check against CouchDB:

```bash
curl -u admin:$COUCHDB_PASSWORD http://localhost:5984/tamamhealth_patients | jq .update_seq
```

The worker automatically compares this state with the platform's authenticated
checkpoint endpoint after a state-volume loss. `/api/sync` is intentionally not
available to unsigned `curl` requests.

---

## Resetting

To force a full re-sync of one database:

```bash
docker compose stop sync-worker
docker compose exec sync-worker sh -c \
  'jq "del(.tamamhealth_patients)" /var/lib/sync-worker/state.json | sponge /var/lib/sync-worker/state.json'
docker compose start sync-worker
```

The worker will re-poll from `since=0`. The platform's `upsertDocument` is
idempotent so this is safe — but it WILL bump every `updated_at` in
PostgreSQL, so don't do it casually if you have downstream consumers that
care about that timestamp.

---

## Verification (local)

```bash
cd sync-worker
node --check index.mjs           # parse only
node --test index.test.mjs       # built-in tests, no deps
node index.mjs                   # with all required env unset → exits 2 with a clean error list
```

Manual smoke test against a live CouchDB + platform stack:

```bash
COUCHDB_URL=http://localhost:5984 \
COUCHDB_USER=admin \
COUCHDB_PASSWORD=pw \
COUCHDB_WEBHOOK_SECRET="$(openssl rand -hex 32)" \
PLATFORM_SYNC_URL=http://localhost:3000/api/sync \
REQUIRE_HTTPS=false \
POLL_INTERVAL_MS=1000 \
node index.mjs
```

Then in another terminal:

```bash
curl -X POST -u admin:pw -H 'content-type: application/json' \
  -d '{"hospitalNumber":"H-1","name":"Test"}' \
  http://localhost:5984/tamamhealth_patients
```

The worker should log `synced 1 change(s) from tamamhealth_patients` within
one poll interval.

---

## Operator gotchas

- **CouchDB takes ~60 s to first-respond after EC2 boot.** The worker will
  log `couchdb _changes ... HTTP 502` or connection refused for the first
  minute and then settle. The CFN target group has a 90 s health-check grace
  period to absorb this.
- **HMAC secret must be byte-identical on both sides.** Trailing newlines
  from `aws ssm get-parameter | tee` will break the signature silently —
  always use `--output text` and feed the value through env, not files.
- **Set both `COUCHDB_USER` and `COUCHDB_PASSWORD`.** The worker sends Basic
  authentication without putting credentials in URLs or logs.
- **Production requests are replay-resistant.** Each call has a five-minute
  timestamp window and a one-time nonce stored in shared Redis by Vercel.
- **State file persistence.** In docker-compose, mount a named volume on
  `/var/lib/sync-worker`. Without that, every container restart re-syncs
  from `seq=0` (which is idempotent but expensive).
