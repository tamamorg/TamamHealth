/**
 * TamamHealth Fingerprint Bridge
 *
 * Browsers cannot talk to USB fingerprint scanners directly (vendor SDKs are
 * native C/C++/.NET libraries), so this small Node service runs on the SAME
 * machine as the scanner and exposes it to the browser app over localhost
 * HTTP. The platform never depends on it being up — fingerprint features
 * degrade gracefully when the bridge is unreachable (offline-first principle).
 *
 * Endpoints:
 *   GET  /health   → { ok, driver, templateFormat, scannerConnected }
 *   POST /capture  → { template, quality, finger, format, driver }
 *                    body: { finger?, simulateId? (mock driver only) }
 *   POST /match    → { matches: [{ id, score }] } sorted by score desc,
 *                    filtered to score >= threshold
 *                    body: { probe, candidates: [{ id, template }], threshold? }
 *
 * Driver selection: FINGERPRINT_DRIVER env var (default "mock"). Each driver
 * lives in ./adapters/<name>.mjs and exports createAdapter() implementing:
 *   { name, templateFormat, isScannerConnected(), capture(opts), match(probe, candidates) }
 *
 * Security posture: binds to 127.0.0.1 only, but loopback is NOT sufficient on
 * its own — a malicious web page open in the same browser, or another local
 * process, can still reach a localhost service. So the bridge also:
 *   - validates the Host header is loopback (blocks DNS-rebinding attacks);
 *   - enforces an Origin allowlist server-side BEFORE any scan side-effect, so
 *     a hostile web origin can neither read templates (CORS) nor trigger a
 *     capture (we reject before touching the scanner);
 *   - optionally requires a shared-secret token on the capture/match endpoints.
 * Biometric templates transit this process during enroll/identify but are never
 * persisted here — storage and sync live in the platform's PouchDB/CouchDB layer.
 */

import http from 'node:http';
import { pathToFileURL } from 'node:url';

const PORT = Number(process.env.FINGERPRINT_BRIDGE_PORT || 7345);
const HOST = process.env.FINGERPRINT_BRIDGE_HOST || '127.0.0.1';
const DRIVER = process.env.FINGERPRINT_DRIVER || 'mock';
/** Minimum match score (0-100) returned by /match unless the caller overrides. */
const DEFAULT_MATCH_THRESHOLD = 40;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Browser origins permitted to call the bridge (comma-separated). Defaults to
 * the local dev app; production deployments MUST set
 * FINGERPRINT_BRIDGE_ALLOWED_ORIGIN to their real app origin. "*" disables the
 * allowlist and is strongly discouraged — it lets any website read biometrics.
 * Read lazily so tests/deployments can reconfigure without re-importing.
 */
function allowedOrigins() {
  return (process.env.FINGERPRINT_BRIDGE_ALLOWED_ORIGIN || 'http://localhost:3000,http://127.0.0.1:3000')
    .split(',').map(s => s.trim()).filter(Boolean);
}

/** Optional shared secret. When set, /capture and /match require X-Bridge-Token. */
function bridgeToken() {
  return process.env.FINGERPRINT_BRIDGE_TOKEN || '';
}

/** Strip the port from a Host header, handling bracketed IPv6 ([::1]:7345). */
function hostOf(hostHeader) {
  if (!hostHeader) return '';
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end >= 0 ? h.slice(0, end + 1) : h;
  }
  const colon = h.lastIndexOf(':');
  return colon >= 0 ? h.slice(0, colon) : h;
}

function isLoopbackHost(hostHeader) {
  return LOOPBACK_HOSTS.has(hostOf(hostHeader));
}

/** True when the request's Origin is allowed (or no Origin header is present). */
function isOriginAllowed(origin) {
  if (!origin) return true; // non-browser / same-origin requests carry no Origin
  const allow = allowedOrigins();
  return allow.includes('*') || allow.includes(origin);
}

export async function loadAdapter(name = DRIVER) {
  const mod = await import(`./adapters/${name}.mjs`);
  if (typeof mod.createAdapter !== 'function') {
    throw new Error(`[fingerprint-bridge] adapter "${name}" does not export createAdapter()`);
  }
  return mod.createAdapter();
}

function corsHeaders(origin) {
  const allow = allowedOrigins();
  // Echo the caller's origin only when it's allowed; never blanket-reflect.
  const value = allow.includes('*') ? '*' : (origin && allow.includes(origin) ? origin : allow[0] || 'null');
  return {
    'Access-Control-Allow-Origin': value,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Bridge-Token',
    // Chrome asks this before an https page may reach a local service.
    'Access-Control-Allow-Private-Network': 'true',
  };
}

function sendJSON(res, status, body, origin) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...corsHeaders(origin) });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 5 * 1024 * 1024) {
        reject(new Error('payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

export function createServer(adapter) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const origin = req.headers.origin;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders(origin));
      res.end();
      return;
    }

    // Reject non-loopback Host headers (defeats DNS-rebinding to 127.0.0.1).
    if (!isLoopbackHost(req.headers.host)) {
      sendJSON(res, 403, { error: 'forbidden host' }, origin);
      return;
    }

    // Reject disallowed browser origins BEFORE any scanner side-effect.
    if (!isOriginAllowed(origin)) {
      sendJSON(res, 403, { error: 'origin not allowed' }, origin);
      return;
    }

    // Enforce the shared secret on the sensitive endpoints when configured.
    const token = bridgeToken();
    if (token && (url.pathname === '/capture' || url.pathname === '/match')) {
      if (req.headers['x-bridge-token'] !== token) {
        sendJSON(res, 401, { error: 'invalid or missing bridge token' }, origin);
        return;
      }
    }

    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        const scannerConnected = await adapter.isScannerConnected();
        sendJSON(res, 200, {
          ok: true,
          driver: adapter.name,
          templateFormat: adapter.templateFormat,
          scannerConnected,
        }, origin);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/capture') {
        const body = await readBody(req);
        if (!(await adapter.isScannerConnected())) {
          sendJSON(res, 503, { error: 'scanner not connected' }, origin);
          return;
        }
        const result = await adapter.capture(body);
        sendJSON(res, 200, {
          ...result,
          format: adapter.templateFormat,
          driver: adapter.name,
        }, origin);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/match') {
        const body = await readBody(req);
        const { probe, candidates, threshold } = body;
        if (typeof probe !== 'string' || !probe) {
          sendJSON(res, 400, { error: 'probe (base64 template) is required' }, origin);
          return;
        }
        if (!Array.isArray(candidates)) {
          sendJSON(res, 400, { error: 'candidates must be an array of { id, template }' }, origin);
          return;
        }
        // Clamp to [1,100] so a caller can't pass 0/negative to match everyone.
        const requested = typeof threshold === 'number' && Number.isFinite(threshold)
          ? threshold : DEFAULT_MATCH_THRESHOLD;
        const minScore = Math.max(1, Math.min(100, requested));
        const scored = await adapter.match(probe, candidates);
        const matches = scored
          .filter(m => m.score >= minScore)
          .sort((a, b) => b.score - a.score);
        sendJSON(res, 200, { matches }, origin);
        return;
      }

      sendJSON(res, 404, { error: 'not found' }, origin);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'internal error';
      const status = message === 'invalid JSON body' || message === 'payload too large' ? 400 : 500;
      sendJSON(res, status, { error: message }, origin);
    }
  });
}

async function main() {
  // The mock driver reports a connected scanner and emits fake templates; left
  // on in production it silently breaks identification (random subject per
  // capture) while looking healthy. Fail loud unless explicitly overridden.
  if (DRIVER === 'mock' && process.env.NODE_ENV === 'production' && process.env.FINGERPRINT_ALLOW_MOCK !== 'true') {
    console.error('[fingerprint-bridge] refusing to start: mock driver in production. Set FINGERPRINT_DRIVER to a real adapter, or FINGERPRINT_ALLOW_MOCK=true to override.');
    process.exit(1);
  }
  if (allowedOrigins().includes('*')) {
    console.warn('[fingerprint-bridge] WARNING: FINGERPRINT_BRIDGE_ALLOWED_ORIGIN="*" lets any website call the bridge. Pin it to your app origin.');
  }

  const adapter = await loadAdapter();
  const server = createServer(adapter);
  server.listen(PORT, HOST, () => {
    console.log(`[fingerprint-bridge] driver=${adapter.name} format=${adapter.templateFormat} listening on http://${HOST}:${PORT}`);
  });

  const shutdown = () => {
    console.log('[fingerprint-bridge] shutting down');
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => {
    console.error('[fingerprint-bridge] fatal:', err);
    process.exit(1);
  });
}
