# Launch the public demo on tamamhealth.org

Goal: get the demo live at **app.tamamhealth.org** (platform) and
**tamamhealth.org** (marketing site), syncing to **couch.tamamhealth.org**.

Because this is a **public demo with no real patient data**, the South Sudan
in-country hosting rule does **not** apply yet — use any mainstream cloud VPS to
go live fast. (Switch to an in-country/MoH host before any real PHI / production.)

`DEMO_MODE` is set to `true`, so the demo seeds sample patients/users to explore.

---

## Step 1 — Create a server (≈10 min, needs your card)

Pick one (Ubuntu **22.04 LTS**, any region is fine for a demo):

| Provider | Plan | ~Cost | Notes |
|---|---|---|---|
| **Hetzner Cloud** | CPX21 (3 vCPU / 4 GB) or CX32 (4 vCPU / 8 GB) | ~€5–8/mo | Cheapest, excellent perf |
| **DigitalOcean** | Basic Droplet 4 GB / 2 vCPU | ~$24/mo | Simplest UI |
| **Vultr / Linode** | 4 GB plan | ~$20/mo | Fine alternatives |

Create it, add your SSH key, and **copy the public IP** (e.g. `203.0.113.10`).
4 GB RAM is comfortable for a demo; 8 GB if you want headroom.

## Step 2 — Point GoDaddy DNS at it (≈5 min)

In GoDaddy: **My Products → tamamhealth.org → DNS → Records**. Add three **A**
records (delete any existing parked/forwarding "@" record first):

| Type | Name (Host) | Value | TTL |
|---|---|---|---|
| A | `@`    | your server IP | 1 hour |
| A | `app`  | your server IP | 1 hour |
| A | `couch`| your server IP | 1 hour |

Save. DNS can take 5–60 min to propagate. Check with:
`dig +short app.tamamhealth.org` (should return your IP).

## Step 3 — Deploy on the server (≈15 min, mostly waiting on the build)

SSH in as root (or sudo) and run:

```bash
# 1. Get the code
git clone <YOUR-REPO-URL> /opt/tamamhealth && cd /opt/tamamhealth

# 2. Generate all secrets automatically
./scripts/gen-secrets.sh

# 2b. website/.env.production has no .example template, so gen-secrets.sh
# silently skips it — deploy.sh still requires the file to exist. The
# website container reads no secrets from it today, so an empty file works:
touch website/.env.production

# 3. Set the demo's non-secret values (domain + demo mode)
sed -i 's/REPLACE-DOMAIN/tamamhealth.org/g' platform/.env.production website/.env.production
sed -i 's#^NEXT_PUBLIC_COUCHDB_URL=.*#NEXT_PUBLIC_COUCHDB_URL=https://couch.tamamhealth.org#' platform/.env.production
sed -i 's#^NEXT_PUBLIC_DEMO_MODE=.*#NEXT_PUBLIC_DEMO_MODE=true#'  platform/.env.production
grep -q '^NEXT_PUBLIC_APP_URL=' platform/.env.production \
  || echo 'NEXT_PUBLIC_APP_URL=https://app.tamamhealth.org' >> platform/.env.production

# 4. Sanity check, then one-shot deploy (installs Docker + Caddy + TLS, builds, starts)
./scripts/preflight.sh
sudo bash deploy.sh            # defaults already target tamamhealth.org
```

`deploy.sh` provisions HTTPS automatically via Caddy + Let's Encrypt for all
three names. First build takes a few minutes.

## Step 4 — Verify

- Visit **https://app.tamamhealth.org** → the platform loads with the demo login.
- Visit **https://tamamhealth.org** → the marketing site.
- Log in as a demo user and run a visit (register → triage → consult → lab/pharmacy).

---

## When you later go to real production (with real PHI)

1. Provision an **in-country / MoH-approved** server, LUKS-encrypt the data disk.
2. On it, set `NEXT_PUBLIC_DEMO_MODE=false` (clean slate — admin + org only).
3. Follow the full hardening runbook in `docs/DEPLOYMENT-AND-ROLLOUT.md`
   (encryption, firewall, offsite encrypted backups, restore drill).
4. Don't migrate demo data; start clean and onboard the real facility.

---

### What I need from you to finish wiring
Once the server exists, tell me the **public IP** and your **git remote URL**,
and I'll tailor the exact commands (and double-check the GoDaddy records).
