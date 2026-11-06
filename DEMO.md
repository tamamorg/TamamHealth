# TamamHealth — Live Demo Runbook

A one-page guide for walking a stakeholder through the running app. Covers startup, the clinician flow, the patient flow, and the architecture talking points.

Last checked against the code and a running demo build on **2026-11-05**. Tamam is being tested at Iteru Hospital, Juba; describe it as testing, not a live deployment.

---

## 1. Start the app

There are two ways to run a demo. Pick one.

### A. Standalone demo (recommended for a laptop demo)

No CouchDB, no Docker. Every browser seeds its own copy of the demo data, and every demo account signs in with one tap.

```bash
cd /path/to/TamamHealth/platform
npm install
npm run setup            # or: cp .env.example .env.local
npm run dev              # http://localhost:3000
```

`platform/.env.example` already has the right defaults: `NEXT_PUBLIC_DEMO_MODE=true`,
`NEXT_PUBLIC_SYNC_ENABLED=false`, and the `COUCHDB_*` lines commented out. What
makes it a standalone demo is `NEXT_PUBLIC_DEMO_MODE=true` **with no CouchDB
admin user/password set**. If either `COUCHDB_ADMIN_USER`/`COUCHDB_USER` and its
password are set, the demo-account list disappears and sign-in goes to CouchDB.

Check it before the demo:

```bash
curl -s http://localhost:3000/api/demo-credentials | jq '.profiles | length'   # expect 24
```

`0` means the server is not in standalone demo mode (look for CouchDB variables in
`.env` / `.env.local` or the shell).

The first sign-in in a fresh browser seeds the local database: the login page shows
"Initializing offline database…" and the first dashboard can take tens of seconds.
Sign in once before the audience arrives.

### B. Full stack with CouchDB (Docker)

Use this to show real sync between devices. It needs more setup.

```bash
cd /path/to/TamamHealth

# The compose file requires CouchDB credentials. There is no .env.example at the
# repo root: create .env and set at least COUCHDB_USER and COUCHDB_PASSWORD.

# Optional: free the ports first
lsof -ti:3000 -ti:3001 -ti:5984 2>/dev/null | xargs kill -9 2>/dev/null
docker compose down 2>/dev/null

docker compose up -d

# Wait ~15 seconds, then verify
docker compose ps
#   Expect platform, website, couchdb, couchdb-backup running.
#   couchdb-backup has no healthcheck, so it shows "running", not "healthy".
```

> The `analytics` profile adds only `sync-worker`
> (`docker compose --profile analytics up -d`). It is **not** needed for the demo.

CouchDB is required here. The platform authenticates against the shared users
database, so a stack without CouchDB answers sign-in with
*"Sign-in is temporarily unavailable"* rather than an invalid-credentials error.

On this stack the compose build sets `NEXT_PUBLIC_DEMO_MODE=false` by default, so:
there is no demo-account list, only `superadmin` (and `admin`) exist at first, and
**browsers do not seed demo data**. To load the demo patients, run
`cd platform && npm run db:seed:demo-corpus` against the CouchDB (see
`platform/README.md`), and create staff accounts at `/manage` (section 2).

Then open these tabs:

| Tab | URL | What it is |
|---|---|---|
| 1 | http://localhost:3001 | Marketing site (Docker stack only) |
| 2 | http://localhost:3000/login | Staff sign-in |
| 3 | http://localhost:3000/patient-portal | Patient portal |

---

## 2. Clinician demo (Tab 2)

**Talking point**: *"This is how a nurse or doctor signs in on a shared tablet in a ward."*

### Signing in

**Standalone demo:** the sign-in page shows **Choose a demo account** under the form
("One tap signs you in — seeded data, no real patients"). Tap a name. The roster is
one account per job at two hospitals in the same organization:

| Hospital | Accounts |
|---|---|
| Platform / Ministry | `superadmin` (Super Admin), `admin` (Government), `county.lopez` (County Health Director), `org.admin` (Org Admin) |
| Juba Teaching Hospital | `dr.wani`, `dr.achol` (Doctor), `triage.mary` (Nurse), `lab.gatluak` (Lab Tech), `pharma.rose` (Pharmacist), `desk.amira` (Receptionist), `cashier.deng`, `biller.nyandeng`, `data.ayen`, `hrio.dut`, `supt.lado`, `manager.aluel`, `nutr.nyabol`, `rad.tamamhealth` |
| Wau State Hospital | `dr.wau`, `co.deng` (Clinical Officer), `nurse.wau`, `lab.wau`, `pharma.wau`, `desk.wau` |

Passwords are generated per install (`GET /api/demo-credentials`, or
`platform/.seed-credentials.json`); `superadmin` is `Superadmin!` unless
`SUPERADMIN_INITIAL_PASSWORD` is set. No forced password change in standalone demo.
Sign-in is limited to 5 attempts per username per 15 minutes; reuse one browser
window per account rather than signing in again and again.

The first sign-in may offer a setup screen (**Skip setup**) and a guided tour (close it).

**Docker stack:** there is no demo-account list. Sign in as `superadmin` /
`Superadmin!` (or `SUPERADMIN_INITIAL_PASSWORD`); the first sign-in forces a password
change. Create real per-user accounts at **`/manage`** (the old `/admin/users` and
`/org-admin/users` links redirect there): each gets a temporary password shown once
and must change it at first sign-in.

### Showing a role other than super-admin

The fastest way in the standalone demo is to tap another demo account. On either
setup, the sign-in form also has a **Role** picker under the username: only the
platform super-admin may use it. Pick a role, sign in, and you land in that role's
workspace with its own menu, dashboard, permissions and data scope.

| Show this for… | Pick this role (as labelled) | Lands on |
|---|---|---|
| Front-line clinical workflow | Doctor | `/dashboard` |
| Nursing workflow | Nurse | `/dashboard` (role-adapted) |
| Pharmacy dispensing | Pharmacist | `/dashboard/pharmacy` |
| Lab orders and results | Lab Tech | `/dashboard/lab` |
| Reception / registration | Receptionist | `/dashboard/front-desk` |
| Cashier / billing | Cashier | `/payments` (Bills & Claims) |
| Hospital administration | Hospital Manager | `/facility-management` |
| National oversight | Government | `/government` |
| Platform administration | Super Admin | `/admin` |

### 5-minute clinician tour (one patient, start to finish)

This is the path the user guide's section 3 describes and was walked on 2026-11-05.
In the standalone demo every account shares one browser's data, so sign out and tap
the next account in the **same** browser window; a different browser or profile has
its own separate copy and will not see the patient.

1. **Receptionist** (`desk.amira`): **Register New Patient** → fill the required
   fields → **Review** → **Register & Check In**. Show the portal sign-in slip. In
   **Register Walk-In**, pick a department and reason → the patient joins the queue.
2. **Nurse** (`triage.mary`): **Outstanding items → Rooming queue** → **Continue
   rooming** → **Triage**. The chart opens with the Triage / ETAT form; record
   vitals (or "not taken" reasons), destination and doctor → **Save Triage**. Back
   on the rooming page: **Arrived** → room + **Assign** → **Ready**.
3. **Doctor** (`dr.wani`): the patient is "Awaiting consultation" on the In service
   lane. Open the chart → **Notes → Create note** (already filled from triage) →
   **Sign**. **Order basket** → add a lab test and a drug (**Order form**, **Save
   order**) → **Sign and close**.
4. **Lab Tech** (`lab.gatluak`): on the patient's row choose **Collect specimen** →
   **Save**, then **Enter result** → **Save** ("Result filed"). The doctor can
   **Mark reviewed** from Results.
5. **Pharmacist** (`pharma.rose`): **Fill prescription** → **Dispense**. With an
   unpaid bill it refuses ("… is due. Send … to the cashier") — a good talking point.
6. **Cashier** (`cashier.deng`): chart **Billing history → Billing actions → Collect
   payment** → **Record**. Then dispense again.
7. **Nurse**: **Outstanding items → Nurse review** → the chart's **Notes** tab →
   **Mark reviewed** on each item under the notes → reception sets the visit **Completed**.

Other things worth showing:

- **Patient list** (`/patients`) — seeded roster (136 patients), live search, QR
  lookup. Fingerprint lookup appears only with `NEXT_PUBLIC_FINGERPRINT_ENABLED=true`
  and a reader bridge.
- The **chart**: left section list, right rail (Order basket, Visit note, Task list,
  Clinical forms, Patient lists), header **Actions** (Refer patient, Transfer
  patient, Visit summary, Print chart).
- **Offline**: DevTools → Network → Offline, then keep working (add a note). Work is
  saved on the device. In the standalone demo there is no server to sync to, so the
  sync indicator never turns green; show sync recovery only on the Docker stack.
- **Reports** (`/reports`) — facility KPIs.

`/consultation` is only a redirect now (it opens the patient's note in the chart);
don't present it as a separate consultation screen. There is no AI scribe and no
video visit to show.

### Admin tour (as `superadmin`)

- `/admin` — platform command center
- `/manage` — organizations, facilities and people (`/admin/organizations` and
  `/admin/users` redirect here). One demo organization ships: Republic of South
  Sudan, with Juba and Wau.
- `/admin/system` — system health
- `/admin/sync` — sync and background jobs
- `/admin/conflicts` — sync-conflict reconciliation queue
- `/admin/security` — platform security policies (e.g. "Screen lock mandatory")

There is no public account-request form or queue; accounts are created by an administrator.

---

## 3. Patient portal demo (Tab 3)

**Talking point**: *"This is what a patient sees on their phone."*

1. On `/patient-portal`, with `NEXT_PUBLIC_DEMO_MODE=true` (exactly `true`), the
   demo account is prefilled: **`patient.mary` / `patient1234`** ("Demo account —
   signs in as patient.mary / patient1234, seeded data, no real patient").
2. Click **Log in**. (If `PATIENT_PORTAL_OTP_ENABLED=true`, the portal asks for a
   6-digit code sent by SMS; it is off by default.)
3. The portal shows Overview, Medical Records, Prescriptions, Lab Results, Radiology
   & Imaging, Immunizations, Appointments, Billing & Payments, Messages and My Profile.
4. **I have an activation code** shows how a newly registered patient activates the
   account with the code from their sign-in slip (step 1 of the clinician tour).

### The seeded portal patient

- **Mary Nyandeng Lado** — `pat-00004` / `JTH-000004`, phone `+211912000004`
- Deliberately fully populated: Diabetes Type 2 and Hypertension, penicillin and
  sulfa allergies and a preferred pharmacy, so the chart and note history have
  something in every section
- She is the **only** seeded patient with portal credentials

> In the standalone demo the portal uses the built-in demo data, so chart and portal
> do **not** share live data (a portal message will not appear in the chart). On the
> Docker stack, the portal API reads the server-side patients database: seed the
> demo corpus first, or the portal rejects `patient.mary`.

---

## 4. Architecture talking points (for the Q&A)

While clicking around, these are the one-liners:

- **Offline-first**: every write commits to the device's local database (PouchDB) before any remote call. A clinic can keep working through a power or network outage and syncs when connectivity returns.
- **Federated, not centralized**: facility runs locally. Country node aggregates. Regional exchange only handles cross-border continuity. Matches ministry sovereignty expectations.
- **Multi-tenant by database**: each organization gets its own CouchDB databases with their own `_security` objects; each client syncs about 76 databases, with pulls polled (~15s) so they can't starve the live push feed.
- **Patient data sealed per organization**: catalogued patient fields are encrypted with the organization's key before they leave the device.
- **Standards-based**:
  - `GET /api/fhir/metadata` — FHIR R4 CapabilityStatement (public, no auth)
  - `GET /api/fhir/Patient/:id` — FHIR Patient resource
  - `GET /api/fhir/Bundle/referral/:id` — cross-facility referral packet
  - Also `Encounter`, `Observation` and `MedicationRequest`
  - ICD-11 coded diagnoses
  - DHIS2 adapter: `POST /api/admin/dhis2-push` aggregates facility data and posts to the national DHIS2 server.
- **Audit + reconciliation**:
  - Every clinical mutation emits a `sync_event` with the facility, operation, and version
  - `GET /api/admin/sync-health` shows outbox backlog + per-facility last-contact
  - Conflicts on high-risk fields (allergies, referrals) land in a human reconciliation queue rather than silent-merging
  - Clinical messages are retained: "delete" leaves a visible retraction and keeps the original
- **Security**: JWT with boot-time secret validation, RBAC on every route, two-layer CSRF (Origin/Host + HMAC double-submit), per-user and per-IP login rate limiting, HSTS, strict CSP, nightly CouchDB backups in a sidecar. Staff have no second factor (no MFA); admins are forced to change the first password.

### Live curl demos (copy-paste)

```bash
# Unauthenticated FHIR capability discovery
curl -s http://localhost:3000/api/fhir/metadata | jq '.fhirVersion, .rest[0].resource[].type'

# Country profile (mocked catalog: SS / KE / UG)
curl -s "http://localhost:3000/api/country/metadata?country=SS" | jq '{name, dhis2, facilityLevels: [.facilityLevels[].code]}'

# Authenticated: sign in, then list patients
# (standalone demo: Superadmin!; Docker stack: the password you set at first login)
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

The server-side endpoints (`/api/patients`, sync health, MPI) read the server's
databases, so on the standalone demo they return little or nothing; run them
against the Docker stack with the demo corpus seeded.

---

## 5. If something goes wrong during the demo

| Symptom | Fix |
|---|---|
| No "Choose a demo account" list on the sign-in page | The server is not in standalone demo mode. `curl :3000/api/demo-credentials` returns 0 profiles when any CouchDB admin user/password is set or `NEXT_PUBLIC_DEMO_MODE` is not `true`. Restart `npm run dev` without them |
| Stuck on "Initializing offline database…" / "Loading TamamHealth…" | First seed of a fresh browser: wait. If it never finishes, another tab may hold the seed lock — close other Tamam tabs |
| A role can't see the patient another role just created | Each browser profile has its own demo data in the standalone demo. Use the same browser window for every account |
| Sign-in says *"temporarily unavailable"* | Docker stack: CouchDB is unreachable. `docker compose ps` / `docker compose logs couchdb` |
| Sign-in says *"invalid credentials"* for a staff account | Docker stack: that account doesn't exist in the users DB yet. Only `superadmin` and `admin` bootstrap themselves (`admin`'s password is generated into `platform/.seed-credentials.json` unless `ADMIN_INITIAL_PASSWORD` is set); create the rest at `/manage` |
| Too many sign-in attempts | 5 per username per 15 minutes. Use another demo account or wait |
| Dashboard empty after sign-in | Docker stack: the demo corpus was not seeded (`npm run db:seed:demo-corpus`). Standalone: hard-refresh (Cmd+Shift+R); a `SEED_VERSION` bump (currently **80**, `platform/src/lib/db.ts`) triggers a one-time re-seed |
| Pharmacist can't dispense | The patient owes money; collect it as Cashier first (Tier 1 medicines are exempt). Seeded stock exists only at Juba, so Wau's dispensing stays disabled |
| Platform container unhealthy | `docker compose logs platform \| tail -40` — look for a startup error (usually env config) |
| CouchDB not responding | `docker compose restart couchdb` then wait 15s |
| Ports already in use on 3000/3001/5984 | `lsof -ti:3000 -ti:3001 -ti:5984 \| xargs kill -9`; then restart |
| Patient portal rejects `patient.mary` | Check `NEXT_PUBLIC_DEMO_MODE=true`; on the Docker stack, seed the demo corpus first |
| Fresh slate / reset demo | Standalone: use a new browser profile (or clear site data). Docker: `docker compose down -v && docker compose up -d` (deletes the CouchDB volume; reseed afterwards) |

---

## 6. Production deploy (when it's time)

For anything real, use the CI pipeline described in
[CONTRIBUTING.md](CONTRIBUTING.md): `deploy-staging` runs automatically on a
green `main`, and `deploy-production` is a manual,
smoke-tested promotion of an already-reviewed commit.

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
`openssl rand -base64 24 | tr -d '\n/+='` for passwords. The CI production deploy
re-installs the CouchDB validators itself; on a hand-built box, run
`npm run setup:couchdb:validators` after every update.
