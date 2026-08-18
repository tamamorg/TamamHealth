# TamamHealth — Mobile (Patient App)

`tamamhealth-patient` is the Expo / React Native companion app for patients. It
lets a patient view their records, lab results, prescriptions, appointments,
immunizations, billing, and messages — online or offline.

Expo SDK 56 / React Native 0.85 / React 19, expo-router, TypeScript. Node 20
(`.nvmrc` at the repo root), npm >= 10. This package has its own lockfile —
there is no workspace root.

## Getting started

```bash
npm ci
npm run dev        # expo start (choose a target from the CLI)
npm run ios        # expo start --ios
npm run android    # expo start --android
npm run web        # expo start --web
npm run lint       # expo lint
npx tsc --noEmit   # type-check (what CI runs; there is no npm script for it)
```

Native release builds go through EAS: `npm run build:ios` / `npm run build:android`.

## Configuration

Two public variables, both bundled into the JS at build time (`cp .env.example .env`):

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_API_BASE_URL` | Platform API root. `http://localhost:3000` for dev; your machine's LAN IP when running on a physical phone. A trailing slash is stripped by `api-client.ts`. |
| `EXPO_PUBLIC_DEMO_MODE` | Anything but the literal string `false` seeds local SQLite with the `pat-00001` demo family and shows demo accounts on the Login screen. **Must be `false` for store builds.** |

`EXPO_PUBLIC_*` values are readable by anyone holding the `.apk`/`.ipa` — never
put a secret there. `eas.json` sets both per build profile
(`development` → localhost + demo, `preview` → staging + demo,
`production` → `https://api.tamamhealth.org` + demo off), so a release picks
them up from the profile rather than a local `.env`.
`.env.production.example` documents the production values.

## Routing

Navigation is file-based via **expo-router** under `app/`:

- `app/_layout.tsx` — root layout; mounts the provider stack (auth → store →
  network → sync) and gates the app behind the Landing/Login screens.
- `app/(tabs)/*.tsx` — each route file is a **thin re-export** of the matching
  screen in `src/screens/` (e.g. `app/(tabs)/labs.tsx` →
  `src/screens/LabsScreen.tsx`). Put screen logic in `src/screens`, not in the
  route files.

Only five of those routes are bottom tabs — `index`, `records`, `appointments`,
`billing`, `profile`. `labs`, `prescriptions`, `immunizations` and `messages`
are registered with `href: null`, so they have no tab of their own and are
reached from the home shortcuts, the drawer menu, or the profile list (e.g.
`router.push('/(tabs)/labs')`).

## Architecture — two data paths (important)

The app deliberately runs **two separate data systems**. Knowing which is which
avoids the trap of "editing the wrong layer":

1. **Reads (what screens render)** — `use-cached-fetch.ts` → `api-client.ts`
   (REST against the platform API) → `offline-cache.ts` (encrypted SecureStore
   cache for offline reads). Screens consume this path.

2. **Writes + background sync** — `store.tsx` → `database.ts` (local SQLite) →
   `sync-engine.ts`, orchestrated by `sync-context.tsx`. Local mutations are
   queued in SQLite and pushed when connectivity returns (`network.tsx`).

Because reads come from the REST/cache path, the SQLite **read** getters in
`database.ts` are not on the render path today — don't assume a `getX()` in
`database.ts` is what a screen displays.

## Layout

```
app/                  # expo-router routes (_layout + (tabs))
src/
  screens/            # one screen component per route (+ Landing/Login)
  components/          # shared UI (Card, Badge, Skeleton, DrawerMenu,
                       #   TamamHealthLogo, Sync*, icons/)
  lib/
    api-client.ts      # REST client for the platform API (Bearer token in
                       #   SecureStore; clears it on a 401)
    use-cached-fetch.ts# read hook: fetch-on-focus + offline-cache fallback
    offline-cache.ts   # encrypted SecureStore cache (PHI-safe), TTL per entry
    database.ts        # local SQLite schema + CRUD + sync queue
    sync-engine.ts     # pushes queued mutations to the server
    sync-context.tsx   # drives the sync engine; exposes sync state
    store.tsx          # app data store (writes go through here)
    auth.tsx           # auth/session provider
    network.tsx        # connectivity provider
    data.ts            # demo seed records (pat-00001), demo mode only
    theme.ts / types.ts
```

## CI and beta builds

- `ci.yml` runs a `mobile · lint + type-check` job on every PR (`npm ci`,
  `npm run lint`, `npx tsc --noEmit`). There are no automated tests in this
  package yet.
- `.github/workflows/mobile-beta.yml` is manual (`workflow_dispatch`): pick a
  target (TestFlight / Play internal / both) and an EAS profile, and it runs
  `eas build` then `eas submit`. It is gated on an `EXPO_TOKEN` secret in the
  `mobile-beta` environment — without it the job logs a notice and exits 0, so
  the pipeline stays green until developer accounts exist.
- Store submission is **not** wired up yet: `eas.json`'s
  `submit.production.ios` still carries `PLACEHOLDER-…` values for
  `ascAppId` and `appleTeamId`.
