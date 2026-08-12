# TamamHealth production service boundaries

## Deployment model

TamamHealth uses a staged microservices architecture. Clinical transactions
remain in one application boundary so appointment, triage, nursing, MAR, and
doctor-chart updates cannot partially commit across network services.

```text
Browser / facility PouchDB
          |
          +---- HTTPS ----> Vercel: Next.js clinical application and API
          |                       |
          |                       +---- Upstash Redis: shared security state
          |                       +---- Managed PostgreSQL: optional analytics
          |
          +---- HTTPS ----> DigitalOcean Caddy
                                  |
                                  +---- CouchDB: durable clinical records
                                  +---- backup sidecar: verified local dumps
                                  +---- sync worker: signed analytics events
```

## Ownership boundaries

| Service                      | Owns               | Must not own |
|------------------------------|---------------------------------------|---|
| Vercel clinical application  | Authentication, authorization, workflows, APIs | Durable local files |
| CouchDB                      | Patient charts, appointments, triage, MAR, audit documents | Public TLS termination |
| Caddy                        | TLS and narrow reverse proxy to CouchDB | Clinical credentials |
| Upstash Redis                | Rate limits and JWT revocation | Patient records |
| Sync worker                  | CouchDB checkpoints and signed delivery | Source clinical truth |
| Managed PostgreSQL           | Reporting projections | Authoritative clinical records |
| Backup service               | Encrypted, restorable snapshots | Application traffic |

## DigitalOcean data-plane deployment

Use `docker-compose.data.yml`; do not run the platform or website containers on
the data Droplet when the application is hosted by Vercel.

```bash
cd /opt/tamamhealth
cp infra/digitalocean/data-plane.env.example .env.data
# Fill secrets and set RELEASE_ID to `git rev-parse --short=12 HEAD`, then:
docker compose --env-file .env.data -f docker-compose.data.yml config --quiet
docker compose --env-file .env.data -f docker-compose.data.yml up -d couchdb couchdb-backup caddy
```

Enable analytics only after Vercel has a reachable TLS PostgreSQL
`DATABASE_URL` and `/api/sync` passes its smoke test:

```bash
docker compose --env-file .env.data -f docker-compose.data.yml --profile analytics up -d sync-worker
```

## Network policy

- Public inbound: TCP 80/443 to Caddy only.
- Administrative inbound: TCP 22 from named administrator IPs only.
- CouchDB 5984 binds to `127.0.0.1`; never expose it directly.
- PostgreSQL must require TLS and must not be a public Docker port.
- `PLATFORM_SYNC_URL` must be HTTPS and batches must use the shared HMAC secret.
- Worker CouchDB credentials are passed as separate secrets, never embedded in
  a URL, so special characters cannot corrupt parsing or appear in URL logs.
- Every machine request is signed over timestamp, nonce, HTTP method, path, and
  body. Vercel stores each nonce in shared Redis for ten minutes and rejects
  stale or repeated requests.
- Worker and backup images are built with a tag equal to the deployed Git commit,
  avoiding mutable `latest`/`production` tags.

## Release and rollback

Deploy order: CouchDB/TLS, Vercel application, then optional sync worker. The
worker is a projection service and can be stopped without blocking clinical
care. Never roll CouchDB data backward as an application rollback.

Rollback triggers:

- `/api/health` reports CouchDB unavailable.
- Login, appointment assignment, triage, chart hand-off, or MAR smoke tests fail.
- Cross-organization access is observed.
- Sync worker reports repeated dead-letter events.
- Backup verification or restore drill fails before accepting real PHI.
