# TamamHealth — Website

`tamamhealth-website` is the public marketing site at
[tamamhealth.org](https://tamamhealth.org). Next.js 16 (App Router) + React 19,
served by a Node server — **not** the EHR. The product itself lives in
`platform/` and runs on port 3000; this package only describes it and hands
sign-ins over.

Every page is a server component. The site holds no session, no database, and
no patient data.

## Run it

```bash
cd website
npm ci                 # this package has its own lockfile; there is no workspace root
npm run dev            # http://localhost:3001
```

Other scripts:

```bash
npm run build          # next build (output: "standalone")
npm start              # serve the production build on 3001
npm run lint           # eslint
npx tsc --noEmit       # type-check (what CI runs; there is no npm script for it)
npm run i18n:check     # untranslated-copy report — see below
```

Node 20 (`.nvmrc` at the repo root), npm >= 10.

The only environment variable is `NEXT_PUBLIC_PLATFORM_URL` (see
`.env.example`) — the platform deployment `/login` forwards to. It defaults to
`https://app.tamamhealth.org`. Because it is `NEXT_PUBLIC_*`, it is inlined at
**build** time; a runtime value cannot change it afterwards, which is why the
Dockerfile takes it as a build arg.

`docker compose up website` from the repo root builds the same image and
publishes it on `${WEBSITE_PORT:-3001}`.

## Where the content lives

- **`src/lib/site-data.ts`** — nearly all of the copy: products, challenges,
  care levels, team, heroes, news, donation tiers, footer columns, header menus,
  contact details. Editing a page usually means editing this file, not a
  component.
- **`src/components/`** — the shared chrome (`SiteHeader`, `SiteFooter`) and the
  interactive pieces (`LevelsExplorer`, `NewsExplorer`, `ChallengesBand`,
  `DonateWidget`, `ContactForm`), plus `components/home/*` for the home-page
  bands.
- **`src/app/(site)/`** — the route group that carries the header/footer chrome:
  `/`, `/products` (+ `/products/[slug]`), `/platform`, `/health-system`,
  `/about`, `/news` (+ `/news/[slug]`), `/challenges/[slug]`, `/donate`,
  `/contact`, `/terms`.
- **`src/app/login/`** — outside that group, and a **redirect**, not a page. The
  marketing origin deliberately has no password field; `?role=` picks the portal
  and the platform renders the real form.
- **`src/app/robots.ts` / `sitemap.ts`** — both hardcode
  `https://tamamhealth.org`. New routes need adding to the sitemap by hand.
- **`src/app/opengraph-image.jpg` / `twitter-image.jpg`** — the link-preview
  cards, both 1200×630, regenerated from `scripts/og-card.html` by
  `node scripts/make-og-card.mjs` (needs Playwright installed out-of-tree; the
  script header explains why, and how to point `PLAYWRIGHT_ROOT` at it). The
  `.alt.txt` files beside them must keep describing what the picture shows.
- **`public/assets/`** — photography, logos, and the platform screenshots
  (`platform-doctor.png`, `platform-front-desk.png`, …) captured from the
  running EHR, plus `map-south-sudan.html`, which the home page embeds in a
  same-origin iframe (the one path where `next.config.mjs` relaxes
  `X-Frame-Options` to `SAMEORIGIN`).

## i18n

Two languages, both server-rendered: English (LTR) and Juba Arabic
(`apd`, RTL). Translation is an **overlay**, not a key catalogue —
`src/lib/i18n/apd.ts` maps English source strings to their Arabic equivalent and
`translateDeep` swaps the ones it recognises, so English stays the single source
of truth and anything untranslated simply falls back to English. The chosen
locale lives in the `tamamhealth-locale` cookie, read on the server so the first
byte is already in the right language and direction.

The cost of keying on English text is that **editing a source string silently
un-translates it**. That is what `npm run i18n:check` catches: it reports every
user-facing string with no dictionary entry. It is a report, not a gate — it
exits 0.

## Deployment

The site runs on its own DigitalOcean droplet, not on Vercel and not in the
platform's stack. Shipping is manual:

**Actions → `deploy-website` → Run workflow** (`.github/workflows/deploy-website.yml`),
optionally with a git SHA, gated on the `production` environment.

The workflow builds `website/Dockerfile`, publishes the image to
**GHCR** (`ghcr.io/<owner>/tamamhealth-website`) as the record of what shipped,
then copies that same image to the droplet over SSH (`docker save | ssh docker
load`), points `website.service` at the delivered tag, restarts it, and polls
`https://tamamhealth.org/health-system` until it returns 200.

DigitalOcean's container registry is **no longer in the delivery path** — its
free tier could not hold the image. Consequently the droplet cannot fetch a
build on its own: the `restart: reboot` option only recovers an unresponsive
box, it cannot deliver a new version. Without the `WEBSITE_SSH_*` secrets the
run publishes to GHCR and warns that the live site was left untouched.

Droplet, firewall, reserved IP and Caddy TLS are described in
[`infra/digitalocean-website/`](../infra/digitalocean-website) — read its README
before running Terraform there; the committed state does not currently match the
live infrastructure.

## CI

`ci.yml` runs a `website · lint + type-check + build` job on every PR
(`npm ci`, `npm run lint`, `npx tsc --noEmit`, `npm run build`). `i18n:check` is
not part of it — run it yourself after touching copy.
