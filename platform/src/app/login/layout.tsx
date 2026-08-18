import { Barlow, Barlow_Condensed } from 'next/font/google';

/**
 * Staff-login layout — minimal shell so the login page renders edge-to-edge
 * without a top nav.
 *
 * The login screen is drawn in the marketing site's language (tamamhealth.org
 * /login), which means its typefaces too: Barlow for body, Barlow Condensed
 * for headings. They are loaded here rather than in the root layout so the
 * platform proper stays on DM Sans and no extra font ships with the app
 * shell. Self-hosted by next/font, so the login page still works offline.
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

export default function StaffLoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${barlow.variable} ${barlowCondensed.variable}`} style={{ minHeight: '100vh', background: '#FFFFFF' }}>
      <main style={{ width: '100%' }}>{children}</main>
    </div>
  );
}
