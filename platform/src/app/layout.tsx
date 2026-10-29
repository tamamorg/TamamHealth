import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import './print-typography.css';
import "./tablet-desktop.css";
import { AppProvider } from "@/lib/context";

// One typeface for the whole platform: IBM Plex, the face OpenMRS O3 (Carbon)
// is set in. The chart already spoke Plex while every other surface spoke
// Barlow, so crossing from a dashboard into a patient chart changed the
// letterforms under the user's eyes. `--font-ibm-plex-sans` /
// `--font-ibm-plex-mono` feed `--font-platform`, `--font-condensed`,
// `--font-omrs` and `--font-platform-mono` in globals.css. Self-hosted by
// next/font at build time, so they work offline (offline-first requirement).
//
// Plex stops at 700. The stylesheet's 800 rung (`--type-weight-bold` page
// titles) resolves to the 700 face, which is Carbon's heaviest step too.
const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ibm-plex-sans",
  display: "swap",
});
const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm-plex-mono",
  display: "swap",
  // Used by identifiers/code-like values, not the initial shell. Let the
  // browser fetch it only on a surface that actually paints mono text.
  preload: false,
});
import { ToastProvider } from "@/components/Toast";
import TextareaAutoResize from "@/components/TextareaAutoResize";
import BootIntegrityGuard from "@/components/BootIntegrityGuard";

export const metadata: Metadata = {
  title: "Tamam Health",
  description: "Offline-first health records for South Sudan and Africa, built to keep patient stories connected from the bedside to the nation.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Tamam Health",
  },
  applicationName: "Tamam Health",
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
    <html lang="en" dir="ltr" className={`${ibmPlexSans.variable} ${ibmPlexMono.variable}`} data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        {/* Direction and theme, before first paint. useTranslation sets
            dir/lang and PreferenceEffects applies the theme once hydrated,
            but those are effects — they run after React hydrates, so an
            Arabic user would watch the whole app render left-to-right and
            then flip, and a dark-theme user would get a white flash on every
            load. This reads the same localStorage keys synchronously in
            <head> and stamps the attributes on <html> before any pixel is
            drawn. Kept inline and dependency-free for that reason; it must
            not wait for a bundle. The theme default here ('light') and the
            'system' resolution mirror lib/user-prefs.ts exactly. */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var l=localStorage.getItem('tamamhealth-locale')||'en';var d=l==='apd'?'rtl':'ltr';document.documentElement.lang=l;document.documentElement.dir=d;}catch(e){}try{var p={};try{var u=localStorage.getItem('tamamhealth.active-user-preferences');p=u?JSON.parse(localStorage.getItem('tamamhealth.user-prefs.'+u)||'{}')||{}:{}}catch(e){}var t=p.theme;if(t!=='dark'&&t!=='system')t='light';if(t==='system')t=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light';document.documentElement.dataset.theme=t;}catch(e){}})();`,
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
