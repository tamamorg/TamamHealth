/**
 * @jest-environment node
 *
 * `/api/auth/change-password` wrote no audit row at all — a password change,
 * whether by the account owner or a compromised session, is exactly the kind
 * of event an access review needs to find. This mirrors `login-audit.test.ts`:
 * asserted against the source rather than by driving the route, because the
 * handler reaches the identity module and PouchDB, and a mock deep enough to
 * exercise it would test the mock rather than the audit contract.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROUTE = path.join(process.cwd(), 'src/app/api/auth/change-password/route.ts');
const source = readFileSync(ROUTE, 'utf8');

describe('the change-password route audits server-side', () => {
  it('uses the fault-tolerant audit writer, like login does', () => {
    expect(source).toContain("from '@/lib/services/audit-service'");
    expect(source).toContain('logAuditSafe');
  });

  it('does not use withAuditLog — the request body carries raw passwords', () => {
    expect(source).not.toMatch(/export const POST\s*=\s*withAuditLog/);
    expect(source).toMatch(/export async function POST/);
  });

  it('records both a success and a failure outcome', () => {
    expect(source).toContain("'password_change_success'");
    expect(source).toContain("'password_change_failed'");
  });

  it('never puts a password into the audit call', () => {
    const calls = source.match(/logAuditSafe\((?:[^()]|\([^()]*\))*\)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const call of calls) {
      // Strip string literals before checking for identifiers — the outcome
      // description ("Current password is incorrect") is prose, not a leak.
      const identifiers = call.replace(/'[^']*'/g, "''");
      expect(identifiers).not.toMatch(/\bcurrentPassword\b/);
      expect(identifiers).not.toMatch(/\bnewPassword\b/);
      expect(identifiers).not.toMatch(/\bbody\b/);
    }
  });

  it('audits the wrong-current-password failure before refusing the request', () => {
    const idx = source.indexOf('current password is incorrect');
    expect(idx).toBeGreaterThan(-1);
    const around = source.slice(idx, idx + 900);
    expect(around).toContain("logAuditSafe('password_change_failed'");
    expect(around).toContain("status: 400");
  });

  it('audits success once the password has actually changed, before the response is built', () => {
    const changeIdx = source.indexOf('await changeOwnPassword(');
    const successLogIdx = source.indexOf("logAuditSafe('password_change_success'");
    const responseIdx = source.indexOf("NextResponse.json({ success: true })");
    expect(changeIdx).toBeGreaterThan(-1);
    expect(successLogIdx).toBeGreaterThan(changeIdx);
    expect(responseIdx).toBeGreaterThan(successLogIdx);
  });
});
