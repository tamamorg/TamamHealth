import T from '@/components/T';

export default function NotFound() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      fontFamily: "var(--font-platform)",
    }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '0.5rem' }}>404</h1>
        <p style={{ color: 'var(--text-muted)' }}><T k="ui.pageNotFound" en="Page not found" /></p>
      </div>
    </div>
  );
}
