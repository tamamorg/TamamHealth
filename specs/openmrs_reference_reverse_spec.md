# Reverse-Engineered Specification: OpenMRS Reference Application for Tamam

**Audit date:** 2026-09-03  
**Purpose:** Define the behavior Tamam must reproduce while retaining Tamam's
Next.js/TypeScript/PouchDB architecture and visual system.

## Scope and evidence

This audit uses the assembled OpenMRS Reference Application rather than treating
`openmrs-core` as the whole product.

| Source | Audited revision | Role in the audit |
|---|---:|---|
| `openmrs/openmrs-core` | `a48d5d8` | Core domain objects, services, security annotations, persistence behavior and tests |
| `openmrs/openmrs-distro-referenceapplication` | `81cd706` | Authoritative backend/frontend feature assembly |
| `openmrs/openmrs-esm-core` | `2edf609` | Shell, authentication UI, extension framework and offline utilities |
| `openmrs/openmrs-esm-patient-chart` | `69e629e` | Patient chart applications and clinical workspaces |
| `openmrs/openmrs-esm-patient-management` | `5aa9030` | Registration, search, visits, appointments, queues, wards and beds |
| OpenMRS laboratory, dispensing, stock, billing and task applications | revisions listed in the master plan | Operational workflows |
| REST, FHIR2, queue, appointments, bed, reporting, stock, billing and O3 Forms backend modules | revisions listed in the master plan | APIs and domain rules behind the frontend |
| Current Tamam repository | working tree on 2026-09-03 | Target behavior, architecture, design system and existing feature coverage |

The temporary OpenMRS clones used for this audit live outside the repository at
`/tmp/tamam-openmrs-audit-20260903`. They are references only and are not part of
the Tamam build.

## Architecture summary

### Observed OpenMRS architecture

```text
O3 React microfrontends
        |
REST v1 / FHIR R4
        |
OpenMRS Core + OMOD modules
        |
Spring services + Hibernate
        |
Relational database + Liquibase migrations
```

OpenMRS Core exposes 23 primary service interfaces. The largest audited
interfaces include `ConceptService`, `OrderService`, `PersonService`,
`PatientService`, `FormService`, `EncounterService`, `UserService`,
`ProgramWorkflowService`, `LocationService`, `ProviderService`, `VisitService`
and `ObsService`. The checked-out core contains 590 API test files. The REST
module contains 306 resource-class files and the FHIR2 module exposes 31
FHIR-oriented service interfaces.

The reference distribution assembles 35 backend OMOD entries, two content
packages and 47 frontend applications. Therefore the feature contract cannot be
derived from the core repository or its README alone.

### Target Tamam architecture

```text
Tamam Next.js / React interface
        |
Domain hooks and TypeScript services
        |
PouchDB on the care device
        |
Tenant-filtered CouchDB replication
        |
Optional PostgreSQL analytics projection
```

Tamam currently has 120 protected dashboard pages, 99 API route files, 95
service files, 74 PouchDB accessors and 297 Jest test files. The platform test
baseline at audit time is 2,867 passing tests in 297 suites. ESLint exits
successfully with zero errors and 236 warnings. The production build and i18n
check also pass; both locales contain 6,689 keys.

## Observed OpenMRS domain model

### Identity and administration

- Person, names, addresses and arbitrary person attributes
- Patient layered on Person
- Multiple typed patient identifiers with preferred and location semantics
- Relationships and relationship types
- Users, providers, provider roles, roles and privileges
- Hierarchical locations, location tags and typed attributes
- Metadata lifecycle using retire/unretire; data lifecycle using void/unvoid
- UUID-based external identity

### Clinical terminology

- Concepts with localized names, descriptions, classes and data types
- Coded answers and concept sets
- Numeric concepts and reference ranges
- Concept sources, reference terms and mappings
- Drugs, ingredients and drug mappings
- Orderable concepts and locale-aware search

### Clinical record

- Visits with visit types, date bounds, location, attributes and encounters
- Encounters with encounter type, providers, roles, location and observations
- Observations with coded, numeric, text, date and complex values
- Observation revisions and explicit voiding
- Diagnoses and conditions as distinct concepts
- Allergies, reactions and severity
- Programs, workflows, states and patient enrollment

### Orders and medication

- Base order abstraction with type, care setting, urgency, instructions and dates
- Drug, test, service and referral order specializations
- Order groups, order sets and order templates
- Discontinuation, fulfillment and replacement relationships
- Medication dispensing separate from medication ordering

### Configurable care delivery

- Form metadata, fields, concepts and versions
- O3 JSON form schema delivery and rendering
- Cohorts, cohort membership and patient lists
- Appointments, recurrence, providers, services and conflicts
- Service queues, queue rooms, priorities and transitions
- Beds, bed types, tags, locations and patient assignments
- Reporting definitions, cohorts, data sets, indicators and evaluations

## OpenMRS Reference Application feature catalog

The following is the full 47-application frontend list assembled at revision
`81cd706`, grouped by product capability rather than npm package ownership.

### Shell and administration

- Login, logout, password change and two-factor entry
- Primary navigation and home dashboard
- User onboarding
- Help menu
- Offline tools
- System administration
- Implementer/developer tools
- Metadata export
- Open Concept Lab integration

### Patient access and flow

- Patient registration
- Patient search
- Active visits
- Appointments and calendar
- Service queues
- Ward application
- Bed management
- Patient list management
- Cohort builder

### Patient chart

- Patient banner and chart shell
- Visits and encounters
- Allergies
- Conditions
- Vitals and biometrics
- Medications
- Orders
- Test results
- Procedures
- Immunizations
- Programs
- Notes
- Attachments
- Patient flags
- Growth charts
- Patient forms
- Form engine and generic observation widgets
- Patient task list
- Label and visit-summary printing
- Generic patient widgets

### Clinical and operational applications

- Laboratory
- Dispensing
- Stock management
- Billing
- Reports
- Fast data entry
- Form builder

## Observed functional requirements

The statements below capture foundational behavior that the Tamam rewrite must
preserve. Detailed requirements are expanded feature-by-feature before each
implementation slice.

### Lifecycle and identity

**OBS-LIFE-001 — Stable identity**  
The system shall assign a stable UUID to every externally addressable data and
metadata record.

**OBS-LIFE-002 — Clinical deletion**  
When a user removes a clinical record from ordinary use, the system shall void
the record with the actor, time and reason instead of physically deleting it.

**OBS-LIFE-003 — Metadata deletion**  
When an administrator removes metadata from ordinary use, the system shall
retire it with a reason while preserving historical references.

**OBS-LIFE-004 — Revision provenance**  
When a finalized observation is corrected, the system shall preserve the prior
observation and link the replacement to its predecessor.

### Patient identity

**OBS-PAT-001 — Person and patient separation**  
The system shall represent demographic identity independently from the clinical
patient role so that users, providers, relatives and patients can share person
semantics.

**OBS-PAT-002 — Multiple identifiers**  
The system shall support multiple patient identifiers, identifier types,
issuers/locations, preferred status, validation and uniqueness rules.

**OBS-PAT-003 — Merge**  
When authorized staff merge duplicate patients, the system shall preserve an
auditable surviving identity and re-associate dependent clinical data without
silently dropping conflicting information.

### Terminology

**OBS-CON-001 — Concept-driven capture**  
The system shall represent clinical questions, answers, tests, diagnoses and
orderables using configurable concepts rather than page-specific string enums.

**OBS-CON-002 — Localized names**  
The system shall permit a concept to have localized preferred, full and short
names while retaining a stable identity across translations.

**OBS-CON-003 — External mappings**  
Where terminology mappings are configured, the system shall associate concepts
with reference terms from sources such as ICD, SNOMED, LOINC or local catalogs.

### Visits, encounters and observations

**OBS-VIS-001 — Visit grouping**  
When care begins, the system shall create or select a visit that groups one or
more encounters within a time interval and location.

**OBS-ENC-001 — Typed encounter**  
When clinical activity is recorded, the system shall associate it with a typed
encounter, patient, location, responsible providers and provider roles.

**OBS-OBS-001 — Typed values**  
When an observation is recorded, the system shall validate its value against
the referenced concept's datatype and permitted coded answers.

### Orders

**OBS-ORD-001 — Unified order lifecycle**  
The system shall apply common lifecycle, care-setting, urgency, scheduling,
fulfillment and discontinuation semantics to medication, laboratory, procedure,
service and referral orders.

**OBS-ORD-002 — Order replacement**  
When an order is revised or discontinued, the system shall retain the original
order and explicitly link its replacement or discontinuation action.

**OBS-ORD-003 — Dispensing separation**  
When medication is dispensed, the system shall record dispensing independently
from the prescription while maintaining the relationship between them.

### Configurable workflows

**OBS-FORM-001 — Metadata-defined forms**  
When an administrator publishes a form schema, the clinical client shall render
the form from metadata and save results as concept-linked clinical data.

**OBS-PROG-001 — Configurable programs**  
The system shall permit programs to define workflows and states without adding
a new hard-coded page for every clinical program.

**OBS-QUEUE-001 — Queue transitions**  
When a patient moves through a service queue, the system shall retain queue,
priority, location, status-transition and timing information.

### Authorization

**OBS-AUTH-001 — Privilege checks**  
When a protected service operation is requested, the system shall verify the
required privilege independently of whether the requesting screen is visible.

**OBS-AUTH-002 — Minimum necessary access**  
The system shall restrict clinical data and actions to the minimum required by
the user's role, facility and organizational scope.

## Tamam adaptation requirements

These are Tamam constraints, not claims about OpenMRS behavior.

**TAM-OFF-001 — Local-first operation**  
While connectivity is unavailable, when authorized staff perform any supported
clinical workflow, Tamam shall complete the operational write locally without
requiring a network response.

**TAM-OFF-002 — Idempotent synchronization**  
When connectivity returns, Tamam shall replicate every queued mutation
idempotently and retain unresolved clinically meaningful conflicts for review.

**TAM-TEN-001 — Tenant isolation**  
When data is stored, queried or replicated, Tamam shall enforce organization
and facility scope at service, API and CouchDB validation boundaries.

**TAM-UI-001 — Tamam presentation**  
When an OpenMRS-derived feature is presented, Tamam shall render it through the
existing Tamam shell, design tokens, icons, responsive behavior and interaction
patterns rather than reproducing the OpenMRS visual interface.

**TAM-I18N-001 — Language parity**  
When user-facing copy is added, Tamam shall provide English and Juba Arabic
translations and shall preserve RTL behavior.

**TAM-DATA-001 — Non-destructive replacement**  
When an existing Tamam feature is retired from navigation, Tamam shall preserve
its stored data until a verified migration or archival policy has completed.

## Non-functional observations

### Security

- OpenMRS uses service privileges and authorization annotations; Tamam currently
  uses route roles, service scope, replication roles and CouchDB validators.
- Feature parity is incomplete unless authorization behavior is reproduced at
  the service boundary, not merely in navigation.
- Tamam's append-only audit, sync-event and controlled-substance stores must
  remain protected even if those applications leave primary navigation.
- Patient merge, identifier reassignment, order discontinuation, result
  amendment and metadata retirement are high-risk actions requiring dedicated
  audit events and negative authorization tests.

### Data integrity

- OpenMRS obtains referential integrity from a relational model. Tamam must
  implement equivalent invariants in services, validators, repair documents and
  reconciliation checks because CouchDB does not enforce foreign keys.
- Concept, form and program metadata should be pull-only to clinical clients.
- Audit trails and high-risk corrections should remain append-only/push-only.
- Mutable clinical aggregates require explicit conflict policies rather than
  last-write-wins acceptance.

### Performance and offline behavior

- A generic concept/observation model introduces more lookups than Tamam's
  current embedded records. Local indexes and pre-resolved display caches will
  be required.
- Metadata packages must be versioned and downloadable for offline use.
- Large attachments and complex observations need a separate attachment
  strategy so they do not overload ordinary replication.

### Quality baseline

- OpenMRS's large service and module test suites are a source of behavioral
  cases, not tests Tamam can run directly.
- Every ported rule needs a TypeScript characterization test referencing its
  OpenMRS source and revision.
- Tamam's baseline passed 2,867 tests during the audit; preserving that green
  baseline is a release gate.

## Inferred acceptance criteria

### AC-001 — Feature parity traceability

Given an OpenMRS Reference Application feature, when it is scheduled for
implementation, then the feature registry identifies its source repositories,
behavioral requirements, Tamam owner module, data migration, authorization,
offline behavior and test evidence.

### AC-002 — Tamam-only visual identity

Given a rewritten feature, when a user opens it, then it uses Tamam's existing
navigation, spacing, typography, color tokens, icons, empty states, drawers,
dialogs, responsive behavior and translated copy.

### AC-003 — Offline clinical completion

Given a supported clinical workflow and an authenticated offline session, when
the network is disabled, then the workflow can be completed locally and later
synchronizes without duplicate clinical records.

### AC-004 — Safe replacement

Given an existing Tamam page being replaced, when the OpenMRS-equivalent feature
is activated, then historical records remain readable or are migrated, the old
route redirects safely, and rollback does not require restoring deleted data.

### AC-005 — End-to-end release gate

Given a feature slice marked complete, when CI runs, then unit, service,
integration, authorization, tenant-isolation, online browser, offline browser,
sync-conflict, accessibility and i18n checks pass.

## Uncertainties requiring per-feature resolution

- Which reference-application version will be the long-term parity baseline?
- Which OpenMRS optional configuration is considered canonical when behavior
  changes by implementation metadata?
- Which OpenMRS features are intentionally excluded from the deployed Tamam
  product even though their packages appear in the reference distribution?
- Whether legacy Tamam-only records remain available in a read-only archive or
  are migrated into generic OpenMRS-derived concepts/forms/programs.
- Which external terminology packages Tamam is licensed to distribute offline.
- Maximum metadata and attachment volume supported on low-cost Android devices.
- Clinical governance authority for approving parity in South Sudan workflows.

## Recommendations

1. Freeze the audited OpenMRS commit manifest; never use moving `next` packages
   as an acceptance target.
2. Build foundational metadata, lifecycle and identity semantics before
   replacing visible clinical pages.
3. Use Tamam domain modules rather than create one monolithic `openmrs` module.
4. Replace one vertical slice at a time behind feature flags; do not perform a
   big-bang navigation or data-model swap.
5. Preserve all existing Tamam data until migration reconciliation and rollback
   windows have closed.
6. Treat OpenMRS tests as a behavioral case library and record provenance for
   every translated rule.
7. Maintain a feature registry throughout the rewrite; a feature is not done
   until its offline, authorization and end-to-end evidence is linked.
