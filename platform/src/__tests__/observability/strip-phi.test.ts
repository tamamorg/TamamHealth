/**
 * `stripPHI` is the Sentry `beforeSend` hook. These tests pin down the exact
 * scrub rules so the policy documented in `docs/operations/monitoring.md`
 * can't silently drift.
 */
import type { Event } from '@sentry/core';
import { stripPHI } from '@/lib/observability';

describe('stripPHI', () => {
  it('redacts request.headers.cookie regardless of casing', () => {
    const event: Event = {
      request: {
        headers: {
          'user-agent': 'jest',
          Cookie: 'tamamhealth-token=abc; tamamhealth-csrf=xyz',
        },
      },
    };
    const out = stripPHI(event);
    expect(out.request?.headers).toMatchObject({
      'user-agent': 'jest',
      Cookie: '[redacted]',
    });
  });

  it('redacts lowercase cookie header', () => {
    const event: Event = {
      request: { headers: { cookie: 'tamamhealth-token=abc' } },
    };
    const out = stripPHI(event);
    expect((out.request?.headers as Record<string, unknown>).cookie).toBe('[redacted]');
  });

  it('redacts request.data keys named like email/phone/dob/password/passwordHash/nationalId/notes', () => {
    const event: Event = {
      request: {
        data: {
          username: 'alice',
          email: 'support.tamam@gmail.com',
          phone: '+211912345678',
          dob: '1980-01-01',
          password: 'hunter2',
          passwordHash: '$2b$10$xxx',
          nationalId: 'NID-12345',
          notes: 'patient prefers morning visits',
        } as Record<string, unknown>,
      },
    };
    const out = stripPHI(event);
    const data = out.request!.data as Record<string, unknown>;
    expect(data.username).toBe('alice');
    expect(data.email).toBe('[redacted]');
    expect(data.phone).toBe('[redacted]');
    expect(data.dob).toBe('[redacted]');
    expect(data.password).toBe('[redacted]');
    expect(data.passwordHash).toBe('[redacted]');
    expect(data.nationalId).toBe('[redacted]');
    expect(data.notes).toBe('[redacted]');
  });

  it('redacts PHI keys deep inside nested objects', () => {
    const event: Event = {
      extra: {
        user: { id: '1', email: 'x@y.z' },
        patient: {
          identifiers: { nationalId: 'NID-1', mrn: 'MRN-1' },
          contact: { phone: '+1234' },
        },
      },
    };
    const out = stripPHI(event);
    const extra = out.extra as {
      user: Record<string, unknown>;
      patient: {
        identifiers: Record<string, unknown>;
        contact: Record<string, unknown>;
      };
    };
    expect(extra.user.id).toBe('1');
    expect(extra.user.email).toBe('[redacted]');
    expect(extra.patient.identifiers.nationalId).toBe('[redacted]');
    expect(extra.patient.identifiers.mrn).toBe('MRN-1');
    expect(extra.patient.contact.phone).toBe('[redacted]');
  });

  it('redacts PHI keys inside arrays', () => {
    const event: Event = {
      extra: {
        contacts: [
          { name: 'Alice', email: 'a@b.c' },
          { name: 'Bob', phone: '+1' },
        ],
      },
    };
    const out = stripPHI(event);
    const contacts = (out.extra as { contacts: Record<string, unknown>[] }).contacts;
    expect(contacts[0].email).toBe('[redacted]');
    expect(contacts[1].phone).toBe('[redacted]');
    expect(contacts[0].name).toBe('Alice');
  });

  it('redacts PHI inside breadcrumb data payloads', () => {
    const event: Event = {
      breadcrumbs: [
        {
          category: 'request',
          message: 'POST /api/patients',
          data: { email: 'p@q.r', method: 'POST' },
        },
      ],
    };
    const out = stripPHI(event);
    const crumb = out.breadcrumbs![0];
    expect(crumb.data!.email).toBe('[redacted]');
    expect(crumb.data!.method).toBe('POST');
  });

  it('matches PHI keys case-insensitively and as substrings', () => {
    const event: Event = {
      extra: {
        Email: 'a@b.c',
        userPhone: '+1',
        DOB: '2000-01-01',
        password_confirm: 'x',
        national_id: 'N-1',
      },
    };
    const out = stripPHI(event);
    const extra = out.extra as Record<string, unknown>;
    expect(extra.Email).toBe('[redacted]');
    expect(extra.userPhone).toBe('[redacted]');
    expect(extra.DOB).toBe('[redacted]');
    expect(extra.password_confirm).toBe('[redacted]');
    expect(extra.national_id).toBe('[redacted]');
  });

  it('survives cyclic references without throwing', () => {
    const cyclic: Record<string, unknown> = { name: 'root' };
    cyclic.self = cyclic;
    const event: Event = { extra: { cyclic } };
    expect(() => stripPHI(event)).not.toThrow();
  });

  it('returns the same event object (mutates in place)', () => {
    const event: Event = { extra: { email: 'a@b.c' } };
    const out = stripPHI(event);
    expect(out).toBe(event);
  });

  it('is a no-op on an empty event', () => {
    const event: Event = {};
    expect(() => stripPHI(event)).not.toThrow();
    expect(stripPHI(event)).toEqual({});
  });

  it('does not redact non-PHI keys that look similar', () => {
    const event: Event = {
      extra: {
        emailSent: true,            // boolean flag — value still redacted (key matches /email/i)
        phoneticName: 'Alice',      // matches /phone/i — value redacted
        patientId: 'P-1',           // does NOT match — preserved
        username: 'alice',          // does NOT match — preserved
      },
    };
    const out = stripPHI(event);
    const extra = out.extra as Record<string, unknown>;
    // Substring-aware match: these get scrubbed even though the field is
    // not literally named "email" / "phone". This is the documented policy
    // — we err on the side of over-redaction.
    expect(extra.emailSent).toBe('[redacted]');
    expect(extra.phoneticName).toBe('[redacted]');
    expect(extra.patientId).toBe('P-1');
    expect(extra.username).toBe('alice');
  });

  it('the exposed PHI key pattern list matches the documented policy', () => {
    // Guards against the pattern list silently drifting from what
    // docs/operations/monitoring.md documents as the contract.
    const source = require('@/lib/observability').__PHI_KEY_PATTERNS_FOR_TESTING as RegExp[];
    const names = ['email', 'phone', 'dob', 'password', 'passwordHash', 'nationalId', 'national_id', 'notes'];
    for (const key of names) {
      expect(source.some((re) => re.test(key))).toBe(true);
    }
    // A representative non-PHI key must not match any pattern.
    expect(source.some((re) => re.test('username'))).toBe(false);
  });
});
