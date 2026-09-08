# Insurance integration: offline-first, evidence-based status

## Acceptance criteria
- Saving a claim locally queues it; it never asserts delivery to an insurer.
- Local eligibility estimates cannot become verified by selecting an API source.
- Policy/patient/facility linkage is validated. Eligibility is displayed per policy, with expiry.
- Staff may record an external payer receipt with a reference, or a manual coverage decision with evidence and expiry; these are clearly manual, not authenticated API responses.
- Approval is distinct from payment. Recording an approval must not create a payment ledger entry.
- Existing claims remain readable; no silent bulk migration or external transmission.

## Frontend
Use the existing billing/claims and patient insurance surfaces. Add queue notices, manual receipt controls, coverage evidence fields, per-policy checks and translations. Retain clinical work when verification is unavailable.

## Backend
Persist queue status in existing replicated claim documents. Store evidence and manual eligibility in existing scoped databases. Use stable claim identifiers and optimistic revision conflicts to prevent repeat transitions. No new database is needed. A real Smart/MediSmart adapter remains disabled until approved protocol, sandbox, provider identifiers, tariffs, credentials and data-sharing terms are supplied. Do not invent vendor endpoints or assume US EDI support.

## Security
Require authenticated scoped financial/clinical roles, validate linked documents and financial values, reject fabricated API eligibility, audit state changes without raw clinical narratives, and keep external secrets out of browser bundles. Existing CouchDB tenant policies remain the server-side authorization boundary. Manual evidence does not guarantee payment or biometric identity.

## Implementation
1. Correct local claim and eligibility semantics.
2. Add scoped manual evidence services and UI.
3. Separate approval from settlement; regressions for linkage, expiry, invalid transitions and retry.
4. Run types, lint, translation and tests; browser verification with synthetic data only.

## Integration boundary
This implements the local workflow, not a live insurer partnership. Automatic dispatch, payer-authenticated callbacks, tariff mapping, preauthorization exchange and certified card-reader integration require the vendor contract. Pending claims stay queued; no automatic network retry can run until that contract exists.

## Verification and operating limits
- Synthetic browser walkthrough: queue a claim, record a manual payer receipt, approve without recording payment, then record settlement. Patient billing also supports a local estimate and referenced, expiring manual coverage evidence.
- Regression tests exercise scope and patient/policy linkage, expiry, duplicate queue requests, approval/payment separation and recovery after an interrupted settlement write.
- Settlement currently records the entire approved amount, not installments. Legacy adjudications without the new receipt and adjudication evidence require reconciliation before settlement; they are not silently credited again.
- Build and automated tests validate this change, not production deployment or partner certification. A clinic pilot must separately prove backup restoration, facility isolation and offline synchronization against its actual infrastructure.
