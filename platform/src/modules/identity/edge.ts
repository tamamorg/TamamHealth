/**
 * Identity — the half that runs in the Edge middleware.
 *
 * ## Why a third surface
 *
 * `src/proxy.ts` is Next 16's middleware. It runs on the Edge runtime, which
 * has Web Crypto but no Node built-ins — no `node:crypto`, no `node:fs`, no
 * filesystem at all. AGENTS.md has said "only import Edge-safe modules from
 * it" since the file was written.
 *
 * When identity moved into a module, the proxy's narrow imports
 * (`lib/auth-token`, `lib/csrf`, `lib/session`) were collapsed onto the server
 * barrel, and that barrel reaches `user-invite.ts` → `node:crypto` and
 * `login-session.ts` → `organization-service` → `couch-auth` → `node:crypto`.
 * The dev server logged it on every compile and served 500s; the production
 * build reported it as a warning and carried on. Middleware runs on **every
 * request**, so this was the worst possible place to put that import.
 *
 * That is the same barrel hazard as `client.ts`, one runtime over: a barrel
 * serves whoever imports it, and "whoever" here has three genuinely different
 * capability sets. So the module has three surfaces, and each one is a promise
 * about where its contents can run:
 *
 *     index.ts   Node — the full server surface
 *     client.ts  browser — no Node built-ins, no database
 *     edge.ts    Edge — Web Crypto only, and nothing else  ← this file
 *
 * ## The rule
 *
 * Everything re-exported here must run on the Edge runtime. In practice that
 * means `jose` (Web Crypto) and pure code. No `node:` import may be reachable
 * from this file, not even transitively —
 * `src/__tests__/architecture/module-boundaries.test.ts` walks the graph and
 * fails the build if one appears.
 *
 * Anything the middleware cannot do here, it must not do at all: the proxy
 * decides routing and CSRF, and every question that needs a database is
 * answered later by `getAuthPayload` inside the route.
 */

// ── Session tokens ──────────────────────────────────────────────────────────
// `jose` verifies HS256 with Web Crypto, which the Edge runtime provides.
// Only VERIFY is exported: the middleware reads a token to decide routing and
// has no business minting one.
export { verifyToken, type VerifiedTokenPayload } from './core/auth-token';

// ── CSRF ────────────────────────────────────────────────────────────────────
// The double-submit check the proxy runs on every state-changing request.
// `csrf.ts` imports nothing at all, which is the reason it can be here.
export {
  mintCsrfToken, verifyCsrfToken, CSRF_COOKIE_NAME, CSRF_HEADER_NAME,
} from './core/csrf';

// ── Session shape ───────────────────────────────────────────────────────────
// Cookie names and lifetimes — constants the proxy needs to set and read
// cookies without knowing how a session is created.
export { SESSION_TTL_SEC, SESSION_COOKIE_NAME } from './core/session';
