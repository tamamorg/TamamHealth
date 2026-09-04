# Tamam Clinical Platform Completion Roadmap

## Goal

Complete the missing clinical-platform foundations without replacing Tamam's
offline-first architecture, domain language, or visual system. Each capability
must work with organization and facility scope, remain usable offline, support
English and Juba Arabic, and have an auditable path from configuration to
patient care.

## Delivery principles

- Build domain contracts before administrative screens.
- Keep browser writes local-first and replicate through the existing sync path.
- Treat terminology, form schemas, report definitions, and program definitions
  as versioned metadata rather than hardcoded UI configuration.
- Do not advertise a capability as complete merely because a route exists.
- Add database migrations only after the domain contract and conflict policy are
  tested.
- Ship vertical slices with authorization, tenant scoping, audit events,
  translations, offline behavior, and end-to-end verification together.

## Dependency map

```text
Terminology and metadata
  |-- Clinical form engine --> Form builder --> Fast clinical data entry
  |-- Cohort criteria -------> Patient lists --> Reporting
  |-- Program definitions ---> Program workflows and dashboards
  |-- Unified orders --------> Order sets and fulfillment
  `-- FHIR contracts --------> Client registry and national exchange

Inventory transaction ledger --> Procurement, stock reports, and approvals
Patient observations ---------> Growth charts
Patient identity -------------> Labels, wristbands, and specimen labels
```

## Phased backlog

| Phase | Priority | Deliverable | Exit criteria |
| --- | --- | --- | --- |
| 0 | P0 | Feature catalogue accuracy | Every catalogue item declares complete, partial, planned, or development-only maturity; tests prevent route presence from implying parity. |
| 1 | P0 | Terminology foundation | Typed, versioned concepts, code systems, value sets, mappings, lifecycle rules, validation, and deterministic search are tested. |
| 1 | P0 | Clinical form foundation | Versioned schemas support sections, core clinical fields, repeat groups, conditional visibility, bilingual labels, and pure validation. |
| 1 | P0 | Metadata persistence | Tenant-scoped local databases, indexes, replication policy, audit events, and conflict rules support terminology and form schemas. |
| 2 | P0 | Form renderer | Clinicians can open, validate, draft, resume, submit, amend, and view a schema-backed form offline. |
| 2 | P1 | Form builder | Authorized implementers can create, preview, version, publish, retire, import, and export form definitions. |
| 2 | P1 | Cohorts and patient lists | Saved static and dynamic lists support typed criteria, membership, sharing, snapshots, and patient-chart access. |
| 3 | P0 | Program definitions | Programs have configurable workflows, states, outcomes, eligibility, forms, and dashboards. |
| 3 | P0 | Inventory ledger | Receipts, issues, transfers, adjustments, returns, requisitions, counts, disposal, batches, expiry, and approvals derive balances from an immutable ledger. |
| 3 | P1 | Unified orders | Medication, laboratory, procedure, imaging, and referral orders share lifecycle, provenance, fulfillment, cancellation, and order-set rules. |
| 4 | P0 | Reporting engine | Cohort, indicator, stock, revenue, and line-list reports have definitions, parameters, run history, scheduling, access controls, and safe exports. |
| 4 | P1 | Growth and printing | WHO growth calculations and charts are tested; configurable patient, wristband, and specimen labels print with barcode or QR identifiers. |
| 5 | P0 | Interoperability expansion | Supported clinical resources have explicit read/search/write profiles, validation, authorization, terminology bindings, audit events, and conformance tests. |
| 5 | P1 | National exchange | Client matching, facility registry, metadata distribution, aggregate reporting, retries, reconciliation, and operational monitoring work end to end. |
| 6 | P1 | Configurable experience | Fast retrospective entry, configurable chart widgets, contextual help, diagnostics, and metadata packages use the preceding foundations. |

## Initial implementation sprint

**Sprint goal:** establish truthful catalogue status and tested domain contracts
for terminology and clinical forms.

| Workstream | Scope | Dependencies | Status |
| --- | --- | --- | --- |
| Catalogue maturity | Add explicit maturity semantics and correct known partial or missing capabilities. | None | Complete |
| Terminology contracts | Add a domain module with lifecycle, validation, mapping, value-set, and search primitives. | None | Complete |
| Clinical-form contracts | Add a domain module for schemas, conditional rules, repeat groups, localization, and validation. | Terminology bindings follow in the next slice | Complete |
| Integration verification | Run focused tests, architecture tests, lint, translation checks, and production build. | All sprint workstreams | Complete |

## Definition of done for every vertical slice

- Tenant and facility scope fail closed.
- Authorization is enforced at UI and service boundaries.
- Mutations generate PHI-safe audit events.
- Offline creation, editing, conflict handling, and replication are tested.
- User-facing text is translated in both supported locales.
- Accessibility and keyboard operation are verified.
- Unit, integration, and representative browser workflows pass.
- Feature maturity is updated only after the end-to-end workflow ships.
- Operational documentation and rollback steps are current.

## Risks and controls

| Risk | Control |
| --- | --- |
| Metadata edits invalidate historical records | Store immutable published versions and retain the version used by every clinical record. |
| Generic builders become too permissive | Use constrained field and rule registries with schema validation and explicit migrations. |
| Offline concurrent edits diverge | Define per-document conflict ownership before persistence and surface unresolved clinical conflicts. |
| Reports expose cross-tenant PHI | Compile every query from a scoped definition and test negative access cases. |
| Interoperability changes internal behavior | Isolate transport adapters from domain models and validate profiles at the boundary. |
| Scope expands into a full rewrite | Require each phase to deliver a usable vertical slice on the existing Tamam stack. |

## Next sprint candidate

After the initial contracts pass, implement terminology and form-schema
persistence together with one end-to-end form: create a versioned triage form,
publish it, complete it offline, synchronize it, and display its immutable
submission in the patient chart.
