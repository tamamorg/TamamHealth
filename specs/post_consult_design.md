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
### Audit follow-up design
- Route every persisted discharge through live checkout evaluation; exceptional dispositions require a clinician actor and a bounded reason. Generic patches cannot close a visit. Appointment completion checks before writing.
- Bind replication attestations to an administrator-provisioned `user:` claim, not a caller-supplied document ID. Preserve ownership history; current owner or clinician can transfer responsibility with a reason and validated recipient.
- Compare SHA-256 digests of locally available signed documentation and clinical orders with the reviewed digest. Ignore replication bookkeeping; changed clinical evidence requires explicit re-review and keeps past outcomes in history. This is deliberately conservative: fulfillment edits also require review. No claim of globally synchronized atomicity during network partitions.
- UI: reuse existing EHR typography and CSS tokens (white surface, blue actions, neutral borders, amber pending state); start-aligned patient/task rows rather than decorative dashboard cards. Show readable staff names, task progress, clear stale-plan warning and a secondary transfer disclosure with reason/recipient. Preserve keyboard focus, responsive form layout and both locales.
- Security checkpoint: scope all reads, reject stale revisions/conflicts, validate roles and recipients, encode text through React, audit changes; no new remote endpoint or credentials in the UI.

Add service tests for scope, ownership, task validation and readiness. Run types, translations, lint and journey regressions; browser-check the new surface. Deployment and local clinical sign-off remain separate.

## Operational limits and deployment
- Run the existing CouchDB validator setup command for the target tenant databases before rollout; generating validators in source does not install them on a running server.
- Refresh provisioned CouchDB user identities so clinical sessions carry the new administrator-issued `user:` claim. The replication validator binds document attestations to that identity; it does not evaluate live records across databases. The local discharge service performs those clinical checks. Staged multi-device synchronization/conflict testing and clinical sign-off are still required.
- The final regression run passed 317 suites / 3,071 tests, including service, journey, component and generated replication-validator tests. The production build, TypeScript and translation checks passed. Whole-tree lint reported zero errors and 243 warnings; the final scoped lint reported zero errors and four existing warnings. This is local verification, not a production certification.
- Browser verified a newly signed, encounter-linked synthetic note creating a handoff, accepting responsibility and persisting one task outcome with readable staff identity and progress. Transfer and changed-plan/re-review behavior have automated coverage; a live transfer still requires a populated staff directory. No real records or deployment were modified.
- Current-day notes resolve a unique scoped open encounter when no encounter ID is supplied; ambiguous visits are rejected rather than guessed. Historical signed notes are not migrated.
- Staff directory lookup is currently online. Keeping responsibility yourself supports offline deferral; transferring to another staff member requires a successful directory check. Deferred tasks remain on the nursing queue until completed.
- Existing terminal visits are untouched. This is an outpatient coordination checklist, not emergency/trauma routing or a replacement for medication administration, immunization, procedure or booking records.
