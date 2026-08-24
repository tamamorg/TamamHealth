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
        {/* The brand mark knocked out of accent navy on a rounded tile, from a
            file named for its job rather than a style-guide export number.

            It used to be the bare mark in the marketing site's lighter blue,
            matched so the two tabs read as one brand. That parity cost more
            than it bought: with no ground of its own the mark washed out on a
            light home screen and its smallest dots dissolved below about 32px,
            which is most of the sizes an installed app is actually seen at.
            The site's favicon is still the lighter blue — worth revisiting
            together rather than leaving the two to drift. */}
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
