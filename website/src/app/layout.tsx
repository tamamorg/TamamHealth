import type { Metadata } from "next";
import "./globals.css";

/** What the browser tab says. Short on purpose: a tab is ~25 characters
 *  before it truncates, so the tagline was being cut mid-word and every tab
 *  looked the same. It still runs in full in the description and the social
 *  card below, where there is room for it. */
const TAB_TITLE = "TamamHealth";
/** The full line, for search results and link previews. Matches the platform
 *  (`platform/src/app/layout.tsx`) verbatim, so the product and the site that
 *  sells it say the same thing. */
const TITLE = "TamamHealth — Every Patient Deserves to Be Remembered";
const DESCRIPTION =
  "South Sudan's clinics run on paper-based records that get lost, damaged, or destroyed. TamamHealth brings digital records that work offline, so care never starts from zero.";

export const metadata: Metadata = {
  metadataBase: new URL("https://tamamhealth.org"),
  title: {
    default: TAB_TITLE,
    template: "%s — TamamHealth",
  },
  description: DESCRIPTION,
  manifest: "/manifest.webmanifest",
  // Its own file, not the logo's: the tab icon has to stay legible against
  // whatever chrome the browser puts behind it, so it does not follow the
  // logo when the mark's colour changes.
  icons: {
    icon: [{ url: "/assets/tamam-favicon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/assets/tamam-favicon.svg" }],
  },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "https://tamamhealth.org",
    siteName: "TamamHealth",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- root layout, applies site-wide */}
        <link
          href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;700&family=Barlow+Condensed:wght@400;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
