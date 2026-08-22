# User Registration & Provisioning Audit — August 2026

_Scope: every path by which an identity comes to exist on TamamHealth, from the platform
super-admin down to a ward nurse and a patient-portal login. Read against code on
2026-08-22. Companion to `RBAC-MATRIX.md` (what a role may do) — this document covers how
someone comes to hold a role in the first place._

> **Status: all fifteen findings were fixed on 2026-08-22.** The findings below are kept
> in the past tense they were written in, because the reasoning is why the code now looks
> the way it does. What each fix turned into is recorded in §6.
>
> **One change alters behaviour on deploy.** `superAdminPolicies.mfaRequired` has read
> `true` since the security console shipped and was enforced by nothing. It is enforced
> now, so on the first sign-in after this deploy a `super_admin`, `org_admin`,
> `medical_superintendent` or `hospital_manager` is held at a second-factor enrolment
> screen until they add an authenticator app. Enrolment takes about a minute and needs no
> network. To defer it: Super-admin → Security → **Require MFA → Off**, which stays
> reachable from a gated session precisely so nobody can be locked out of the switch.

---

## 1. The map

There is a real dependency chain. Nothing below it can exist until the thing above it does.

### Chain step 1 — Platform operator (`superadmin`)

**Bootstrap-on-first-login.** No seeding script creates this account on a production
deployment; it materialises the first time someone signs in as `superadmin`.

- `lib/server-users.ts:119` — `BOOTSTRAP_USERNAMES = {'admin','superadmin'}` is the only
  allow-list. `bootstrapUserLogin()` writes the user doc **only** when no doc exists yet and
  the offered password matches the seed credential, then sets `mustChangePassword: true`.
- Credential source: `SUPERADMIN_INITIAL_PASSWORD`, falling back to the well-known
  `'Superadmin!'` (`lib/seed-credentials.ts:177`).
- Production is gated: `lib/config-validation.ts:188-193` refuses boot if that variable is
  missing, is the demo default, or is under 16 characters. `instrumentation.ts:30` throws.
- After the first password change, `deleteSeedCredentialsFile()` shreds and unlinks the
  plaintext credentials file (`api/auth/change-password/route.ts:100`).

**Assessment: this is the strongest link in the chain.** Create-if-absent, fail-closed on a
write race, boot refusal on a weak secret, self-destructing credential file. Nothing to fix.

### Chain step 2 — Organization (tenant) + its first `org_admin`

`super_admin` only. `POST /api/organizations` (`WRITE_ROLES = ['super_admin']`). The create
dialog on `/admin/organizations` carries an optional sub-form that provisions the tenant's
first `org_admin` in the same step — role hard-coded to `org_admin`, scoped to the org just
created (`lib/org-admin-provisioning.ts:60`), written through the same `createUser()` path as
every other account. Credentials land in `CredentialHandoffModal`, shown once.

`SINGLE_ORG_MODE=true` permits exactly one organization, but always allows the first, so an
empty install can still be bootstrapped.

### Chain step 3 — Facility

A facility-bound role cannot be created before its facility has **reached the server** —
`/api/users` reads the server's copy while the picker reads the browser replica
(`api/users/route.ts:79-96`). `CreateUserModal` handles the empty case inline rather than
routing away and discarding the half-filled form.

### Chain step 4 — Staff account

Two entry points, one write path.

| | Admin-created | Request-and-approve |
|---|---|---|
| Initiator | `super_admin` / `org_admin` | anyone, unauthenticated |
| Entry | `CreateUserModal` (roster, facility Staff tab, org create dialog) | `/request-account` |
| Route | `POST /api/users` | `POST /api/account-requests` → `POST /api/account-requests/:id` |
| Approval | none — the admin *is* the approval | tier-routed queue |
| Credential delivery | **invite email**, temp password as fallback | **temp password only** |
| Audited | `user.create` + `user_created` | `account_request.decide` + `user_created` |

Both terminate in `user-service.createUser()`, which validates role, enforces the
org/facility rules from `lib/user-scope-rules.ts`, checks username uniqueness, bcrypt-hashes,
and stamps `mustChangePassword: true`.

**Request routing** (`lib/account-request-roles.ts:approverTierFor`) is derived server-side
from the requested role and org — never accepted from the client:

- `super_admin` / `government` / `county_health_director` → `super_admin` only.
- Any other role with an org → that org's `org_admin`.
- No org named → `super_admin` (otherwise the request would be visible to nobody).

`super_admin` is deliberately absent from `REQUESTABLE_ROLES`. The granted role is re-checked
against the privileged list at approval time, so an `org_admin` cannot approve a legitimate
request while substituting a national role on the way through.

### Chain step 5 — Credential activation

- **With email:** welcome mail carries no password, only a link to `/accept-invite?token=`.
  Token is 32 random bytes, stored as a SHA-256 hash, TTL 72h, single-use, redeemed at an
  unauthenticated endpoint that answers identically for every failure mode and **issues no
  session** (`api/auth/accept-invite/route.ts`).
- **Without email:** 14-character temp password from `lib/temp-password.ts` (CSPRNG,
  look-alike characters excluded so it can be read aloud in a clinic), shown once.
- **First login:** `(dashboard)/layout.tsx:59` renders `ForcePasswordChange` full-screen while
  `mustChangePassword` is set.

### Alternate path — patient portal

`POST /api/patient-portal/login` authenticates against `portalUsername` / `portalPasswordHash`
on the patient document, with optional SMS OTP as a real second factor. **No code anywhere
writes those two fields.** The only account that has them is the seeded demo patient
(`data/mock.ts:2033`). The portal has a front door and no way to issue a key.

### Alternate path — standalone demo

`isStandaloneDemo()` requires `NEXT_PUBLIC_DEMO_MODE === 'true'` **and** no CouchDB admin
credentials. Both halves are load-bearing — this replaced a demo branch that failed open on a
single unset environment variable.

---

## 2. What is working

Worth stating plainly, because the fixes below should not disturb any of it.

1. **One write path.** Approval, admin creation, and the org-create shortcut all funnel into
   `createUser()`. There is no second, weaker way to make a user.
2. **Privilege escalation is closed at three separate points** — `assignableRoleError` on
   create, `targetMutationError` on every mutation of an existing account, and the
   granted-role re-check at approval.
3. **Credentials never travel in mail.** The invite-link design is correct and the reasoning
   is documented at the top of `lib/user-invite.ts`.
4. **Delivery is reported honestly.** `wasDelivered()` refuses to count the `log` provider as
   a send, so an admin is never told mail went out when it did not.
5. **Sessions die when they should.** `getAuthPayload` checks live `isActive`, a
   `passwordUpdatedAt` epoch against the token's `pwdAt`, and the tenant kill-switch — all
   fail-closed in production.
6. **The request queue is unauthenticated but boring**: stores a claim, grants nothing, never
   reveals whether an email already has an account, IP rate-limited, and the
   `account_requests` database is explicitly non-replicating so requester PII never reaches a
   device.

---

## 3. Findings

Ranked. Severity is about clinical/operational consequence, not code tidiness.

### P0-1 — An approved account request never sends the invitation email

The person typed their email into the form *for this purpose*. `POST /api/account-requests/:id`
calls `createUser()` directly (`route.ts:129`) and returns `temporaryPassword` — it never
reaches `inviteNewUser()`, which lives in `api/users/route.ts:222` and is only wired to the
admin-created path. The approver is left phoning a password to someone they have never met.

**Fix:** lift `inviteNewUser()` into a shared module and call it from both routes. One
provisioning path already exists; make it one *delivery* path too.

### P0-2 — No invitation resend and no password self-service

`issueUserInvite()` has exactly one call site (`api/users/route.ts:231`). After 72 hours the
link is dead and the only recovery is an admin reset that mints a new temporary password.
There is no forgot-password flow at all — `login.forgotPassword` exists in both locales
(`en.ts:3029`, `apd.ts:3021`) and is rendered nowhere.

Consequence: every forgotten password in the field becomes a phone call and a spoken
credential, which is exactly the failure mode `lib/user-invite.ts` was written to avoid.

**Fix:** `action: 'resend_invite'` on `/api/users` (reuses `issueUserInvite`, which already
overwrites the outstanding token), plus an email-based reset that reuses the same token
machinery — same TTL, same generic-failure discipline, same no-session-issued rule.

### P0-3 — The security policy console is decorative

`lib/admin/super-admin-policies.ts` declares `mfaRequired: true`, `passwordMinLength: 12`,
`sessionTimeoutMinutes: 15`, `impersonationEnabled: false`. `/admin/security` renders them as
live toggles and `/admin/config` reports "MFA required: Yes". **Nothing reads any of them
outside those two pages.**

- Staff MFA does not exist. Patients get SMS OTP; the people holding write access to every
  chart in the facility get a password.
- The real password floor is a hard-coded `8` in five files (`user-service.ts`,
  `accept-invite/route.ts`, `change-password/route.ts`, `ForcePasswordChange.tsx`,
  `CreateUserModal.tsx`).
- Super-admin impersonation via the login role picker (`api/auth/login/route.ts:121`) is
  unconditional and **not audited**, while the policy default says impersonation is off.

An operator reading that screen believes their platform enforces controls it does not. That
is worse than showing nothing.

**Fix, in order:** (a) delete or disable the toggles that enforce nothing, so the screen stops
lying; (b) make `passwordMinLength` real by reading it in one shared validator; (c) audit
impersonation and gate it on `impersonationEnabled`; (d) add TOTP for `super_admin` and
`org_admin` first, then facility admin roles.

### P0-4 — A production deploy can ship with invitations silently disabled

`EMAIL_PROVIDER` defaults to `log`. Per-account copy is honest, but
`productionConfigWarnings()` only checks `SENTRY_DSN` — nothing warns at boot that no mail
provider or no `NEXT_PUBLIC_APP_URL` is configured, so a deployment can run for months where
every invitation is a line on stdout and every new user is onboarded by telephone.

**Fix:** add both to `productionConfigWarnings()`. Two lines, and it removes an entire class
of "why didn't they get the email".

### P1-5 — No identity proofing anywhere in the request flow

The public form collects self-asserted name, email, phone, role, org, facility. The email is
never verified. The approver sees only what the requester typed. Nothing captures a
professional registration number, a supervisor, or a staff ID except as free text in the
optional note.

This is the weakest link in the whole system: it is the only place where someone outside the
organization can start a process that ends in prescribing rights.

**Fix:** (a) email round-trip before the request enters the queue — an unverified request
should not consume approver attention; (b) a structured `professionalRegistrationNumber`
field for clinical roles, shown to the approver as something to check against the South Sudan
Medical & Dental Council / Nursing Council register; (c) a required approver attestation
("I verified this person's identity by …") stored on the decision.

### P1-6 — Nobody is told a request is waiting

There is no notification, no email, no badge outside the page itself. An `org_admin` who does
not open `/org-admin/users` never learns anyone asked. A request that rots is a clinician who
gives up and shares a colleague's login.

**Fix:** notify the resolved approver tier on create, and add an ageing indicator to the queue.

### P1-7 — An admin can deactivate themselves; nothing protects the last admin

`action: 'delete'` blocks self-targeting (`api/users/route.ts:391`). `action: 'deactivate'`
does not. Combined with the live `isActive` check in `getAuthPayload`, an `org_admin` who
deactivates their own account is locked out on the next request — and if they were the only
one, so is the tenant. Recovery requires `super_admin` intervention.

**Fix:** block self-deactivation, and refuse any deactivation/demotion/deletion that would
leave an organization with zero active `org_admin`s.

### P1-8 — Audit vocabulary is misleading

`export const POST = withAuditLog(postHandler, { action: 'user.create' })`
(`api/users/route.ts:613`) stamps **every** action on that route — delete, reset, deactivate,
update — as `user.create`. The service layer separately logs the correct verb, so the log
holds one accurate row and one wrong one per event. An auditor reading the wrapper's rows
concludes accounts were created when they were destroyed.

**Fix:** derive the action from `body.action`, or split the route.

### P1-9 — Seven of twenty-five roles cannot be requested

`REQUESTABLE_ROLES` omits the six clinical-flow station roles (`triage_nurse`,
`rooming_nurse`, `clinician`, `clinic_clerk`, `central_registration_clerk`,
`records_hmis_officer`). Those are real, seeded, routable roles with dashboards. Staff holding
them have no self-service path and no explanation for why their job is not in the list.

### P1-10 — Seat enforcement is partial

`validateSeatAvailable()` runs only for `org_admin` and facility-bound roles, only on
**create**, and fails open on a read error. Reactivating a deactivated account does not check
seats, and an org-scoped `government` account bypasses the check entirely.

### P2-11 — `mustChangePassword` is a UI gate, not an enforcement gate

`AuthPayload` carries the flag but `getAuthPayload` never acts on it, and the proxy does not
either. The full-screen block lives only in `(dashboard)/layout.tsx:59`. A session on a
temporary credential can still drive `/api/*` directly.

### P2-12 — Invitation state is invisible in the roster

`inviteExpiresAt` reaches the client (only `inviteTokenHash` is redacted) but no screen shows
it. There is no "invited / expired / never signed in" column, and no `lastLoginAt` field
exists on `UserDoc` at all — so dormant accounts cannot be found, and no access review is
possible.

### P2-13 — No bulk onboarding

A hospital going live with 200 staff has one dialog and one account at a time. No CSV import,
no bulk invite, no template.

### P2-14 — The temporary password renders in cleartext by default

`CreateUserModal` initialises `showPassword` to `true`. In a shared clinic office the
credential is on screen for the length of the form.

### P2-15 — Minor

- `POST /api/account-requests` is not wrapped in `withAuditLog` — the one public write in the
  app produces no audit row.
- `/api/account-requests/options` enumerates every organization and facility to anyone. Likely
  acceptable (a facility directory is close to public), but it should be a decision on the
  record, not a side effect.
- Rate limiting on requests is per-IP only; there is no per-email dedupe, so one person can
  fill a queue with ten variations.
- Offboarding is `isActive: false` and nothing else — no handover of assigned patients, open
  queues or pending orders.

---

## 4. Recommendations

### 4.1 Align password policy with NIST SP 800-63B-4 (finalised 2025)

The current 8-character floor with no screening is below current guidance, and the
`passwordMinLength: 12` shown in the console is enforced nowhere.

- **15 characters minimum when a password is the only authenticator**; 8 is acceptable only
  *with* a second factor. This makes MFA and password length one decision, not two.
- **No composition rules.** Rev 4 prohibits mandated character-class mixes rather than merely
  discouraging them. Nothing here imposes them today — keep it that way.
- **Screen against a breach/common-password blocklist** on every set-password path
  (`accept-invite`, `change-password`, admin reset). This is the single highest-value addition.
- **Accept up to 64 characters, allow spaces and printable ASCII**, and do not block paste —
  password managers are the point.
- **Stop forcing periodic rotation.** The platform already only forces a change on
  admin-issued credentials, which is exactly right; do not add scheduled expiry later.

### 4.2 Put a real second factor on privileged accounts

The proposed HIPAA Security Rule update (published January 2025, comment period closed March
2025) would make MFA an explicit requirement for systems touching ePHI. As of mid-2026 it
remains proposed — OMB's Unified Agenda now targets July 2027 for final action, and the
industry expectation is 180 days to a year to comply once finalised. South Sudan is not a
HIPAA jurisdiction, but donors, ministries and NGO partners increasingly procure against these
controls, and the direction of travel is not in doubt.

Sequence it: TOTP for `super_admin` and `org_admin` → facility admin roles
(`medical_superintendent`, `hospital_manager`) → prescribers. TOTP over SMS: the OTP machinery
already exists for patients (`lib/patient-portal-otp.ts`), but SMS in low-connectivity
settings fails closed, and a second factor nobody receives is not a factor — the code already
says so.

### 4.3 Make provisioning a joiner–mover–leaver lifecycle, not a create form

The platform models *joiner* well and *mover* and *leaver* barely.

- **Joiner:** one shared credential-delivery path for both entry points (P0-1), resend (P0-2),
  bulk import for go-live (P2-13).
- **Mover:** role changes are supported but produce no notification and no re-attestation.
  A role change should be audited as its own event and re-check facility scope.
- **Leaver:** add scheduled deactivation (end-date on the account), a handover step that
  surfaces the leaver's open work before the account closes, and a quarterly access review
  that lists accounts with no login in 90 days. All three need `lastLoginAt`, which does not
  exist yet — **add that field first; it unblocks the whole category.**

### 4.4 Fix the honesty gap between the console and the code

Every control shown on `/admin/security` should either be enforced or removed. This is not
cosmetic: a governance screen that overstates the platform's posture will be read as an
assurance by whoever procures it.

### 4.5 Raise the floor on identity proofing before raising anything else

Ordered by value per unit of work:

1. Email verification round-trip on account requests.
2. Approver attestation stored with the decision.
3. Professional registration number captured and displayed for clinical roles.
4. Later, if it becomes worth the integration cost: verification against the national council
   registers.

### 4.6 Suggested sequence

| Order | Work | Why here |
|---|---|---|
| 1 | Shared invite delivery (P0-1) + resend (P0-2) + boot warnings (P0-4) | Small, self-contained, removes the most field pain |
| 2 | Self-deactivation + last-admin guard (P1-7); audit action fix (P1-8) | Lockout and audit integrity; both are small |
| 3 | `lastLoginAt` + invitation state in the roster (P2-12) | Unblocks access review and dormancy |
| 4 | Password policy: 15-char floor, blocklist, one shared validator (§4.1) | Needs a decision on the floor before coding |
| 5 | Email verification + approver attestation (§4.5) | Changes the request document shape |
| 6 | TOTP for admin roles (§4.2) | Largest; do it after the floor is set so the two decisions are made together |
| 7 | Password self-service (§4.3) | Depends on 1, 4, and ideally 6 |
| 8 | Patient portal enrolment | Currently a door with no key — scope separately |

---

## 5. Verification

Existing coverage is genuinely good for the write path — `__tests__/api/user-provisioning.test.ts`,
`account-request-provisioning.test.ts`, `organization-bootstrap.test.ts`,
`rbac/invitation-consistency.test.ts`, `rbac/user-activation-path.test.ts`,
`services/user-invite*.test.ts`, `services/bootstrap-login.test.ts`,
`services/email-delivery-honesty.test.ts`.

The gaps above are mostly *missing features*, not broken tested ones — which is why they
survived. Anything added should carry a test in the same files.

---

## 6. What was built

Every finding above, with the code that answers it.

| # | Finding | Fix |
|---|---|---|
| P0-1 | Approval never sent the invitation | `lib/services/invite-delivery.ts` — one delivery path, called by `/api/users`, `/api/account-requests/:id` and the new forgot-password route |
| P0-2 | No resend, no password self-service | `resend_invite` action on `/api/users`; `POST /api/auth/forgot-password` + `/forgot-password` page; `/accept-invite?reset=1` re-words the same redemption page |
| P0-3 | Security console enforced nothing | `lib/totp.ts` + `lib/services/mfa-service.ts` + `/api/auth/mfa` + `/api/auth/verify-mfa`; `lib/password-policy.ts` makes `passwordMinLength` real; impersonation now checks `impersonationEnabled` and writes an audit row |
| P0-4 | Silent email failure on deploy | `productionConfigWarnings()` now names a missing mail provider, its API key, and `NEXT_PUBLIC_APP_URL` |
| P1-5 | No identity proofing | Email round-trip (`/api/account-requests/verify`); `professionalRegistrationNumber` on the form and in the queue; `identityAttestation` required to approve |
| P1-6 | Nobody told a request was waiting | `lib/services/account-request-notify.ts` mails the resolved approver tier; the queue shows how long each request has waited |
| P1-7 | Self-deactivation and last-admin lockout | `lastAdminLockoutError()` in `/api/users`, covering deactivate, delete and demotion |
| P1-8 | Every action logged as `user.create` | `AUDIT_ACTION_HEADER` — the handler names the verb it ran |
| P1-9 | Seven roles could not be requested | The six clinical-flow station roles added to `REQUESTABLE_ROLES` |
| P1-10 | Partial seat enforcement | Seat check now runs on reactivate as well as create |
| P2-11 | Forced change was a UI gate only | Edge-proxy 403 for `mustChangePassword` and the new `mfaPending`, with a remediation allow-list |
| P2-12 | No invitation state, no last login | `UserDoc.lastLoginAt` + `lib/account-state.ts`; both rosters and the account card read it |
| P2-13 | No bulk onboarding | `lib/bulk-user-import.ts` + `POST /api/users/import` + `BulkUserImportModal`, with a dry run that must agree with the commit |
| P2-14 | Temp password shown in cleartext | `CreateUserModal` opens with it hidden |
| P2-15 | Smaller items | Public request write audited; per-email dedupe; `summarizeOpenWork()` reports a leaver's unfinished work after access is revoked |
| §4.3 | Patient portal had no enrolment | `lib/services/patient-portal-enrolment.ts`, `/api/patients/portal-access`, `/api/patient-portal/activate`, `/patient-portal/activate`, and a card on the chart's Demographics tab |

**Verification.** 101 new unit tests across eight suites (password policy, TOTP, MFA
service, account state, bulk import, portal enrolment, users-route guards, approval
route); full suite 151 suites / 1742 tests green; `npm run lint` 0 errors; `i18n:check`
passes with both locales at parity; production build clean. Driven end to end in Chromium:
the two-step sign-in, the enrolment gate, the forced-change 403, the impersonation refusal,
the invite/reset pages, and a bulk import of six rows against a throwaway tenant.

Two defects were found by that browser pass and fixed: the CSV importer resolved the
label "Doctor" to the `clinician` role (shared label, last-write-wins in the alias map),
and its dry run reported rows as ready that the commit then refused when the organisation
had no facilities — the exact preview/outcome gap a preview exists to close.

**Sources for §4.1–4.2:**
[NIST SP 800-63B Rev 4 password updates](https://securityboulevard.com/2025/09/nist-sp-800-63b-rev-4-password-updates/) ·
[NIST 800-63B Rev 4: what's new](https://www.enzoic.com/blog/nist-sp-800-63b-rev4/) ·
[HIPAA MFA requirements 2026](https://medcurity.com/hipaa-mfa-requirements-2026/) ·
[2026 HIPAA changes roundup](https://complycreate.com/updates/2026-hipaa-changes-roundup)
