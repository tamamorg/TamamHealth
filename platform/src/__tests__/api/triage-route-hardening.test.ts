/**
 * POST /api/triage hardening (KAN triage audit, item 6).
 *
 * Before this change the route trusted whatever the caller posted as
 * `vitalUrgencyRecommendation`/`vitalUrgencyWarnings` and never itself
 * checked the posted vitals against IITT's danger thresholds — a caller
 * could POST SpO2 70 with `priority: 'GREEN'` and no override and be
 * accepted outright. It also ran its own ETAT calculator with no
 * incompleteness guard, so an unassessed POST (no airway/breathing/
 * circulation/consciousness at all) silently scored and stored as GREEN
 * (KAN-100).
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-route` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());
jest.mock('@/modules/identity/core/api-auth', () => {
  const actual = jest.requireActual('@/modules/identity/core/api-auth');
  return { ...actual, getAuthPayload: jest.fn() };
});
jest.mock('@/lib/services/audit-service', () => {
  const actual = jest.requireActual('@/lib/services/audit-service');
  return { ...actual, logAuditSafe: jest.fn().mockResolvedValue(undefined) };
});
// See referral-appointment-scope.test.ts / phi-read-audit.test.ts for why
// next/server needs undici's Response/Request/Headers swapped in before it
// is first required under jsdom.
jest.mock('next/server', () => {
  const { ReadableStream, WritableStream, TransformStream } = require('node:stream/web');
  const { MessageChannel, MessagePort } = require('node:worker_threads');
  Object.assign(globalThis, { ReadableStream, WritableStream, TransformStream, MessageChannel, MessagePort });
  const undici = require('undici');
  Object.assign(globalThis, {
    Response: undici.Response, Request: undici.Request, Headers: undici.Headers, fetch: undici.fetch,
  });
  return jest.requireActual('next/server');
});

jest.setTimeout(30000);

import type { NextRequest } from 'next/server';
import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { patientsDB } from '@/lib/db';
import { getAuthPayload, type AuthPayload } from '@/modules/identity/core/api-auth';
import { logAuditSafe } from '@/lib/services/audit-service';
import type { PatientDoc } from '@/lib/db-types';

const mockGetAuth = getAuthPayload as jest.MockedFunction<typeof getAuthPayload>;
const mockLogAuditSafe = logAuditSafe as jest.MockedFunction<typeof logAuditSafe>;

const NURSE: AuthPayload = { sub: 'user-nurse', username: 'nurse1', role: 'nurse', name: 'Nurse Test', orgId: 'org-a', hospitalId: 'hosp-a' };

function postRequest(body: Record<string, unknown>): NextRequest {
  return new Request('http://test/api/triage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    patientId: 'patient-1',
    patientName: 'Test Patient',
    airway: 'clear',
    breathing: 'normal',
    circulation: 'normal',
    consciousness: 'alert',
    ...overrides,
  };
}

afterEach(async () => {
  await teardownTestDBs();
  uuidCounter = 0;
  jest.clearAllMocks();
});

describe('server-side vitals recompute (never trusting the client)', () => {
  test('dangerous vitals + GREEN priority + no override is rejected, even claiming a GREEN recommendation', async () => {
    mockGetAuth.mockResolvedValue(NURSE);
    const { POST } = await import('@/app/api/triage/route');
    const res = await POST(postRequest(basePayload({
      priority: 'GREEN',
      oxygenSaturation: '70', // IITT high-risk SpO2 <92, regardless of age
      vitalUrgencyRecommendation: 'GREEN',
      vitalUrgencyWarnings: [],
    })));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Saving below the recommended triage urgency/);
  });

  test('the same dangerous vitals, posted with a recorded override reason, are accepted and audited', async () => {
    mockGetAuth.mockResolvedValue(NURSE);
    const { POST } = await import('@/app/api/triage/route');
    const res = await POST(postRequest(basePayload({
      priority: 'GREEN',
      oxygenSaturation: '70',
      vitalUrgencyOverridden: true,
      vitalUrgencyOverrideReason: 'Repeat reading pending; patient stable on room air, monitored closely.',
    })));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.triage.priority).toBe('GREEN');
    expect(body.triage.vitalUrgencyOverridden).toBe(true);
    // The stored recommendation/warnings are the server's own computation,
    // not the (absent, in this case) client claim.
    expect(body.triage.vitalUrgencyRecommendation).toBe('YELLOW');
    expect(body.triage.vitalUrgencyWarnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'IITT_HIGH_RISK_SPO2' }),
    ]));

    expect(mockLogAuditSafe).toHaveBeenCalledWith(
      'TRIAGE_RECORDED', 'user-nurse', 'Nurse Test', expect.stringContaining('GREEN triage'),
    );
    expect(mockLogAuditSafe).toHaveBeenCalledWith(
      'TRIAGE_URGENCY_OVERRIDE', 'user-nurse', 'Nurse Test', expect.stringContaining('Repeat reading pending'),
    );
  });

  test('a client-supplied vitalUrgencyRecommendation cannot substitute for the real one when there ARE no dangerous vitals', async () => {
    mockGetAuth.mockResolvedValue(NURSE);
    const { POST } = await import('@/app/api/triage/route');
    // A caller falsely claims RED to see if it gets stored verbatim.
    const res = await POST(postRequest(basePayload({
      priority: 'GREEN',
      vitalUrgencyRecommendation: 'RED',
    })));
    expect(res.status).toBe(201);
    const body = await res.json();
    // Nothing dangerous was actually posted, so the server's own
    // recomputation is GREEN — the false claim is discarded, not stored.
    expect(body.triage.vitalUrgencyRecommendation).toBe('GREEN');
  });

  test('age-banded thresholds use the patient\'s real age when a local record exists', async () => {
    await putDoc(patientsDB(), {
      _id: 'patient-adult', type: 'patient', firstName: 'Adult', surname: 'Patient',
      dateOfBirth: '1990-01-01',
    } as unknown as PatientDoc & { _id: string });

    mockGetAuth.mockResolvedValue(NURSE);
    const { POST } = await import('@/app/api/triage/route');
    // Adult pulse 160 is RED (>150); GREEN priority below that must be
    // refused without an override.
    const res = await POST(postRequest(basePayload({
      patientId: 'patient-adult', priority: 'GREEN', pulse: '160',
    })));
    expect(res.status).toBe(400);
  });
});

describe('ETAT incompleteness guard (item 5, enforced at the route)', () => {
  test('a POST with no ABCC assessment at all and no explicit priority is rejected, not silently scored GREEN', async () => {
    mockGetAuth.mockResolvedValue(NURSE);
    const { POST } = await import('@/app/api/triage/route');
    const res = await POST(postRequest({
      patientId: 'patient-1', patientName: 'Test Patient',
      // No airway/breathing/circulation/consciousness, no priority.
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/priority is required/i);
  });

  test('an explicit priority is still honoured for an unassessed (clerical) triage', async () => {
    mockGetAuth.mockResolvedValue(NURSE);
    const { POST } = await import('@/app/api/triage/route');
    const res = await POST(postRequest({
      patientId: 'patient-1', patientName: 'Test Patient',
      priority: 'YELLOW', assessmentSource: 'clerical_checkin',
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.triage.priority).toBe('YELLOW');
    expect(body.triage.airway).toBe('not_assessed');
  });

  test('a complete, non-emergency ABCC still auto-derives GREEN with no explicit priority', async () => {
    mockGetAuth.mockResolvedValue(NURSE);
    const { POST } = await import('@/app/api/triage/route');
    const res = await POST(postRequest(basePayload()));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.triage.priority).toBe('GREEN');
  });
});

describe('cross-tenant scoping and the shared service path (KAN triage audit F3)', () => {
  test('a patientId belonging to a different org resolves as age-unknown — no cross-tenant existence oracle', async () => {
    // NURSE is in org-a; this patient is registered to org-b. A 3-day-old
    // meets IITT's under-8-days RED criterion regardless of vitals — if the
    // real age reached the recompute, GREEN would be refused below it. The
    // route must not read this patient at all: treated as not-found, it
    // succeeds exactly like a patientId this device has never seen.
    await putDoc(patientsDB(), {
      _id: 'patient-foreign-infant', type: 'patient', firstName: 'Newborn', surname: 'Foreign',
      dateOfBirth: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      orgId: 'org-b', registrationHospital: 'hosp-b',
    } as unknown as PatientDoc & { _id: string });

    mockGetAuth.mockResolvedValue(NURSE);
    const { POST } = await import('@/app/api/triage/route');
    const res = await POST(postRequest(basePayload({ patientId: 'patient-foreign-infant', priority: 'GREEN' })));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.triage.vitalUrgencyRecommendation).toBe('GREEN');
    expect(body.triage.vitalUrgencyWarnings).toBeUndefined();
  });

  test('a valid POST is routed through createTriage — the duplicate-active-triage guard now applies', async () => {
    // The old direct `db.put` bypassed createTriage entirely, so a second
    // POST for the same still-active patient wrote a second triage record
    // outright instead of being refused.
    mockGetAuth.mockResolvedValue(NURSE);
    const { POST } = await import('@/app/api/triage/route');
    const first = await POST(postRequest(basePayload({ patientId: 'patient-dup', priority: 'GREEN' })));
    expect(first.status).toBe(201);

    const second = await POST(postRequest(basePayload({ patientId: 'patient-dup', priority: 'GREEN' })));
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.error).toMatch(/already has an active triage/i);
  });
});
