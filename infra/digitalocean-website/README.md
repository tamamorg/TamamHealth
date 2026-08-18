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
- A DigitalOcean Container Registry (`starter` tier, free). **No longer in
  the delivery path** — see "Shipping a new version" below. Kept only because
  destroying it is a separate decision.

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
(Actions → deploy-website → Run workflow), gated on the `production`
environment. It builds the image, publishes it to
`ghcr.io/tamamorg/tamamhealth-website` as the record of what shipped, and
copies it to the droplet over SSH — `docker save` piped into `docker load`.

The droplet does **not** pull. `website.service` runs the local tag
`tamamhealth-website:current`, which is why it needs no registry credentials
and why no storage tier can block a release. DigitalOcean's registry used to
be in this path; its free tier is 500 MB and exactly one repository, and
collecting garbage to stay under the size cap left the repository
unrecreatable — the registry's own catalog reporting zero repositories while
its auth endpoint counted one and denied every push.

Pick a `restart` mode when you run it:

| Mode | What it does | Needs |
|---|---|---|
| `ssh` | copies the image in, restarts `website.service`, verifies the live site | `WEBSITE_SSH_HOST` / `_USER` / `_KEY` in the production environment |
| `reboot` | reboots the droplet via the DO API. **Cannot deliver a new build** — the unit no longer pulls, so this only recovers an unresponsive box | nothing extra |
| `none` | publishes to GHCR only | — |

`NEXT_PUBLIC_PLATFORM_URL` is inlined into the client bundle at build time and
is what every login link on the site redirects through, so it is passed as a
build arg. It cannot be corrected at runtime.

A freshly built droplet has no image until the first deploy delivers one:
`website.service` will restart every 10s until then. That is the tradeoff for
not holding registry credentials on the box.

<details>
<summary>Manual delivery (only if the pipeline is unavailable)</summary>

```bash
docker build --build-arg NEXT_PUBLIC_PLATFORM_URL=https://app.tamamhealth.org \
  -t tamamhealth-website:current ../../website
docker save tamamhealth-website:current | gzip -1 \
  | ssh root@$(terraform output -raw reserved_ip) 'docker load'
ssh root@$(terraform output -raw reserved_ip) 'systemctl restart website'
```
</details>

Then point GoDaddy DNS at the reserved IP:

| Type | Name | Value |
|---|---|---|
| A | `@` | `terraform output -raw reserved_ip` |
| A | `www` | `terraform output -raw reserved_ip` |

## Known tradeoff

The droplet no longer holds any registry credential — cloud-init used to embed
the DO API token to `docker login`, and that is gone with the registry. What
replaces it is a dependency on the deploy key: if `WEBSITE_SSH_*` stops
working, nothing can deliver a build, and the reboot path cannot substitute
for it because the unit does not pull.
