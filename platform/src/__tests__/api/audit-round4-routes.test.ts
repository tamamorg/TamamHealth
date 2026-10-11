/**
 * @jest-environment node
 *
 * Round-4 review findings: lab PATCH lifecycle, medical-record create
 * mass-assignment and facility, prescription supply-field freeze, message
 * existence oracle, and the toOrgId visibility grant.
 */
jest.mock('@/lib/audit/with-audit', () => ({
  AUDIT_ACTION_HEADER: 'x-audit-action',
  withAuditLog: (handler: (...args: unknown[]) => Promise<Response>) => handler,
}));
type Actor = { sub: string; username: string; name: string; role: string; orgId?: string; hospitalId?: string; facilityIds?: string[] };
let actor: Actor;
jest.mock('@/modules/identity/core/api-auth', () => ({
  getAuthPayload: jest.fn(async () => actor),
  unauthorized: jest.fn(() => Response.json({ error: 'unauthorized' }, { status: 401 })),
  forbidden: jest.fn((error = 'forbidden') => Response.json({ error }, { status: 403 })),
  hasRole: jest.fn((auth: { role: string }, roles: string[]) => roles.includes(auth.role)),
  serverError: jest.fn(() => Response.json({ error: 'Internal server error' }, { status: 500 })),
  logApiError: jest.fn(),
}));
jest.mock('@/modules/identity/core/server-users', () => ({ isStandaloneDemo: () => false }));

let inScope = true;
jest.mock('@/lib/services/data-scope', () => ({
  buildScopeFromAuth: jest.fn(() => ({})),
  filterByScope: jest.fn((docs: unknown[]) => (inScope ? docs : [])),
}));

let labDoc: Record<string, unknown>;
const advanceLabOrder = jest.fn(async (id: string, to: string, extra: Record<string, unknown>) => {
  const { effectiveOrderStatus } = jest.requireActual('@/lib/services/lab-service') as { effectiveOrderStatus: (d: unknown) => string };
  const { labOrder } = jest.requireActual('@/lib/clinical-flow/order-lifecycles') as { labOrder: { can: (a: string, b: string) => boolean } };
  const from = effectiveOrderStatus(labDoc);
  if (from !== to && !labOrder.can(from, to)) throw new Error(`Illegal lab order transition: ${from} → ${to}`);
  return { ...labDoc, ...extra, orderStatus: to };
});
const updateLabResult = jest.fn(async (_id: string, d: Record<string, unknown>) => ({ ...labDoc, ...d }));
jest.mock('@/lib/services/lab-service', () => ({
  getLabResultById: jest.fn(async () => labDoc),
  updateLabResult: (id: string, d: Record<string, unknown>) => updateLabResult(id, d),
  advanceLabOrder: (id: string, to: string, extra: Record<string, unknown>) => advanceLabOrder(id, to, extra),
  effectiveOrderStatus: (d: { orderStatus?: string }) => d.orderStatus ?? 'ordered',
}));

const createMedicalRecord = jest.fn(async (d: Record<string, unknown>) => ({ _id: 'rec-1', ...d }));
jest.mock('@/lib/services/medical-record-service', () => ({ createMedicalRecord: (d: Record<string, unknown>) => createMedicalRecord(d) }));
let patient: Record<string, unknown> | null;
jest.mock('@/lib/services/patient-service', () => ({ getPatientById: jest.fn(async () => patient) }));
jest.mock('@/lib/services/hospital-service', () => ({
  getHospitalById: jest.fn(async (id: string) => ({
    'hosp-1': { _id: 'hosp-1', orgId: 'org-a', name: 'Hosp One' },
    'hosp-2': { _id: 'hosp-2', orgId: 'org-a', name: 'Hosp Two' },
    'hosp-x': { _id: 'hosp-x', orgId: 'org-other', name: 'Other' },
  } as Record<string, unknown>)[id] ?? null),
}));

import { NextRequest } from 'next/server';
const json = (url: string, method: string, body?: unknown) => new NextRequest(`http://localhost${url}`, {
  method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
});
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  jest.clearAllMocks();
  inScope = true;
  labDoc = { _id: 'lab-1', type: 'lab_result', orgId: 'org-a', orderStatus: 'in_process', status: 'in_progress' };
  patient = { _id: 'pat-1', orgId: 'org-a', registrationHospital: 'hosp-1' };
  actor = { sub: 'u1', username: 'u1', name: 'Tech One', role: 'lab_tech', orgId: 'org-a', hospitalId: 'hosp-1' };
});

describe('lab PATCH', () => {
  test('status, completedAt and reportedAt from the body are ignored', async () => {
    const { PATCH } = await import('@/app/api/lab/[id]/route');
    const res = await PATCH(json('/api/lab/lab-1', 'PATCH', {
      result: '5.1', status: 'completed', completedAt: '2020-01-01', reportedAt: '2020-01-01', reportedBy: 'someone',
    }), ctx('lab-1'));
    expect(res.status).toBe(200);
    expect(updateLabResult).toHaveBeenCalledTimes(1);
    const patch = updateLabResult.mock.calls[0][1];
    expect(patch.result).toBe('5.1');
    expect(patch.status).toBeUndefined();
    expect(patch.completedAt).toBeUndefined();
    expect(patch.reportedAt).toBeUndefined();
  });

  test('a lab tech advances in_process to resulted, stamped from the session', async () => {
    const { PATCH } = await import('@/app/api/lab/[id]/route');
    const res = await PATCH(json('/api/lab/lab-1', 'PATCH', { orderStatus: 'resulted', result: '5.1', reportedBy: 'forged' }), ctx('lab-1'));
    expect(res.status).toBe(200);
    const extra = advanceLabOrder.mock.calls[0][2];
    expect(advanceLabOrder.mock.calls[0][1]).toBe('resulted');
    expect(extra.reportedBy).toBe('Tech One');
  });

  test('a lab tech cannot mark a result clinician-reviewed', async () => {
    labDoc.orderStatus = 'resulted';
    const { PATCH } = await import('@/app/api/lab/[id]/route');
    const res = await PATCH(json('/api/lab/lab-1', 'PATCH', { orderStatus: 'reviewed_by_clinician' }), ctx('lab-1'));
    expect(res.status).toBe(403);
    expect(advanceLabOrder).not.toHaveBeenCalled();
  });

  test('a doctor can review, with reviewedBy from the session, but cannot write results', async () => {
    labDoc.orderStatus = 'resulted';
    actor = { ...actor, role: 'doctor', name: 'Dr Wani' };
    const { PATCH } = await import('@/app/api/lab/[id]/route');
    expect((await PATCH(json('/api/lab/lab-1', 'PATCH', { result: '9' }), ctx('lab-1'))).status).toBe(403);
    const ok = await PATCH(json('/api/lab/lab-1', 'PATCH', { orderStatus: 'reviewed_by_clinician', reviewedBy: 'forged' }), ctx('lab-1'));
    expect(ok.status).toBe(200);
    expect(advanceLabOrder.mock.calls[0][2].reviewedBy).toBe('Dr Wani');
  });

  test('a resulted test cannot be moved back (409), and a reviewed result cannot be edited', async () => {
    labDoc.orderStatus = 'resulted';
    const { PATCH } = await import('@/app/api/lab/[id]/route');
    expect((await PATCH(json('/api/lab/lab-1', 'PATCH', { orderStatus: 'in_process' }), ctx('lab-1'))).status).toBe(409);
    labDoc.orderStatus = 'reviewed_by_clinician';
    expect((await PATCH(json('/api/lab/lab-1', 'PATCH', { result: 'changed' }), ctx('lab-1'))).status).toBe(409);
  });
});

describe('medical-record create', () => {
  const body = { patientId: 'pat-1', chiefComplaint: 'cough', hospitalId: 'hosp-1' };
  test('lifecycle and attestation fields in the body are dropped', async () => {
    actor = { ...actor, role: 'doctor' };
    const { POST } = await import('@/app/api/medical-records/route');
    const res = await POST(json('/api/medical-records', 'POST', {
      ...body, documentStatus: 'signed', addenda: [{ text: 'forged' }], type: 'x', createdAt: '2000-01-01',
      updatedAt: '2000-01-01', signedBy: 'u9', _id: 'rec-forged',
    }));
    expect(res.status).toBe(201);
    const written = createMedicalRecord.mock.calls[0][0];
    for (const k of ['documentStatus', 'addenda', 'type', 'createdAt', 'updatedAt', 'signedBy', '_id']) {
      expect(written[k]).toBeUndefined();
    }
    expect(written.chiefComplaint).toBe('cough');
  });

  test('a clinician covering a second entitled site can file there', async () => {
    actor = { ...actor, role: 'doctor', facilityIds: ['hosp-2'] };
    const { POST } = await import('@/app/api/medical-records/route');
    await POST(json('/api/medical-records', 'POST', { ...body, hospitalId: 'hosp-2' }));
    expect(createMedicalRecord.mock.calls[0][0].hospitalId).toBe('hosp-2');
  });

  test('a facility outside the entitlement or the org is refused', async () => {
    actor = { ...actor, role: 'doctor' };
    const { POST } = await import('@/app/api/medical-records/route');
    expect((await POST(json('/api/medical-records', 'POST', { ...body, hospitalId: 'hosp-2' }))).status).toBe(403);
    actor = { ...actor, role: 'super_admin', hospitalId: undefined };
    expect((await POST(json('/api/medical-records', 'POST', { ...body, hospitalId: 'hosp-x' }))).status).toBe(403);
    expect(createMedicalRecord).not.toHaveBeenCalled();
  });
});

describe('prescription supply record', () => {
  test('route, frequency, duration and refills are frozen once dispensed', async () => {
    jest.resetModules();
    jest.doMock('@/lib/services/prescription-service', () => ({
      getPrescriptionById: jest.fn(async () => ({ _id: 'rx-1', orgId: 'org-a', status: 'dispensed', dispensedAt: '2026-01-01', quantityDispensed: 10 })),
      updatePrescription: jest.fn(),
    }));
    actor = { ...actor, role: 'doctor' };
    const { PATCH } = await import('@/app/api/prescriptions/[id]/route');
    for (const field of ['route', 'frequency', 'duration', 'refills']) {
      const res = await PATCH(json('/api/prescriptions/rx-1', 'PATCH', { [field]: 'x' }), ctx('rx-1'));
      expect(res.status).toBe(409);
    }
  });
});

describe('messages recipient oracle', () => {
  test('a missing patient and an out-of-scope patient both read 404', async () => {
    jest.resetModules();
    jest.doMock('@/lib/rate-limit', () => ({ rateLimit: jest.fn(async () => ({ allowed: true, resetAt: 0, remaining: 5 })) }));
    jest.doMock('@/modules/communication/services/message-service', () => ({ createMessage: jest.fn(), updateMessage: jest.fn() }));
    actor = { ...actor, role: 'doctor' };
    const { POST } = await import('@/app/api/messages/route');
    patient = null;
    const missing = await POST(json('/api/messages', 'POST', { patientId: 'pat-9', content: 'hi' }));
    patient = { _id: 'pat-1', orgId: 'org-other' };
    inScope = false;
    const foreign = await POST(json('/api/messages', 'POST', { patientId: 'pat-1', content: 'hi' }));
    expect(missing.status).toBe(404);
    expect(foreign.status).toBe(404);
  });
});
