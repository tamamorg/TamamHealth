/**
 * @jest-environment node
 *
 * Cross-tenant patient takeover via referral create + accept.
 *   - a referral can only be raised for a patient inside the caller's scope;
 *   - accept / acknowledge are RECEIVER actions, never the sender's;
 *   - cancel is a SENDER action;
 *   - a legitimate cross-org referral accepted by the receiver still re-homes
 *     the patient, and only when the sending org owned the patient.
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
jest.mock('@/lib/services/audit-service', () => ({
  logPhiSearch: jest.fn(async () => undefined), logAuditSafe: jest.fn(async () => undefined),
}));

const ORG_A_PATIENT = { _id: 'pat-a', type: 'patient', orgId: 'org-a', registrationHospital: 'hosp-a' };
const getPatientById = jest.fn(async (id: string) => (id === 'pat-a' ? ORG_A_PATIENT : null));
jest.mock('@/lib/services/patient-service', () => ({ getPatientById: (id: string) => getPatientById(id) }));

let referral: Record<string, unknown>;
const acceptReferral = jest.fn(async () => ({ ...referral, status: 'seen' }));
const updateReferralStatus = jest.fn(async (_id: string, status: string) => ({ ...referral, status }));
const createReferral = jest.fn(async (d: Record<string, unknown>) => ({ _id: 'ref-new', ...d }));
jest.mock('@/lib/services/referral-service', () => ({
  getReferralById: jest.fn(async () => referral),
  acceptReferral: () => acceptReferral(),
  updateReferralStatus: (id: string, s: string) => updateReferralStatus(id, s),
  updateReferralNotes: jest.fn(),
  createReferral: (d: Record<string, unknown>) => createReferral(d),
}));

import { NextRequest } from 'next/server';
import { POST as referralsPost } from '@/app/api/referrals/route';
import { POST as transfersPost } from '@/app/api/transfers/route';

const post = (url: string, body: unknown) => new NextRequest(`http://localhost${url}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

const orgBDoctor: Actor = { sub: 'u-b', username: 'b', name: 'Dr B', role: 'doctor', orgId: 'org-b', hospitalId: 'hosp-b' };
const orgADoctor: Actor = { sub: 'u-a', username: 'a', name: 'Dr A', role: 'doctor', orgId: 'org-a', hospitalId: 'hosp-a' };

beforeEach(() => {
  jest.clearAllMocks();
  // Org A (hosp-a) refers to a facility in org B (hosp-b).
  referral = {
    _id: 'ref-1', type: 'referral', patientId: 'pat-a', orgId: 'org-a', toOrgId: 'org-b',
    fromHospitalId: 'hosp-a', toHospitalId: 'hosp-b', status: 'sent',
  };
});

describe('referral create', () => {
  test('an org-B clinician cannot raise a referral for an org-A patient', async () => {
    actor = orgBDoctor;
    const res = await referralsPost(post('/api/referrals', { patientId: 'pat-a', toHospitalId: 'hosp-b', reason: 'x' }));
    expect(res.status).toBe(404);
    expect(createReferral).not.toHaveBeenCalled();
  });
  test('a clinician can refer a patient in their own scope', async () => {
    actor = orgADoctor;
    const res = await referralsPost(post('/api/referrals', { patientId: 'pat-a', toHospitalId: 'hosp-b', reason: 'x' }));
    expect(res.status).toBe(201);
    expect(createReferral).toHaveBeenCalled();
  });
});

describe('accept / acknowledge are receiver-only', () => {
  test('the sender cannot accept its own outbound referral', async () => {
    actor = orgADoctor;
    const res = await referralsPost(post('/api/referrals', { action: 'accept', referralId: 'ref-1' }));
    expect(res.status).toBe(403);
    expect(acceptReferral).not.toHaveBeenCalled();
  });
  test('the sender cannot acknowledge through /api/transfers either', async () => {
    actor = orgADoctor;
    const res = await transfersPost(post('/api/transfers', { action: 'acknowledge', referralId: 'ref-1' }));
    expect(res.status).toBe(403);
    expect(acceptReferral).not.toHaveBeenCalled();
  });
  test('the receiving facility can accept', async () => {
    actor = orgBDoctor;
    expect((await referralsPost(post('/api/referrals', { action: 'accept', referralId: 'ref-1' }))).status).toBe(200);
    expect((await transfersPost(post('/api/transfers', { action: 'acknowledge', referralId: 'ref-1' }))).status).toBe(200);
    expect(acceptReferral).toHaveBeenCalledTimes(2);
  });
  test('a clinician at a different facility of the receiving org cannot', async () => {
    actor = { ...orgBDoctor, hospitalId: 'hosp-b2' };
    const res = await referralsPost(post('/api/referrals', { action: 'accept', referralId: 'ref-1' }));
    // Not even visible to them (facility-scoped), so it reads as missing.
    expect(res.status).toBe(404);
    expect(acceptReferral).not.toHaveBeenCalled();
  });
  test('an org-wide role of the receiving org can', async () => {
    actor = { ...orgBDoctor, role: 'medical_superintendent', hospitalId: undefined };
    expect((await referralsPost(post('/api/referrals', { action: 'accept', referralId: 'ref-1' }))).status).toBe(200);
  });
});

describe('status changes follow the side', () => {
  test('only the sender can cancel; only the receiver can mark seen', async () => {
    actor = orgBDoctor;
    expect((await referralsPost(post('/api/referrals', { action: 'update_status', referralId: 'ref-1', status: 'cancelled' }))).status).toBe(403);
    expect((await transfersPost(post('/api/transfers', { action: 'status', referralId: 'ref-1', status: 'cancelled' }))).status).toBe(403);
    expect((await referralsPost(post('/api/referrals', { action: 'update_status', referralId: 'ref-1', status: 'seen' }))).status).toBe(200);
    actor = orgADoctor;
    expect((await referralsPost(post('/api/referrals', { action: 'update_status', referralId: 'ref-1', status: 'seen' }))).status).toBe(403);
    expect((await referralsPost(post('/api/referrals', { action: 'update_status', referralId: 'ref-1', status: 'cancelled' }))).status).toBe(200);
  });
});
