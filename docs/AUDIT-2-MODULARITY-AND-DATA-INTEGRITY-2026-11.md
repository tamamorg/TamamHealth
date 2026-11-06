# Audit 2: modularity, shared UI, data integrity, best practice (2026-11-05)

This is the second, exhaustive pass. It follows [MODULARIZATION-REPORT-2026-11](MODULARIZATION-REPORT-2026-11.md) (audit 1). Audit 1's structural plan still stands. This report adds five things:

- **Data integrity:** for every feature, is what a user records actually saved, synced, and shown back?
- **Shared UI patterns:** cards, lists, tables and the rest, and which features can share one look.
- **Best-practice research:** with sources, checked against every audit-1 recommendation.
- **Full coverage:** every folder of the repo was assigned to a reviewer and reported back (Appendix A).
- **Automated measurement:** duplicate code, unused code, import cycles, type strictness, lint, bundle size, dependencies.

**Method:**
- 17 read-only reviews in total (4 in audit 1, 13 in this pass).
- Several reviewers ran the **real CouchDB validator** (`buildValidateDocUpdateFn()`) and the real services (against the in-memory test DB) on the document shapes the UI produces.
- No code was changed. All scratch outputs live in the session scratchpad (Appendix B).

**Confidence marks:**

| Mark | Meaning |
|---|---|
| **✔** | I re-checked it myself in the code (or by running it) while writing this report |
| **C** | CONFIRMED by the reviewer, who traced it end to end and/or ran it |
| **S** | SUSPECTED: the code fact holds, but reachability or impact is not proven |

---

## 1. Summary

1. **The biggest problem is not code style. Some recorded data is not really saved.** There is one root cause: services write to the local database first, and the server's sync rules only refuse the write later. The user sees "saved". The document then sits on one device with a "denied" badge, or is silently dropped. About 25 features are affected (§2.2).
2. **Some defects touch patient safety or money** and should be fixed before any refactor:
   - allergies entered at triage are invisible to the prescribing and dispensing safety checks;
   - the "Nocte (At night)" and "STAT (Immediately)" frequencies schedule no MAR doses;
   - batch-entered lab results skip every critical-value safeguard;
   - lab tests and drugs are billed at the wrong price;
   - insurance is credited twice;
   - morphine stocked through the UI dispenses with no witness.

   See §2.1.
3. **A second class of defect is "success shown on failure".** Services catch errors and return `null`, and the UI shows a success message anyway. There are about 30 call sites.
4. **The same data has different shapes and paths:**
   - allergies are stored in two places;
   - payments follow two models;
   - stock is set to an absolute level instead of adjusted;
   - immunisation coverage has four definitions;
   - appointments and payments each have three to four write paths.
5. **Shared UI: one template and one kit would replace most hand-built screens.**
   - 14 register pages (births, deaths, equipment, blood bank, HR, alerts…) have an identical structure and could run on one `RegisterPage` template, removing about 2,000 lines. Seven of them would gain the missing Print button.
   - Every UI family (KPI tiles, cards, lists, tables, tabs, status pills, empty states, form fields) has 3–15 hand-built copies next to an existing shared component.
   - Several shared components have **zero users**.
6. **Code duplication is low (0.7% exact clones). The repetition is structural:** the same patterns written again by hand. That needs templates and a kit, not copy-paste removal.
7. **Best-practice research supports almost all of audit 1, with five corrections:**
   - ESLint 9 is end-of-life, so upgrade to 10 first;
   - use ESLint's built-in *bulk suppressions* for ratchets;
   - write down the Tailwind v3 decision against Tailwind v4's browser floor;
   - don't edit an accepted ADR, supersede it;
   - enforce server-only code with the `server-only` import.

**Recommended order:**
1. Fix the critical data and safety defects (§2.1) as small, separate PRs.
2. Add the pre-write sync guard and "throw, never return null" (§3). This closes whole classes of defect.
3. Add the contract tests (§3.3), so the layers cannot drift again.
4. Only then start the modular refactor and the UI kit (§4, §8).

---

## 2. Data integrity: what is recorded but not saved (or saved wrong)

### 2.1 Critical: patient safety, money, data loss

| # | Defect | Where | Effect | Conf. |
|---|---|---|---|---|
| 1 | **Allergies entered at triage are invisible to the safety checks.** Triage merges into the legacy `patient.allergies` array only. `entriesOf()` ignores that array whenever `structuredAllergies` exists. | `triage-service.ts:324-329`, `allergy-service.ts:28-30` | A patient with any earlier chart allergy who later reports "Penicillin" at triage gets no allergy stop when amoxicillin is prescribed (`assessPrescriptionSafety`) or dispensed (pharmacist review), and it doesn't appear in the chart allergy list. The MAR does show it. | ✔ |
| 2 | **"Nocte (At night)" and "STAT (Immediately)" schedule no MAR doses.** The patient-page Prescribe form stores the label; the scheduler only knows the bare word "nocte". | `PatientActionModals.tsx:68-69`, `medication-schedule.ts:35` | Ran it: `"Nocte (At night)" → []`, `"STAT (Immediately)" → []` (OD/BD/TDS/QDS are correct). Nurses never see a night or stat dose on the MAR. | ✔ |
| 3 | **Batch lab entry bypasses every critical-result safeguard.** Sets `status:'completed'` but leaves `orderStatus` at ordered/in-process. | `LabBatchEntry.tsx:98` | No critical-result task, no review-SLA escalation, checkout gate passes, the result can never be reviewed or released to the portal, no staff alert. | C |
| 4 | **The chart "Lab results" form never flags abnormal or critical values.** | `StructuredFormPanel.tsx:111-112` (`abnormal:false, critical:false` hardcoded) | A critical value entered from the chart raises nothing. | C |
| 5 | **Lab tests and drugs are billed at the wrong price.** `priceFromFees` matches only on `serviceCode`, and callers pass the test or drug *name*. On no match it falls back to the first fee in the category. | `fee-schedule-service.ts:138-142`, `place-lab-order.ts:192`, `prescription-service.ts:663` | Simulated: Malaria RDT (2,000) billed at 3,500, urinalysis at 3,500. Every lab test gets the FBC price. Drugs get the "dispensing" fee times the tablet count (21 tablets = 21,000). The fee's currency is ignored. | ✔ |
| 6 | **Insurance is counted twice, or never reversed.** `createBill` credits the insurance share at creation, and `recordClaimSettlement` credits it again. A denied claim never re-charges the patient. | `billing-service.ts:212,292`, `insurance-workflow-service.ts:85-97` | Double credit, or `INSURANCE_OVERPAYMENT_REVIEW` once the patient has paid. Revenue leaks on denials. | C |
| 7 | **The controlled-substance chain is not enforced for real stock.** No UI sets `controlledSchedule`/`requiresWitness`. The manual register uses a free-text witness and a fake `csub-<slug>` inventory id. Reversal entries subtract instead of add. | `controlled-substances/page.tsx:100,120`, `controlled-substance-service.ts:66`, `dispensing-service.ts:515` | Morphine stocked through the UI dispenses with no witness and no register entry. Register balances drift. | C |
| 8 | **Restocking corrupts batch data.** Writes an absolute `stockLevel` from page state onto the *existing* batch, and overwrites its batch number and expiry. | `pharmacy/page.tsx:195-200`, `pharmacy-inventory-service.ts:74` | FEFO (first-expiry-first-out) dispensing and recall traceability break. A concurrent dispense on another device is lost. A failure still shows "added to stock". | C |
| 9 | **Online dispensing drops the pharmacist's allergy-review reason.** The API reads `body.allergyReview`; the hook never sends it. | `usePrescriptions.ts:83-91`, `api/prescriptions/[id]/route.ts:103` | Every online dispense of an allergy-conflict order fails with 409 every time. The reason is never stored. | ✔ |
| 10 | **Equipment registrations never save.** No `orgId` is sent, and `createAsset` doesn't resolve one. | `equipment/page.tsx:115-124`, `asset-service.ts:95` | Success toast, then the validator refuses ("orgId is required") and `filterByScope` hides it from its creator. The test showed visible-to-creator = 0. | ✔ |
| 11 | **Super-admin config, feature flags, security policies, Risk Center resolutions, the DHIS2 sync log and backup status are saved on one device only.** They are written locally to `tamamhealth_platform_config`, which is pull-only; `/api/platform-config` exists but the UI never calls it. `risk_resolution` is registered nowhere. | `platform-config-service.ts:102`, `sync-config.ts:129`, `risk-resolution-service.ts:124-137`, `dhis2-sync-log-service.ts` | Flags and policies appear changed but nobody else gets them. A second DHIS2 officer sees "never synced", which risks a double or missed national submission. | ✔ |
| 12 | **A death recorded with no age counts as a neonatal death.** The form starts at `ageAtDeath: 0`, age isn't required, and neonatal is `< 0.077` years. | `deaths/page.tsx:74`, `death-service.ts:180`, `mch-analytics-service.ts:436` | Adult deaths with a blank age inflate neonatal, infant and under-5 deaths in DHIS2 and the MCH NMR/IMR. There is no way to enter an age in days. | ✔ |
| 13 | **The immunisation defaulter tracker finds no UI-entered defaulters.** The page only writes `status:'completed'`, and `getDefaulters` looks for overdue, missed, or scheduled-and-past-due. | `immunizations/page.tsx:329` | DEFAULTERS = 0 in the test. Recall SMS, the briefing and DHIS2 IMM_DEFAULTERS are all empty. | C |
| 14 | **Completing a follow-up erases its instructions.** `notes` is overwritten with the completion note, or with `undefined`. | `EhrClinicalDashboard.tsx:1036`, `follow-up-service.ts:75-77` | "Repeat chest X-ray, check SpO2" became `undefined` in the test. | ✔ |
| 15 | **Birth registration links ANC visits by mother's name across every org and every past pregnancy, and writes `linkedBirthId` into them.** | `birth-service.ts:18-29,97-108` | Cross-tenant writes (refused at push, so a standing denial). A same-name mother's or a previous pregnancy's visits are relinked. | C |
| 16 | **Abyei Region records drop out of state totals.** Registration offers 11 states; analytics loops over a hardcoded list of 10. | `lib/geographic-data.ts:9`, `mch-analytics-service.ts:169,249,366`, `epidemic-intelligence-service.ts` | Abyei patients are missing from state roll-ups. | ✔ |
| 17 | **CSV exports have no spreadsheet-formula guard** in 6 of the 7 writers. Only `lib/csv.ts` escapes a leading `= + - @`. | `lib/export-file.ts:54`, `PrintListDialog.tsx:94`, pharmacy, appointments, admin/audit, BillingWorkspace | Free-text patient names and notes can execute as formulas in Excel. | ✔ |
| 18 | **The client can set attribution fields.** Example: `body.registeredBy = body.registeredBy \|\| auth.sub`, at 12 lines in 7 routes. | `api/births/route.ts:73` + deaths, immunizations, referrals, appointments, anc, follow-ups | The person recorded as having made a record can be forged through the API. orgId is stamped correctly. | ✔ |
| 19 | **`admin/sync-health` returns all tenants' per-facility stats** to `org_admin` and `medical_superintendent`. | `api/admin/sync-health/route.ts:85` | Cross-tenant metadata leak. | ✔ |
| 20 | **The nutrition panel puts the patient's name in a URL** (`/referrals?patient=<name>`). | `NutritionScreeningPanel.tsx:122` | Patient-identifying data in browser history. | C |

### 2.2 Recorded locally, refused at sync

Each of these saves on the device and shows success. The server validator then refuses it. Each was run against the real validator unless marked S.

| Feature | Role(s) offered the action | Doc the server refuses | Where |
|---|---|---|---|
| Walk-in check-in, and front-desk LWBS / room / discharge / status | `central_registration_clerk`, `clinic_clerk` (their home dashboard), `rooming_nurse` | `triage` (✔ the triage write row has none of these three) | `check-in-service.ts:419,434`, `front-desk/page.tsx:339,815,893,932` |
| Triage form | `rooming_nurse` (route-gated in) | `triage` | `role-form-access.ts:43` |
| Home-care triage disposition | **every** role | the encounter close: `transitionEncounter` is called without `actorRole`, so `assertDischargeAllowed` always throws (✔). The triage and appointment writes have already landed, and a retry is blocked as a duplicate. | `triage-handoff-service.ts:166` |
| "Add addendum" on signed notes | nurse, midwife, triage_nurse, rooming_nurse | `clinical_note` amend | `ClinicalNoteViewer.tsx:318` |
| Death registration side effects | nurse, midwife, doctor, hrio, data_entry_clerk, records_hmis_officer | cancelling future appointments; the patient `isDeceased` update; closing the admission; the bed set to cleaning | `deaths/page.tsx:247`, `death-service.ts:66-75`, `ward-service.ts:888-915` |
| Pharmacist's visit close-out after the last dispense | pharmacist | `clinical_encounter` (✔ pharmacist is in no encounter row) | `dispensing-service.ts:985` |
| Radiology study images and annotations | radiologist | `patient_document` | `StudyImageWorkspace.tsx:78` |
| Announcements (authoring, and dismissal) | hrio, government (author); any non-admin (dismiss rewrites the announcement) | `announcement` | `announcement-service.ts:12-14,95-100` |
| Issue reports | government (the route is universal) | `message` | `role-routes.ts:452` |
| Accepting a cross-org referral | non-admin | patient `orgId` change (immutable); the error is swallowed and the referral is still marked seen | `referral-service.ts:473-478` (S: reachability) |
| Nurse admission with a deposit | nurse | the second admission revision, if the first was already pushed | `ward-service.ts:510,564` (S: timing) |
| Chart task list | lab_tech, pharmacist, cashier, radiologist, nutritionist, medical_biller | `patient_reminder` | `TamamChartShell.tsx:87` (S) |
| Seven sync-outbox events (prescription create/update, dispense, transfer, portal appointment/payment) | any | the `sync_event` doc: `emitSyncEvent` is called without `orgId`, so the push filter drops it (✔). **The clinical record itself still syncs.** What's lost is the country-node and analytics event. | `prescription-service.ts:842,913`, `dispensing-service.ts:218`, `patient-transfer-service.ts:889`, `api/patient-portal/{appointments,payments}` |

### 2.3 Success shown on failure

These are the about-30 call sites that treat a `null` result or a caught error as success:

| Area | Call sites |
|---|---|
| Appointments | `useAppointments` reschedule/update; `AppointmentEditModal.tsx:324`; check-in treating null as checked in (`check-in-service.ts:468`); `updateAppointmentStatus` turns every guard error into null (`appointment-service.ts:604-613`) |
| Referrals | `useReferrals.ts:59-81`: decline, accept, complete (✔) |
| Patient | mark deceased/alive (`buildHandleToggleDeceased.tsx:17-37`); problem reconciliation (`IncludeProblemsModal.tsx:204`) |
| Pharmacy | recall, stock-out, clarify (`usePharmacyWorkflow.ts:276…`, `updatePrescription` returns null at `:921`); restock |
| Maternal and child health | ANC edit, immunisation edit |
| HR | leave decision (self-approval error is swallowed, then "Leave approved"); payroll status; schedule update and delete |
| Emergency preparedness | activate and deactivate a plan |
| Billing | `recordPlanPayment` (log only); ledger-mirror failures in `createBill` / `recordPayment` / `postLedgerAdjustment` (`console.warn`, then the bill and ledger diverge, which the checkout and pharmacy pay-first gates read) |
| Hooks | `useTasks` swallows errors and returns `[]` (a false "no tasks"); `useEncounters` has no catch at all |
| Pages that show "empty" on a load error | patient portal (5 parallel loads; one failure gives a blank record), births, deaths, ANC, immunisations, mch-analytics (spins forever), referrals (empty before loaded) |

### 2.4 Same data, different shapes or paths

| Data | Problem |
|---|---|
| **Allergies** | Two stores (legacy `allergies[]` and `structuredAllergies`), with different writers and readers (defect 1). Registration writes the sentinel `['None known']`. |
| **Vitals** | `spo2` vs `oxygenSaturation`. Triage stores flat strings; the medical record stores numbers. Pain score and GCS are captured but never charted. |
| **Medication frequency** | 4 vocabularies (`basket-types`, `PatientActionModals`, `MedicationsModal` datalist, `DrugInfoSection`). This is the cause of defect 2. |
| **Prescription writes** | Create is written in 4–5 places; discontinue in 4. |
| **Payments** | `BillingDoc.payments[]` (bill page, no receipt) vs `PaymentDoc` (PaymentPanel). A third copy writes from inside the `payments/portal` page. Payment-method keys drift (`mtn` vs `mtn_momo`). |
| **Money** | Float major units, not integer minor units. Two currency-default rules. `getPatientBalance` sums across currencies. |
| **Facility key** | 41 types use `facilityId`, about 30 use `hospitalId`, 4 have neither. |
| **"Entered in error"** | Four mechanisms (`recordStatus`, `status`, `deleted`, `correctionReason`). DHIS2, analytics and FHIR don't honour them, so withdrawn records count nationally. The problem modal hard-deletes. |
| **Lab status** | Coarse `status` and `orderStatus` are written independently (defect 3). There is no `cancelled` state. Radiology "Repeat study" always throws (an illegal transition). |
| **Immunisation coverage** | Four definitions (government home vs MCH vs per-vaccine vs cohort). Defaulters have three; ANC4+ has two. The DHIS2 page summary disagrees with its own export. |
| **Patient age** | Three calculators with opposite precedence (estimated age vs date of birth), so the header, triage and analytics can disagree. |
| **Duplicate patients** | Three matchers (edit distance, Jaro-Winkler, exact identifier) that can disagree. |
| **Drafts** | Two encrypted draft systems (`draft-storage.ts`, `unsaved/draft-store.ts`) with different keys, TTL and wipe rules for the same patient data. |
| **Settings** | Four settings stores. Seven editable facility settings have no reader (`checkoutGateKeys`, `triageRequiredFor`, `routingDefaults`, …). IT-ops policies show as "Required/healthy" but aren't enforced. |

### 2.5 Downstream copies: analytics, FHIR, DHIS2, transfer package

- **Analytics (Postgres) is a write-only sink.**
  - Nothing reads it except `/api/health`, and no materialised view is ever refreshed.
  - Departments and pathway configs land in the national `hospitals` table.
  - Payment links are counted as payments.
  - `hospitals.latitude/longitude` are always NULL (the mapper reads `latitude`; the doc has `lat`).
  - `disease_alerts.status` has no source field, so the surveillance view is always empty.
  - Payroll base salary is projected nationally in plaintext.
- **FHIR:** a discontinued prescription exports as `active`.
- **DHIS2:** counts entered-in-error records. Also, `pushDataSetToDHIS2` reads server-only environment variables in the browser (S).
- **Transfer package:** omits immunisations, history, procedures, structured allergies and administrations (S: clinical gap).
- **Patient portal:** `records` returns raw medical records with no field allow-list, unlike `labs` (✔). Walk-in and outside lab results never reach the portal, because release ignores `reportReleasedAt`.

---

## 3. Make data movement consistent (the systemic fixes)

### 3.1 Five root causes

| Cause | Defects it explains |
|---|---|
| **R1. The local write happens before any sync-rule check.** Only appointment `update`/`reschedule` checks `fieldsOutsideAmendGrant` first. | all of §2.2 |
| **R2. Services return `null` on error; callers don't check.** | all of §2.3 |
| **R3. UI permission flags are hand-written, not derived from `DOC_WRITE_ROLES`.** `canAddAddendum` has no role check; the triage gate is by route; `canRecordVitalEvents` gates vitals. | §2.2 rows 1–4, 9, 10 |
| **R4. A doc type has several write paths and shapes.** | §2.4 |
| **R5. orgId and actor are stamped by each caller.** About 22 chart writers use `currentUser.orgId`; `emitSyncEvent` takes an optional orgId; transitions take an optional `actorRole`. | defects 10, 12, 18; §2.2 last row |

### 3.2 Fixes, in order

1. **`assertSyncWritable(type, role, before, after)`** in `lib/persistence/`. It runs the validator's own tables (write roles, create-only/required values, amend fields, appointment transitions, exceptional discharge) before every local `put`, and refuses with a plain message ("[Action] not saved. A clinician must …"). This closes §2.2 as a class, without touching the validator itself.
2. **Services throw typed errors, never `null`.** Start with `updateAppointmentStatus`, the referral mutators, `updatePrescription`, `updateInventoryItem`, `decideLeave`, `updateANCVisit`, `updateImmunization`, `setPayrollStatus`, `updateSchedule`. Add a lint or architecture check that flags a discarded `await svc.update…()` result.
3. **Make the required fields mandatory in the types:** `actorRole` in `transitionEncounter`/`updateAppointmentStatus`, `orgId` in `emitSyncEvent`. `resolveDocOrgId` goes inside `defineRepository` (audit 1, §5.3), not in callers.
4. **Derive capability flags from `DOC_WRITE_ROLES`.** Use `roleCan(role, type, op)`, as `role-form-access.ts` already does for the O3 forms.
5. **One write path per doc type.** Concretely:
   - triage allergies go through `addAllergy`;
   - one `VitalsReading` type, including pain and GCS;
   - one frequency vocabulary (codes, with translated labels);
   - one `fileResult()` for bench, batch, chart and radiology results;
   - stock as movements (`receiveStock` makes a new batch; `adjustStock(delta)` re-reads first);
   - payments only through `collectPayment`;
   - `resolvePrice(category, {code, name})` with no "first in category" fallback;
   - insurance posted at settlement only;
   - one shared indicators module (coverage, defaulters, ANC4+, neonatal deaths) that filters `isDeleted` and `entered_in_error` in one place.
6. **A `defineDocType()` registry**, one file per doc type: db, tenant key, PHI fields, write/amend/create-only roles, replication direction, entered-in-error mechanism, analytics map, sync-event policy. It *generates* the following, so the layers can't drift:
   - `DATABASE_DOCUMENT_TYPES`
   - `DOC_WRITE_ROLES` and its siblings
   - the PHI catalogue
   - the national-projection exclusions
   - the analytics mappers
   - `LOCAL_DATABASE_NAMES`
   - the test DB mock

   Validator **output** must stay byte-identical; snapshot it.

### 3.3 Contract tests

Each of these would fail today, and that is the point.

| # | The test asserts that… | Defects it catches |
|---|---|---|
| 1 | Every `put` of a literal `type:'x'` targets a DB whose registry lists `x` | risk_resolution, payment_link, dhis2_sync_log |
| 2 | No browser-reachable service writes to a pull-only DB without an `apiFetch` branch | platform_config |
| 3 | Every `emitSyncEvent` call includes `orgId` | the 7 sites |
| 4 | Every field an analytics mapper reads exists on its interface, and every column exists in the migrations | lat/lng, alert status |
| 5 | Every multi-type DB maps or excludes every type | hospitals and payments DBs |
| 6 | Every type declares its entered-in-error mechanism, and every export honours it | DHIS2 and analytics counts |
| 7 | **Role × UI action × validator:** each role that can see an action passes the validator for the doc it writes | §2.2 (the reviewers' harness in the scratchpad is the template) |
| 8 | One integration suite per patient journey, on the in-memory DB, with the real validator applied to every put. **Don't mock `transitionEncounter`**: that mock is what hid the home-care defect. Journeys: walk-in → triage home-care → closed; booked → triage → note → sign → nurse addendum; prescribe Nocte → MAR; lab batch critical → task; insured lab → claim settle | all of §2.1–§2.2 |
| 9 | The test DB mock equals the registry (today it is missing 11 DBs and has `SEED_VERSION: 12` vs the real 80 ✔) | mock drift |

---

## 4. Shared UI patterns: cards, lists and the rest

### 4.1 Inventory

"Adoption" means the share of implementations that use the shared component.

| Family | Variants found | Shared component today | Adoption | One shared component |
|---|---|---|---|---|
| KPI / stat tiles | 11 | `SadbKpiTile` (20), `FacilityKpiBand` (10) | ~55% | `KpiTile` + `KpiBand` (band / inline / vital) |
| Section cards / panels | 9 card shells; 159 `*-card/-panel` classes | `SadbCard` (32), `ChartSection` (25) | ~45% | `Card` (panel / section / rail / list / setting) + `KeyValueList` |
| Worklists / queue rows | 4 row systems | CSS only (`appointment-card-*`, 14 files) | 0% | `WorkList` + `WorkListRow` |
| Data tables | 96 `<table>`s in 70 files; 9+ class families; 17 unclassed | `SaTable` (7), `useColumnSort` (5), `TableCols` (4) | ~25% | `DataTable` (column config, pager, row actions, empty row) |
| Filters / toolbars | 3 search kits; 64 date inputs; no `DateField` | `EhrListHeader.search`, `SadbSearch` | ~60% (split) | `Toolbar`, `SearchField`, `FilterField`, `DateField` |
| Page / section headers | 7 header components; 14 `<h1>` and 35 `<h3>` class variants | `EhrListHeader`, `SadbPage`, `FormPageHead` | ~50% | `PageFrame` + `PageHeader` (list / console / form) |
| **Status pills / tones** | **~14 tone vocabularies, ~51 colour maps**, 11 chart `STATUS_BADGE` copies | `Badge`, `SadbChip`, … | none dominant | `StatusPill` + one `tones.ts` with `defineStatusMap` |
| Empty / loading / error | ~30 `*-empty` namespaces; loading text in 101 files | `EmptyState` (24), `OmrsEmptyState` (17); `Skeleton` (0) | ~40% / 0% | `EmptyState` (page / chart / row) + `LoadingState` |
| Dialogs / sliders | 4 image-lightbox copies; 2 sadb modals | `FormSlider` (86), `Modal`, `Dialog`, `ConfirmDialog` | **~90%** | Keep. Add `ImageLightbox`. |
| Forms | 719 `<label>`s, **117 distinct label class strings**; 4 field kits | `FormField` (17), O3 parts | ~15% | `Field` + `FieldGrid` (escapes the global `label` caps trap once) |
| Tabs | **17 `role="tablist"` implementations** | `FilterTabs`, `SegmentedControl`, `SadbTabs`: **0 users each** | 0% | `Tabs` (segmented / underline / lane) |
| Avatars / names | ~10 initials helpers, 5 avatar components; names concatenated by hand 10× | `PatientAvatar`, `patientDisplayName` | ~40% | `PersonPlate` + `PersonIdentity` |
| Charts | 11 Recharts files | `ChartCard` helpers (10/11) | ~90% | Keep. Add `ChartPanel`. |
| Anchored popovers | 13 hand-written `getBoundingClientRect` engines | `overlay/Menu` | low | `AnchoredPopover` |

**Verified unused kit components (✔):** `FilterBar`, `FilterTabs` (re-exported only), `SegmentedControl`, `Skeleton`, `RowActionsPopup` (imported only for one helper). Also unused: `SadbTabs`, `SaCard`, `SaStatusDot`, `SadbDangerZone`, the `ChartCard` default export, `Modal variant="drawer"`, `Dialog{Section,Split,Main,Aside}`, and 3 payments components (`BalanceBanner`, `InsuranceSnapshot`, `PaymentHistoryTimeline`).

### 4.2 One `RegisterPage` template fits 14 features

The same seven-part skeleton (frame → KPI band → card → list header → table/list → create slider → print) is rebuilt by hand on each of these pages:

- births, deaths, equipment, controlled-substances, blood-bank, anc
- hr/leave, hr/payroll, hr/schedule
- emergency-preparedness, facility-assessments
- alerts, notifications, transfers, nutrition/supplies

Partial fits: immunisations (the records tab) and referrals (with tabs).

The sibling pages have also drifted apart:
- two different card shells;
- three pill systems;
- the empty row present on some and missing on others (births renders none, against the AGENTS list rule);
- **7 have no Print button at all**, against the AGENTS printing rule.

```ts
interface RegisterConfig<T> {
  id: string; title: string;
  kpis?: KpiTileProps[] | ((rows: T[]) => KpiTileProps[]);
  search?: { placeholder: string; match: (row: T, q: string) => boolean };
  filters?: ReactNode;
  columns: (WorkListColumn<T> & { print?: (r: T) => string })[];   // one list drives table AND print/CSV
  layout?: 'table' | 'worklist' | 'grid';
  rowActions?: (row: T) => RowAction[];
  status?: { of: (r: T) => string; map: StatusMap };
  empty: { none: EmptyCopy; filtered: EmptyCopy };
  detail?: (row: T, close: () => void) => ReactNode;
  create?: { label: string; can: boolean; render: (close: () => void) => ReactNode } | { label: string; href: string };
  print?: { title: string } | false;          // default ON
  frame?: 'list' | 'console';
}
```

- **Ownership:** each page keeps its data hook and its write handlers. The template owns layout, search, empty/loading/error states, keyboard row activation, print and CSV (with the formula guard), and slider mounting.
- **Size:** pages drop to about 60–150 lines.
- **A second template, `AnalyticsPage`** (filters + KPI band + chart grid), fits mch-analytics, epidemic-intelligence, government, surveillance, public-stats, vital-statistics and data-quality.
- **Not a fit:** dashboards (their own engines), patients, appointments (calendar), messages, billing.

### 4.3 Kit folder

```
components/kit/
  tones.ts                    Tone + defineStatusMap (+ adapters for old vocabularies)
  page/       PageFrame  PageHeader
  templates/  RegisterPage  AnalyticsPage  register-rules.ts (pure, tested)
  kpi/        KpiTile  KpiBand  trend.ts      (merges weekOverWeek / weeklyTrend / trendBetween)
  card/       Card  KeyValueList
  list/       WorkList  WorkListRow
  table/      DataTable  Pager  (+ useColumnSort, TableSortEnhancer, TableCols moved in)
  status/     StatusPill  (Badge / SadbChip / SaPill become aliases)
  feedback/   EmptyState  LoadingState  Toast  InlineBanner  (FormError + NoticeToast merged)
  filters/    SearchField  FilterField  FilterDisclosure  DateField  Toolbar
  tabs/       Tabs
  form/       Field  FieldGrid  Select  NumberInput  O3Form
  overlay/    Modal  Dialog  FormSlider  ConfirmDialog  Menu  RowActionsMenu  Tooltip  AnchoredPopover  ImageLightbox
  person/     PersonPlate  PersonIdentity
  print/      PrintListDialog  ReportSheet  PrintDocumentButton
styles/kit/   one CSS file per folder, tm-* namespace
```

**Rules:**
- **No barrel.** Barrels load eagerly (AGENTS.md); import each file directly.
- `kit/**` may not import `lib/services`, `lib/hooks`, `lib/context` or `@/modules`. Today only `PrintListDialog` (`useAuth`) and `useDraftKeeper` reach into context.
- **Variants are props, never copies.**
- **Old names stay as one-line re-exports** during migration. Tests mock old paths (`jest.mock('@/components/Toast')` 17×), so a mock must move in the same commit as its import sites.

**Guards against new copies** (ratchet tests in `__tests__/architecture/`, which may only shrink):
- counts of raw `<table`, `role="tablist"`, utility-class `<label>`, `fixed inset-0` and `animate-spin` outside the kit;
- no new `*_TONE` / `*_CHIP` / `STATUS_BADGE` / `{bg,fg}` maps outside `tones.ts` and `*-rules.ts`;
- no new `-card/-kpi/-pill/-empty/-tabs` class names outside `styles/kit`;
- `page.tsx` may not contain `<table` or the `page-container` inline-flex clone;
- every kit export has at least one importer, so dead kits can't come back.

Also update `docs/UI-STYLE-GUIDE.md`: it currently tells authors to hand-build `dash-card` tiles and to use `FilterTabs`, which has zero users.

### 4.4 Migration order for the kit

| Step | Work | Risk | Notes |
|---|---|---|---|
| 0 | Delete dead kits | very low | |
| 1 | `tones.ts` + `StatusPill` | low | |
| 2 | `KpiTile` / `KpiBand` | low | |
| 3 | `EmptyState` variants + `LoadingState` | low | fixes the births empty/loading bugs |
| 4 | `DataTable` + `WorkList` | medium | births → deaths → equipment first |
| 5 | `RegisterPage` | medium | **one page per PR**. The new Print button is a behaviour change, so it gets its own commit; new strings go into `en` and `apd` |
| 6 | `Field` / `FieldGrid` | medium | |
| 7 | `Tabs`, `Card`, `SearchField`, `PersonIdentity`, `ImageLightbox` | medium | touches the chart |
| 8 | Retire the per-namespace CSS | **high** (cascade) | last, with snapshot diffs. The kit must emit **the same class names** until then, because `management-frame.css`, `tablet-desktop.css` and `accent-pass.css` style them with late `!important` passes. Verify every register under both the management frame and the default frame |

---

## 5. Best-practice check (with sources)

Full citations are in the research notes (Appendix B). Installed versions: next 16.4.3, react 19.2.7, tailwind 3.4.19, typescript 5.9.3, eslint 9.39.4 ✔.

| Audit-1 recommendation | Verdict | Change |
|---|---|---|
| ESLint guard-rails on "ESLint 9.39" | **Adjust** | ESLint 9 reached end-of-life on 2026-08-06; v10 is current (eslint.org/version-support). `eslint-config-next` supports 10 from 16.4.0. Upgrade first. |
| Hand-made baseline for every lint ratchet; keep `--max-warnings 223` | **Better option exists** | ESLint ≥9.24 has **bulk suppressions** (`--suppress-rule`, `eslint-suppressions.json`), which count violations per file and rule. Use them for react-hooks compiler rules, jsx-a11y and typescript-eslint, and retire the 223-warning ceiling. **Keep the custom per-file baseline only for `max-lines*` / `complexity`**, because suppressions count violations, not size. |
| `globals.css` as an import-only manifest, postcss-import first | Supported | Tailwind v3 docs: the manifest must contain *no rules* ("never mix"); turn off import-sorting lints. |
| Don't adopt native `@layer` yet | Supported | MDN: unlayered beats layered, and `!important` inverts layer order. Also don't use Tailwind v3's `@layer components`: it moves rules *before* utilities. |
| "Revisit with Tailwind v4" | Adjust | Next.js now defaults to v4, which needs Chrome 111 / Safari 16.4 / Firefox 128. Survey hospital devices and **record the v3 decision in an ADR** with that browser floor. |
| Hand-written CSS rule tests | Better option | **stylelint** already has `declaration-no-important`, `color-no-hex`, `selector-class-pattern`, `no-duplicate-selectors`, `no-descending-specificity`. Make new component CSS `*.module.css` (Next's recommendation). Use logical properties for RTL `apd`. |
| Shared component CSS into `kit/` | Supported, essential | Next: global CSS imported by components isn't removed on navigation, and `cssChunking:'strict'` is webpack-only, while this app runs on Turbopack. |
| Screenshot baselines on a production build | Supported | Playwright `toHaveScreenshot`; generate baselines in one Docker/CI image; use `stylePath` to hide clocks. Needs `@playwright/test` (a new dev dependency, which needs sign-off). |
| Feature folders: rules first, then hooks, then parts | Supported | react.dev: "Choosing the State Structure", "You Might Not Need an Effect", custom-hook guidance (name hooks by purpose; a hook shares logic, not state); Kent C. Dodds on colocation. |
| "≤8 useState", "useMemo ≤40 lines" as hard limits | Adjust | Make them review heuristics, not lint gates. React Compiler guidance: leave existing memoisation in place; evaluate `reactCompiler` `compilationMode:'annotation'` after the splits. |
| NotePanel union replacing 11 booleans | Supported | Discriminated union plus a `never` exhaustiveness check. |
| `defineRepository`, rules/repository/service | Supported | Fowler's Repository pattern; functional core, imperative shell. Pilot on 5 small services to avoid over-abstraction. |
| Retry on conflict / compensating writes | Supported + add | PouchDB conflicts guide: prefer **append-only delta docs** for ledger, billing and stock, which also fixes defect 8. |
| Mango index rule | Supported + add | Also refuse `$regex` / `$ne` / `$not` on large DBs (they can't use an index). |
| "Surface: server/client/edge" in file headers | Adjust | Enforce it with `import 'server-only'` / `'client-only'`, which fail the build. Today only 3 files use it. |
| Size limits 500 / 80 / 250 / complexity 25 | Adjust | ESLint defaults are 300 / 50 / complexity 20; sonarjs cognitive complexity is 15. Keep audit 1's numbers as the starting cap, add `sonarjs/cognitive-complexity` 15 for **new** files, and tighten later. |
| Boundary allow-list regex | Adjust | Upgrade ESLint first. Consider `eslint-plugin-boundaries`. Add **dependency-cruiser** `no-circular` with `--ignore-known` to show the hidden cycles. |
| Update ADR 0003 in place | **Contradicted** | Fowler (2026): ADRs are immutable; supersede them. Write ADR 0005 for `/edge` and the module list; keep the live list in module READMEs and the registry test. |
| Locales stay central | Supported (trade-off) | OpenMRS O3 puts translations per module; central suits translators. Record the choice. Also generate a `TranslationKey` type from `en`. |
| TypeScript strictness | Gap in audit 1 | `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `noImplicitOverride` are not part of `strict`. `noImplicitOverride` (1 error) and `noFallthroughCasesInSwitch` (0) can be turned on today. |
| Tooling | Add | **knip** (unused files, exports, dependencies) and **jscpd** `--baseline-from-ref origin/main --fail-on-new-clones 0` in CI. |
| Healthcare | Note | If dose ceilings and interaction alerts count as regulated software (IEC 62304 class B/C), keep architecture and unit docs, traceability, and a **SOUP list** (third-party versions with known issues). Add a "Risk controls" section to the module README template. |

---

## 6. Code-structure findings new in this pass

These add to audit 1 §3–§6; they don't repeat it.

### 6.1 App pages (all 137 `page.tsx` files)

- **Shape:** about 22 redirect stubs; five of them redirect client-side and flash a frame. 11 pages have `'use client'` without needing it. Only the root `error.tsx` exists, so a page crash also loses the nav shell. Add `(dashboard)/error.tsx` and `patient-portal/error.tsx`.
- **Inline styles:** mch-analytics 188, immunizations 95, referrals 93, payments/portal 70, public-stats 69.
- **Invalid CSS:** `${var}08` hex-alpha appended to a `var()` (✔) in mch-analytics, checkout and payments/portal. The browser drops these backgrounds. Use `color-mix()`.
- **Duplicates across pages:**
  - 3 CSV implementations;
  - 4 KPI band systems;
  - `PanelHead` copied twice;
  - 2 hand-built South Sudan map components;
  - 2 IDSR summary calculations (surveillance page vs service), so two screens can disagree;
  - 4 payment-method catalogues.
- **Bad dependencies:**
  - `hr-shared.tsx` and the org-admin `branding`/`pricing` *pages* are imported by components (a component depending on a route);
  - the `/messages` page and `useStaffChat` stay outside the communication module that has already landed.
- **Booking server loaders** build URLs from the `Host` header. Use `NEXT_PUBLIC_APP_URL`.
- **The i18n ratchet misses more than audit 1 said:**
  - single-word `<th>` text;
  - object-literal labels;
  - `aria-label` / `placeholder` / `title` props;
  - tour step text in `.ts`: 205 strings;
  - service error prose, translated by reverse text match.

  That is about 159 literals in route files alone. `UNTRANSLATED_BASELINE` also lists 3 files that no longer exist.
- **A fourth global CSS trap:** `management-frame.css:46` resets `text-transform` and `letter-spacing` with `!important` for manager roles only. The same page looks different by role, and `uppercase` does nothing for managers.

### 6.2 API (107 routes), proxy, modules

- **Guards and roles:**
  - 81 hand-written guard blocks, while `authorizeJson` is used in 24 files;
  - 73 inline `UserRole[]` arrays (57 distinct sets; 69 redundantly list `super_admin`);
  - **44 `body as Parameters<typeof svc>[0]` casts** pass unvalidated bodies to services.
- **Errors and audit labels:**
  - **3 different `ValidationError` responses** (422 `details` vs 400 `fields` vs 400 first message);
  - HTTP status inferred from error **prose** by regex in 6 routes;
  - raw `err.message` returned in 18 places;
  - 19 handlers multiplex on `body.action`. Deletes are audited as `*.create`, and no `withAuditLog` site passes a `category`.
- **Duplicated plumbing:**
  - the orgId stamping block copied into 10 files;
  - 4 rate-limit mechanisms, one of them an in-memory `Map` that does nothing across serverless instances;
  - 3 copies of the Sentry setup.
- **Proxy:** `proxy.ts` keeps route security in 5 lists plus about 12 inline `if`s (a 317-line function). `/api/auth/*` returns before the Origin check. That may be intended, but it isn't documented.
- **Dead code and misplaced helpers:**
  - `api-security.verifyCsrf` and `checkContentLength` have 0 callers ✔;
  - the `next.config` `webpack:` block is dead under Turbopack, so the `fs/crypto:false` fallbacks protect nothing;
  - the generic HTTP helpers (`serverError`, `validationError`) belong to `identity` but are used by 96 routes; move them to `shared/server/http.ts`.
- **Modules:**
  - the self-barrel guard is bypassed by relative imports (`'../index'`, `'..'`);
  - `tenancy/index.ts` holds 101 lines of logic;
  - 4 client files import the `specialty-care` *server* barrel;
  - `insurance` has no `index.ts`;
  - only `ai-scribe` has a README and co-located tests.
- **Route template, refined:** `defineRoute({ access, audit:{action,category}, rateLimit, parse, errors, run })` over the existing pieces. It keeps the pinned strings byte-identical and lazy-loads services. Migrate in this order:
  1. `supply-chain` (already in the target shape);
  2. the vital-events family (6 routes);
  3. portal reads;
  4. FHIR;
  5. machine callers (with an Edge-safe `API_ROUTE_POLICY` registry for the proxy).

### 6.3 Components

- **The top-level `components/` folder:**
  - ~40 loose files belong in `kit/`, `shell/`, `capture/` or their domain folder;
  - `create-dialogs/` is mostly HR;
  - `dashboard/` vs `dashboards/` is a name clash;
  - `billing/` is really payments' stylesheet.
- **Icons:**
  - AGENTS.md says "in-repo duotone set", but they are plain lucide icons behind three alias layers;
  - **22 aliases silently swap glyphs** (ArrowLeft → ChevronLeft, Wrench → Settings, …);
  - `IconName = string`, so a typo silently falls back to a default icon;
  - nothing bans direct `lucide-react` imports.
- **Dashboard engines:** there are **four**, not two. The mobile shell's `use-*-dashboard-data.ts` re-implements lane assembly. There are **6** `assemble*Worklist` builders with 4 `clock()` copies, 2 of them unguarded.
- **Prescription create/discontinue** is written in 4–5 places, and the medication vocabulary in 4 (the cause of defect 2).
- **Prop drilling:** `currentUser`, `router` and the `can*` flags go through 3 levels of chart panels. Add a `ChartPanelContext`.
- **More split plans** (each with file-level detail in Appendix B): `TamamChartShell` (760 lines), `EhrTopRail` (782; it loads every patient and appointment on every page for search), `BillingTab` (969), `SystemAdminSections` (1,180, of which ~480 are CSS in a template string), `PaymentPanel` (27 `useState`), `MessagingDock`, `BookAppointmentModal` + `AppointmentEditModal` + `BookAppointmentPanel` (one booking pipeline), `PatientTimeline`, portal `BillingTab`.
- **CSS:**
  - `tamam-chart.css`: 59 selectors are redefined inside the file; `.tamam-section-add` is declared 9×;
  - only ~20 of audit 1's "180 raw hex" values are actually raw; the rest are `var()` fallbacks;
  - 4 form-kit namespaces (`obk-/obf-`, `sv-`, `o3f-`, `labord-`) are used app-wide from feature CSS files;
  - `globals.css` holds the "Facility management header" block **twice** (117 lines, ✔).
- **Other:**
  - `DoctorDashboardPage` fabricates ward and gender data when `IS_DEMO` is set;
  - `NURSE_ROLES` in the facility dashboard leaves out triage and rooming nurses, so staffing counts are low;
  - about 11 clickable `<tr>` rows are mouse-only;
  - 239 buttons have no `type`.

### 6.4 `lib/`

- **There are 114 service files, not 95.** `services/payment-service.ts` is itself a **service barrel** (it re-exports 11 payment services). That breaks the "no services in barrels" rule, and the lint can't see it.
- **Four more `lib → shared` blockers:**
  - 11 lib files import `@/components`;
  - server secrets ship to the browser: the `db.ts` admin-credential branch, the `org-data-cipher` `DEV_SECRET` fallback (✔), and `organization-service → couch-auth`;
  - `field-encryption.ts` imports Node `crypto` and is reachable from hooks;
  - fix by splitting the files *before* adding `server-only`, which would otherwise fail the build.
- **Duplicates:**
  - 5 `todayIso` and 3 `addDays` copies (one in UTC);
  - 3 relative-time formats, all English;
  - 5 initials helpers;
  - 3 age calculators;
  - 3 duplicate-patient matchers;
  - 2 lab catalogues;
  - 2 geocode-id formats;
  - about 30 role arrays across 15 files;
  - `snake_case → words` written by hand 38 times while `humanizeStatus` exists.
- **Dead or misnamed:**
  - `SyncService.resolveConflicts` has 0 callers ✔, and it would delete losing revisions, against the conflict-queue model;
  - `people-nav.ts` is the Add menu;
  - `request-utils.ts` holds only the client-IP helper;
  - `sync-auth.ts` is worker HMAC;
  - `transfer-service.ts` builds the referral package;
  - `data-scope.ts`, the tenant barrier, has no header comment.
- **Hooks:** 34 fit the proposed `useScopedCollection`. Nine are never live (a payment doesn't refresh the patient balance), and 12 expose no error.
- **More split plans:** `sync-service` (keep the push filter byte-identical), `patient-transfer-service` (cut along its 7 banners), `note-service`, `patient-service` (keep id derivation byte-identical), `config-validation` (the easiest win).

### 6.5 Tests, scripts, CI, infra, website, docs

- **Tests:**
  - 69 test files read source by path (490 assertions; 122 are negative, which keep passing on moved code). 39 of them are pure text tests.
  - The DB mock has drifted (✔); 80 files mock `uuid` the same way.
  - There is no render library.
  - Coverage leaves out `lib/sync`, `proxy.ts` and `app/api`, and no threshold is set.
  - **Proposal:**
    - `src/test-support/` holding a generated DB mock, shared mocks and fixture factories;
    - an allow-list ratchet for source-text tests;
    - co-located unit tests;
    - per-directory coverage thresholds.
- **Scripts:**
  - 9 copies of the CouchDB request helper;
  - inconsistent credential variable names;
  - **inconsistent dry-run defaults, which is a hazard.** Four scripts write unless `DRY_RUN=true`.
  - **Proposal:** `scripts/lib/couch.mjs` (dry-run on by default); `ops/`, `migrations/`, `check/`, `dev/` and `archive/` folders; delete or archive the 5 unreferenced root scripts and the 2 placeholder tools.
- **CI:**
  - **The staging build can bake in production URLs** ✔. `build-and-push` has no `environment: staging`, so its fallbacks are `app.tamamhealth.org`.
  - Setup steps are duplicated four times. Use composite actions and a reusable `build-images.yml`.
  - Five compose topologies and four manual deploy scripts. Add an `infra/README` table naming the production path.
  - Node versions disagree (`<21` vs `<25`).
  - Local hygiene: `backup-privkey.asc` and terraform state sit in the working tree. They are untracked, but move the key to a keychain.
- **Website:**
  - 642 inline styles and 202 `!important`: the same disease as the platform in miniature.
  - Its `tm-*` class prefix clashes with the platform overlay kit.
  - `site-data.ts` copies the platform's role catalogue.
  - Its i18n check never runs in CI, and translation-by-English-string silently breaks when an English line is reworded.
  - About 2.5 MB of unused images.
- **Docs:**
  - about 17 overlapping deploy and runbook docs;
  - **two ADRs numbered 0004** ✔;
  - `platform/README` shows a credentialed `NEXT_PUBLIC_COUCHDB_URL` example, which is bad advice for a client-bundled variable;
  - 12 MB of third-party papers and a client `.docx` in the public repo.
  - **Proposal:** `docs/{start, architecture, adr, operations, product, plans, audits/YYYY-MM, assets}` with status front matter, and one ADR series.

---

## 7. Automated measurements

| Metric | Value |
|---|---|
| Exact duplicate code (jscpd, 70 tokens) | **0.7%** of lines (194 clones). The repetition is structural, not copy-paste. (jscpd's default size caps silently skip `globals.css`; they were raised for this run) |
| CSS duplication (30 tokens) | 3.1% (180 clones; 2,777 lines inside `globals.css`) |
| Unused (knip) | 5 files, 763 exports, 612 types. Redundant `@types/bcryptjs` (deprecated stub) and `@types/uuid`; 17 unlisted deps (`server-only`, `@sentry/core`, …) |
| Import cycles (dependency-cruiser) | **3 static runtime cycles** (e.g. Modal → useDraftKeeper → context → identity/client → CreateUserModal → UserForm → context). Counting `await import()` edges, **one cycle spans 92 files**. 1,219 `await import(` sites in total |
| Type escape hatches | 28 `any` (all lint-disabled), 0 `@ts-ignore`, 177 non-null `!`, 101 `as unknown as` |
| Stricter TS flags | `noUncheckedIndexedAccess` 829 errors outside tests (330 in `db-seed.ts`); `exactOptionalPropertyTypes` 1,777; **`noImplicitOverride` 1, `noFallthroughCasesInSwitch` 0: turn on today** |
| Size and complexity | 469 functions over 80 lines; 215 over complexity 25; 299 over sonarjs cognitive complexity 15; 36 over depth 4 |
| Hooks | 481 `useEffect`s; 33 `exhaustive-deps` disables. The existing 223 warnings are 184 `set-state-in-effect` and 39 others |
| Accessibility | 239 buttons with no `type`; ~11 mouse-only clickable rows |
| Bundle | `/reports` pulls in recharts despite `next/dynamic`, through a static value import from `./_ReportCharts` ✔; `/payments` does the same through `BillingOverviewCards` |
| Logging | 241 `console.error` vs 35 `captureException`. Review the `console.log` calls in the payment webhooks for payload logging |
| Outdated majors | eslint 9→10, tailwind 3→4, typescript 5.9→7, @sentry/nextjs 10→11, lucide-react 0.563→1.x, uuid 11→14 |

---

## 8. Revised roadmap

Every item is its own PR, with lint, tests, `i18n:check` and a production build green. **Behaviour changes are always separate commits.**

| Phase | Work | Why first |
|---|---|---|
| **A. Safety and money** (now) | §2.1 items 1–14 as small PRs, each with a regression test: allergies via `addAllergy` + reader fallback; frequency codes + scheduler; batch lab via `fileResult`; chart lab-form flags; `resolvePrice`; insurance at settlement; controlled-stock enforcement + reversal sign; restock as a new batch with delta; `allergyReview` in the API body; equipment orgId; platform config via the API; death age required + days unit + form reset; defaulter rule; follow-up `completionNotes` | Patient safety, revenue, statutory statistics |
| **B. Stop silent loss** | `assertSyncWritable` pre-write guard; services throw; mandatory `actorRole`/`orgId`; capability flags from `DOC_WRITE_ROLES`; grant or reroute the refused writes (pharmacist close-out, radiologist documents, clerk walk-ins, announcement dismissal, government issue reports); load-error states on the register pages | Closes §2.2 and §2.3 as classes |
| **C. Fence** | Contract tests 1–9 (§3.3); fix the DB mock; ESLint 10 + bulk suppressions; size baseline; stylelint; knip + jscpd + dependency-cruiser in CI; `noImplicitOverride` + `noFallthroughCasesInSwitch`; i18n check that imports the maps and scans props, `.ts` tour text and `src/modules`; staging `environment:`; CSV formula guard everywhere; quick security items (§2.1 rows 18–20, portal records allow-list, CSRF dead code) | Nothing drifts again |
| **D. Shared UI** | Kit steps 0–7 (§4.4); `RegisterPage` for 14 features; `AnalyticsPage`; one indicator module | Biggest readability payoff, lowest risk |
| **E. Structure** | Audit 1 phases 1–4 (pure extractions, primitives, ADR 0003 domain migrations), now including the `defineDocType` registry, `defineRoute`, the split plans in §6, the `payment-service` barrel, and the client/server secret splits | |
| **F. Styles and finish** | Audit 1 phases 6–7: CSS manifest, per-namespace merges with screenshot diffs, then retiring kit-replaced CSS; `context.tsx`/`db-seed.ts` splits; locale sharding; docs IA | Highest cascade risk, so last |

**Coordination:**
- **Other edits are happening on this branch right now.** Uncommitted changes exist in `globals.css`, `O3Form`, `tamam-chart.css`, `patient-reminder-service`, `TransferHistoryPanel`, `chart-buttons.css` and others; two files changed during this audit.
- Start each slice from `main` once those land, and give each file one owner at a time.

---

## Appendix A: coverage

Every folder below was assigned to one reviewer and reported back with a per-folder table.

| Area | Folders | Reviewer |
|---|---|---|
| `app/` pages | all 49 `(dashboard)` entries + booking, patient-portal, login, checkout, accept-invite, forgot-password, privacy, terms, root files, app CSS | pages |
| `app/api` | all 54 route groups (107 `route.ts`), proxy, instrumentation, sentry, next.config | API |
| `modules/` | all 13 modules (incl. their components) | API + components |
| `components/` (big) | ehr (incl. chart, sections, panels, order-basket), patients (incl. detail, registration), clinical-notes (incl. prescribe), lab (order, workflow), settings, nurse (incl. triage), payments, admin, dashboards | components-1 |
| `components/` (rest) | anc, appointments, billing, booking, clinical-images, create-dialogs, dashboard, facilities, filters, forms, front-desk, icons, login, mobile, navigation, onboarding, overlay, oversight, patient-handover, patient-portal, pharmacy, radiology, referrals, reports, staff, table, tour, unsaved, vital-events, wards + all ~40 top-level files | components-2 |
| `lib/` | all 33 subfolders; one line per file for all 114 services and ~110 top-level files | lib |
| Data integrity | clinical journey; diagnostics/pharmacy/revenue; public health/admin/ops; 84-row doc-type matrix | 4 tracers |
| UI patterns | cross-cutting, families A–N | patterns |
| Outside `src/` | `__tests__` (all 44 folders), platform/scripts, scripts, tools, infra, compose, Dockerfiles, workflows, husky, website, docs | ops |
| Measurement | jscpd, knip, dependency-cruiser, tsc flags, ESLint + sonarjs, AST counts, npm outdated | static |
| Best practice | 11 topics, primary sources | research |
| Styles (audit 1) | globals.css + 55 CSS files | audit 1 |

## Appendix B: raw outputs

Everything below is under the session scratchpad, `/private/tmp/claude-501/-Users-makuachtenygatluak-Documents-Projects-TamamHealth/bde9892f-ee4f-4d23-9302-453286ae3803/scratchpad/`:

| Path | Contents |
|---|---|
| `dataflow/matrix/MATRIX.md`, `dataflow/matrix/DEFECTS.md` | Full doc-type matrix (84 rows) and its defect list |
| `dataflow/validate.ts`, `v2.ts`–`v5.ts`, `check.ts`, `fee.ts`, `proofs*.test.ts`, `routes.test.ts` | Validator harness and jest proofs (template for contract test 7) |
| `static/` | jscpd, knip, depcruise, tsc-per-flag, ESLint and AST outputs |
| `patterns/notes.md` | UI pattern counts |
| `routes.json` | Per-route metrics |
| `graph.py`, `inv.js`, `imp.js`, `fns.js` | Import-graph and inventory scripts |
| `nocte.ts`, `nocte2.ts` | MAR frequency check |

These are temporary: copy anything you want to keep.
