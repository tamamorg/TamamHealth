/**
 * @jest-environment node
 *
 * Review of PR #257: births/deaths allow-list, bounded billing money fields,
 * ANC mother id derived from the chart, follow-up assignee confined to the org.
 */
jest.mock('@/lib/audit/with-audit', () => ({
  AUDIT_ACTION_HEADER: 'x-audit-action',
  withAuditLog: (handler: (...args: unknown[]) => Promise<Response>) => handler,
}));

type Actor = { sub: string; username: string; name: string; role: string; orgId?: string; hospitalId?: string };
const actor: Actor = { sub: 'doc-1', username: 'doc', name: 'Dr Real', role: 'doctor', orgId: 'org-a', hospitalId: 'h-a' };

jest.mock('@/lib/api-json-guard', () => ({
  authorizeJson: jest.fn(async (request: Request) => ({ auth: actor, body: await request.json() })),
}));
jest.mock('@/lib/api-security', () => ({ checkRateLimit: jest.fn(async () => null) }));

const patients: Record<string, Record<string, unknown>> = {
  'p-a': { _id: 'p-a', type: 'patient', orgId: 'org-a', firstName: 'Awak', surname: 'Deng', hospitalNumber: 'HN-1', registrationHospital: 'h-a' },
  'p-b': { _id: 'p-b', type: 'patient', orgId: 'org-b', firstName: 'Other', surname: 'Tenant', hospitalNumber: 'HN-9', registrationHospital: 'h-b' },
};
jest.mock('@/lib/services/patient-service', () => ({
  getPatientById: jest.fn(async (id: string) => {
    const p = patients[id];
    return p && p.orgId === actor.orgId ? p : null;
  }),
}));
const hospitals: Record<string, { orgId: string; name: string }> = {
  'h-a': { orgId: 'org-a', name: 'Facility A' },
  'h-a2': { orgId: 'org-a', name: 'Facility A2' },
  'h-b': { orgId: 'org-b', name: 'Facility B' },
};
jest.mock('@/lib/services/hospital-service', () => ({
  getHospitalById: jest.fn(async (id: string) => (hospitals[id] ? { _id: id, ...hospitals[id], facilityLevel: 'county' } : null)),
}));
jest.mock('@/lib/sync/facility-entitlements', () => ({
  entitlementFor: jest.fn((a: Actor) => ({ orgId: a.orgId, facilityIds: a.hospitalId ? [a.hospitalId] : [], allFacilities: false })),
}));
jest.mock('@/lib/services/data-scope', () => ({
  buildScopeFromAuth: jest.fn(() => ({ role: actor.role, orgId: actor.orgId })),
  filterByScope: jest.fn((docs: unknown[]) => docs),
}));

const users: Record<string, Record<string, unknown>> = {
  'u-a': { _id: 'u-a', name: 'Chw Alpha', orgId: 'org-a', isActive: true },
  'u-b': { _id: 'u-b', name: 'Chw Beta', orgId: 'org-b', isActive: true },
  'u-off': { _id: 'u-off', name: 'Gone', orgId: 'org-a', isActive: false },
};
jest.mock('@/modules/identity/services/user-service', () => ({
  getUserById: jest.fn(async (id: string) => users[id] ?? null),
}));

const captured: Record<string, Record<string, unknown>> = {};
jest.mock('@/lib/services/birth-service', () => ({
  createBirth: jest.fn(async (d: Record<string, unknown>) => { captured.birth = d; return { _id: 'b-1', ...d }; }),
}));
jest.mock('@/lib/services/death-service', () => ({
  createDeath: jest.fn(async (d: Record<string, unknown>) => { captured.death = d; return { _id: 'd-1', ...d }; }),
}));
jest.mock('@/lib/services/billing-service', () => ({
  createBill: jest.fn(async (d: Record<string, unknown>) => { captured.bill = d; return { _id: 'bill-1', ...d }; }),
}));
jest.mock('@/lib/services/anc-service', () => ({
  createANCVisit: jest.fn(async (d: Record<string, unknown>) => { captured.anc = d; return { _id: 'anc-1', ...d }; }),
}));
jest.mock('@/lib/services/follow-up-service', () => ({
  createFollowUp: jest.fn(async (d: Record<string, unknown>) => { captured.fu = d; return { _id: 'fu-1', ...d }; }),
}));

import { NextRequest } from 'next/server';
import { POST as birthPOST } from '@/app/api/births/route';
import { POST as deathPOST } from '@/app/api/deaths/route';
import { POST as billPOST } from '@/app/api/billing/route';
import { POST as ancPOST } from '@/app/api/anc/route';
import { POST as fuPOST } from '@/app/api/follow-ups/route';

const post = (url: string, body: unknown) => new NextRequest(`http://localhost${url}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
beforeEach(() => { for (const k of Object.keys(captured)) delete captured[k]; });

describe('births', () => {
  const base = { childFirstName: 'B', childSurname: 'C', motherName: 'M', dateOfBirth: '2026-11-01' };

  it('drops void, attribution, id and foreign org fields; stamps facility and org from the session', async () => {
    const res = await birthPOST(post('/api/births', {
      ...base, voidedAt: '2026-11-02', voidedBy: 'x', voidedByName: 'x', voidReason: 'x', _id: 'birth-victim',
      registeredBy: 'forged', orgId: 'org-b', facilityId: 'h-a', facilityName: 'Forged', isDeleted: true,
    }));
    expect(res.status).toBe(201);
    const d = captured.birth;
    expect(d).toMatchObject({ registeredBy: 'doc-1', registeredByName: 'Dr Real', orgId: 'org-a', facilityId: 'h-a', facilityName: 'Facility A' });
    for (const k of ['voidedAt', 'voidedBy', 'voidedByName', 'voidReason', '_id', 'isDeleted']) expect(d).not.toHaveProperty(k);
  });

  it('refuses a facility outside the assignment or the organisation', async () => {
    expect((await birthPOST(post('/api/births', { ...base, facilityId: 'h-a2' }))).status).toBe(403);
    expect((await birthPOST(post('/api/births', { ...base, facilityId: 'h-b' }))).status).toBe(403);
    expect(captured.birth).toBeUndefined();
  });

  it('refuses linked patients from another organisation and accepts own', async () => {
    expect((await birthPOST(post('/api/births', { ...base, motherPatientId: 'p-b' }))).status).toBe(404);
    expect((await birthPOST(post('/api/births', { ...base, childPatientId: 'p-b' }))).status).toBe(404);
    expect(captured.birth).toBeUndefined();
    expect((await birthPOST(post('/api/births', { ...base, motherPatientId: 'p-a' }))).status).toBe(201);
    expect(captured.birth.motherPatientId).toBe('p-a');
  });
});

describe('deaths', () => {
  const base = { deceasedFirstName: 'A', deceasedSurname: 'B', dateOfDeath: '2026-11-01' };
  it('drops void fields and refuses a foreign facility', async () => {
    const ok = await deathPOST(post('/api/deaths', { ...base, voidedAt: '2026-11-02', voidedBy: 'x', registeredBy: 'forged', orgId: 'org-b', facilityId: 'h-a' }));
    expect(ok.status).toBe(201);
    expect(captured.death).toMatchObject({ registeredBy: 'doc-1', orgId: 'org-a', facilityId: 'h-a' });
    expect(captured.death).not.toHaveProperty('voidedAt');
    expect(captured.death).not.toHaveProperty('voidedBy');
    expect((await deathPOST(post('/api/deaths', { ...base, facilityId: 'h-b' }))).status).toBe(403);
  });
});

describe('billing money fields', () => {
  const items = [{ description: 'Consult', quantity: 2, unitPrice: 50 }]; // subtotal 100
  const bill = (extra: Record<string, unknown>) => billPOST(post('/api/billing', { patientId: 'p-a', items, ...extra }));

  it('accepts a partial discount and a sane tax rate', async () => {
    expect((await bill({ discount: 40, taxRate: 10 })).status).toBe(201);
    expect(captured.bill).toMatchObject({ discount: 40, taxRate: 10 });
  });
  it.each([
    ['full discount (must be a waiver)', { discount: 100 }],
    ['discount above subtotal', { discount: 500 }],
    ['negative discount', { discount: -5 }],
    ['string discount', { discount: '10' }],
    ['NaN-ish discount', { discount: null, taxRate: 'abc' }],
    ['tax above 100', { taxRate: 101 }],
    ['negative tax', { taxRate: -1 }],
    ['coverage above 100', { insuranceCoveragePercent: 150 }],
  ])('rejects %s', async (_n, extra) => {
    const res = await bill(extra);
    expect(res.status).toBe(400);
    expect(captured.bill).toBeUndefined();
  });
});

describe('anc', () => {
  it('derives motherId from the patient when patientId is supplied', async () => {
    const res = await ancPOST(post('/api/anc', { patientId: 'p-a', motherId: 'p-b', motherName: 'Awak Deng', visitNumber: 1 }));
    expect(res.status).toBe(201);
    expect(captured.anc.motherId).toBe('p-a');
    expect(captured.anc.patientId).toBe('p-a');
  });
});

describe('follow-up assignee', () => {
  const base = { patientId: 'p-a', condition: 'htn', scheduledDate: '2026-12-01' };
  it('takes the name from the user record', async () => {
    const res = await fuPOST(post('/api/follow-ups', { ...base, assignedWorker: 'u-a', assignedWorkerName: 'Forged' }));
    expect(res.status).toBe(201);
    expect(captured.fu).toMatchObject({ assignedWorker: 'u-a', assignedWorkerName: 'Chw Alpha' });
  });
  it('refuses another org, an inactive or unknown user', async () => {
    for (const id of ['u-b', 'u-off', 'u-nobody']) {
      expect((await fuPOST(post('/api/follow-ups', { ...base, assignedWorker: id }))).status).toBe(404);
    }
    expect(captured.fu).toBeUndefined();
  });
  it('defaults to the caller', async () => {
    await fuPOST(post('/api/follow-ups', base));
    expect(captured.fu).toMatchObject({ assignedWorker: 'doc-1', assignedWorkerName: 'Dr Real' });
  });
});
