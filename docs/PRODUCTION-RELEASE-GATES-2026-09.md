# Production release gates — September 2026

**Decision: NO-GO for real patient data until the remaining gates have evidence.**

This is a local readiness pass on the current working tree, not an attestation of the deployed infrastructure or clinical completeness. A successful production build is not proof of safe production operation.

## Implemented in this pass

- Updated the vulnerable transitive `fast-uri` dependency to the patched 3.x line; the lock resolves 3.1.7. Production dependency audit reports zero known vulnerabilities at check time. The full dependency audit still reports four low-severity development-tool findings.
- Added CI translation coverage and a high-severity production-dependency audit gate.
- Added `npm run config:check:production` in `platform/`. It loads environment configuration with Next's production precedence, checks existing fail-closed rules, rejects demo mode and unsupported Node versions, prints no secret values, and exits nonzero on errors or operational warnings. This is a read-only configuration check; it does not contact deployment services or validate actual encryption.

## Current local configuration blockers

Verification: the production build (including TypeScript and 197 generated pages) passed on Node 22; all 314 test suites / 3,041 tests passed on Node 22; translation coverage passed; the production dependency audit passed. Lint passed with 0 errors and 241 warnings. Alternate `.next-*` build output is excluded from lint and Jest module discovery.

- Development-only `SUPERADMIN_MASTER_PASSWORD=true` is present in the effective local configuration. Remove it from the actual deployment environment; do not bypass the startup validator.
- The shell defaults to Node 25, outside the application's declared Node >=20 <25 support. This pass runs verification with Node 22 without changing the user's global runtime.
- Error reporting is not configured. Configure and exercise an error sink before release.
- Email delivery is not configured; invitation/reset links default to logs. Configure delivery and verify the reset/invitation lifecycle without exposing tokens in logs.

The effective local configuration is not evidence of the remote production configuration. Operator-managed secrets were not edited and no deployment was made.

## Evidence required before clinical go-live

| Gate | Required acceptance evidence | Status |
| --- | --- | --- |
| Staging installation | Non-demo build on the intended host/runtime; durable CouchDB available; deployed validators/security policies verified | Not verified |
| Tenant isolation | Separate facility/org test users cannot read or modify records outside their permitted scope, including direct database access | Not verified live |
| Restricted notes | Authorized encrypted write/read, unauthorized denial, audit logging and key recovery on durable storage | Blocked in database-free demo |
| Core workflow | Registration → visit → orders/results → prescribing/dispensing → billing, including deposits/refunds and role handoffs, with synthetic data | Partial browser coverage only |
| Offline operation | Internet loss, reconnect, concurrent edits/conflicts, restart and local power-loss recovery without silent loss/duplication | Not verified in deployment |
| Disaster recovery | Restore encrypted backup into an isolated environment; verify records, attachments and permissions; measure approved recovery targets | Not verified |
| Devices and site | HTTPS/LAN trust, actual disk/device encryption, persistent storage behavior, UPS/power plan and secure server space | Not verified |
| Clinical acceptance | Named clinic owners approve each enabled pathway, field catalogue, SOP, translation and escalation process | Not obtained |
| Operations | Working alerts, named support owner, incident/rollback runbook and exercised rollback | Not verified |
| Release controls | Green remote CI, review approval, immutable artifact/version, staging approval | Not verified remotely |

Use synthetic patients in staging. Do not treat demo-only pathway owner/SOP entries as clinical approvals. See `DEMO-BROWSER-TEST-2026-09-07.md` for exactly what the browser test covered.

## Rollback / stop conditions

Stop rollout immediately on cross-tenant exposure, missing/duplicated clinical writes, incorrect patient linkage, unaudited restricted-note access, duplicate financial posting, or a failed restore. Preserve logs without PHI leakage, switch to the clinic's approved downtime procedure, and have the operator restore the last approved application artifact. Do not blindly roll back database migrations or overwrite unsynced records.
