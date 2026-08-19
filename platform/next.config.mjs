/** @type {import('next').NextConfig} */
import path from 'path';
import { fileURLToPath } from 'url';
import { withSentryConfig } from '@sentry/nextjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Allow CouchDB URL in Content-Security-Policy connect-src when sync is enabled
const couchdbUrl = process.env.NEXT_PUBLIC_COUCHDB_URL || '';
const couchdbConnectSrc = couchdbUrl ? ` ${couchdbUrl}` : '';

// Optional PostHog host for usage-metrics forwarding (autocapture off).
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST || '';
const posthogConnectSrc = posthogHost ? ` ${posthogHost}` : '';

const isProd = process.env.NODE_ENV === 'production';

// Next.js requires 'unsafe-eval' in dev (HMR / react-refresh uses eval) and
// 'unsafe-inline' for its own bootstrap script injection. Production drops
// 'unsafe-eval'.
//
// 'unsafe-inline' remains, and it is the weakest directive in this header set:
// an injected inline <script> would execute. Removing it means per-request
// nonces, which cannot be built here — `headers()` in next.config is static, so
// the policy has to move into the middleware (src/proxy.ts), the root layout's
// pre-paint locale bootstrap has to carry the nonce, and the whole app becomes
// dynamically rendered. That is a deliberate piece of work, not a config tweak.
//
// (An earlier version of this comment claimed 'strict-dynamic' scoped the
// inline scripts. It never appeared in the emitted policy — the header below is
// the whole truth.)
const scriptSrc = isProd
  ? "script-src 'self' 'unsafe-inline'"
  : "script-src 'self' 'unsafe-eval' 'unsafe-inline'";

// Cache-bust identifier baked into the client bundle. Used by the service
// worker registration (`/sw.js?v=<BUILD_ID>`) so a new deploy invalidates
// the old SW cache without requiring a manual version bump.
// Priority: explicit env var → git short SHA (set via `NEXT_PUBLIC_BUILD_ID=$(git rev-parse --short HEAD)`) → timestamp.
const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || String(Date.now());

const nextConfig = {
  // `X-Powered-By: Next.js` names the framework and its major behaviour to
  // anyone scanning, for no benefit to the app.
  poweredByHeader: false,
  // Pin Turbopack to this package so a stray lockfile under $HOME (e.g.
  // ~/package-lock.json) is not treated as the workspace root — that broke
  // `@/` module resolution and inflated compile failures in local dev.
  turbopack: {
    root: __dirname,
  },
  devIndicators: false,
  env: {
    NEXT_PUBLIC_BUILD_ID: BUILD_ID,
  },
  generateBuildId: () => BUILD_ID,
  experimental: {
    // Tree-shake heavy barrel imports so pages only pull the components they
    // use — cuts dev compile time and production bundle size.
    optimizePackageImports: ['recharts', 'date-fns', 'react-big-calendar', 'lucide-react'],
  },
  webpack: (config, { isServer }) => {
    // Filter managed paths that don't contain a package.json to avoid noisy
    // webpack cache warnings from empty optional dependency stubs.
    // Suppress noisy webpack cache warnings for platform-specific optional
    // dependency stubs (e.g. @next/swc-linux-x64-gnu on macOS).
    config.infrastructureLogging = {
      ...config.infrastructureLogging,
      level: 'error',
    };

    if (!isServer) {
      // PouchDB needs these Node.js polyfills disabled in browser
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        os: false,
        crypto: false,
      };
    }
    return config;
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // camera/microphone are same-origin only: patient photo capture at
          // registration and the telehealth visit room both use getUserMedia.
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(self)' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              scriptSrc,
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: blob:",
              `connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com${couchdbConnectSrc}${posthogConnectSrc}`,
              "worker-src 'self' blob:",
              // Chart document previews frame the decoded file as a blob: URL
              // so Chrome's PDF viewer can render it. Without this, blob frames
              // fall back to `default-src 'self'` and every PDF preview in the
              // patient chart shows the viewer's broken-file icon. Same-origin
              // and blob: only — `object-src 'none'` below still stands, and
              // this app is never framed itself (`frame-ancestors 'none'`).
              "frame-src 'self' blob:",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "object-src 'none'",
              "upgrade-insecure-requests",
            ].join('; '),
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

// Wrap the export in `withSentryConfig` so the build emits client/server
// source-map uploads (only when SENTRY_AUTH_TOKEN + org/project are set —
// otherwise this is a transparent passthrough). `silent: true` suppresses
// the build-time logspam, `widenClientFileUpload` covers route-handler
// chunks, and `hideSourceMaps` keeps the .map files out of the public
// browser path so source isn't leaked alongside the bundle.
export default withSentryConfig(nextConfig, {
  silent: true,
  widenClientFileUpload: true,
  hideSourceMaps: true,
});
