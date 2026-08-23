import type { Metadata } from "next";
import "./globals.css";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import { getLocale } from "@/lib/i18n/server";
import { localeConfig } from "@/lib/i18n";
import StructuredData from "./structured-data";

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
  // Names the apex as the one real address for every page. Without it, the
  // site answered on both tamamhealth.org and www.tamamhealth.org with
  // identical content and nothing saying which was authoritative — so a
  // crawler indexing a two-month-old domain had to pick, and could split the
  // little signal there is across two hosts. Resolved against `metadataBase`,
  // so each route emits its own canonical rather than all pointing at "/".
  alternates: { canonical: "./" },
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
  /* Ownership proof for the two webmaster consoles that between them feed
     every browser's default search — Google (Chrome, Firefox, Safari) and Bing
     (Edge, and through it DuckDuckGo, Yahoo and Ecosia). Read from the
     environment because the tokens are issued per property and per account:
     hard-coding one would tie this repository to whichever console happened to
     verify first, and leaving them out means the sitemap cannot be submitted
     at all, which is the step a new domain actually needs. Absent values emit
     no tag. */
  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || undefined,
    other: process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION
      ? { "msvalidate.01": process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION }
      : {},
  },
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Resolved on the server so the first byte is already in the right language
  // and the right direction — no English flash before an Arabic repaint.
  const locale = await getLocale();
  const { dir } = localeConfig(locale);

  return (
    <html lang={locale} dir={dir}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- root layout, applies site-wide */}
        <link
          href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;700&family=Barlow+Condensed:wght@400;600;700&display=swap"
          rel="stylesheet"
        />
        <StructuredData />
      </head>
      <body>
        <LanguageProvider locale={locale}>{children}</LanguageProvider>
      </body>
    </html>
  );
}
