# Outpatient post-consultation handoff

## Research and scope
AHRQ Warm Handoff Plus recommends patient/family participation in transfer of responsibility: https://www.ahrq.gov/patient-safety/reports/engage/warmhandoff.html
AHRQ teach-back checks whether explanations were understood: https://www.ahrq.gov/patient-safety/reports/engage/teachback.html
These principles inform the workflow; they are not a South Sudan staffing or scope-of-practice rule. Local clinical leadership must approve the pilot. No automated clinical decisions or medication administration are introduced.

## Acceptance and design
- On first entry to clinic checkout, create an encounter-owned post-consult checklist atomically with the transition. Existing terminal encounters are not migrated.
- Signing a provider note also creates the handoff while pharmacy/laboratory work is pending; these clinical orders keep their separate safety gates. A checklist reviews/coordinates orders, rather than falsely marking them administered or resulted.
- Nursing dashboard and consultation show the same scoped, live checklist. A nurse/clinician claims ownership before recording completion.
- Review care plan/teach-back, ordered treatments, investigation coordination and follow-up. Checklist completion is NOT evidence of administration, specimen collection or booking: staff use linked existing modules for those records.
- Deferred work requires a reason, responsible staff member and future review time; it remains visible in the queue. Clinicians can document that no separate nursing step is needed.
- An unresolved handoff blocks routine discharge centrally, including appointment-triggered discharge. Walk-outs retain an explicit pending-items disposition, never fabricated completion.
- PouchDB encounter revisions serialize local edits; unresolved replicated conflicts block completion/discharge. Existing clinical_encounter conflict tracking and tenant replication policies apply.
- Frontend: accessible translated component, loading/error states, doctor-style tokens, existing routes only. Backend: scoped services, bounded fields, actor attribution, safe audit and sync events. No secrets or new API.

## Verification
Add service tests for scope, ownership, task validation and readiness. Run types, translations, lint and journey regressions; browser-check the new surface. Deployment and local clinical sign-off remain separate.

## Operational limits and deployment
- Run the existing CouchDB validator setup command for the target tenant databases before rollout; generating validators in source does not install them on a running server.
- The final regression run passed 316 suites / 3,059 tests. Additional targeted tests execute the generated replication validator. The production build passed earlier. Whole-tree lint initially encountered a syntax error during concurrent patient-chart edits; the subsequent TypeScript recheck and scoped handoff lint passed. Re-run release checks after all concurrent edits settle.
- Browser verified the nurse dashboard surface in an isolated seeded demo. No real records or deployment were modified.
- Staff directory lookup is currently online. Keeping responsibility yourself supports offline deferral; transferring to another staff member requires a successful directory check. Deferred tasks remain on the nursing queue until completed.
- Existing terminal visits are untouched. This is an outpatient coordination checklist, not emergency/trauma routing or a replacement for medication administration, immunization, procedure or booking records.
