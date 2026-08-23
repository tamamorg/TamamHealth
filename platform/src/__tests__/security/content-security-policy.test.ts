import { buildContentSecurityPolicy } from '@/lib/security/content-security-policy';

describe('strict content security policy', () => {
  it('allows only nonce-trusted scripts in production', () => {
    const policy = buildContentSecurityPolicy({
      nonce: 'abc123XYZ',
      isDev: false,
      couchdbUrl: 'https://couch.example.org/path',
      posthogHost: 'https://metrics.example.org/capture',
    });

    expect(policy).toContain("script-src 'self' 'nonce-abc123XYZ' 'strict-dynamic'");
    const scriptDirective = policy.split('; ').find(part => part.startsWith('script-src'));
    expect(scriptDirective).not.toContain("'unsafe-inline'");
    expect(scriptDirective).not.toContain("'unsafe-eval'");
    expect(policy).toContain('https://couch.example.org');
    expect(policy).toContain('https://metrics.example.org');
    expect(policy).not.toContain('/path');
  });

  it('keeps unsafe-eval development-only and rejects nonce injection', () => {
    expect(buildContentSecurityPolicy({ nonce: 'dev123', isDev: true }))
      .toContain("'unsafe-eval'");
    expect(() => buildContentSecurityPolicy({ nonce: "x'; script-src *", isDev: false }))
      .toThrow('invalid characters');
  });

  it('does not widen connect-src beyond what the app dials', () => {
    // The policy is the fixed set below; a future addition has to be
    // deliberate rather than inherited.
    const policy = buildContentSecurityPolicy({ nonce: 'dev123', isDev: true });
    const connect = policy.split('; ').find(part => part.startsWith('connect-src'))!;
    expect(connect).toBe("connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com");
  });

  it('upgrades insecure requests only on an HTTPS origin', () => {
    // Production over TLS keeps the hardening.
    expect(buildContentSecurityPolicy({ nonce: 'abc', isDev: false, isSecureOrigin: true }))
      .toContain('upgrade-insecure-requests');
    // Omitting it must not silently drop the directive.
    expect(buildContentSecurityPolicy({ nonce: 'abc', isDev: false }))
      .toContain('upgrade-insecure-requests');
    // On plain HTTP the directive rewrites the app's own absolute http URLs —
    // the CouchDB gateway among them — into https against a listener that
    // speaks no TLS, and replication dies silently.
    const http = buildContentSecurityPolicy({
      nonce: 'abc', isDev: true, isSecureOrigin: false,
      couchdbUrl: 'http://localhost:3000/api/couch',
    });
    expect(http).not.toContain('upgrade-insecure-requests');
    expect(http).toContain('http://localhost:3000');
  });
});
