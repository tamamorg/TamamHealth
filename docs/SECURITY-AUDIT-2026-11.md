# Security audit — can someone break in and steal the data? (2026-11-05)

Scope: the whole platform, read-only, by seven reviewers working from the code and git history (the GitHub repo is **public**, so the attacker is assumed to have read all source). Findings were proved with **local, offline** test scripts where marked; **no live attacks were run against production**, which Iteru Hospital is testing on. This sits alongside [AUDIT-2](AUDIT-2-MODULARITY-AND-DATA-INTEGRITY-2026-11.md) (which covered data integrity and §2.1/§6.2 security items) and [MODULARIZATION-REPORT](MODULARIZATION-REPORT-2026-11.md).

**Marks:** ✔ = I re-verified it in the code myself. **PROVED** = a reviewer demonstrated it with a local script. **CONFIRMED** = traced in code. **PLAUSIBLE/SUSPECTED** = code path real, impact not proven.

---

## 1. Bottom line

**Can an anonymous attacker on the internet break in and read patient data through the app?** No one found a way. The login, JWT, CSRF, XSS and webhook defences are strong and held up under test. What the app serves to the browser is well guarded.

**But the data can be reached by other routes, and two of them need no insider:**

1. **A DigitalOcean API token is sitting in the public git history** (✔). Anyone who clones the repo can snapshot the production droplet and walk away with every database plus the `.env` that decrypts it. This is the single most serious finding and **only you can close it, by revoking the token.**
2. **Production CouchDB is exposed to the internet**, admin UI included, behind only a password with no lockout (✔).

Beyond those, the real risks are **insiders and stolen devices**, not outside hackers:
- any staff role's device holds, and can decrypt, the whole facility's records;
- a `government` login reads every patient in the country (PROVED);
- `org_admin` can grant itself restricted mental-health notes (PROVED);
- a stolen or shared tablet is readable because the lock is cosmetic and logout doesn't wipe.

**"Fully secure like the top EHRs" is not a state any system reaches** — Epic and Oracle Health included. The honest target is to close what's below and keep watching. Much of the top of this list is operational and only you can do it.

---

## 2. Do these now — only you can (operational)

| # | Action | Why | Status |
|---|---|---|---|
| 1 | **Revoke every DigitalOcean API token** in the DO console; issue new ones. | A token is in public git history (commit `098ea48f`). It can snapshot the prod droplet → all PHI + secrets. | ⛔ only you |
| 2 | **Review DO account activity since 2026-07-06** — snapshots, rebuilds, new SSH keys, firewall changes. | Detect whether the token was used. | ⛔ only you |
| 3 | **If anything looks off (or to be safe), rotate every prod secret:** JWT, CouchDB admin, `ORG_DATA_KEY_SECRET`, webhook keys. | Assume the droplet may have been copied. | ⛔ only you |
| 4 | **Close the public CouchDB host:** remove `couch.tamamhealth.org` from Caddy (or restrict to your IP/VPN) and rotate the CouchDB admin password. | Internet-facing CouchDB + Fauxton, no lockout, unlimited password guessing. Browsers don't need it — they use `/api/couch`. | ⛔ only you |
| 5 | **Fix GitHub access control:** `enforce_admins=true`, point the branch ruleset at the default branch, `prevent_self_review=true`, distinct human reviewers, hardware-key 2FA on all 6 collaborators, and stop using the org admin account for daily work. | Last 10 PRs merged with 0 approvals; the two prod approvals are one person clicking twice; your laptop `gh` is the org admin. | ⛔ only you |
| 6 | **Restrict the backup key:** give the `production-cron` environment a `main`-only branch policy, and rotate the backup GPG key pair. | Any writer can read the backup private key + passphrase from any branch → decrypt offsite backups. | ⛔ only you |
| 7 | **Settle the CouchDB exposure review:** check `docker logs tamamhealth-couchdb --since` on the host now; add Caddy access logging. If no evidence either way, treat the data readable until 2026-11-01 as disclosed and decide on breach notification. | The exposure ran until 2026-11-01; Caddy has no access logs, so the window is closing. | ⛔ only you |
| 8 | **Deploy prod images by digest, not a mutable tag; drop `:latest` from compose.** | A writer can replace the image under its tag while the deploy waits for approval. | code + ops |

**I deleted the extracted token file the reviewer left in the scratchpad.** I never printed the token value.

---

## 3. Findings, ranked

### Critical

**C1. DigitalOcean API token in public git history. ✔ verified present.**
`infra/digitalocean-website/tfplan` (a plan zip) was committed in `098ea48f` (2026-07-06), deleted in `5d980f3d` (15 July). The commit is still reachable from `origin/main`. The zip holds a full `dop_v1_` token three times. An account-wide token snapshots the prod droplet; the copy holds every CouchDB DB and `/opt/tamamhealth/.env` (JWT secret, CouchDB admin, `ORG_DATA_KEY_SECRET` — which unseals PHI). → action 1–3. Purging history (`git filter-repo` + GitHub Support) is cleanup; **revocation is the fix**, because clones keep the file.

### High

**H1. Production CouchDB is internet-exposed. ✔ verified from config.**
`deploy.sh` generates a Caddy site `couch.tamamhealth.org → localhost:5984`, running plain `couchdb:3` with no `require_valid_user` and no rate limit; Fauxton at `/_utils` and the version at `/` advertise it. Unlimited admin-password guessing; CouchDB admin reads every DB and can rewrite the validator and `_security`. The hardened, pinned image exists but is only wired into `docker-compose.data.yml`, which prod doesn't use. → action 4.

**H2. The org data key is not a boundary inside an org. ✔ verified (code comment confirms it's deliberate).**
`/api/crypto/org-key` issues the organisation's key to **any known staff role** (`mayHoldOrgKey` = "has a role config"), and the gateway lets every role replicate every org-scoped database. So a cashier or data-entry clerk can pull and decrypt clinical notes, labs and prescriptions at their facility — data their UI never shows. `oenc:` protects against outsiders, not against a curious or malicious insider. **Fix:** a role→database read allowlist in the gateway (no clinical DBs for billing/reception); longer term, per-facility or per-domain keys.

**H3. A `government` session reads row-level PHI for every org. PROVED (F1).**
`filterByScope` returns everything for `government`, and the role is in the read lists of `/api/patients`, `/api/reports`, `/api/mpi/match` and all FHIR reads. `GET /api/reports?type=patients&format=csv` returned patients from two different orgs in one unpaginated response; MPI returned candidates across orgs. The export audit is fire-and-forget with no row count, so a national dump looks ordinary. **Fix:** make `government` aggregate-only (serve it from the de-identified Postgres projection), remove it from PHI read lists and the scope bypass; if row-level is ever needed, bound by state/county and require MFA; await the audit and log the row count.

**H4. `org_admin` can self-grant restricted mental-health notes. PROVED (F4).**
Access to `/api/restricted-mental-health-notes` is `user.specialtyCode === 'psychiatry'` regardless of role, and `org_admin` sees every facility. An admin can set their own `specialtyCode` through the users route. **Fix:** gate restricted notes on a clinical role **and** an explicit care-team or grant relationship, not a self-editable field; forbid self-editing `specialtyCode`.

**H5. No MFA on any account, including super-admin. CONFIRMED (code + history).**
MFA was removed (`020e049c`, `5f73318f`). `super_admin` passes every guard, sees every tenant, and can pull any org's key; the username `superadmin` is in the repo. A single phished/reused password is total compromise. **Fix:** TOTP/WebAuthn for `super_admin`, `org_admin`, `government`, enforced as a token claim at the proxy; optional IP allowlist for super-admin. → relates to action 5.

**H6. Every role's device holds the whole facility record, and keeps it. CONFIRMED.**
Sync starts all ~80 databases for every role, narrowed only by facility, never by role (admin/superintendent/manager devices hold the whole org). With H2's key on the same device, a stolen tablet is fully readable. Logout keeps any database with one unsynced or refused write, so the next user from another facility can read it. **Fix:** per-role replication allowlist (H2); on wipe, keep only unsynced/denied docs in a sealed outbox and destroy the rest.

**H7. Unauthenticated logout poisons the token-revocation store. PROVED.**
`/api/auth/logout` runs before every gate and calls `revokeToken()` on an **unverified** cookie, trusting its `exp`. 4,000 forged ~4 KB cookies → a 15.5 MB file, 67 ms/call and climbing (quadratic), entries that never expire; with Upstash, keys with century-long TTLs. Anonymous denial-of-service against the whole EHR. **Fix:** `verifyToken` before revoking; clamp `exp` to `now + SESSION_TTL`; rate-limit logout per IP. *(Next code fix in progress.)*

### Medium

**M1. Server-side request forgery via the public booking loaders. PROVED locally.**
The `/book/*` server components build `` `${x-forwarded-proto}://${host}/api/booking/…` `` from request headers and fetch it; a `/` or `?` in `Host` injects the path too. A listener received an attacker-chosen path. Production's host-matched Caddy blocks it today, but any `PLATFORM_BIND=0.0.0.0` install or same-network host is exposed, and the confirm page is a 2xx-JSON oracle for internal port scanning. **Fix:** call the booking service directly in the server component, or build the URL from `NEXT_PUBLIC_APP_URL`, never from headers.

**M2. Mass assignment on clinical create routes. PROVED (IDOR reviewer).**
Several create routes accept any `patientId` and server-owned status fields (44 `body as Parameters<…>` casts; client-settable actor fields). A clinician in another org can write fake results/records into a patient's chart and portal. **Fix:** per-route parsers that allow-list fields and stamp `orgId`/actor/status server-side (ties into AUDIT-2 §3's `defineRoute` and `assertSyncWritable`).

**M3. The server never forces catalogued PHI fields to be sealed. CONFIRMED.**
The validator doesn't require `oenc:`/`oencm:` on catalogued fields, so plaintext from a client bug, a modified client, or a `runWithoutEncryption` path replicates to every device and backup. **Fix (cheap):** validator refuses a catalogued string field that isn't an envelope.

**M4. Screen lock is cosmetic; PIN is brute-forceable. ✔ verified.**
`isLocked` is in-memory `useState`, so a reload, new tab, or reopen restores the session with no lock; the chart stays mounted behind the overlay; the 4-digit PIN has no attempt limit (a stolen PIN hash cracked in ~49 s). **Fix:** persist a lock flag and start locked on a cold restore; `inert` the app behind the overlay; lock out after N wrong PINs and force password re-auth; 6 digits.

**M5. Closing the browser is not a logout; the key persists. CONFIRMED/PROVED.**
The wipe runs only on explicit logout or a 401; an expired/missing cookie wipes nothing. The org-key keystore has no expiry, and the stored CryptoKey decrypts envelopes with no app code (AAD is just `tamamhealth:<orgId>`). **Fix:** wrap the org key under a password-derived key at sign-in; drop the unwrapped key on cold start with no valid session; expire the keystore with the credential. **Cheap mitigation now: OS PIN + disk encryption on every tablet, USB debugging off.**

**M6. Anyone can lock out a named account, including `superadmin`. CONFIRMED.**
The per-username rate limit is checked before the password, so 5 bad attempts/15 min locks a known username (and the correct password then 429s). A clinical availability problem. **Fix:** key the lockout on (username, IP) or a device cookie; progressive delay, not a hard lock; let a correct password through.

**M7. A stolen staff token outlives logout and renews forever. CONFIRMED.**
Revocation is keyed by exact token string (no session id/`jti`); `/api/auth/me` re-mints any token older than 6 h with no absolute ceiling. Logout revokes only the current string. **Fix:** a session id in the token, revoke the whole renewal family on logout, an absolute max age, a "sign out all devices" control.

**M8. Validator create-grants can overwrite existing records via replication. PLAUSIBLE.**
The validator's immutability and care-team checks depend on the server's `oldDoc`; your own live test notes that a replicated write whose history doesn't connect reaches the validator as a *new* doc. The gateway compensates only on append-only and message DBs. Create-only grants (`lab_tech`→patient, nursing→medical_record, charge-raisers→billing) could replace a winning revision. **Fix:** in the gateway, for every org-scoped DB, refuse a create for an id that already exists and a revision that doesn't descend from the server's.

### Low (hardening)

- **L1. Dev/non-prod servers accept unsigned tokens for any role. PROVED.** `verifyFallbackToken` accepts `…​.dev-fallback` when `NODE_ENV !== production`; `next dev` binds all interfaces. Bind dev to 127.0.0.1; require an explicit loopback-only opt-in or delete the path.
- **L2. Auth routes skip the Origin check and ignore content-type.** Cross-site `text/plain` can force logout or login-CSRF. Apply the Origin check to `/api/auth/*` and require `application/json`.
- **L3. No `Cache-Control: no-store` on authenticated API JSON** (only ~8 routes set it); the service worker keeps page URLs after logout, one of which carries a patient name (`/referrals?patient=<name>`). Set `no-store, private` on every `/api/*`; use the patient id in that URL; purge `tamamhealth-*` caches on logout.
- **L4. Facility write-check skips patients and referrals** (neither carries a facility field), so any patient-write role can write any patient in the org by id. Tie patients to `registrationHospital`/`lastVisitHospital`.
- **L5. Records with no facility field are readable org-wide; deleted docs pass the read filter with a body.** Refuse clinical writes without a facility field; strip tombstones to `_id/_rev/_deleted`.
- **L6. Portal accounts are guessable** (`first.last.NNNN`, 8-char activation with no blocklist, OTP opt-in, ~960 guesses/day). Run the password blocklist at activation, OTP on by default, exponential per-account backoff.
- **L7. JWT alg/exp not pinned; nothing ties a token to one deployment.** Add `{ algorithms: ['HS256'], requiredClaims: ['exp','iat','sub'] }`; put a deployment id in the audience; confirm each deploy (demo v6/v7 included) has its own `JWT_SECRET` and delete the v7 Preview Couch vars.
- **L8. Unauthenticated full-table scans** in activation/invite/forgot-password; **raw `err.message`** returned in ~18 places; **`NEXT_PUBLIC_FINGERPRINT_BRIDGE_TOKEN`** ships in the bundle (only matters if fingerprint is enabled); **attachment MIME type trusted** for blob URLs (contained by CSP today). Index-backed lookups; typed errors; allow-list upload MIME.
- **L9. Dependencies:** `npm audit --omit=dev` — platform 5 moderate (all build-time `@sentry/nextjs` chain; fix is `@sentry/nextjs@11`), website 0, root 0. No runtime-reachable high/critical.

---

## 4. What holds (so you know the floor)

- **No anonymous web break-in found.** Strict CSP with per-request nonces and `strict-dynamic`, no inline scripts; only 3 static `dangerouslySetInnerHTML`, no `innerHTML`/`document.write`; every print/HTML builder escapes its values; `frame-ancestors 'none'`, HSTS, nosniff.
- **Patient-written text can't XSS staff** — rendered only through React; `javascript:` URLs blocked by Next and React.
- **JWT:** `alg=none` rejected, staff/patient tokens separated by audience, expired rejected, production refuses a default/short secret and the dev fallback.
- **Live re-check every API call:** deactivation, role/org/facility from the user record, password epoch, tenant kill-switch — all fail closed in prod.
- **Passwords:** bcrypt cost 12, constant-time unknown-user path, one error message, 12+ char staff policy with blocklist.
- **CSRF:** HMAC bound to the subject, constant-time; cookies httpOnly, SameSite=Strict, Secure in prod.
- **Payment webhooks:** HMAC over the raw body with replay protection; a forged/replayed callback can't mark a bill paid; providers off until `*_GATEWAY_VERIFIED=true`.
- **Tenancy at CouchDB:** per-user CouchDB credential never shown to the browser; other orgs' DBs refused by CouchDB itself; `_security`/`_design`/admin endpoints blocked; reads filtered per-doc by facility; `tamamhealth_users` never replicated to browsers; portal hashes stripped on read.
- **Secrets:** apart from the DO token, the 952-commit history holds only placeholders; `.env*`, `.seed-credentials.json`, tfvars/tfstate are gitignored; services bind to localhost; the GitHub OIDC cron check accepts only this repo's `main` workflows; Sentry strips PHI.
- **ID-based API access is mostly scoped** — no cross-org read by changing a URL id, except the `government` role (H3).

---

## 5. Code-fix queue (what I can do)

One fix per PR, from `main`, each with a test. **Behaviour changes ship as their own commit.** The operational items in §2 are not here — they're yours.

| Order | Fix | Finding | Status |
|---|---|---|---|
| 1 | CSV formula-injection guard across all writers | L3-adjacent / AUDIT-2 | ✅ **PR #203** |
| 2 | Verify token before revoking; clamp exp; rate-limit logout | H7 | next |
| 3 | Validator refuses plaintext in catalogued PHI fields | M3 | queued |
| 4 | Booking SSRF: drop Host-header self-fetch | M1 | queued |
| 5 | `no-store` on `/api/*`; patient id not name in URL; purge SW cache on logout | L3 | queued |
| 6 | Persist lock state + start locked on cold restore; PIN attempt limit | M4 | queued |
| 7 | Gateway role→database read allowlist | H2 / H6 | queued (bigger; needs care + sync tests) |
| 8 | `government` → aggregate-only; restricted-notes grant check; create-route field allow-listing | H3 / H4 / M2 | queued (behaviour change; design first) |
| 9 | Gateway create/revision-lineage check for org-scoped DBs | M8 | queued (needs live-CouchDB test) |
| 10 | Auth Origin check + content-type; JWT alg/claims pin; session-id revocation | L2 / L7 / M7 | queued |

**Note:** the IDOR reviewer's run was cut off by a safety classifier on its model before it finished listing every mass-assignment case. The two HIGH findings (H3, H4) and the mass-assignment summary (M2) came through; a few individual create-route cases weren't enumerated. I did not reconstruct them, because rewording the same request hits the same block. When fixing M2, treat every create route's body as untrusted rather than relying on that list being complete.

## Appendix: proof scripts (temporary)

Under the session scratchpad `…/scratchpad/security/`: `auth/` (`jwt-probe.ts`, `blacklist-probe.ts`), `authz/`, `device/` (`derive.ts`, `nonextractable.ts`, `pin.ts`), `web/`, `infra/` (`hits.tsv`), `idor/` (`idor.test.ts`). These print no secret values. Copy anything you want to keep; the scratchpad is cleared between sessions.
