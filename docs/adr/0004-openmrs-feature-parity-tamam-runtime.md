# ADR 0004 — OpenMRS feature parity on the Tamam runtime and design system

- **Status:** Accepted for planning; implementation is gated by the master plan
- **Date:** 2026-09-03
- **Deciders:** Tamam product, clinical governance and engineering
- **Interacts with:** ADR 0003, `docs/ARCHITECTURE.md`, `docs/PRINCIPLES.md`

## Context

Tamam will replace its product feature catalog with the feature catalog and
behavior of the OpenMRS Reference Application. The user-facing product must
remain Tamam and retain the existing Tamam layout and visual language.

Using OpenMRS Core directly would change the backend to Java/Spring/Hibernate
and a relational operational database. Using the O3 frontend directly would
replace Tamam's Next.js application shell and visual system. Neither meets the
desired target.

Tamam also has non-negotiable runtime constraints: local-first clinical writes,
CouchDB as operational source of truth, no mandatory cloud dependency, simple
facility deployment, organization/facility isolation, English/Juba Arabic
parity and the current Tamam design tokens.

## Decision

OpenMRS is the behavioral reference, not a runtime dependency.

Tamam will:

1. Retain Next.js, React, TypeScript, PouchDB, CouchDB, the optional PostgreSQL
   projection, Expo mobile and the existing deployment topology.
2. Retain the Tamam shell, design tokens, components, accessibility patterns,
   responsive behavior and translations.
3. Replace the visible feature catalog with the 47 applications assembled by
   the pinned OpenMRS Reference Application baseline.
4. Reimplement OpenMRS domain behavior natively in Tamam domain modules.
5. Hide or archive Tamam-only applications that are not in the approved
   OpenMRS parity catalog; stored data will not be deleted as part of hiding.
6. Extract requirements from pinned source and tests before implementing each
   feature.
7. Use incremental feature flags and data migrations rather than a big-bang
   rewrite.

## Options considered

### A. Run OpenMRS and reskin O3

| Dimension | Assessment |
|---|---|
| Feature fidelity | High initially |
| Tamam runtime compatibility | Low |
| Tamam layout retention | Low to medium |
| Offline architecture compatibility | Low |
| Rewrite cost | Low initially |

Rejected because it replaces the runtime, data architecture and UI framework.

### B. Translate OpenMRS line-by-line

| Dimension | Assessment |
|---|---|
| Feature fidelity | Superficially high |
| Maintainability | Low |
| Fit with Tamam domain modules | Low |
| Licensing/provenance complexity | High |
| Delivery risk | Very high |

Rejected because Java persistence and framework implementation details do not
map cleanly to TypeScript and CouchDB.

### C. Specification-driven native rewrite

| Dimension | Assessment |
|---|---|
| Feature fidelity | High with traceability |
| Tamam runtime compatibility | High |
| Tamam layout retention | High |
| Offline architecture compatibility | High, but must be designed per feature |
| Delivery risk | High but controllable incrementally |

Accepted. Source code, APIs and tests define observable behavior; implementation
is native to Tamam.

## Consequences

### Easier

- One visual system and one product identity
- Continued use of the current offline and tenant-isolation infrastructure
- Reuse of existing Tamam screens, components and partial workflows
- Shared web/mobile TypeScript domain vocabulary
- Incremental replacement and rollback

### Harder

- Tamam must reproduce relational integrity in an eventually consistent store
- The generic concept/observation/form model must work efficiently offline
- Every OpenMRS behavior requires test-backed extraction and clinical review
- Existing Tamam-only routes and data need explicit archival decisions
- Feature parity becomes a long-running program rather than a repository import

## Guardrails

- Never delete a legacy database or document merely because its route is hidden.
- Never ship a feature whose main clinical write requires connectivity.
- Never copy an OpenMRS screen's styling; map behavior into Tamam components.
- Never introduce hard-coded clinical concepts where metadata should define them.
- Never declare parity from page presence alone; domain rules and negative cases
  must be covered.
- Never target floating OpenMRS `next` versions. Pin source revisions.
- Direct source translations must retain required license provenance.
- Production code identifiers, CSS namespaces and user-facing copy use Tamam
  terminology. Upstream names remain only in audit, provenance and license
  documentation where attribution is required.

## Action items

1. Maintain the pinned upstream manifest and feature registry.
2. Create the clinical metadata and lifecycle kernel.
3. Implement the registration-to-encounter vertical slice.
4. Replace the patient chart feature group.
5. Replace operational applications in dependency order.
6. Move old routes to read-only archive or remove them from navigation only
   after migration and rollback gates pass.
7. Require clinical, security and offline acceptance for every release wave.
