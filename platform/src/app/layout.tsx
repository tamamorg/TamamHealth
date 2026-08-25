import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Barlow, Barlow_Condensed, JetBrains_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/lib/context";

// Platform typeface. `--font-barlow` / `--font-barlow-condensed` /
// `--font-jetbrains-mono` are consumed by `--font-platform` /
// `--font-condensed` / `--font-platform-mono` in globals.css. Self-hosted by
// next/font at build time, so they work offline (offline-first requirement).
//
// Barlow replaced DM Sans with the Clinical App design: the app and
// tamamhealth.org now share one voice, and the condensed cut is what carries
// the design's headings and its letterspaced uppercase micro-labels — DM Sans
// has no condensed face, so those labels had to fake it with tracking alone.
// 800 is loaded because the stylesheet asks for it in ~180 places — every
// section title, KPI and uppercase micro-label sits on `--type-weight-bold`.
// Without the face, all of those fell back to 700 and rendered identically to
// the 700 rung below them, which is what flattened the type: the top two steps
// of the scale were the same pixel weight.
const barlow = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-barlow",
  display: "swap",
});
const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-barlow-condensed",
  display: "swap",
});
const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});
// Carbon's typeface, used only by the OpenMRS-styled surfaces (`--font-omrs`
// in globals.css). Scoped rather than global: the rest of the platform is DM
// Sans, and OpenMRS in anything but Plex reads as an imitation of it.
const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-ibm-plex-sans",
  display: "swap",
});
import { ToastProvider } from "@/components/Toast";
import TextareaAutoResize from "@/components/TextareaAutoResize";
import BootIntegrityGuard from "@/components/BootIntegrityGuard";

export const metadata: Metadata = {
  title: "TamamHealth — Every Patient Deserves to Be Remembered",
  description: "Offline-first health records for South Sudan and Africa, built to keep patient stories connected from the bedside to the nation.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "TamamHealth",
  },
  applicationName: "TamamHealth",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Allow pinch-zoom (accessibility — don't lock to 1) and draw under device
  // notches / rounded corners so the PWA fills the whole screen on mobile.
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
  themeColor: "#015697",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nonce = (await headers()).get('x-nonce') || undefined;
  return (
    <html lang="en" dir="ltr" className={`${barlow.variable} ${barlowCondensed.variable} ${jetBrainsMono.variable} ${ibmPlexSans.variable}`} data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        {/* Direction, before first paint. useTranslation sets dir/lang once it
            has loaded the locale chunk, but that is an effect — it runs after
            React hydrates, so an Arabic user would watch the whole app render
            left-to-right and then flip. This reads the same localStorage key
            synchronously in <head> and stamps the attributes on <html> before
            any pixel is drawn. Kept inline and dependency-free for that reason;
            it must not wait for a bundle. */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var l=localStorage.getItem('tamamhealth-locale')||'en';var d=l==='apd'?'rtl':'ltr';document.documentElement.lang=l;document.documentElement.dir=d;}catch(e){}})();`,
          }}
        />
        {/* The bare brand mark in the marketing site's blue, restored
            2026-08-24 — the platform tab and tamamhealth.org read as one
            brand again.

            It briefly wore a navy rounded tile, which solves a real problem
            this does not: with no ground of its own the mark washes out on a
            light home screen and its smallest dots dissolve below about 32px.
            That trade is deliberate now rather than accidental — the tab is
            where this icon is actually seen, and the installed-app icons in
            public/icons keep their tile. */}
        <link rel="icon" type="image/svg+xml" href="/assets/tamam-favicon.svg" />
        <link rel="apple-touch-icon" sizes="192x192" href="/assets/tamam-favicon.svg" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className="antialiased">
        <BootIntegrityGuard />
        <AppProvider>
          <ToastProvider>
            <TextareaAutoResize />
            {children}
          </ToastProvider>
        </AppProvider>
      </body>
    </html>
  );
}
