/**
 * Staff-login layout — minimal shell so the login page renders edge-to-edge
 * without a top nav.
 *
 * The login screen is drawn in the marketing site's language (tamamhealth.org
 * /login), which means its typefaces too: Barlow for body, Barlow Condensed
 * for headings. The root layout already self-hosts both families for the
 * platform, so this route reuses those variables instead of generating and
 * downloading a second set of font files.
 */
export default function StaffLoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-app)' }}>
      <main style={{ width: '100%' }}>{children}</main>
    </div>
  );
}
