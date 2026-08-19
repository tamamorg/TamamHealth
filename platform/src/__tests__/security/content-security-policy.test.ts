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
});
