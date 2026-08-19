# TamamHealth — Live Demo Runbook

A one-page guide for walking a stakeholder through the running stack. Covers startup, the clinician flow, the patient flow, and the architecture talking points.

---

## 1. Start the stack

```bash
cd /path/to/TamamHealth

# First time only: the compose file requires CouchDB credentials.
cp .env.example .env          # then set COUCHDB_USER / COUCHDB_PASSWORD

# Optional: free the ports first
lsof -ti:3000 -ti:3001 -ti:5984 2>/dev/null | xargs kill -9 2>/dev/null
docker compose down 2>/dev/null

# Start everything
docker compose up -d

# Wait ~15 seconds, then verify
docker compose ps
#   Expect 4 services healthy: platform, website, couchdb, couchdb-backup
```

> The analytics half — `sync-worker` and `postgres` — sits behind a profile and
> is **not** needed for the demo: `docker compose --profile analytics up -d`.

CouchDB is required. The platform authenticates against the shared users
database, so a stack without CouchDB answers sign-in with
*"Sign-in is temporarily unavailable"* rather than an invalid-credentials error.

Then open three browser tabs:

| Tab | URL | What it is |
|---|---|---|
| 1 | http://localhost:3001 | Marketing site |
| 2 | http://localhost:3000/login | Clinician login |
| 3 | http://localhost:3000/patient-portal | Patient portal |

---

## 2. Clinician demo (Tab 2)

**Talking point**: *"This is how a nurse or doctor signs in on a shared tablet in a ward."*

There is **no demo-account roster on the login page** — accounts are issued by
an administrator, and a sign-in page that hands out working credentials to
anyone who loads it is not something to ship. A fresh stack is reachable
through the platform bootstrap account:

1. Username `superadmin`, password `Superadmin!` (or whatever
   `SUPERADMIN_INITIAL_PASSWORD` is set to).
2. First login forces a password change — pick something and note it down.
3. The browser then seeds its local PouchDB (~136 patients, staff records,
   labs, prescriptions, appointments, billing). Watch the sync status
   indicator in the top-right; the seed replicates up to CouchDB from here.

### Showing a role other than super-admin

The login form has a **role picker** next to the username field. Only the
platform super-admin may use it: pick a role, sign in, and you land in that
role's workspace with its own nav, dashboard, permissions and data scope.
That is the fastest way to show several roles in one session.

| Show this for… | Pick this role | Lands on |
|---|---|---|
| Front-line clinical workflow | Doctor | `/dashboard` |
| Nursing workflow | Nurse | `/dashboard` (role-adapted) |
| Pharmacy dispensing | Pharmacist | `/dashboard/pharmacy` |
| Lab order management | Lab Technician | `/dashboard/lab` |
| Reception / registration | Medical Receptionist | `/dashboard/front-desk` |
| Cashier / billing | Cashier | `/payments` |
| Hospital administration | Hospital Manager | `/facility-management` |
| National oversight | Ministry of Health | `/government` |
| Platform administration | Super Admin | `/admin` |

To show real per-user accounts instead, create them at `/admin/users` (or
`/org-admin/users` for a single organization) — each is issued a temporary
password and forced to change it on first login.

### 3-minute clinician tour

1. **Patient list** (`/patients`) — seeded roster, live search, fingerprint/QR lookup
2. Click any patient — **OpenMRS-style chart** with vitals, problems, allergies, medications, orders and timeline
3. **New consultation** (`/consultation`) — write a note, prescribe, order a lab
4. **Offline demo** — DevTools → Network → Offline. Click around, add a note. Everything still works.
5. Flip back online — **sync indicator** turns green; edits replicate to CouchDB.
6. **Reports** (`/reports`) — facility KPIs, national rollup

### Admin tour (as `superadmin`)

- `/admin` — platform command center
- `/admin/organizations` — tenants; a second demo org ("Mercy") ships with its own dataset
- `/admin/users` — user accounts and the public account-request queue
- `/admin/system` — system health
- `/admin/sync` — sync and background jobs
- `/admin/conflicts` — sync-conflict reconciliation queue

---

## 3. Patient portal demo (Tab 3)

**Talking point**: *"This is what a patient sees on their phone."*

1. On `/patient-portal`, the single demo account is prefilled while
   `NEXT_PUBLIC_DEMO_MODE` is not `false`: **`patient.mary` / `patient1234`**.
2. Click **Log in**. (If SMS OTP is enabled, the form asks for the code sent to
   the patient's registered number.)
3. Patient dashboard loads with their visits, labs, meds, bills and messages.

### The seeded portal patient

- **Mary Nyandeng Lado** — `pat-00004` / `JTH-000004`, phone `+211912000004`
- Deliberately fully populated: Diabetes Type 2 and Hypertension, penicillin
  and sulfa allergies, a chronic medication, a preferred pharmacy — so the
  consultation wizard pre-fills history and every step can be exercised
- She is the **only** patient with portal credentials; the other seeded
  patients have no `portalUsername`

> Order of operations matters on a fresh stack: the portal API reads the
> server-side patients database, so sign in on the clinician tab first and let
> the seed replicate up. (Running `npm run dev` with no CouchDB reachable at
> all, the portal falls back to the literal seed data instead.)

---

## 4. Architecture talking points (for the Q&A)

While clicking around, these are the one-liners:

- **Offline-first**: every write commits to PouchDB locally before any remote call. Clinic can work through a 6-hour power + network outage; syncs when connectivity returns.
- **Federated, not centralized**: facility runs locally. Country node aggregates. Regional exchange only handles cross-border continuity. Matches ministry sovereignty expectations.
- **Multi-tenant by database**: each organization gets its own CouchDB database with its own `_security` object; 74 replications run per client, pulls polled so they can't starve the live push feed.
- **Standards-based**:
  - `GET /api/fhir/metadata` — FHIR R4 CapabilityStatement (public, no auth)
  - `GET /api/fhir/Patient/:id` — FHIR Patient resource
  - `GET /api/fhir/Bundle/referral/:id` — cross-facility referral packet
  - Also `Encounter`, `Observation` and `MedicationRequest`
  - DHIS2 adapter: `POST /api/admin/dhis2-push` aggregates facility data and posts to the national DHIS2 server.
- **Audit + reconciliation**:
  - Every clinical mutation emits a `sync_event` with the facility, operation, and version
  - `GET /api/admin/sync-health` shows outbox backlog + per-facility last-contact
  - Conflicts on high-risk fields (allergies, referrals) land in a human reconciliation queue rather than silent-merging
- **Security**: JWT with boot-time secret validation, RBAC on every route, two-layer CSRF (Origin/Host + HMAC double-submit), per-user and per-IP login rate limiting, HSTS, strict CSP, nightly CouchDB backups in a sidecar.

### Live curl demos (copy-paste)

```bash
# Unauthenticated FHIR capability discovery
curl -s http://localhost:3000/api/fhir/metadata | jq '.fhirVersion, .rest[0].resource[].type'

# Country profile (mocked catalog: SS / KE / UG)
curl -s "http://localhost:3000/api/country/metadata?country=SS" | jq '{name, dhis2, facilityLevels: [.facilityLevels[].code]}'

# Authenticated: sign in, then list patients (use the password you set at first login)
curl -sc /tmp/jar.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" -H "Origin: http://localhost:3000" \
  -d '{"username":"superadmin","password":"YOUR-PASSWORD"}'
curl -sb /tmp/jar.txt http://localhost:3000/api/patients | jq '{total, first: .patients[0] | {name: (.firstName + " " + .surname), hospitalNumber}}'

# Admin: sync health + conflict queue (GETs need only the session cookie)
curl -sb /tmp/jar.txt http://localhost:3000/api/admin/sync-health | jq '.outbox, .perFacilityLast24h'
curl -sb /tmp/jar.txt http://localhost:3000/api/admin/conflicts | jq '.total'

# Any POST also needs the CSRF double-submit token: the cookie AND the header.
CSRF=$(awk '/tamamhealth-csrf/{print $7}' /tmp/jar.txt)
curl -sb /tmp/jar.txt -X POST http://localhost:3000/api/mpi/match \
  -H "Content-Type: application/json" -H "Origin: http://localhost:3000" \
  -H "X-CSRF-Token: $CSRF" \
  -d '{"firstName":"Mary","surname":"Lado","dateOfBirth":"1979-06-12"}' \
  | jq '.candidates[0] | {score, method, name: (.patient.firstName + " " + .patient.surname)}'
```

---

## 5. If something goes wrong during the demo

| Symptom | Fix |
|---|---|
| Sign-in says *"temporarily unavailable"* | CouchDB is unreachable. `docker compose ps` / `docker compose logs couchdb` |
| Sign-in says *"invalid credentials"* for a staff account | That account doesn't exist in the users DB yet. Only `superadmin` (and `admin`, with `ADMIN_INITIAL_PASSWORD` set) bootstrap themselves; create the rest at `/admin/users` |
| Dashboard empty after sign-in | Hard-refresh (Cmd+Shift+R). A `SEED_VERSION` bump (currently **73**, `platform/src/lib/db.ts`) triggers a one-time re-seed |
| Platform container unhealthy | `docker compose logs platform \| tail -40` — look for a startup error (usually env config) |
| CouchDB not responding | `docker compose restart couchdb` then wait 15s |
| Ports already in use on 3000/3001/5984 | `lsof -ti:3000 -ti:3001 -ti:5984 \| xargs kill -9`; `docker compose up -d` |
| Patient portal rejects `patient.mary` | Sign in on the clinician tab first so the seeded patients replicate to CouchDB; also check `NEXT_PUBLIC_DEMO_MODE` is not `false` |
| Fresh slate / reset demo | `docker compose down -v && docker compose up -d` (deletes the CouchDB volume — seeded content will need to be recreated) |

---

## 6. Production deploy (when it's time)

For anything real, use the CI pipeline described in
[CONTRIBUTING.md](CONTRIBUTING.md): `deploy-staging` runs automatically on a
green `main`, and `deploy-production` / `deploy-app-platform` are manual,
smoke-tested promotions of an already-reviewed commit.

For a one-shot self-hosted box, [`deploy.sh`](deploy.sh) still works on a fresh
Ubuntu 22.04 VPS:

```bash
# Point DNS at your VPS IP first:
#   tamamhealth.org         → VPS
#   app.tamamhealth.org     → VPS
#   couch.tamamhealth.org   → VPS

# Copy your env files up:
scp .env root@VPS:/opt/tamamhealth/
scp platform/.env.production root@VPS:/opt/tamamhealth/platform/
scp website/.env.production root@VPS:/opt/tamamhealth/website/
scp deploy.sh root@VPS:/root/

ssh root@VPS
bash /root/deploy.sh
```

The script installs Docker + Caddy, configures auto-TLS via Let's Encrypt,
builds, starts, and prints the live URLs. ~10 minutes end-to-end once DNS has
propagated.

Before go-live, work through
[`docs/operations/production-hardening.md`](docs/operations/production-hardening.md)
and run [`scripts/preflight.sh`](scripts/preflight.sh). In particular: set
`NEXT_PUBLIC_DEMO_MODE=false`, set a real `SUPERADMIN_INITIAL_PASSWORD` (the
config validator refuses `Superadmin!` in production), and rotate every
placeholder secret — `openssl rand -base64 48` for `JWT_SECRET`,
`openssl rand -base64 24 | tr -d '\n/+='` for passwords.
