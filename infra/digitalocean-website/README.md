# TamamHealth website — DigitalOcean

> **⚠️ The committed state does not match live infrastructure. Do not run
> `terraform apply` until it is reconciled.**
>
> This state records a droplet at `167.71.33.194` with reserved IP
> `129.212.252.214`. Neither exists. The site is served by droplet
> `tamamhealth-website` (`165.22.26.170`) behind reserved IP
> `134.199.191.56`, created outside this state. An `apply` today would plan
> against resources that are gone and could act on live infrastructure.
>
> To reconcile (needs `TF_VAR_do_token`):
> ```bash
> terraform state rm digitalocean_droplet.website digitalocean_reserved_ip.website
> terraform import digitalocean_droplet.website <droplet-id>      # doctl compute droplet list
> terraform import digitalocean_reserved_ip.website 134.199.191.56
> terraform plan   # must be a no-op before anyone applies
> ```
> The provisioned SSH key (`tamamhealth-website-admin`,
> `bc:8e:43:e7:64:2e:86:94:8a:a0:2b:d1:64:52:cb:3e`) is **not** in the live
> droplet's `authorized_keys` — it was replaced without it, which is why
> deploys currently need the DO console or the API-reboot path.

Terraform for the marketing website (`website/`) only — not the full
platform stack. Provisions:

- A Droplet (Ubuntu 22.04) running the website container behind Caddy
  (automatic Let's Encrypt TLS).
- A Cloud Firewall (22/80/443 only).
- A Reserved IP (stable — survives droplet rebuilds).
- A DigitalOcean Container Registry (`starter` tier, free) to hold the
  built website image.

See `docs/DEPLOY-DIGITALOCEAN.md` at the repo root for the equivalent
full-stack (platform + website + CouchDB) playbook this was adapted from.

## Usage

```bash
export TF_VAR_do_token="dop_v1_..."   # never commit this

terraform init
terraform apply
```

### Shipping a new version of the site

**Use the pipeline, not your laptop.** Run the **deploy-website** workflow
(Actions → deploy-website → Run workflow). It builds the same image CI builds
and pushes it to this registry, gated on the `production` environment.

Pick a `restart` mode when you run it:

| Mode | What it does | Needs |
|---|---|---|
| `ssh` | restarts `website.service` and verifies the live site | `WEBSITE_SSH_HOST` / `_USER` / `_KEY` in the production environment |
| `reboot` | reboots the droplet via the DO API (~40s downtime); the unit pulls on boot | nothing extra |
| `none` | publishes the image only | — |

A push alone does **not** update a running droplet: `Restart=always` only fires
when the process exits, so the container keeps its old image until the service
restarts. (The unit does re-pull on start — that is why a reboot works.)

`NEXT_PUBLIC_PLATFORM_URL` is inlined into the client bundle at build time and
is what every login link on the site redirects through, so it is passed as a
build arg. It cannot be corrected at runtime.

<details>
<summary>Manual push (only if the pipeline is unavailable)</summary>

```bash
doctl registry login
docker build --build-arg NEXT_PUBLIC_PLATFORM_URL=https://app.tamamhealth.org \
  -t $(terraform output -raw registry_endpoint) ../../website
docker push $(terraform output -raw registry_endpoint)
```
Then restart the droplet's service, or the running container keeps the old image.
</details>

Then point GoDaddy DNS at the reserved IP:

| Type | Name | Value |
|---|---|---|
| A | `@` | `terraform output -raw reserved_ip` |
| A | `www` | `terraform output -raw reserved_ip` |

## Known tradeoff

The DO API token is embedded in the droplet's cloud-init user-data to
authenticate `docker login` to the registry. It's only visible to someone
with API/console access to this same DO account, but a production hardening
step would be to swap it for a registry-scoped read-only token instead of
the full read+write token Terraform itself needs.
