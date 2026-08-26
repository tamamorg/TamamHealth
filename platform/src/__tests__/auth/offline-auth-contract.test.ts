import fs from 'node:fs';
import path from 'node:path';

const contextSource = fs.readFileSync(path.join(process.cwd(), 'src/lib/context.tsx'), 'utf8');
const clientIdentitySource = fs.readFileSync(path.join(process.cwd(), 'src/modules/identity/client.ts'), 'utf8');

describe('offline authentication boundary', () => {
  it('never creates an authoritative JWT in the browser', () => {
    expect(contextSource).not.toContain('createToken(');
    expect(contextSource).not.toContain('tamamhealth-token=${token}');
    expect(clientIdentitySource).not.toMatch(/export \{ createToken, verifyToken/);
  });

  it('does not treat an absent cookie as server-confirmed expiry', () => {
    expect(contextSource).not.toContain("if (!hasSessionCookie) await wipeLocalData('session-expired')");
    expect(contextSource).toContain("res.status === 401 || res.status === 403");
    expect(contextSource).toContain("wipeLocalData('session-expired')");
  });

  it('keeps replication behind a server-authoritative session', () => {
    expect(contextSource).toContain("sessionMode !== 'online'");
    expect(contextSource).toContain("setSessionMode(usedApi ? 'online' : 'offline')");
  });

  it('does not downgrade a restored server session in the same boot pass', () => {
    expect(contextSource).toContain('let serverSessionRestored = false');
    expect(contextSource).toContain('serverSessionRestored = true');
    expect(contextSource).toContain('if (!serverSessionRestored)');
  });
});
