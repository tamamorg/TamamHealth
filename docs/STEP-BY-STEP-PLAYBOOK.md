# Step-by-Step Playbook — from domain to live (and to a country node)

Written to be followed literally. Each step says **what to do**, **the exact
command/clicks**, and **what you should see**. No prior server experience assumed.

- **Part A** — launch the public demo on `tamamhealth.org` (no real patient data).
- **Part B** — stand up the first real **country production node** (real PHI).
- **Part C** — add another country.

Conventions: lines starting with `$` are typed on **your laptop**; lines
starting with `#` are typed on the **server** (after you SSH in). Replace
`<…>` placeholders.

---

# Part A — Launch the public demo

### Step A0 — Accounts you'll need (15 min)
Create these (free to start):
1. **GitHub** account (to hold the code) — github.com.
2. A **cloud server** account — Hetzner (hetzner.com/cloud, cheapest) or
   DigitalOcean (digitalocean.com).
3. You already have **GoDaddy** + `tamamhealth.org`. Good.

---

### Step A1 — Put the code on GitHub (one-time, 10 min)
The server downloads the code from GitHub, so it must live there first.

1. On github.com → top-right **+** → **New repository**.
   - Name: `tamamhealth` · Visibility: **Private** · don't add a README.
   - Click **Create repository**. Copy the URL it shows
     (e.g. `https://github.com/<you>/tamamhealth.git`).
2. On your laptop, in the project folder:
   ```
   $ cd /path/to/TamamHealth
   $ git init            # skip if it's already a git repo
   $ git add -A
   $ git commit -m "Initial deploy"
   $ git branch -M main
   $ git remote add origin https://github.com/<you>/tamamhealth.git
   $ git push -u origin main
   ```
   **You should see** the files appear on the GitHub repo page after refresh.
   (Your `.env` files are gitignored, so secrets are NOT uploaded — that's correct.)

---

### Step A2 — Create the server (10 min)
**Hetzner Cloud** (recommended):
1. Log in → **+ New Project** → name it `tamamhealth`.
2. **Add Server**.
   - Location: any (e.g. Falkenstein/Nuremberg) — fine for a demo.
   - Image: **Ubuntu 22.04**.
   - Type: **CPX21** (3 vCPU / 4 GB) is plenty for a demo.
   - **SSH key**: click *Add SSH Key*. If you don't have one:
     ```
     $ ssh-keygen -t ed25519 -C "tamamhealth"      # press Enter to all prompts
     $ cat ~/.ssh/id_ed25519.pub                    # copy this whole line
     ```
     Paste that public key into Hetzner.
   - Name: `tamamhealth-demo` → **Create & Buy now**.
3. **Copy the server's public IPv4** (e.g. `203.0.113.10`).

---

### Step A3 — Point GoDaddy DNS at the server (5 min)
1. GoDaddy → **My Products** → next to `tamamhealth.org` click **DNS**
   (or *Manage DNS*).
2. Under **Records**, delete any default **A record** named `@` that points to a
   GoDaddy "parked" IP (and any "Forwarding").
3. **Add** three records (labels may read slightly differently in GoDaddy):

   | Type | Name | Value (Points to) | TTL |
   |---|---|---|---|
   | A | `@` | `<your server IP>` | 1 Hour |
   | A | `app` | `<your server IP>` | 1 Hour |
   | A | `couch` | `<your server IP>` | 1 Hour |

4. **Save.** Wait 5–30 min. Check from your laptop:
   ```
   $ dig +short app.tamamhealth.org      # should print your server IP
   ```
   (No `dig`? Use https://dnschecker.org and search `app.tamamhealth.org`.)

---

### Step A4 — Connect to the server (2 min)
```
$ ssh root@<your server IP>
```
First time it asks to trust the host → type `yes`. **You should see** a prompt
like `root@tamamhealth-demo:~#`. Everything with `#` below is typed here.

---

### Step A5 — Deploy (15 min, mostly the build)
```
# 1. Install git and clone your code
# apt-get update -y && apt-get install -y git
# git clone https://github.com/<you>/tamamhealth.git /opt/tamamhealth
# cd /opt/tamamhealth
```
GitHub will ask for your username + a **personal access token** (not your
password) for a private repo: GitHub → Settings → Developer settings → Personal
access tokens → *Fine-grained* → give it read access to this repo → use it as the
password.

```
# 2. Generate all secrets automatically
# ./scripts/gen-secrets.sh

# 2b. website/.env.production has no .example template in the repo, so
# gen-secrets.sh silently skips creating it — but deploy.sh below still
# requires the file to exist. The website container reads no secrets from
# it today, so an empty file is enough:
# touch website/.env.production

# 3. Set the demo's non-secret values (domain + demo mode)
# sed -i 's/REPLACE-DOMAIN/tamamhealth.org/g' platform/.env.production website/.env.production
# sed -i 's#^NEXT_PUBLIC_COUCHDB_URL=.*#NEXT_PUBLIC_COUCHDB_URL=https://couch.tamamhealth.org#' platform/.env.production
# sed -i 's#^NEXT_PUBLIC_DEMO_MODE=.*#NEXT_PUBLIC_DEMO_MODE=true#' platform/.env.production
# grep -q '^NEXT_PUBLIC_APP_URL=' platform/.env.production || echo 'NEXT_PUBLIC_APP_URL=https://app.tamamhealth.org' >> platform/.env.production

# 3b. Bootstrap login for the seeded `superadmin` account — not in the
# .example template, and required (even in demo mode) because this template
# ships with NEXT_PUBLIC_SYNC_ENABLED=true:
# grep -q '^SUPERADMIN_INITIAL_PASSWORD=' platform/.env.production || echo "SUPERADMIN_INITIAL_PASSWORD=$(openssl rand -base64 24 | tr -d '\n/+=')" >> platform/.env.production

# 4. One-shot deploy: installs Docker + Caddy, issues HTTPS, builds, starts
# sudo bash deploy.sh
```
`deploy.sh` already targets `tamamhealth.org`. **You should see** it install
Docker + Caddy, write a Caddyfile, build the images (a few minutes), then a
success banner with the admin login info.

---

### Step A6 — Verify it's live (2 min)
- Open **https://app.tamamhealth.org** → the platform loads with a padlock (TLS).
- Open **https://tamamhealth.org** → the marketing site.
- Log in with a demo account and run one visit: register → triage → consult →
  order labs / send to pharmacy → dispense → checkout.

**Send me the server IP + your GitHub repo URL and I'll sanity-check everything.**

---

### Step A7 — If something's wrong
```
# docker compose ps                 # are services "healthy"?
# docker compose logs -f platform   # platform errors (Ctrl-C to exit)
# systemctl status caddy            # TLS/proxy status
```
- **TLS not issuing?** DNS probably hasn't propagated — re-check Step A3, wait,
  then `# systemctl reload caddy`.
- **"Missing .env" error from deploy.sh?** You skipped Step A5.2 (gen-secrets).
- **"Missing .../website/.env.production" error from deploy.sh?** Expected —
  see Step A5.2b. `gen-secrets.sh` has no template to generate that file from,
  so create it yourself: `# touch website/.env.production`.
- **Build out of memory?** Use a 4 GB+ server (CPX21 or bigger).

---

# Part B — First country production node (real patient data)

Do this only when you have a pilot facility/ministry. The difference from the
demo: **PHI is real**, so it must be hosted in/near the country, encrypted, and
`DEMO_MODE=false`.

### Step B1 — Line up the sponsor + agreement (people, not code)
1. Identify the **pilot country** and a sponsor (a hospital group or the MoH).
2. Sign a simple **data-hosting / data-processing agreement** naming where data
   lives and who controls it. This is the gate to touching real PHI.

### Step B2 — Choose hosting (in this order)
1. MoH / government data centre in-country (best).
2. In-region cloud: **AWS Cape Town (`af-south-1`)** or Azure South Africa.
3. Reputable local host with a UPS + good uplink.
Provision **Ubuntu 22.04**, ≥ 4 vCPU / 16 GB / 100 GB, with a public IP and a
domain/subdomain for that country (e.g. `ss.tamamhealth.org` or a national domain).

### Step B3 — Encrypt the data disk FIRST (before any data)
On the server, with a second disk (e.g. `/dev/sdb`):
```
# apt-get update -y && apt-get install -y cryptsetup
# cryptsetup luksFormat /dev/sdb                 # type YES, set a strong passphrase
# cryptsetup open /dev/sdb cryptdata
# mkfs.ext4 /dev/mapper/cryptdata
# mkdir -p /opt/tamamhealth-data && mount /dev/mapper/cryptdata /opt/tamamhealth-data
```
Store the passphrase in a password manager **and** escrow a copy securely
off-server. (This protects PHI if the disk is ever stolen.)

### Step B4 — Firewall
```
# ufw default deny incoming
# ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
# ufw enable
```
CouchDB/Postgres stay private (bound to localhost by compose) — never open 5984/5432.

### Step B5 — Code + secrets, production mode
```
# apt-get install -y git
# git clone https://github.com/<you>/tamamhealth.git /opt/tamamhealth
# cd /opt/tamamhealth
# ./scripts/gen-secrets.sh
# touch website/.env.production   # no .example template ships for this file — see Step A5.2b
# sed -i 's/REPLACE-DOMAIN/<your-country-domain>/g' platform/.env.production website/.env.production
# sed -i 's#^NEXT_PUBLIC_COUCHDB_URL=.*#NEXT_PUBLIC_COUCHDB_URL=https://couch.<your-country-domain>#' platform/.env.production
# sed -i 's#^NEXT_PUBLIC_DEMO_MODE=.*#NEXT_PUBLIC_DEMO_MODE=false#' platform/.env.production   # CLEAN SLATE
# grep -q '^NEXT_PUBLIC_APP_URL=' platform/.env.production || echo 'NEXT_PUBLIC_APP_URL=https://app.<your-country-domain>' >> platform/.env.production

# Bootstrap login credential. Not in the .example template — the platform
# refuses to boot without it once sync is enabled (real value, 16+ chars,
# not the demo default "Superadmin!"):
# echo "SUPERADMIN_INITIAL_PASSWORD=$(openssl rand -base64 24 | tr -d '\n/+=')" >> platform/.env.production
```
Point Docker's data at the encrypted mount (so PHI lands on the encrypted disk):
```
# mkdir -p /etc/docker && printf '{ "data-root": "/opt/tamamhealth-data/docker" }\n' > /etc/docker/daemon.json
```
(If Docker is already installed, `# systemctl restart docker` after this.)

### Step B6 — DNS + deploy
Add the same three A records for the country domain in your DNS host, then:
```
# ./scripts/preflight.sh
# sudo bash deploy.sh
```

### Step B7 — First login & facility setup (in the app)
1. Open `https://app.<your-country-domain>`, log in as `superadmin` with
   `SUPERADMIN_INITIAL_PASSWORD` from `platform/.env.production` — this is
   the actual bootstrap account (the login page's old demo role chips and
   `/api/demo-credentials` are gone). Set this value **yourself** before Step
   B6's deploy: it isn't in `platform/.env.production.example`, and the
   platform refuses to boot without it once `NEXT_PUBLIC_SYNC_ENABLED=true`.
2. **Immediately change that password** in the UI.
3. Create the **hospital/facility** record, then a **facility administrator**.
4. The facility admin creates real users by role (front desk, nurse, clinical
   officer, lab tech, pharmacist, cashier…) — see `docs/RBAC-MATRIX.md`.

### Step B8 — Backups + tested restore (do before real patients)
1. The stack runs a nightly CouchDB dump to a volume. Ship it offsite **within
   the same country** (encrypted) — set up an `rclone`/`rsync` cron, see
   `docs/operations/backups.md`.
2. Prove a restore works:
   ```
   # ./scripts/backup-restore-drill.sh
   ```

### Step B9 — Wire DHIS2 (national reporting — wins ministry buy-in)
Provide the country's DHIS2 URL + credentials and org-unit mappings; configure
the DHIS2 export (see the DHIS2 settings in the app / `country-node/`). This makes
routine visits flow into national reporting automatically.

### Step B10 — Onboard facilities & train
Per facility: create it + its users, hand them the URL (browser/tablet, no
install), and train by role following the live flow (register → triage →
consult → lab/pharmacy → checkout). Start with 3 facilities, measure, expand.

---

# Part C — Add another country
Repeat **Part B** on a separate node in/near that country (its own domain, its
own encrypted disk, its own backups). Each country node is independent and keeps
working alone. Only stand up the **regional exchange** (`regional-exchange/`)
when you need cross-border referrals or outbreak signals, sharing minimum /
anonymised data under an agreement.

---

### Where things live
- Secrets generator: `scripts/gen-secrets.sh` · preflight: `scripts/preflight.sh`
- One-shot deploy: `deploy.sh` · stack: `docker-compose.yml`
- Full runbook: `docs/DEPLOYMENT-AND-ROLLOUT.md` · only-you list: `docs/MANUAL-SETUP-CHECKLIST.md`
- Strategy: `docs/AFRICA-HOSTING-STRATEGY.md` · roles: `docs/RBAC-MATRIX.md`
