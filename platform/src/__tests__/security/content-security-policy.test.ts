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

  it('lets the browser reach the LiveKit server, in both schemes it needs', () => {
    const policy = buildContentSecurityPolicy({
      nonce: 'abc123XYZ',
      isDev: false,
      livekitUrl: 'wss://livekit.example.internal/rtc',
    });
    const connect = policy.split('; ').find(part => part.startsWith('connect-src'))!;

    // The signalling socket AND the validate request, which is plain HTTPS to
    // the same host. Neither is implied by the other in a CSP source list.
    expect(connect).toContain('wss://livekit.example.internal');
    expect(connect).toContain('https://livekit.example.internal');
    expect(connect).not.toContain('/rtc');
  });

  it('keeps a local ws:// LiveKit on ws, and widens nothing when there is none', () => {
    const dev = buildContentSecurityPolicy({ nonce: 'dev123', isDev: true, livekitUrl: 'ws://localhost:7880' });
    expect(dev).toContain('ws://localhost:7880');
    expect(dev).toContain('http://localhost:7880');

    const none = buildContentSecurityPolicy({ nonce: 'dev123', isDev: true });
    const connect = none.split('; ').find(part => part.startsWith('connect-src'))!;
    expect(connect).toBe("connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com");
  });
});
