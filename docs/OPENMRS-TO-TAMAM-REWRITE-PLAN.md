# OpenMRS-to-Tamam Complete Rewrite Plan

**Plan date:** 2026-09-03  
**Decision:** OpenMRS features and behavior; Tamam runtime, layout and style.  
**Companion evidence:** `specs/openmrs_reference_reverse_spec.md` and ADR 0004.

## 1. Outcome

The finished product is Tamam, implemented entirely in the existing Tamam
codebase and runtime. Its primary feature list matches the pinned OpenMRS
Reference Application. OpenMRS code and tests are reference material; Java,
Spring, Hibernate, OMOD, O3 microfrontends and the OpenMRS relational schema do
not enter the production runtime.

The rewrite is complete only when each approved feature has:

- An extracted behavioral specification
- A Tamam domain model and service contract
- Offline and conflict behavior
- Authorization and tenant-isolation rules
- A data migration or explicit no-migration decision
- Tamam-styled responsive UI in English and Juba Arabic
- Unit, integration and browser tests
- Clinical/product sign-off
- A rollback path

## 2. Audited upstream manifest

| Repository | Revision |
|---|---:|
| openmrs-core | `a48d5d8` |
| openmrs-distro-referenceapplication | `81cd706` |
| openmrs-esm-core | `2edf609` |
| openmrs-esm-patient-management | `5aa9030` |
| openmrs-esm-patient-chart | `69e629e` |
| openmrs-esm-patient-list | `1964b12` |
| openmrs-esm-form-entry | `c553a59` |
| openmrs-esm-laboratory-app | `4859e01` |
| openmrs-esm-dispensing-app | `34ebf4f` |
| openmrs-esm-stock-management | `9081793` |
| openmrs-esm-billing-app | `c5bd613` |
| openmrs-esm-task-list | `f22e24d` |
| openmrs-module-webservices.rest | `4d6d9cc` |
| openmrs-module-fhir2 | `069deb7` |
| openmrs-module-queue | `53c3803` |
| openmrs-module-bahmni-appointments | `a9954a4` |
| openmrs-module-bedmanagement | `b90023c` |
| openmrs-module-reporting | `45a4114` |
| openmrs-module-stockmanagement | `dc2a1f2` |
| openmrs-module-billing | `2e21085` |
| openmrs-module-o3forms | `b1a6e27` |

The manifest is immutable for the first parity program. Upstream changes enter
through a separately reviewed baseline upgrade.

## 3. Current-state audit

### Strengths to retain

- Offline-first service-to-PouchDB write path
- CouchDB replication, conflict queue and repair documents
- Organization/facility scoping and CouchDB write validation
- Append-only audit and regulated-record patterns
- Tamam dashboard, rail, drawer, dialog and empty-state components
- Existing OpenMRS-inspired patient chart shell
- English/Juba Arabic and RTL infrastructure
- Responsive and dark-theme guardrails
- Print-document safety helpers
- Established Jest, architecture, RBAC, security and sync test suites
- Domain-module migration already established in ADR 0003

### Structural weaknesses affecting the rewrite

- Only four domains have been substantially moved under `src/modules`; most
  clinical behavior remains spread across 95 legacy services, hooks, pages and
  large components.
- Clinical metadata is mostly hard-coded into feature-specific types, enums and
  form components.
- There is no OpenMRS-equivalent concept dictionary.
- Patient is not layered on a reusable Person model.
- Patient identifiers are not a first-class typed collection.
- Visits, encounters and medical records overlap without a single canonical
  OpenMRS-compatible lifecycle.
- Vitals and other observations are embedded or feature-specific rather than a
  generic typed observation domain.
- Prescriptions, lab/imaging records, procedures and referrals do not share one
  order abstraction.
- Programs are a fixed `ProgramKey` catalog rather than configurable workflow
  metadata.
- Clinical forms are not a complete metadata-defined form engine and builder.
- Existing route breadth can create false confidence: a page match does not
  imply semantic parity with OpenMRS.
- ESLint currently accepts 236 warnings. New rewrite modules must introduce no
  new warnings and should not copy effect-heavy legacy patterns.

### Verified baseline

- 297 Jest suites passed
- 2,867 Jest tests passed
- ESLint completed with zero errors and 236 warnings
- The Next.js 16.3.0 production build completed successfully and generated 194
  static pages during collection
- The i18n check passed with 6,689 keys in each of `en` and `apd`, scanning 400
  components without introducing untranslated UI text
- Unrelated in-progress lab files were already modified before this audit and
  were not touched

## 4. Target module architecture

Continue ADR 0003 and build the following native Tamam domains:

```text
platform/src/modules/
  clinical-metadata/  concepts, mappings, reference ranges, metadata lifecycle
  people/             person, names, addresses, attributes, relationships
  patients/           patient role, identifiers, duplicate detection and merge
  locations/          location hierarchy, tags and attributes
  providers/          provider identities, roles and assignments
  visits/             visits, encounters, encounter providers and types
  observations/       typed observations, groups, revisions and complex values
  conditions/         diagnoses, conditions and allergies
  orders/             common orders, groups, sets, replacement and fulfillment
  medications/        drug catalog, prescriptions and medication dispensing
  forms/              schemas, versions, rendering and submissions
  programs/           programs, workflows, states and enrollments
  cohorts/            cohorts, memberships and patient lists
  scheduling/         appointments, recurrence, calendars and conflicts
  queues/             queues, rooms, priorities and transitions
  inpatient/          wards, beds and patient assignments
  diagnostics/        lab workflow and results on top of orders/observations
  inventory/          stock items, sources, operations, batches and rules
  revenue/            bills, line items, payments, discounts, refunds and cash
  reporting/          definitions, parameters, evaluations and exports
  tasks/              clinical and operational tasks
```

Cross-cutting infrastructure remains shared: database factory, replication,
tenant scoping, authentication, i18n, design tokens, UI primitives, audit and
time handling.

Each module exposes only the three ADR 0003 surfaces. Application route files
remain thin re-exports or render a module page component.

## 5. Data architecture plan

### New foundational databases

| Database | Purpose | Sync |
|---|---|---|
| `tamamhealth_concepts` | Concepts, names, classes, datatypes, sets and answers | pull |
| `tamamhealth_concept_sources` | Terminology sources, reference terms and mappings | pull |
| `tamamhealth_clinical_metadata` | Encounter, visit, identifier, provider and location metadata types | pull |
| `tamamhealth_persons` | Person demographics independent of patient role | both, scoped |
| `tamamhealth_relationships` | Person relationships | both, scoped |
| `tamamhealth_visits` | Visit aggregate | both, scoped |
| `tamamhealth_observations` | Generic clinical observations and revisions | both, scoped |
| `tamamhealth_orders` | Unified order records and lifecycle links | both, scoped |
| `tamamhealth_forms` | Published form metadata and schemas | pull |
| `tamamhealth_form_submissions` | Form submission provenance | both, scoped |
| `tamamhealth_cohorts` | Cohort definitions | pull or both by ownership |
| `tamamhealth_cohort_memberships` | Patient membership history | both, scoped |

Existing databases are migrated or adapted rather than immediately deleted.
For example, legacy prescriptions can project into medication orders, lab
records into service/test orders plus observations, and medical records into
encounters. During transition, one canonical writer per aggregate is mandatory.

### Shared document semantics

Every new data record must include:

- Stable UUID and local `_id`
- Type and schema version
- Organization and facility ownership where applicable
- Creator and last modifier
- Created and changed timestamps
- Lifecycle status: active/voided for data or active/retired for metadata
- Void/retire reason and actor where applicable
- Provenance/source-system marker
- Offline synchronization status

### Migration rules

1. Migrations are repeatable and idempotent.
2. Source documents remain untouched until reconciliation passes.
3. Every migrated document records its source database, source ID and revision.
4. Migration writes use the same service validators as new application writes.
5. Reconciliation compares counts, patient links, clinical dates, authors,
   statuses and clinically meaningful values.
6. Failed records enter a review queue; they are never silently skipped.
7. Rollback changes the active reader/writer flag, not stored history.

## 6. Feature registry and disposition

Legend: **Reuse** means a credible Tamam workflow exists but still requires
semantic parity work. **Rebuild** means the foundation or workflow is missing.
**Adapt** means the existing page can remain while its model and rules change.

### Shell and administration

| OpenMRS feature | Tamam evidence | Disposition |
|---|---|---|
| Login/logout/password | Identity module and login routes | Reuse; map privilege semantics |
| Two-factor entry | Existing identity/security work | Reuse and verify parity |
| Location picker | Facility/session selection exists | Adapt to location hierarchy |
| Language switch | `en`/`apd` infrastructure | Reuse Tamam UI |
| Primary navigation/home | Tamam dashboard shell | Replace feature list only |
| Offline tools | Sync/conflict admin exists | Adapt for patient/action packages |
| User onboarding | Identity onboarding exists | Reuse Tamam UI |
| System admin | Multiple Tamam admin pages | Replace catalog and permissions |
| Implementer tools | Partial config/admin tools | Rebuild metadata-focused tools |
| Help | No equivalent complete catalog | Rebuild in Tamam shell |
| Metadata export | No direct equivalent | Rebuild |
| Open Concept Lab | No concept subsystem | Rebuild after concept kernel |

### Patient access and flow

| OpenMRS feature | Tamam evidence | Disposition |
|---|---|---|
| Registration | Patient registration exists | Adapt to Person + typed identifiers |
| Search | Patient search exists | Adapt names/identifiers/relationships |
| Patient lists | Partial patient-list panel | Rebuild on cohorts/memberships |
| Active visits | Queues and encounter journeys exist | Adapt to canonical Visit |
| Appointments/calendar | Appointment service and pages exist | Adapt recurrence/services/conflicts |
| Service queues | Triage/rooming/queue services exist | Adapt transitions and queue metadata |
| Ward | Ward, MAR and handoff pages exist | Adapt to visit/bed assignment model |
| Bed management | Ward/bed types exist | Adapt metadata, tags and assignment history |
| Cohort builder | No generic builder | Rebuild after concepts/observations |

### Patient chart

| OpenMRS feature | Tamam evidence | Disposition |
|---|---|---|
| Banner/chart shell | `OpenmrsChartShell`, `PatientDetailPage` | Retain Tamam implementation |
| Visits/encounters | Encounter and medical-record services | Rebuild canonical semantics, adapt UI |
| Allergies | Allergy service and chart section | Adapt coded allergen/reaction/severity |
| Conditions | Problem service and chart section | Adapt condition and diagnosis distinction |
| Vitals/biometrics | Vitals capture and trends | Rebuild on generic observations |
| Medications | Prescription and MAR functionality | Adapt to unified orders + dispense |
| Orders | Separate lab/prescription/procedure models | Rebuild common order kernel |
| Test results | Lab workflow and result catalog | Adapt to orders + observations |
| Procedures | Procedure service/section | Adapt to service orders |
| Immunizations | Dedicated service/page/section | Adapt coding and encounter provenance |
| Programs | Fixed program catalog | Rebuild configurable workflows |
| Notes | Clinical notes and signing | Reuse stronger Tamam audit behavior; map encounters |
| Attachments | Patient document service | Adapt attachment/complex-observation semantics |
| Patient flags | Care alerts/admin flags | Adapt configurable flag rules |
| Growth charts | No complete chart feature found | Rebuild |
| Patient forms | Partial clinical forms panel | Rebuild on metadata form engine |
| Form engine | No complete generic engine | Rebuild |
| Generic observation widgets | No generic observation domain | Rebuild |
| Patient tasks | Clinician tasks exist | Adapt ownership/status semantics |
| Label/summary printing | Shared print system exists | Adapt templates; retain safe Tamam printing |

### Operational applications

| OpenMRS feature | Tamam evidence | Disposition |
|---|---|---|
| Laboratory | Deep lab order/result workflow | Adapt onto order/observation kernel |
| Dispensing | Dispensing and pharmacy workflows | Adapt to medication orders/dispenses |
| Stock management | Pharmacy inventory/supply services | Rebuild operation and batch ledger semantics |
| Billing | Billing/payment/ledger domains | Adapt to OpenMRS feature catalog; preserve stronger Tamam payment safety |
| Reports | Reports and analytics pages | Rebuild metadata-defined report execution |
| Fast data entry | Data-entry dashboard only | Rebuild configurable entry workflow |
| Form builder | No equivalent full builder | Rebuild after form engine |

### Tamam-only navigation disposition

Because the approved product list is OpenMRS-led, the following current Tamam
areas do not remain first-class navigation unless product governance explicitly
maps them to an OpenMRS feature:

- Government dashboards and national briefing/equity views
- Epidemic intelligence, surveillance and disease alerts
- Births, deaths, vital statistics and standalone ANC
- Emergency preparedness
- HR, payroll, leave and staff scheduling
- Equipment and facility assessments
- Public inquiries
- Mobile payment portal and advanced insurance/claims pages beyond approved
  OpenMRS billing scope
- Cross-facility transfer workflows beyond the approved referral/order model
- Controlled-substance administration UI beyond approved medication/stock scope

These routes are **parked**, not deleted. Their databases and audit trails remain
until a separate archival or migration decision is accepted.

## 7. Dependency sequence

```text
Lifecycle/UUID/audit
        |
Concepts + clinical metadata
        |
Person -> Patient -> Provider/Location
        |
Visit -> Encounter -> Observation
        |
Conditions     Unified Orders
        |             |
        +------ Forms + Programs
                      |
   Appointments / Queues / Wards
                      |
 Lab / Dispensing / Stock / Billing
                      |
     Cohorts / Reporting / Fast Entry
```

A downstream feature does not begin until its upstream contracts and migration
fixtures are stable.

## 8. Implementation waves

### Wave 0 — Control the program

- Commit ADR 0004, the reverse specification and this plan.
- Create `openmrs-upstream-manifest.json` with repositories, revisions, licenses
  and local provenance paths.
- Create a machine-readable feature registry with owner, status and evidence.
- Add feature flags for old and replacement routes.
- Snapshot current navigation, route permissions, database counts and E2E flows.
- Add a rule prohibiting direct imports from temporary/reference OpenMRS source.

**Exit gate:** every one of the 47 applications has a registry row and owner;
the baseline suite is green.

### Wave 1 — Clinical metadata and lifecycle kernel

- Concepts, localized names, data types, classes, sets and answers
- Concept sources, terms and mappings
- Numeric reference ranges
- Visit, encounter, identifier, provider and location metadata types
- UUID, retire/unretire, void/unvoid and revision primitives
- Metadata package installation and offline versioning
- Initial South Sudan/Tamam concept package

**Exit gate:** metadata can be installed, searched and used offline; invalid
observation values are rejected from both UI and replicated writes.

### Wave 2 — Person, patient, provider and location

- Person names, addresses and attributes
- Patient role and multiple typed identifiers
- Duplicate detection and guarded patient merge
- Relationships and contacts
- Provider records and roles
- Location hierarchy, tags and attributes
- Migrate existing patient/facility records with reconciliation
- Adapt registration and search screens without changing Tamam styling

**Exit gate:** register, search, edit and merge work online/offline; historical
Tamam patient IDs remain resolvable; cross-tenant negative tests pass.

### Wave 3 — Visits, encounters and observations

- Canonical visit and encounter aggregates
- Encounter providers/roles and retrospective encounter time
- Generic observations and grouped observations
- Observation correction/voiding and reference ranges
- Adapt active visits, patient chart, vitals and encounter history
- Migrate medical records, triage vitals and other embedded observations

**Exit gate:** registration-to-visit-to-encounter-to-vitals completes offline,
syncs without duplication and renders correctly from another device.

### Wave 4 — Conditions, allergies, orders and medications

- Diagnoses versus longitudinal conditions
- Coded allergies, reactions and severity
- Common order lifecycle and specialized order payloads
- Order groups, sets, favorites/templates and replacement chains
- Medication orders and independent medication dispense records
- Migrate problems, prescriptions, procedures, referrals and lab/imaging orders
- Adapt order basket, conditions, allergies and medication chart sections

**Exit gate:** order creation, fulfillment, discontinuation and correction retain
complete provenance through offline conflict scenarios.

### Wave 5 — Forms, programs, cohorts and configurable UI

- Versioned form schema and renderer
- Form submission to encounter/observation mapping
- Form builder with validation and publishing workflow
- Programs, workflows, states and enrollment
- Cohorts, membership history, patient lists and cohort builder
- Generic observation widgets and fast data entry
- Replace hard-coded standalone programs where equivalent metadata is approved

**Exit gate:** an administrator can publish a form/program; a disconnected
clinical client can use the published metadata and later synchronize results.

### Wave 6 — Scheduling and patient flow

- Appointment services, recurrence, provider availability and conflict checks
- Queue metadata, rooms, priority and transitions
- Ward lists, bed metadata and assignment history
- Adapt Tamam appointment, queue, triage, rooming, ward and bed screens

**Exit gate:** appointment-to-arrival-to-queue-to-encounter-to-discharge works
end-to-end online and offline with accurate timing and audit history.

### Wave 7 — Laboratory, dispensing and stock

- Laboratory worklists and order pickup
- Specimen/result/review/amendment lifecycle
- Dispensing against medication orders
- Stock items, packaging, batches, sources, operations, reservations and rules
- Integrate order fulfillment and billing triggers

**Exit gate:** prescribed/ordered work crosses clinician, lab/pharmacy and stock
stations without duplicate fulfillment, negative stock or lost critical results.

### Wave 8 — Billing and reporting

- OpenMRS billing catalog: services, prices, bills, line items, discounts,
  exemptions, refunds, payment modes, cash points, timesheets and receipts
- Preserve Tamam append-only ledger and supported local payment methods where
  they do not contradict the approved catalog
- Report definitions, parameter schemas, cohort/data-set evaluation and exports
- Metadata export and Open Concept Lab integration

**Exit gate:** clinical orders can generate priced line items; payment/refund
reconciles to the ledger; reports rebuild from operational CouchDB data.

### Wave 9 — Navigation replacement and archive

- Generate the primary feature navigation from the approved registry.
- Remove parked Tamam-only modules from role routes and dashboards.
- Preserve safe read-only access for authorized archival users where required.
- Add redirects for replaced routes.
- Remove legacy writers only after reconciliation and rollback windows close.
- Update operator, support and training documentation.

**Exit gate:** only approved OpenMRS-equivalent features appear in primary Tamam
navigation; no legacy data has been deleted; production rollback is rehearsed.

## 9. Per-feature execution template

Every feature follows the same pull-sized loop:

1. **Pin sources:** record repositories, commit hashes and source/test paths.
2. **Extract behavior:** happy paths, validation, state transitions, permissions,
   void/retire behavior, searches, errors and configuration.
3. **Write EARS requirements:** observed facts separately from Tamam adaptations.
4. **Map dependencies:** concepts, metadata, entities and upstream modules.
5. **Design Tamam contract:** TypeScript types, service interface, database,
   indexes, sync direction and conflict policy.
6. **Write characterization tests:** port behavior, not Java implementation.
7. **Implement service:** tenant-scoped and offline-first.
8. **Migrate data:** idempotent transformer plus reconciliation report.
9. **Build UI:** existing Tamam components and tokens only.
10. **Verify:** online, offline, second-device sync, permissions, i18n, responsive,
    accessibility, print where relevant and failure recovery.
11. **Activate:** role-scoped feature flag and monitored pilot.
12. **Retire old writer:** only after rollback and reconciliation gates.

## 10. Test architecture

### Required layers

| Layer | Required evidence |
|---|---|
| Domain unit | Validation, transitions, lifecycle and edge cases |
| Service | PouchDB writes, indexes, scoping and audit events |
| Contract | Tamam public module/API schemas and stable error codes |
| Migration | Fixtures, idempotency, reconciliation and failure queue |
| Security | Privilege denial, cross-org/facility isolation and PHI handling |
| Sync | push, pull, conflict, retry, replay and two-device convergence |
| Browser | Tamam UI happy path and important failures |
| Offline browser | Full workflow with network disabled then restored |
| Accessibility | Keyboard, focus, labels, contrast and announcements |
| i18n | English/Juba Arabic parity and RTL layout |
| Performance | Metadata install, search, chart load and low-end device budget |

### End-to-end journeys

1. Register patient -> detect duplicate -> issue identifier -> print label.
2. Start visit -> queue -> encounter -> vitals -> clinical note -> close visit.
3. Diagnose -> order lab -> collect -> result -> review -> amend result.
4. Prescribe -> dispense -> stock decrement -> discontinue/revise medication.
5. Schedule recurring appointment -> check in -> resolve conflict -> no-show.
6. Admit -> assign bed -> transfer bed/ward -> discharge.
7. Enroll program -> transition state -> submit form -> cohort membership.
8. Generate bill from orders -> discount/exemption -> payment -> refund -> receipt.
9. Work entirely offline -> reconnect -> converge on second device.
10. Attempt every journey as unauthorized and cross-tenant users.

## 11. Release gates

A wave cannot ship until:

- `npm run lint` has zero errors and introduces no warning-count increase
- `npm test -- --runInBand` passes
- `npm run i18n:check` passes
- `npm run build` passes
- New module-boundary tests pass
- Online and offline Playwright journeys pass
- Tenant and facility isolation tests pass
- Migration reconciliation is clean or every exception is signed off
- Clinical governance approves observable behavior
- Rollback has been tested on a production-like copy

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Page parity mistaken for behavioral parity | Require source/test traceability and state-machine tests |
| Generic model slows offline clients | Indexed metadata stores, compact packages and measured device budgets |
| Relational invariants lost in CouchDB | Service validators, write validators, repair queue and reconciliation jobs |
| Two writers diverge during migration | One canonical writer per aggregate behind a feature flag |
| OpenMRS upstream changes during rewrite | Immutable baseline and deliberate upgrade reviews |
| Legacy Tamam data becomes inaccessible | Park routes, preserve stores and provide audited read-only access |
| Clinical terminology licensing/quality | Separate terminology governance and package provenance |
| Rewrite becomes one giant branch | Vertical slices, green commits and wave exit gates |
| Existing design drifts toward O3 | Tamam component-only UI reviews and design tests |
| Scope silently expands to every OpenMRS community module | Reference-distribution feature registry is the boundary |

## 13. Definition of complete

The program is complete when:

- All 47 reference frontend applications have an implemented, intentionally
  excluded or superseded status approved in the feature registry.
- All required backend behaviors have test traceability to pinned OpenMRS
  sources.
- The primary Tamam navigation contains only the approved parity catalog.
- No production code depends on Java/OpenMRS runtime components.
- Every supported clinical journey works offline and converges after reconnect.
- Historical Tamam records are migrated or remain safely accessible.
- Tamam's layout, design tokens, responsive behavior and translations are used
  throughout.
- Security, clinical, migration and operational sign-offs are recorded.

## 14. Immediate next work

The next implementation work is Wave 0 only. Do not begin clinical feature
changes until the registry, pinned manifest and feature flags exist. After Wave
0, the first product slice is the metadata-backed registration-to-encounter
journey from Waves 1–3.

### Wave 0 implementation status

- [x] Pinned upstream provenance manifest
- [x] Typed, exact 47-feature Tamam registry
- [x] Fail-closed current/shadow/replacement/parked cutover resolver
- [x] Pull-only platform configuration storage for catalog state
- [x] Module-boundary and registry completeness tests
- [x] Tamam-only naming in the new runtime catalog
- [x] Existing patient-chart component, stylesheet and CSS namespace renamed to
  Tamam terminology
- [x] Connect the resolver to the role-authorized desktop and mobile module
  directories; current routes remain the fail-closed default
- [x] Add the administrator capability rollout matrix with all 47 features,
  search, ownership, delivery wave, current route and guarded stage controls

### Platform re-audit — 2026-09-03

The second pass traced rendered navigation and select/dropdown producers rather
than stopping at the feature registry:

- 120 protected App Router pages exist; the reference catalog currently maps 19
  distinct route roots covering 45 of them. The other routes are Tamam-specific
  administration, government, workforce, messaging, finance and public-health
  capabilities and must not be deleted merely because the reference catalog has
  no equivalent.
- 108 component/page files render a native select, shared Select or popup
  picker. The static inventory found 351 option/catalog signals. Many are
  legitimate workflow enums, but clinical vocabularies remain fragmented and
  are the next metadata-kernel migration target.
- The desktop module dropdown was incomplete by construction: it removed the
  four rail shortcuts. Mobile retained those entries but ignored disabled-app
  configuration. Neither surface consumed the 47-feature cutover resolver.
- Both module directories now use the same sequence: role authorization →
  organization app filtering → feature-catalog cutover. The desktop dropdown
  contains the complete authorized directory; shortcuts are accelerators, not
  omissions from the directory.
- Every catalog `currentRoutes` entry is now checked against a real application
  page, preventing configuration from advertising a route that does not ship.

Prioritized follow-up debt using `(impact + risk) × (6 - effort)`:

| Priority | Item | Impact | Risk | Effort | Score |
|---:|---|---:|---:|---:|---:|
| 1 | Metadata-backed clinical dropdown vocabulary | 5 | 5 | 3 | 30 |
| 2 | One route-to-capability map for all 120 protected pages | 4 | 4 | 3 | 24 |
| 3 | Approval history layered on implemented feature-stage audit events | 4 | 5 | 4 | 18 |
| 4 | Browser E2E coverage for desktop/mobile catalog filtering | 4 | 4 | 4 | 16 |
| 5 | Localize remaining grandfathered hardcoded UI strings | 3 | 3 | 4 | 12 |

## Appendix A — Exact 47-application registry

This table closes the audit boundary against the distribution's
`frontend/spa-assemble-config.json`. A later OpenMRS package is not silently in
scope unless the baseline manifest is deliberately upgraded.

| # | OpenMRS frontend package | Initial Tamam decision | Delivery wave |
|---:|---|---|---:|
| 1 | `@openmrs/esm-active-visits-app` | Adapt existing visit/queue UI | 3, 6 |
| 2 | `@openmrs/esm-appointments-app` | Adapt existing scheduling UI | 6 |
| 3 | `@openmrs/esm-bed-management-app` | Adapt existing ward/bed UI | 6 |
| 4 | `@openmrs/esm-billing-app` | Adapt existing billing UI and preserve safer ledger rules | 8 |
| 5 | `@openmrs/esm-cohort-builder-app` | Rebuild natively | 5 |
| 6 | `@openmrs/esm-devtools-app` | Development-only; do not expose in production | 0 |
| 7 | `@openmrs/esm-dispensing-app` | Adapt pharmacy workflow | 7 |
| 8 | `@openmrs/esm-fast-data-entry-app` | Rebuild natively | 5 |
| 9 | `@openmrs/esm-form-builder-app` | Rebuild natively | 5 |
| 10 | `@openmrs/esm-form-engine-app` | Rebuild natively | 5 |
| 11 | `@openmrs/esm-generic-patient-widgets-app` | Rebuild on generic observations | 3, 5 |
| 12 | `@openmrs/esm-help-menu-app` | Rebuild with Tamam help content/layout | 9 |
| 13 | `@openmrs/esm-home-app` | Keep Tamam home layout; replace feature cards | 9 |
| 14 | `@openmrs/esm-implementer-tools-app` | Rebuild metadata-focused tools | 1, 8 |
| 15 | `@openmrs/esm-laboratory-app` | Adapt existing lab workflow | 7 |
| 16 | `@openmrs/esm-login-app` | Reuse Tamam identity UI and close behavior gaps | 2 |
| 17 | `@openmrs/esm-metadataexport-app` | Rebuild natively | 8 |
| 18 | `@openmrs/esm-openconceptlab-app` | Rebuild after concept kernel | 8 |
| 19 | `@openmrs/esm-patient-allergies-app` | Adapt chart section and data model | 4 |
| 20 | `@openmrs/esm-patient-attachments-app` | Adapt patient documents | 3, 5 |
| 21 | `@openmrs/esm-patient-banner-app` | Retain Tamam chart header | 2, 3 |
| 22 | `@openmrs/esm-patient-chart-app` | Retain Tamam chart shell; replace contracts | 3 |
| 23 | `@openmrs/esm-patient-conditions-app` | Adapt problems/conditions UI | 4 |
| 24 | `@openmrs/esm-patient-flags-app` | Adapt care-alert UI and rules | 4 |
| 25 | `@openmrs/esm-patient-forms-app` | Rebuild on form engine | 5 |
| 26 | `@openmrs/esm-patient-growth-chart-app` | Rebuild natively | 3, 5 |
| 27 | `@openmrs/esm-patient-immunizations-app` | Adapt existing immunization UI | 3, 4 |
| 28 | `@openmrs/esm-patient-label-printing-app` | Adapt through Tamam print helpers | 2 |
| 29 | `@openmrs/esm-patient-list-management-app` | Rebuild on cohorts/memberships | 5 |
| 30 | `@openmrs/esm-patient-lists-app` | Rebuild chart integration on cohorts | 5 |
| 31 | `@openmrs/esm-patient-medications-app` | Adapt on unified orders/dispensing | 4 |
| 32 | `@openmrs/esm-patient-notes-app` | Reuse Tamam notes; map to encounters | 3 |
| 33 | `@openmrs/esm-patient-orders-app` | Rebuild common order behavior | 4 |
| 34 | `@openmrs/esm-patient-programs-app` | Rebuild configurable workflow model | 5 |
| 35 | `@openmrs/esm-patient-registration-app` | Adapt to Person and identifier model | 2 |
| 36 | `@openmrs/esm-patient-search-app` | Adapt names and typed identifiers | 2 |
| 37 | `@openmrs/esm-patient-task-list-app` | Adapt existing clinician tasks | 3 |
| 38 | `@openmrs/esm-patient-tests-app` | Adapt lab/results chart integration | 4, 7 |
| 39 | `@openmrs/esm-patient-vitals-app` | Adapt UI; rebuild storage on observations | 3 |
| 40 | `@openmrs/esm-patient-procedures-app` | Adapt on service orders | 4 |
| 41 | `@openmrs/esm-primary-navigation-app` | Keep Tamam navigation layout; replace catalog | 9 |
| 42 | `@openmrs/esm-reports-app` | Rebuild metadata-defined reporting | 8 |
| 43 | `@openmrs/esm-service-queues-app` | Adapt current queues and transitions | 6 |
| 44 | `@openmrs/esm-stock-management-app` | Rebuild stock operation semantics | 7 |
| 45 | `@openmrs/esm-system-admin-app` | Rebuild around approved metadata/admin catalog | 1, 8 |
| 46 | `@openmrs/esm-user-onboarding-app` | Reuse Tamam onboarding in Tamam style | 2, 9 |
| 47 | `@openmrs/esm-ward-app` | Adapt current inpatient workflow | 6 |

Every initial decision is provisional until the per-feature source/tests are
fully traced. Changing a decision requires updating this registry, its rationale
and the affected dependency/migration plan in the same change.
