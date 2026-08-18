# TamamHealth Fingerprint Bridge

A small Node service that exposes a USB fingerprint scanner to the TamamHealth
browser app over a localhost HTTP API. It runs on the same machine the scanner
is plugged into (the registration desk PC) and wraps vendor SDKs behind a
uniform adapter interface.

```
Browser app (Next.js)  ──HTTP──▶  fingerprint-bridge (this service, 127.0.0.1:7345)
                                        │
                                        ▼  vendor SDK / driver
                                  USB fingerprint scanner
```

Why a bridge? Browsers cannot load native scanner SDKs. WebUSB is not supported
by most optical scanner vendors, and the SDKs that exist are native libraries.
A loopback HTTP service is the standard integration pattern (Mantra, SecuGen,
DigitalPersona all ship one); this bridge gives TamamHealth a single,
vendor-neutral API in front of whichever scanner a facility owns.

## Offline-first posture

The platform never depends on the bridge being up. If the bridge is
unreachable, fingerprint enrollment/identification UI simply reports the
scanner as unavailable and staff fall back to hospital-number / QR / name
search. Biometric **templates** (not images) are stored in the platform's
PouchDB/CouchDB layer (`tamamhealth_biometric_templates`) and sync like any
other clinical data — identification works fully offline against the local
replica.

## Run

```bash
cd fingerprint-bridge
npm start           # mock driver, http://127.0.0.1:7345
```

Node >= 20 and nothing else — this package has no dependencies and no lockfile,
so there is no install step.

Environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `FINGERPRINT_DRIVER` | `mock` | Adapter to load from `./adapters/<name>.mjs` |
| `FINGERPRINT_BRIDGE_PORT` | `7345` | Listen port |
| `FINGERPRINT_BRIDGE_HOST` | `127.0.0.1` | Listen host (keep loopback) |
| `FINGERPRINT_BRIDGE_ALLOWED_ORIGIN` | `http://localhost:3000,http://127.0.0.1:3000` | Comma-separated browser origins allowed to call the bridge. **Set this to your real app origin in production.** `*` disables the allowlist (lets any website read biometrics — discouraged). |
| `FINGERPRINT_BRIDGE_TOKEN` | _(unset)_ | Optional shared secret. When set, `/capture` and `/match` require header `X-Bridge-Token: <token>`. |
| `FINGERPRINT_ALLOW_MOCK` | `false` | Allow the `mock` driver to start when `NODE_ENV=production` (otherwise the bridge refuses to start, since mock silently breaks real identification). |

### Security notes

The bridge is loopback-only, but loopback alone is not enough: a malicious web
page open in the same browser, or another local process, can reach a localhost
service. The bridge therefore also:

- **validates the `Host` header is loopback** (`127.0.0.1`/`localhost`/`[::1]`),
  defeating DNS-rebinding attacks;
- **enforces an `Origin` allowlist server-side** before any scanner action, so a
  hostile origin can neither read templates (CORS) nor trigger a capture;
- **optionally requires a shared-secret token** (`FINGERPRINT_BRIDGE_TOKEN`).

On the platform side, set in `platform/.env.local`:

```bash
NEXT_PUBLIC_FINGERPRINT_ENABLED=true
NEXT_PUBLIC_FINGERPRINT_BRIDGE_URL=http://127.0.0.1:7345
# only when the bridge runs with FINGERPRINT_BRIDGE_TOKEN — same value, sent
# as the X-Bridge-Token header on capture/match:
NEXT_PUBLIC_FINGERPRINT_BRIDGE_TOKEN=<random-secret>
```

With the flag off or the bridge unreachable, `fingerprint-service.ts` reports
`available: false` and the UI hides itself — see `platform/.env.example`.

## API

### `GET /health`

```json
{ "ok": true, "driver": "mock", "templateFormat": "MOCK", "scannerConnected": true }
```

### `POST /capture`

Body: `{ "finger": "right_index" }` (mock driver also accepts `simulateId` to
produce a deterministic template for demos/tests).

```json
{ "template": "<base64>", "quality": 92, "finger": "right_index", "format": "MOCK", "driver": "mock" }
```

### `POST /match`

Body: `{ "probe": "<base64>", "candidates": [{ "id": "tpl-1", "template": "<base64>" }], "threshold": 40 }`

```json
{ "matches": [{ "id": "tpl-1", "score": 100 }] }
```

Matches are sorted by score (0–100) descending and filtered to
`score >= threshold` (default 40, clamped to 1–100 so a caller cannot pass 0 or
a negative value and match everyone).

## Adding a real scanner adapter

Create `adapters/<vendor>.mjs` exporting `createAdapter()` that returns:

```js
{
  name: 'mantra-mfs100',
  templateFormat: 'ISO_19794_2',        // or 'ANSI_378'
  async isScannerConnected() {},        // poll the SDK / device list
  async capture({ finger }) {},         // → { template, quality, finger }
  async match(probe, candidates) {},    // → [{ id, score }] using the SDK matcher
}
```

then run with `FINGERPRINT_DRIVER=<vendor>`. Guidance:

- **Prefer ISO/IEC 19794-2 (or ANSI 378) templates** so enrollments are
  portable across scanner brands. Avoid proprietary template formats unless
  the vendor offers nothing else — those lock a facility to one brand.
- **Delegate matching to the vendor SDK** (1:1 verify in a loop, or 1:N
  identify if offered). Normalize whatever score the SDK returns to 0–100.
- Vendors with loopback HTTP services of their own (e.g. Mantra MFS100 client
  service) can be wrapped with a thin adapter that just forwards requests.

## Test

```bash
npm run check       # node --check index.mjs — parse only
npm test            # node --test index.test.mjs — built-in runner, no deps
```

CI runs both on every PR as the `fingerprint-bridge · syntax check + tests`
job, with no `npm ci` step.
