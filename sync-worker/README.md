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
| `COUCHDB_URL`             | yes      | —                                    | Internal CouchDB URL, e.g. `http://couchdb:5984`. Credentials embedded in the URL are accepted but are stripped out into an `Authorization` header (Node's fetch rejects user:pass URLs); prefer the two variables below. |
| `COUCHDB_USER`            | production | —                                  | CouchDB machine user. Must be set together with `COUCHDB_PASSWORD` — setting one without the other is a startup error. Sent as Basic auth, never logged. |
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
| `PLATFORM_SYNC_ROUTE_PATH`| no       | —                                    | Extra path to try when reading the DB list off the platform's `route.ts`. `/app/platform/src/app/api/sync/route.ts` and `../platform/src/app/api/sync/route.ts` are tried anyway; if none resolve, the 44-entry hardcoded fallback is used. |

The worker has no npm dependencies — `npm start` is `node index.mjs`, and Node
20+ is the only requirement.

---

## Where it runs

- **`docker-compose.yml`** (local / single-host stack) — service `sync-worker`,
  image `ghcr.io/${GH_OWNER:-tamamhealth}/tamamhealth-sync-worker:latest`,
  behind the **`analytics` profile**. It does not start with a plain
  `docker compose up`; use `docker compose --profile analytics up -d`.
- **`docker-compose.data.yml`** (clinical-data droplet) — same service tagged
  `${RELEASE_ID}`, `REQUIRE_HTTPS=true`, pointing `PLATFORM_SYNC_URL` at the
  public platform deployment. Also under the `analytics` profile.

Both mount the named volume `sync_worker_state` on `/var/lib/sync-worker`. The
image's `HEALTHCHECK` reads `HEARTBEAT_FILE` and fails once the heartbeat is
more than 10 minutes stale.

This package is **not** covered by `ci.yml` — run `npm test` locally before
shipping a change.

---

## Expected log lines

Healthy steady state, no traffic:

```
2026-05-09T12:00:00.000Z [info] worker starting; dbs=44, batch=100, interval=5000ms, state=/var/lib/sync-worker/state.json
2026-05-09T12:00:00.001Z [info] using fallback db list (44 entries)
```

When the platform tree is on disk the list is read from `route.ts` instead and
the second line reads `loaded N db names from <path>`. Both sources currently
hold the same 44 databases — if they diverge, `route.ts` is authoritative and
`FALLBACK_DBS` needs updating.

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

Per-document rejection — the checkpoint is **held**, not advanced, so the batch
retries on the next tick:

```
2026-05-09T12:03:00.000Z [error] tamamhealth_billing: /api/sync reported 2 error(s); holding checkpoint for retry {"since":"91-abc","retry":1,"max":5}
```

After 5 held attempts the batch is dead-lettered and the stream unblocks. Those
documents never reached analytics — this line needs a human:

```
2026-05-09T12:05:00.000Z [error] tamamhealth_billing: DEAD-LETTER — 2 doc(s) failed 5 retries; advancing past to unblock the stream. ...
```

Fatal (missing env, exits non-zero immediately at startup):

```
[sync-worker] missing required env: COUCHDB_URL
[sync-worker] missing required env: PLATFORM_SYNC_URL
[sync-worker] required env: COUCHDB_URL, COUCHDB_WEBHOOK_SECRET (>=32 chars), PLATFORM_SYNC_URL
```

---

## Inspecting state

State is a plain JSON file. SSH to whichever host runs the stack — the
clinical-data droplet on the DigitalOcean target, the EC2 instance on the AWS
one — or `docker exec` into the container locally, and:

```bash
docker compose exec sync-worker cat /var/lib/sync-worker/state.json | jq
```

(`jq` runs on the host — the image is `node:20-alpine` with no extra tooling
in it.)

Output:

```json
{
  "tamamhealth_patients":     { "seq": "42-abcdef",   "errorRetries": 0, "lastUpdated": "2026-05-09T12:01:34.567Z" },
  "tamamhealth_lab_results":  { "seq": "18-feedface", "errorRetries": 0, "lastUpdated": "2026-05-09T12:01:34.890Z" }
}
```

`errorRetries` is the held-batch counter above; a non-zero value means that
database is stuck re-posting the same batch.

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

Stop the worker, drop that database's entry from the state file, start it
again. The edit runs in a throwaway container on the same volume, because
`docker compose exec` needs a *running* container and the image has neither
`jq` nor `sponge` — Node is what it does have:

```bash
docker compose --profile analytics stop sync-worker
docker compose --profile analytics run --rm --no-deps sync-worker node -e '
  const fs = require("fs"), p = "/var/lib/sync-worker/state.json";
  const s = JSON.parse(fs.readFileSync(p, "utf8"));
  delete s["tamamhealth_patients"];
  fs.writeFileSync(p, JSON.stringify(s, null, 2));
'
docker compose --profile analytics start sync-worker
```

The worker will re-poll from `since=0`. The platform's `upsertDocument` is
idempotent so this is safe — but it WILL bump every `updated_at` in
PostgreSQL, so don't do it casually if you have downstream consumers that
care about that timestamp.

---

## Verification (local)

```bash
cd sync-worker
npm run check                    # node --check index.mjs — parse only
npm test                         # node --test index.test.mjs — built-in runner, no deps
npm start                        # with all required env unset → exits 2 with a clean error list
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

- **CouchDB takes ~60 s to first-respond after a host boot.** The worker will
  log `couchdb _changes ... HTTP 502` or connection refused for the first
  minute and then settle. On the AWS target the ASG's health-check grace
  period is 600 s, which absorbs this along with the instance's own bootstrap.
- **HMAC secret must be byte-identical on both sides.** `COUCHDB_WEBHOOK_SECRET`
  must be >= 32 chars and match `platform/src/lib/sync-auth.ts`. Trailing
  newlines from `aws ssm get-parameter | tee` will break the signature silently
  — always use `--output text` and feed the value through env, not files.
- **Set both `COUCHDB_USER` and `COUCHDB_PASSWORD`.** The worker sends Basic
  authentication without putting credentials in logs.
- **Requests are replay-resistant.** Each call carries a 5-minute timestamp
  window (`SYNC_SIGNATURE_MAX_SKEW_SECONDS = 300`) and a one-time nonce. The
  platform reserves that nonce in Upstash Redis when it is configured, and
  falls back to an in-process set only outside production — in production with
  no Upstash config, `/api/sync` answers **503**, and the worker holds its
  checkpoint and retries.
- **A dead-letter line is data loss.** The checkpoint only advances past
  rejected documents after 5 held retries. Those documents are not in
  PostgreSQL and nothing re-queues them; fix the mapper and replay that
  database deliberately (see Resetting).
- **State file persistence.** In docker-compose, mount a named volume on
  `/var/lib/sync-worker`. Without that, a container restart falls back to
  recovering checkpoints from the platform's `sync_metadata` table; if that is
  also unreachable it re-syncs all 44 databases from `seq=0` (idempotent but
  expensive) and logs the recovery failure.
