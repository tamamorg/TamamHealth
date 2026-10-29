import { Barlow, Barlow_Condensed } from 'next/font/google';

/**
 * Patient-portal shell. Deliberately chrome-free: the signed-in top rail
 * (brand + "Patient Portal" title, search, tab nav, user menu) is rendered by
 * the page itself, which owns the active-tab state the nav drives — and the
 * sign-in screen is a full-viewport page exactly like /login, with no header.
 *
 * The sign-in screen is drawn in the marketing site's login language, which
 * means its typefaces too: Barlow for body, Barlow Condensed for headings,
 * loaded here rather than in the root layout so the platform proper stays on
 * DM Sans. Self-hosted by next/font, so the door still opens offline. The
 * signed-in portal below uses --font-platform and is untouched by them.
 */
const barlow = Barlow({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--lg-font-body',
  display: 'swap',
});
const barlowCondensed = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['600'],
  variable: '--lg-font-heading',
  display: 'swap',
});

export default function PatientPortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${barlow.variable} ${barlowCondensed.variable}`}
      style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}
    >
      <main style={{ width: '100%' }}>{children}</main>
    </div>
  );
}
