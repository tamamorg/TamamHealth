/**
 * @jest-environment node
 *
 * Attribution fields on the vital-event / referral / appointment POST routes
 * must be stamped from the verified auth claim, never trusted from the request
 * body. Before the fix the routes used `body.registeredBy = body.registeredBy
 * || auth.sub`, so an API client could forge the person recorded as having made
 * a record (security/data audit 2026-11-05, §2.1 #18).
 *
 * The one deliberate exception is /api/follow-ups `assignedWorker`: that is an
 * assignment target (a supervisor assigns a follow-up to a CHW), not a claim of
 * who created the record, so a supplied value is still honoured.
 */
jest.mock('@/lib/audit/with-audit', () => ({
  AUDIT_ACTION_HEADER: 'x-audit-action',
  withAuditLog: (handler: (...args: unknown[]) => Promise<Response>) => handler,
}));

type Actor = { sub: string; username: string; name: string; role: string; orgId?: string; hospitalId?: string };
let actor: Actor = { sub: 'real-user', username: 'real', name: 'Real Clerk', role: 'hrio', orgId: 'org-a', hospitalId: 'h1' };

// authorizeJson is the single JSON+role gate every route uses; return the
// verified actor plus the parsed body so the handler runs its stamping logic.
jest.mock('@/lib/api-json-guard', () => ({
  authorizeJson: jest.fn(async (request: Request) => ({ auth: actor, body: await request.json() })),
}));

const captured: Record<string, Record<string, unknown>> = {};
jest.mock('@/lib/services/birth-service', () => ({
  createBirth: jest.fn(async (doc: Record<string, unknown>) => { captured.birth = doc; return { _id: 'b1', ...doc }; }),
}));
jest.mock('@/lib/services/anc-service', () => ({
  createANCVisit: jest.fn(async (doc: Record<string, unknown>) => { captured.anc = doc; return { _id: 'a1', ...doc }; }),
}));
jest.mock('@/lib/services/follow-up-service', () => ({
  createFollowUp: jest.fn(async (doc: Record<string, unknown>) => { captured.followUp = doc; return { _id: 'f1', ...doc }; }),
}));
jest.mock('@/lib/services/data-scope', () => ({
  buildScopeFromAuth: jest.fn(() => ({ role: actor.role, orgId: actor.orgId })),
  filterByScope: jest.fn((docs: unknown[]) => docs),
}));
// The ANC and follow-up routes now prove the patient is in scope first.
jest.mock('@/lib/services/patient-service', () => ({
  getPatientById: jest.fn(async (id: string) => ({ _id: id, orgId: actor.orgId, firstName: 'Pat', surname: 'Ient' })),
}));
jest.mock('@/lib/services/hospital-service', () => ({
  getHospitalById: jest.fn(async (id: string) => ({ _id: id, orgId: actor.orgId, name: 'Facility' })),
}));

import { NextRequest } from 'next/server';
import { POST as birthsPOST } from '@/app/api/births/route';
import { POST as ancPOST } from '@/app/api/anc/route';
import { POST as followUpsPOST } from '@/app/api/follow-ups/route';

const post = (url: string, body: unknown) => new NextRequest(`http://localhost${url}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(captured)) delete captured[k];
  actor = { sub: 'real-user', username: 'real', name: 'Real Clerk', role: 'hrio', orgId: 'org-a', hospitalId: 'h1' };
});

describe('attribution fields cannot be forged through the API', () => {
  it('/api/births ignores a forged registeredBy / registeredByName', async () => {
    const res = await birthsPOST(post('/api/births', {
      childFirstName: 'Nyandeng', childSurname: 'Deng', motherName: 'Aluel', dateOfBirth: '2026-11-01',
      registeredBy: 'someone-else', registeredByName: 'Impersonated Officer',
    }));
    expect(res.status).toBe(201);
    expect(captured.birth.registeredBy).toBe('real-user');
    expect(captured.birth.registeredByName).toBe('Real Clerk');
  });

  it('/api/anc ignores a forged attendedBy / attendedByRole', async () => {
    const res = await ancPOST(post('/api/anc', {
      motherId: 'm1', motherName: 'Aluel', visitNumber: 1,
      attendedBy: 'someone-else', attendedByRole: 'doctor',
    }));
    expect(res.status).toBe(201);
    expect(captured.anc.attendedBy).toBe('real-user');
    expect(captured.anc.attendedByRole).toBe('hrio');
  });

  it('/api/follow-ups still honours a supplied assignedWorker (an assignment, not a forgery)', async () => {
    const res = await followUpsPOST(post('/api/follow-ups', {
      patientId: 'p1', condition: 'htn', scheduledDate: '2026-12-01',
      assignedWorker: 'chw-7', assignedWorkerName: 'CHW Seven',
    }));
    expect(res.status).toBe(201);
    expect(captured.followUp.assignedWorker).toBe('chw-7');
    expect(captured.followUp.assignedWorkerName).toBe('CHW Seven');
  });
});
