---
name: verify
description: Build/launch/drive recipe for verifying TamamHealth platform UI changes end-to-end in a real browser.
---

# Verifying TamamHealth changes

The app is the Next.js project in `platform/`.

## Launch

- `cd platform && npm run dev` — but check first: the user usually already has a dev
  server on **http://localhost:3000** (`.next/dev/logs/next-development.log`). If one is
  running, drive that instead of starting another (a second `next dev` exits with
  "Another next dev server is already running"). Turbopack hot-reloads edits, so no restart needed.

## Login (seeded demo users)

- The account-picker page was removed 2026-08-13: `/login` now goes straight to the
  sign-in form. Fill `#tl-name` (username, e.g. `desk.amira`, `clinician.peter`) and
  `#tl-password`, then submit with `button[type=submit].lg-btn` (the web-v3 login
  rev renamed `.tl-submit` → `.lg-btn`; input ids are unchanged). The Role combobox
  may stay empty ("Your assigned role"). `superadmin` / `Superadmin!` opens /admin.
- Passwords: fetch `GET /api/demo-credentials` and read `profiles[].password` for the
  username (demo mode only). Fallback: `platform/.seed-credentials.json` (gitignored;
  JSON after a `#` comment line — strip up to the first `{` before parsing).
  Usernames/roles are defined in `platform/src/lib/db-seed.ts` (e.g. `co.deng` =
  clinical officer, `dr.wani` = doctor, `desk.amira` = receptionist).
- Gotcha: the submit button is disabled until the browser-side PouchDB finishes seeding
  ("Initializing offline database…") — wait for `button[type=submit].lg-btn:not([disabled])`,
  can take tens of seconds on a fresh browser profile.
- A guided tour ("Step 1 of 8") can pop over role dashboards — dismiss with
  `button[aria-label="Close tour"]` before screenshotting.

## Drive

- No Playwright in the repo. `npm i playwright` in the scratchpad works; Chromium is already
  cached in `~/Library/Caches/ms-playwright`.
- Use viewport width ≥1280 (xl) to see the consultation right rail (`.ehr-chart-details`,
  `hidden xl:block`); below 1280 the top patient picker (`.ehr-consult-patient-picker`)
  takes over patient selection.
- Data is per-hospital: which patients appear depends on which seeded user you log in as.
- First login shows a full-screen "Get Started" onboarding overlay (`div.absolute.inset-0.z-30`)
  that intercepts all clicks. "Skip setup" confirms via `window.confirm`, which headless
  Playwright auto-cancels — register `page.on('dialog', d => d.accept())` before clicking it.
- The clinician dashboard (`/dashboard`) lists only appointments with
  `providerId === currentUser._id`; seed appointment dates are relative
  (`dateFromNow(n)`/`dateAgo(n)` in `db-seed.ts`). Mini-calendar days are addressable
  via `button[data-date="YYYY-MM-DD"]`.
- Print styles: `page.emulateMedia({ media: 'print' })` + screenshot/`page.pdf()`.
  Global print CSS hides every `button:not(.print-visible)`.
