/**
 * Patient-portal shell. Deliberately chrome-free: the signed-in top rail
 * (brand + "Patient Portal" title, search, tab nav, user menu) is rendered by
 * the page itself, which owns the active-tab state the nav drives — and the
 * sign-in screen is a full-viewport page exactly like /login, with no header.
 *
 * Type is the platform's IBM Plex, loaded once by the root layout.
 */
export default function PatientPortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
      <main style={{ width: '100%' }}>{children}</main>
    </div>
  );
}
