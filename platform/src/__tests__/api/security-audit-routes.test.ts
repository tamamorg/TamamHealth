/**
 * @jest-environment node
 *
 * Behavioural coverage for the security-audit route fixes: mass assignment,
 * redaction, prescription lifecycle, transfer scope, the messages SMS relay,
 * the receipts relay and the portal session check.
 */
jest.mock('@/lib/audit/with-audit', () => ({
  AUDIT_ACTION_HEADER: 'x-audit-action',
  withAuditLog: (handler: (...args: unknown[]) => Promise<Response>) => handler,
}));

type Actor = { sub: string; username: string; name: string; role: string; orgId?: string; hospitalId?: string };
let actor: Actor = { sub: 'u1', username: 'u1', name: 'U One', role: 'front_desk', orgId: 'org-a', hospitalId: 'h1' };
jest.mock('@/modules/identity/core/api-auth', () => ({
  getAuthPayload: jest.fn(async () => actor),
  unauthorized: jest.fn(() => Response.json({ error: 'unauthorized' }, { status: 401 })),
  forbidden: jest.fn((error = 'forbidden') => Response.json({ error }, { status: 403 })),
  hasRole: jest.fn((auth: { role: string }, roles: string[]) => roles.includes(auth.role)),
  serverError: jest.fn(() => Response.json({ error: 'Internal server error' }, { status: 500 })),
  validationError: jest.fn(() => Response.json({ error: 'validation' }, { status: 422 })),
  logApiError: jest.fn(),
}));
jest.mock('@/modules/identity/core/server-users', () => ({ isStandaloneDemo: () => false }));

let inScope = true;
jest.mock('@/lib/services/data-scope', () => ({
  buildScopeFromAuth: jest.fn(() => ({})),
  filterByScope: jest.fn((docs: unknown[]) => (inScope ? docs : [])),
}));

const STORED_PATIENT = {
  _id: 'pat-1', type: 'patient', firstName: 'A', surname: 'B', orgId: 'org-a',
  portalUsername: 'asha', portalPasswordHash: '$2b$secret', portalInviteTokenHash: 'tokenhash',
};
const updatePatient = jest.fn(async (_id: string, data: Record<string, unknown>) => ({ ...STORED_PATIENT, ...data }));
jest.mock('@/lib/services/patient-service', () => ({
  getPatientById: jest.fn(async () => ({ ...STORED_PATIENT, email: 'asha@example.org', phone: '+211912345678' })),
  getAllPatients: jest.fn(async () => [STORED_PATIENT]),
  searchPatients: jest.fn(async () => [STORED_PATIENT]),
  updatePatient: (id: string, d: Record<string, unknown>) => updatePatient(id, d),
  createPatient: jest.fn(async (d: Record<string, unknown>) => ({ ...STORED_PATIENT, ...d })),
}));
jest.mock('@/lib/services/audit-service', () => ({
  logPhiRead: jest.fn(async () => undefined), logPhiSearch: jest.fn(async () => undefined),
  logDataAccess: jest.fn(async () => undefined),
}));

import { NextRequest } from 'next/server';

const json = (url: string, method: string, body?: unknown) => new NextRequest(`http://localhost${url}`, {
  method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
});
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  jest.clearAllMocks();
  inScope = true;
  actor = { sub: 'u1', username: 'u1', name: 'U One', role: 'front_desk', orgId: 'org-a', hospitalId: 'h1' };
});

describe('patients', () => {
  it('PATCH drops portal credentials and ownership fields before they reach updatePatient', async () => {
    const { PATCH } = await import('@/app/api/patients/[id]/route');
    const res = await PATCH(json('/api/patients/pat-1', 'PATCH', {
      phone: '+211911111111',
      portalPasswordHash: 'evil', portalUsername: 'evil', portalInviteTokenHash: 'evil',
      portalInviteExpiresAt: '2099-01-01', portalDisabledAt: '', portalEnabledAt: 'x', portalEnabledBy: 'x',
      portalLastLoginAt: 'x', orgId: 'org-evil', countryId: 'XX', hospitalNumber: 'HACK', registrationHospital: 'h-evil',
    }), ctx('pat-1'));
    expect(res.status).toBe(200);
    expect(updatePatient).toHaveBeenCalledTimes(1);
    const patch = updatePatient.mock.calls[0][1];
    expect(patch).toEqual({ phone: '+211911111111' });
    const out = await res.json();
    expect(out.patient.portalPasswordHash).toBeUndefined();
    expect(out.patient.portalInviteTokenHash).toBeUndefined();
  });

  it('GET by id never returns credential hashes, only booleans', async () => {
    actor.role = 'doctor';
    const { GET } = await import('@/app/api/patients/[id]/route');
    const res = await GET(json('/api/patients/pat-1', 'GET'), ctx('pat-1'));
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('$2b$secret');
    expect(JSON.stringify(body)).not.toContain('tokenhash');
    expect(body.patient).toMatchObject({ portalHasPassword: true, portalInvitePending: true });
  });

  it('GET list never returns credential hashes', async () => {
    actor.role = 'doctor';
    const { GET } = await import('@/app/api/patients/route');
    const res = await GET(json('/api/patients', 'GET'));
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain('$2b$secret');
    expect(text).not.toContain('tokenhash');
  });

  it('POST ignores portal fields and a body orgId', async () => {
    const { POST } = await import('@/app/api/patients/route');
    const { createPatient } = await import('@/lib/services/patient-service');
    await POST(json('/api/patients', 'POST', {
      firstName: 'N', surname: 'M', orgId: 'org-evil', portalPasswordHash: 'evil', portalUsername: 'evil',
    }));
    const arg = (createPatient as jest.Mock).mock.calls[0][0];
    expect(arg.orgId).toBe('org-a');
    expect(arg.portalPasswordHash).toBeUndefined();
    expect(arg.portalUsername).toBeUndefined();
  });
});

describe('prescriptions generic PATCH', () => {
  const rx = { _id: 'rx-1', type: 'prescription', status: 'pending', medication: 'Amox', dose: '500mg', orgId: 'org-a', hospitalId: 'h1', patientId: 'pat-1' };
  const updatePrescription = jest.fn(async (_id: string, d: Record<string, unknown>) => ({ ...rx, ...d }));
  beforeEach(() => {
    jest.doMock('@/lib/services/prescription-service', () => ({
      getPrescriptionById: jest.fn(async () => rx),
      updatePrescription: (id: string, d: Record<string, unknown>) => updatePrescription(id, d),
    }));
    jest.resetModules();
  });

  it('a pharmacist cannot change status, medication, dose or quantity', async () => {
    actor = { ...actor, role: 'pharmacist' };
    const { PATCH } = await import('@/app/api/prescriptions/[id]/route');
    for (const body of [{ status: 'discontinued' }, { orderStatus: 'dispensed' }, { medication: 'Morphine' }, { dose: '9g' }, { quantityToDispense: 999 }]) {
      const res = await PATCH(json('/api/prescriptions/rx-1', 'PATCH', body), ctx('rx-1'));
      expect(res.status).toBe(403);
    }
    expect(updatePrescription).not.toHaveBeenCalled();
  });

  it('a prescriber cannot jump status, and identity fields are never merged', async () => {
    actor = { ...actor, role: 'doctor' };
    const { PATCH } = await import('@/app/api/prescriptions/[id]/route');
    const jump = await PATCH(json('/api/prescriptions/rx-1', 'PATCH', { status: 'discontinued' }), ctx('rx-1'));
    expect(jump.status).toBe(403);
    const ok = await PATCH(json('/api/prescriptions/rx-1', 'PATCH', {
      frequency: 'BD', patientId: 'pat-other', orgId: 'org-evil', prescribedBy: 'someone',
    }), ctx('rx-1'));
    expect(ok.status).toBe(200);
    expect(updatePrescription).toHaveBeenCalledWith('rx-1', { frequency: 'BD' });
  });
});

describe('transfers POST', () => {
  it('refuses a referral outside the caller scope with 404 and does not mutate it', async () => {
    const acceptReferral = jest.fn();
    jest.doMock('@/lib/services/referral-service', () => ({
      getReferralById: jest.fn(async () => ({ _id: 'ref-1', orgId: 'org-other' })),
      acceptReferral, updateReferralStatus: jest.fn(), updateReferralNotes: jest.fn(),
    }));
    jest.resetModules();
    actor = { ...actor, role: 'doctor' };
    inScope = false;
    const { POST } = await import('@/app/api/transfers/route');
    const res = await POST(json('/api/transfers', 'POST', { action: 'acknowledge', referralId: 'ref-1' }));
    expect(res.status).toBe(404);
    expect(acceptReferral).not.toHaveBeenCalled();
  });
});

describe('messages relay', () => {
  it('staff recipient: the body phone is ignored and an out-of-org user is refused', async () => {
    const sendSms = jest.fn(async () => ({ ok: true }));
    jest.doMock('@/lib/sms', () => ({ sendSms }));
    jest.doMock('@/modules/identity/services/user-service', () => ({
      getUserById: jest.fn(async () => ({ _id: 'u9', name: 'Other', orgId: 'org-other', isActive: true, phone: '+211900000001' })),
    }));
    jest.doMock('@/lib/rate-limit', () => ({ rateLimit: jest.fn(async () => ({ allowed: true, resetAt: 0, remaining: 5 })) }));
    jest.doMock('@/modules/communication/services/message-service', () => ({
      createMessage: jest.fn(async (m: Record<string, unknown>) => ({ _id: 'm1', ...m })), updateMessage: jest.fn(),
    }));
    jest.resetModules();
    actor = { ...actor, role: 'doctor' };
    const { POST } = await import('@/app/api/messages/route');
    const res = await POST(json('/api/messages', 'POST', {
      patientId: 'u9', recipientType: 'staff', channel: 'sms', content: 'hi', patientPhone: '+211999999999',
    }));
    expect(res.status).toBe(404);
    await new Promise(r => setTimeout(r, 10));
    expect(sendSms).not.toHaveBeenCalled();
  });

  it('SMS sends are rate limited per sender', async () => {
    jest.doMock('@/lib/rate-limit', () => ({ rateLimit: jest.fn(async () => ({ allowed: false, resetAt: Date.now() + 1000, remaining: 0 })) }));
    jest.resetModules();
    actor = { ...actor, role: 'doctor' };
    const { POST } = await import('@/app/api/messages/route');
    const res = await POST(json('/api/messages', 'POST', { patientId: 'pat-1', channel: 'sms', content: 'hi' }));
    expect(res.status).toBe(429);
  });
});

describe('medical-records POST', () => {
  it('takes authorship from the session and refuses an out-of-scope patient', async () => {
    const createMedicalRecord = jest.fn(async (r: Record<string, unknown>) => ({ _id: 'mr1', ...r }));
    jest.doMock('@/lib/services/medical-record-service', () => ({ createMedicalRecord }));
    jest.resetModules();
    actor = { ...actor, role: 'doctor' };
    const { POST } = await import('@/app/api/medical-records/route');
    await POST(json('/api/medical-records', 'POST', {
      patientId: 'pat-1', consultedBy: 'impostor', consultedByName: 'Impostor', chiefComplaint: 'cough',
    }));
    const arg = createMedicalRecord.mock.calls[0][0] as Record<string, unknown>;
    expect(arg).toMatchObject({ consultedBy: 'u1', consultedByName: 'U One', hospitalId: 'h1' });
    // A facility outside the caller's assignment is refused, not silently honoured.
    createMedicalRecord.mockClear();
    const evil = await POST(json('/api/medical-records', 'POST', { patientId: 'pat-1', hospitalId: 'h-evil' }));
    expect(evil.status).toBe(403);
    expect(createMedicalRecord).not.toHaveBeenCalled();
    inScope = false;
    createMedicalRecord.mockClear();
    const res = await POST(json('/api/medical-records', 'POST', { patientId: 'pat-1' }));
    expect(res.status).toBe(404);
    expect(createMedicalRecord).not.toHaveBeenCalled();
  });
});

describe('receipts email relay', () => {
  it('refuses an address that is not the patient email on file', async () => {
    jest.doMock('@/lib/db', () => ({
      paymentsDB: () => ({ get: async () => ({ _id: 'pay-1', type: 'payment', patientId: 'pat-1', patientName: 'A B', amount: 5, currency: 'SSP', method: 'cash', processedAt: new Date().toISOString(), processedByName: 'x', orgId: 'org-a' }) }),
    }));
    jest.doMock('@/lib/services/payment-service', () => ({ getPaymentByReference: jest.fn(async () => null) }));
    jest.doMock('@/lib/rate-limit', () => ({ rateLimit: jest.fn(async () => ({ allowed: true, resetAt: 0, remaining: 5 })) }));
    jest.resetModules();
    actor = { ...actor, role: 'cashier' };
    const { POST } = await import('@/app/api/receipts/email/route');
    const bad = await POST(json('/api/receipts/email', 'POST', { to: 'attacker@evil.test', paymentId: 'pay-1', subject: 'x', html: '<b>x</b>' }));
    expect(bad.status).toBe(403);
    const ok = await POST(json('/api/receipts/email', 'POST', { to: 'asha@example.org', paymentId: 'pay-1' }));
    expect(ok.status).toBe(200);
    inScope = false;
    const gone = await POST(json('/api/receipts/email', 'POST', { to: 'asha@example.org', paymentId: 'pay-1' }));
    expect(gone.status).toBe(404);
  });
});
