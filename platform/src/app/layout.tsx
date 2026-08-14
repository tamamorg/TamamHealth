import type { Metadata, Viewport } from "next";
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
const barlow = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
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
  themeColor: "#EFF8FD",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${barlow.variable} ${barlowCondensed.variable} ${jetBrainsMono.variable} ${ibmPlexSans.variable}`} data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        {/* The same mark and blue the marketing site serves, from a file
            named for its job rather than a style-guide export number. The tab
            icon deliberately does NOT follow the platform accent — it has to
            stay recognisable next to the site's. */}
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
