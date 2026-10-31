# Hosting & Rollout Strategy — Scaling TamamHealth across Africa

> **Current production:** DigitalOcean (the `tamamhealth-production` droplet,
> deployed by `deploy-production.yml`; backups to DigitalOcean Spaces). DigitalOcean
> has no Africa region, so this document is the sovereignty roadmap for where
> country nodes should live as deployments move in-country; it is not a second
> deploy target.

A practical, opinionated guide for how to host and grow the platform from one
demo to a multi-country deployment, written against how the system is actually
built (offline-first facility nodes → in-country country node → regional
exchange, with DHIS2 and org-scoped multi-tenancy already in place).

---

## The one rule that shapes everything: data stays sovereign

Health data is the most regulated data there is, and most African countries now
have data-protection laws (Nigeria NDPA, Kenya DPA 2019, South Africa POPIA,
Ghana DPA, Rwanda, Uganda, etc.) that restrict moving patient data across
borders. **So the model is: one country node per country, hosted in or near that
country — never one global database holding everyone's PHI.**

The codebase is already designed for this: facilities run offline-first in the
browser, sync to a **country node**, and a **regional exchange** layer handles
the few things that legitimately cross borders (referrals, disease surveillance).
Lean into that; don't centralise.

```
Facility (browser, offline-first)  ─►  Country node (per country, in-region)  ─►  Regional exchange (cross-border only)
   keeps working with no network        all of that country's PHI lives here       referrals, outbreak signals, anonymised stats
```

---

## What to do now vs. as you grow

### Phase 0 — Demo (this week)
- One cheap cloud VPS (Hetzner/DigitalOcean), `DEMO_MODE=true`, no real PHI, so
  residency doesn't apply. This is for showing ministries and partners.
- Goal: a link people can click — `app.tamamhealth.org`.

### Phase 1 — First country pilot (1 country, 3–10 facilities)
- Stand up **one country node** hosted **in-country or in-region** with
  `DEMO_MODE=false` (clean slate), LUKS-encrypted disk, offsite encrypted backups.
- Recommended hosting, in order of preference:
  1. **Government / MoH data centre** in-country — best for sovereignty and buy-in.
  2. **In-region cloud** — a reputable provider with an African region, or a
     national cloud provider.
  3. **Local hosting/ISP** with a UPS + good uplink, if the above aren't available.
- Sign a data-processing/hosting agreement with the MoH or facility group.
- Wire **DHIS2** (already built) so national reporting flows automatically — this
  is usually what wins ministry support.

### Phase 2 — National scale (one country, many facilities)
- Same single country node, scaled up (more CPU/RAM/disk), Postgres analytics
  turned on, sync-worker running.
- Facilities need **no servers** — just browsers/tablets. Onboard by creating the
  facility + users; everything else is offline-first.
- Add read replicas / bigger box as sync volume grows; CouchDB handles batched
  sync well.

### Phase 3 — Multi-country (pan-African)
- **Repeat the country-node pattern per country** — Kenya's data in Kenya,
  Nigeria's in Nigeria, etc. Each is independent and keeps working alone.
- Stand up the **regional exchange** only for cross-border needs (a patient
  referred from Juba to Nairobi, regional outbreak signals) — and share
  **minimum necessary / anonymised** data across it, governed by agreements.
- One codebase, many sovereign deployments. `orgId` scoping already isolates
  tenants within a node; country nodes isolate across borders.

---

## Recommended hosting model (the decision)

**Single-tenant, per-country nodes — offered as a managed deployment.** Not one
multi-tenant global SaaS holding all PHI.

| Option | Verdict | Why |
|---|---|---|
| One global cloud DB for all countries | ✗ Avoid | Illegal/insecure under most African DPAs; single point of failure |
| **Per-country node, in/near country (managed by you or MoH)** | ✓ **Recommended** | Sovereign, matches the architecture, fault-isolated, ministry-friendly |
| Per-facility servers | ✗ Overkill | Facilities can't run/maintain servers; offline-first browser already covers outages |

Business model that fits this: **you operate per-country managed nodes** (or hand
the node to each MoH) and charge per country/per facility — a repeatable unit.

---

## Best use-cases — where it delivers value first

Lead with settings where **offline-first + simple workflows** matter most:

1. **District / county hospitals and health centres** with intermittent power and
   connectivity — the offline-first design is the killer feature here.
2. **Primary health care units (PHCUs) and clinics** doing OPD, ANC, immunization,
   malaria/TB — high volume, paper-based today, quick wins.
3. **Maternal & child health programs** — ANC visits, births, immunization
   tracking map directly to what's already built and to donor/MoH priorities.
4. **Disease surveillance / outbreak reporting** — the DHIS2 + disease-alert
   pipeline turns routine visits into national signal with no extra work.
5. **Pharmacy & controlled-substance stewardship** — the stock gate + witnessed
   controlled-substance log is a real compliance differentiator.
6. **Referral networks** — the referral + transfer-package flow shines across a
   district, and is the seed for the regional exchange later.

Start narrow: one country, a handful of facilities, the OPD→lab→pharmacy loop +
ANC/immunization + DHIS2 reporting. Expand workflows once that's sticky.

---

## Non-negotiables as you scale (so you don't get burned)

- **Encryption everywhere:** LUKS at rest on every node, TLS in transit (Caddy
  auto-handles it).
- **Backups + tested restores per node**, shipped offsite **within the same
  jurisdiction** (don't back up Kenya's data to a box in another country).
- **RBAC + audit logs** (built) on by default; least-privilege user roles.
- **Ministry partnership + DPA** before real PHI in each country — this is a
  relationship/legal step, not a technical one, and it's what unlocks scale.
- **Keep facilities zero-maintenance** — browsers/tablets only; all ops live on
  the country node you control.
- **One codebase, versioned releases** — never fork per country; configure via
  env + org settings.

---

## Concrete next 5 moves

1. Launch the demo on a VPS (see `docs/DEMO-LAUNCH-tamamhealth-org.md`).
2. Pick the **first pilot country** and line up an MoH/facility-group sponsor.
3. Choose that country's node hosting (MoH data centre → in-region cloud → local).
4. Run the production hardening runbook (`docs/DEPLOYMENT-AND-ROLLOUT.md`) for that node.
5. Wire DHIS2 for that country and onboard the first 3 facilities; measure, then expand.

---

_See also: `docs/DEPLOYMENT-AND-ROLLOUT.md` (full runbook), `docs/MANUAL-SETUP-CHECKLIST.md`
(what only you do), `country-node/` and `regional-exchange/` (the federation tiers)._
