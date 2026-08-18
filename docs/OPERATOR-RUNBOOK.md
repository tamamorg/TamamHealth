# TamamHealth Operator Runbook

> **Audience:** the person installing and maintaining a TamamHealth facility
> server. No DevOps background assumed.
>
> Companion documents:
> [operations/backups.md](operations/backups.md) (authoritative backup/DR
> procedure), [operations/secrets.md](operations/secrets.md) (secret
> management), [ARCHITECTURE.md](ARCHITECTURE.md) (how the system fits
> together).

---

## 1. What you are running

A TamamHealth facility server is **one machine** running Docker Compose with
these services (`docker-compose.yml` at the repo root):

| Service | What it does | Required? |
|---|---|---|
| `platform` | The EMR application (port 3000) | Yes |
| `couchdb` | The clinical database — **this is the data that matters** | Yes |
| `couchdb-backup` | Nightly dump of every database at 02:15 UTC | Yes |
| `website` | Public marketing site (port 3001) | Optional |
| `postgres` + `sync-worker` | Analytics tier (`--profile analytics`) | Optional |

Clinicians' devices keep working **offline** even if this server is down —
they sync up whenever it comes back. The server is the durable copy, not a
gatekeeper.

> **Fingerprint scanners (optional):** facilities using USB fingerprint
> scanners run the small `fingerprint-bridge` service on the **registration
> desk PC** itself (not on this server) — see `fingerprint-bridge/README.md`.
> If the bridge or scanner is down, staff fall back to name / hospital-number /
> QR lookup; nothing else is affected.

## 2. Fresh install

### Prerequisites

- A machine with Docker and Docker Compose installed (4 GB+ RAM recommended)
- This repository cloned onto it

### Steps

```bash
cd TamamHealth

# 1. Compose-level config: CouchDB credentials, ports
cp .env.example .env          # then edit: set strong COUCHDB_USER/PASSWORD

# 2. Platform runtime config
cp platform/.env.production.example platform/.env.production
# Edit: JWT_SECRET (long random string), NEXT_PUBLIC_SYNC_ENABLED=true,
# NEXT_PUBLIC_COUCHDB_URL (the public URL clients will reach CouchDB on).
# NOTE: NEXT_PUBLIC_* values are baked in at BUILD time — set them before
# the next step.
#
# Use platform/.env.production.example, not platform/.env.example — the
# latter is the local-dev template (npm run dev) and is missing
# production-required keys such as TAMAMHEALTH_LICENSE_SECRET and
# COUCHDB_GATEWAY_SECRET that lib/config-validation.ts enforces at boot.

# 3. Build and start (CouchDB-only install — no analytics)
docker compose up -d --build

# 4. Verify
docker compose ps                 # everything "healthy"
curl -s http://localhost:3000/    # platform responds
```

To add the optional analytics tier later:

```bash
docker compose --profile analytics up -d
```

### Security notes

- CouchDB is bound to `127.0.0.1` only. If clinician devices need to sync
  from other machines, put a reverse proxy (Caddy/nginx) with TLS in front —
  never expose port 5984 directly.
- Secrets handling (Doppler vs. legacy env files) is documented in
  [operations/secrets.md](operations/secrets.md).

## 3. Routine operations

### Check system health

```bash
docker compose ps                          # all services healthy?
docker compose logs --tail 50 platform     # recent platform logs
curl -s http://localhost:5984/_up          # CouchDB alive (from the host)
```

### Restart after a power cut

All services have `restart: unless-stopped` — Docker brings them back
automatically when the machine boots. If something is stuck:

```bash
docker compose down && docker compose up -d
```

### Update to a new release

```bash
git pull
docker compose build
docker compose up -d
```

Clinical data lives in Docker volumes (`couchdb_data`), not in containers —
rebuilding images never touches it.

## 4. Backups and restore

The authoritative procedure (offsite encrypted backups, retention, restore
drill) is [operations/backups.md](operations/backups.md). Summary:

- The `couchdb-backup` container dumps every `tamamhealth_*` database
  nightly at 02:15 UTC to the `couchdb_backups` volume (14-day retention).
- Offsite: `scripts/backup-couchdb.sh` / `scripts/backup-postgres.sh` push
  encrypted dumps to region-pinned object storage (PHI residency rules in
  that doc).
- A quarterly restore drill runs from CI (`backups-cron.yml`); if it fails,
  treat it as an incident.

## 5. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Platform container crash-loops with "STARTUP REFUSED" | Invalid production config (weak/placeholder secret), or analytics profile on but Postgres unreachable | Check the startup log for which env var it flagged; check `docker compose logs postgres` |
| `Watchpack Error ... EMFILE: too many open files` and every page is 404 (dev mode only) | macOS/Linux file-descriptor limit too low | Run `ulimit -n 10240` in the shell before `npm run dev` (or add it to `~/.zshrc`) |
| Clinician device shows "Initializing offline database..." for a long time on first load | First-run seed of the local PouchDB databases | Wait — one-time per device/browser. Subsequent loads are fast |
| Devices not syncing | CouchDB unreachable from the device, or `NEXT_PUBLIC_SYNC_ENABLED`/`NEXT_PUBLIC_COUCHDB_URL` not baked into the build | Check the reverse proxy/TLS; rebuild the platform image after changing `NEXT_PUBLIC_*` vars |
| Sync conflicts piling up | Two devices edited the same high-risk record offline | An authorized user (org admin, medical superintendent, HRIO) resolves them at `/sync-conflicts` in the app |
| Lost/stolen clinician device | Local PouchDB copy on the device | Deactivate the user account (admin → users). Data on the server is unaffected; consider device-level disk encryption policy |
| Server disk failure | — | Restore per [operations/backups.md](operations/backups.md). Devices re-sync their unsynced work automatically when the server returns |

## 6. What never to do

- **Never** delete the `couchdb_data` volume — that is the clinical record.
- **Never** expose CouchDB (5984) or Postgres (5432) to the network without
  TLS and authentication in front.
- **Never** commit or share `.env` files or backup encryption keys.
- **Never** edit data directly in CouchDB's Fauxton UI on a production
  server — all writes must go through the application so audit logs, sync
  events, and validation stay intact.
