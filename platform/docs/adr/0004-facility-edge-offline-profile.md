# ADR-0004: Explicit facility-edge offline profile

**Status:** Accepted  
**Date:** 2026-08-26

## Context

A prepared browser can continue independently when connectivity disappears,
but it cannot share new records with other workstations or execute server-backed
workflows. Calling both states “offline ready” overstated the guarantee. Dynamic
patient routes, at-rest protection and relationship-level transfer authorization
also required separate controls.

## Decision

TamamHealth supports two explicit profiles:

- `device`: cached application shell, local PouchDB and local sign-in on one
  prepared browser.
- `facility-edge`: the platform, CouchDB and a TLS reverse proxy run on the
  facility LAN. Browsers replicate through the authenticated same-origin
  gateway into database-per-organization storage.

Facility-edge mode fails production boot unless synchronization, tenant
databases, the gateway, patient workspace caching, gateway relationship checks,
the facility URL and disk-encryption attestation are enabled. Settings reports
the live edge database health and each control independently.

Dynamic patient chart documents already present and authorized on a device are
included in its offline pack up to a configured bound. Patient-transfer writes
are checked against the related patient and previous transfer at the gateway.

## Consequences

- Same-facility devices share records without external internet.
- Local password changes, provisioning and other server-backed workflows remain
  available because their application server is on the LAN.
- Third-party services and cross-facility exchange still require a reachable
  upstream; configuration cannot emulate an absent remote organization.
- Operators must enable full-disk encryption and trust the facility Caddy root
  certificate on managed devices. The web application can attest configuration
  but cannot change firmware, operating-system encryption or device trust.

## Operations

Copy `facility-edge.env.example`, provision trusted LAN DNS and encrypted host
storage, then start:

```sh
docker compose --env-file .env.facility-edge \
  -f docker-compose.yml -f docker-compose.facility-edge.yml up -d --build
```

Install the Caddy local root certificate from the `facility_caddy_data` volume
into every managed device trust store, and verify Settings reports **Facility
ready** before relying on the node during an outage.

For example, export the certificate after the first start with:

```sh
docker cp tamamhealth-facility-gateway:/data/caddy/pki/authorities/local/root.crt ./tamamhealth-facility-root.crt
```

Distribute that certificate through the facility's managed-device policy; do
not ask staff to bypass a browser certificate warning.
