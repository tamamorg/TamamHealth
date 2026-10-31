# TamamHealth Country Node

> **Status: design stake — there is no service here yet.** This directory holds
> this README and an empty `src/`. Nothing builds, runs, or deploys from it.
> It exists so the national layer has an agreed shape and a home for the day a
> ministry or partner org commits to hosting one. Everything below the next
> section is **planned**, not implemented.

The national layer in the federated EHR architecture: the receiver for the
facility nodes (hospitals, clinics, PHCUs) inside a country's jurisdiction, and
the country's interoperability and governance runtime. It does not replace the
facility node's clinical runtime — clinicians keep working locally even when the
country node is unreachable.

## What exists today, on the facility side

The facility platform is already built to talk to a country node, and stands in
for one until it exists:

- **Outbox.** `platform/src/lib/services/sync-event-service.ts` writes a
  `sync_event` for clinical mutations into `tamamhealth_sync_events`, with a
  `pending` / `synced` status, and exposes stats for the admin sync views
  (`/admin/sync`, `/admin/interop`).
- **Push.** `pushPendingToCountryNode()` POSTs `{ events: SyncEventDoc[] }` to
  `SYNC_PUSH_URL`, optionally signed with an `X-Sync-Secret` header from
  `SYNC_PUSH_SECRET`, and marks acknowledged events synced from the response's
  `acceptedIds`. **With `SYNC_PUSH_URL` unset it is a no-op** — the facility
  works fully offline and the admin UI says the country node is not configured.
- **Metadata stand-in.** `platform/src/app/api/country/metadata/route.ts` serves
  `GET /api/country/metadata?country=SS` (facility levels, referral network,
  states, DHIS2 period type, terminologies) from the facility itself. This
  endpoint is what the country node's `/metadata` would eventually replace.
- **Downstream pieces the country layer would take over** already have facility
  implementations to port or reuse: the DHIS2 exporter
  (`platform/src/lib/services/dhis2-export-service.ts`), the FHIR read APIs
  under `platform/src/app/api/fhir/`, and the `conflict_queue` documents behind
  `/admin/conflicts`.

So the first country node can be built against a live, already-emitting
facility: point `SYNC_PUSH_URL` at its `/ingest/events` and the outbox starts
draining.

## Planned architecture

```
platform (facility node)                  country-node
─────────────────────────                 ─────────────────
sync_events outbox         ───►           /ingest/events (receive push)
                                          canonical store (PostgreSQL)
                                          DHIS2 adapter → ministry DHIS2
                                          /metadata     (serve to facilities)
                                          /fhir/*       (national FHIR API)
                                          /analytics    (ministry dashboard)
```

Planned responsibilities: national ingestion API, a canonical clinical store
partitioned by country, a DHIS2 adapter with country-specific mappings/periods/
org units, a national metadata service facilities fetch and cache, national
analytics for ministry and partner users, and reconciliation plus profile /
version distribution back to facilities.

## Planned stack

Nothing is chosen or committed. The spec calls for **FastAPI (Python 3.12)** or
**Spring Boot (Java 21)** for the ingestion and query APIs, since both are
common in African ministry IT environments; **PostgreSQL 16** as the canonical
store with per-country schemas; Celery/RQ or scheduled workers for DHIS2 push,
backup and reconciliation; and Kafka or CouchDB `_changes` as the ingestion
backbone.

## First milestones

1. `/ingest/events` — accept the facility's `sync_events` batches, validate the
   shared secret and the country's allowed resource types, write to Postgres,
   and return `acceptedIds` so the facility can mark them synced.
2. `/metadata` — serve the country profile currently stubbed at the facility's
   `/api/country/metadata`.
3. DHIS2 scheduled push — `dataValueSets` submission, reusing the facility
   exporter's logic.
4. National FHIR read API for aggregate queries, ported from the facility
   prototype.
5. Reconciliation push-back — country-detected identifier collisions returned to
   the facility's `conflict_queue`.

## Why this is its own service

- **Sovereignty**: ministries require country-owned data perimeters; a shared
  regional transactional DB is politically and legally infeasible.
- **Resilience**: facility nodes must continue serving care during country-node
  outages; separate services make the failure domain explicit.
- **Scaling**: national aggregate analytics has a very different load profile
  from point-of-care write traffic; separating them lets each layer scale
  independently.

---

When building this out, start with `/ingest/events` and a minimal Postgres
schema mirroring the facility's `platform/src/lib/db-types.ts`.
