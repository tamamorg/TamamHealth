# TamamHealth Regional Exchange Layer

> **Status: design stake — this directory contains nothing but this file.** No
> code, no package, no service, nothing that builds or deploys. Everything
> below describes an intended design, not something that exists. It is written
> down so partners and ministries can see where a regional layer would fit, and
> so the shape is agreed before anyone is under pressure to ship one.

The regional layer in the federated EHR architecture. It would exchange ONLY
the minimum data needed for cross-border continuity of care and regional
programs, and would not hold a pan-regional transactional database (which would
break both sovereignty and resilience).

## Intended scope

- **Regional Referral Service** — cross-border referral packet (FHIR Bundle)
  routing between country nodes.
- **Regional MPI / Identity Mediation** — probabilistic cross-country patient
  matching to support refugee / migrant continuity of care, where legally
  permitted by participating ministries.
- **Terminology & Profile Registry** — distributes shared FHIR profiles,
  concept maps, and code-system versions to country nodes so they speak the
  same clinical language.
- **Regional Analytics Exchange** — approved indicators for regional disease
  programs (polio, TB, HIV, malaria). Aggregates-only; no PHI.
- **Governance + Audit** — who agreed to exchange what, when, and under which
  data-sharing agreement.

## Realistic path to ship

The prerequisite is not written yet either: `country-node/` is also a design
stake, so today there are zero country nodes and the facility platform is
standing in for the national layer itself. In order:

1. Two country nodes stable and exchanging data with their facility nodes.
2. A bilateral data-sharing MOU between two country ministries.
3. Terminology registry stood up first (lowest political risk, highest
   interoperability value).
4. Regional referral packet exchange added next (real patient benefit, scoped
   to consenting patients crossing a specific border).
5. Regional MPI last (hardest politically — cross-country identity linkage).

## Architecture principles (intended)

- **Minimum-data**: the regional layer stores only referral metadata + shared
  reference data. PHI flows through it but is not stored beyond a short
  transit window.
- **Federated governance**: each country's ministry retains authority over its
  nationals' data and its own DHIS2 reporting. Regional services do not
  replace national systems.
- **Explicit consent**: patients traveling with their records must consent to
  cross-border data flow; the Bundle header records the consent token.
- **Standards-based**: everything over FHIR R4; no private formats.

## Terminology registry (the first thing to build, when the time comes)

The lowest-risk, highest-value first shipment. A read-only registry serving:

- `GET /registry/profiles` — list of FHIR profiles supported across the region
- `GET /registry/codesystems/<system>` — shared code systems (e.g. regional
  LOINC subset, regional ICD-11 mappings)
- `GET /registry/valuesets/<id>` — regional value sets for common forms

Country nodes would cache these and fall back to country-local definitions when
the regional registry is unreachable, keeping offline-first semantics intact.

## When to build this

After two country nodes are in stable production. The regional layer only adds
value once there is actual cross-country traffic to route. Premature regional
infrastructure was the most common failure mode in earlier African
inter-country health IT initiatives.
