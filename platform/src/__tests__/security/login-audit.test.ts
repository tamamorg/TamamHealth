/**
 * @jest-environment node
 *
 * Every way a sign-in can end has to leave a row on the server.
 *
 * `context.tsx` has always called `logAudit` for both outcomes — but from the
 * BROWSER, into the device's PouchDB, which then push-replicates. That records
 * a sign-in only when the client code runs. An audit on 2026-08-24 found the
 * consequence: a `curl`, a script, an integration, the mobile client, or
 * somebody working through stolen credentials produced no audit row at all, in
 * either direction, because `/api/auth/login` wrote nothing and the `[REQ]`
 * line in the proxy is a `console.log` rather than a sink.
 *
 * For a patient record system, "who signed in and when" is the log most likely
 * to be asked for, and it was the one least likely to exist.
 *
 * Asserted against the source rather than by driving the route: the handler
 * reaches the identity module, the rate limiter and PouchDB, and a mock deep
 * enough to exercise it would test the mock. What matters here is structural —
 * that no exit branch was added without a corresponding audit call — and that
 * is exactly what reading the file can prove.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROUTE = path.join(process.cwd(), 'src/app/api/auth/login/route.ts');
const source = readFileSync(ROUTE, 'utf8');

describe('the login route audits server-side', () => {
  it('uses the fault-tolerant audit writer', () => {
    // `logAuditSafe`, not `logAudit`: a CouchDB hiccup must not turn a valid
    // sign-in into a 500.
    expect(source).toContain("from '@/lib/services/audit-service'");
    expect(source).toContain('logAuditSafe');
  });

  it('never puts the request body in the audit row', () => {
    // This is why the route does not simply use `withAuditLog`: that decorator
    // serialises request details, and the credential is right there in the
    // body. Asserted on the call sites rather than the file, so the helper's
    // own explanation of the hazard does not read as the hazard.
    // The export, not the prose: the route's own comment names `withAuditLog`
    // to explain why it is unsuitable here, and that explanation must not read
    // as a violation of the rule it is explaining.
    expect(source).toMatch(/export const POST\s*=\s*postHandler|export async function POST/);
    expect(source).not.toMatch(/export const POST\s*=\s*withAuditLog/);
    const calls = (source.match(/auditLogin\((?:[^()]|\([^()]*\))*\)/g) ?? [])
      // The declaration itself is not a call site.
      .filter(call => !call.includes('action:'));
    expect(calls.length).toBeGreaterThan(4);
    for (const call of calls) {
      // Strip string and template literals before looking for the credential.
      // `'Unknown user or wrong password'` is a description of the outcome;
      // what must never appear is the VARIABLE, and only an identifier check
      // can tell those apart.
      const identifiers = call.replace(/'[^']*'/g, "''").replace(/`[^`]*`/g, '``');
      expect(identifiers).not.toMatch(/\bpassword\b/);
      expect(identifiers).not.toMatch(/\bbody\b/);
      expect(identifiers).not.toMatch(/JSON\.stringify/);
    }
  });

  it('records the outcome, the account and the caller', () => {
    expect(source).toMatch(/getClientIp\(request\)/);
    expect(source).toContain("'login_success'");
    expect(source).toContain("'login_failed'");
  });
});

describe('no exit branch escapes the log', () => {
  /**
   * Split the handler at each `return NextResponse.json(` and check that a
   * refusal is preceded by an audit call. Structural, so a new branch added
   * later without one fails here.
   */
  const REFUSAL = /status:\s*(401|403|429|503)\b/;

  it('audits every refusal', () => {
    const segments = source.split('return NextResponse.json(');
    const unaudited: string[] = [];
    segments.forEach((segment, i) => {
      if (i === 0) return;                       // preamble, not a return
      const tail = segment.slice(0, 260);        // the status lives just below
      if (!REFUSAL.test(tail)) return;           // 200/400 shapes are not refusals
      const preceding = segments[i - 1].slice(-700);
      if (!preceding.includes('auditLogin(')) {
        unaudited.push(tail.split('\n').map(l => l.trim()).filter(Boolean)[0] ?? '(unknown)');
      }
    });
    expect(unaudited).toEqual([]);
  });

  it('audits the success path', () => {
    const success = source.slice(source.indexOf('issueSessionResponse(user'));
    const before = source.slice(0, source.indexOf('issueSessionResponse(user')).slice(-600);
    expect(before).toContain("auditLogin(\n      'login_success'");
    expect(success.length).toBeGreaterThan(0);
  });

  it('distinguishes the failures an auditor needs apart', () => {
    // A forgotten password and somebody enumerating accounts both surface as
    // "Invalid credentials" to the caller. They must not look identical here.
    for (const reason of ['Unknown user or wrong password', 'Facility mismatch', 'Locked out', 'Users database unreachable']) {
      expect(source).toContain(reason);
    }
  });
});
