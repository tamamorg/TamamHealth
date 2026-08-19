/** @type {import('next').NextConfig} */
import path from 'path';
import { fileURLToPath } from 'url';
import { withSentryConfig } from '@sentry/nextjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
