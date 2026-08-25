/** @type {import('next').NextConfig} */
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  devIndicators: false,
  // Pin the workspace root to this package. Without it Turbopack walks up,
  // finds the repo-root lockfile (and would find a stray ~/package-lock.json
  // the same way), and warns that it inferred a root that is not this app —
  // the same pin platform/next.config.mjs carries, and for the same reason:
  // a root guessed above the package breaks module resolution in dev.
  turbopack: {
    root: __dirname,
  },
  // Emit a self-contained server with only the modules the app actually
  // imports. The image used to copy the whole node_modules tree and came to
  // 885 MB — one copy of which nearly filled the container registry's 500 MB
  // quota, so every second deploy died mid-push.
  output: "standalone",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
      {
        // The deployment-footprint map is embedded by the home page in a
        // same-origin <iframe>; the global DENY above would blank it, so this
        // one path relaxes to SAMEORIGIN (still no third-party framing).
        // Later entries win when the same header key matches twice.
        source: "/map-south-sudan.html",
        headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
      },
    ];
  },
};

export default nextConfig;
