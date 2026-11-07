/**
 * @jest-environment node
 *
 * Security audit M2: clinical create routes must allow-list client fields,
 * stamp server-owned fields (org, facility, status, attribution) themselves, and
 * refuse a patient who is outside the caller's tenant.
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
  'p-a': { _id: 'p-a', type: 'patient', orgId: 'org-a', firstName: 'Awak', surname: 'Deng', hospitalNumber: 'HN-1', gender: 'Female', dateOfBirth: '1990-01-01', registrationHospital: 'h-a' },
  'p-b': { _id: 'p-b', type: 'patient', orgId: 'org-b', firstName: 'Other', surname: 'Tenant', hospitalNumber: 'HN-9', registrationHospital: 'h-b' },
};
jest.mock('@/lib/services/patient-service', () => ({
  getPatientById: jest.fn(async (id: string) => {
    const p = patients[id];
    return p && p.orgId === actor.orgId ? p : null; // mirrors filterByScope: other orgs are invisible
  }),
}));
jest.mock('@/lib/services/hospital-service', () => ({
  getHospitalById: jest.fn(async (id: string) => ({ _id: id, orgId: 'org-a', name: 'Facility A', facilityLevel: 'county' })),
}));

const captured: Record<string, Record<string, unknown>> = {};
jest.mock('@/lib/services/lab-service', () => ({
  createLabResult: jest.fn(async (d: Record<string, unknown>) => { captured.lab = d; return { _id: 'lab-1', ...d }; }),
}));
jest.mock('@/lib/services/prescription-service', () => ({
  createPrescription: jest.fn(async (d: Record<string, unknown>) => { captured.rx = d; return { prescription: { _id: 'rx-1', ...d }, interactionWarnings: null }; }),
}));
jest.mock('@/lib/services/immunization-service', () => ({
  createImmunization: jest.fn(async (d: Record<string, unknown>) => { captured.imm = d; return { _id: 'imm-1', ...d }; }),
}));
jest.mock('@/lib/services/billing-service', () => ({
  createBill: jest.fn(async (d: Record<string, unknown>) => { captured.bill = d; return { _id: 'bill-1', ...d }; }),
}));
jest.mock('@/lib/services/follow-up-service', () => ({
  createFollowUp: jest.fn(async (d: Record<string, unknown>) => { captured.fu = d; return { _id: 'fu-1', ...d }; }),
}));
jest.mock('@/lib/services/death-service', () => ({
  createDeath: jest.fn(async (d: Record<string, unknown>) => { captured.death = d; return { _id: 'd-1', ...d }; }),
}));
jest.mock('@/lib/services/data-scope', () => ({
  buildScopeFromAuth: jest.fn(() => ({ role: actor.role, orgId: actor.orgId })),
  filterByScope: jest.fn((docs: unknown[]) => docs),
}));

import { NextRequest } from 'next/server';
import { POST as labPOST } from '@/app/api/lab/route';
import { POST as rxPOST } from '@/app/api/prescriptions/route';
import { POST as immPOST } from '@/app/api/immunizations/route';
import { POST as billPOST } from '@/app/api/billing/route';
import { POST as fuPOST } from '@/app/api/follow-ups/route';
import { POST as deathPOST } from '@/app/api/deaths/route';

const post = (url: string, body: unknown) => new NextRequest(`http://localhost${url}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

beforeEach(() => { for (const k of Object.keys(captured)) delete captured[k]; });

describe('lab orders', () => {
  it('ignores forged status, results, flags, org, ids and attribution', async () => {
    const res = await labPOST(post('/api/lab', {
      patientId: 'p-a', testName: 'CBC', specimen: 'Blood',
      _id: 'lab-victim', status: 'completed', orderStatus: 'resulted', result: 'Positive',
      critical: true, abnormal: true, orgId: 'org-b',
      orderedBy: 'Dr Someone Else', patientName: 'Fake Name', reportedBy: 'x', reviewedBy: 'y',
    }));
    expect(res.status).toBe(201);
    const d = captured.lab;
    expect(d).toMatchObject({
      patientId: 'p-a', patientName: 'Awak Deng', hospitalNumber: 'HN-1', testName: 'CBC',
      status: 'pending', orderStatus: 'ordered', result: '', critical: false, abnormal: false,
      orgId: 'org-a', hospitalId: 'h-a', orderedBy: 'Dr Real', orderedById: 'doc-1',
    });
    expect(d).not.toHaveProperty('_id');
    expect(d).not.toHaveProperty('reportedBy');
    expect(d).not.toHaveProperty('reviewedBy');
  });

  it('refuses a patient from another organisation', async () => {
    const res = await labPOST(post('/api/lab', { patientId: 'p-b', testName: 'CBC' }));
    expect(res.status).toBe(404);
    expect(captured.lab).toBeUndefined();
  });

  it('refuses a facility from outside the caller assignment', async () => {
    const res = await labPOST(post('/api/lab', { patientId: 'p-a', testName: 'CBC', hospitalId: 'h-zzz' }));
    expect(res.status).toBe(403);
  });
});

describe('prescriptions', () => {
  it('stamps status and prescriber, drops lifecycle fields, refuses a foreign patient', async () => {
    const ok = await rxPOST(post('/api/prescriptions', {
      patientId: 'p-a', medication: 'Amoxicillin', dose: '500mg', frequency: 'TDS',
      status: 'dispensed', orderStatus: 'complete', dispensedBy: 'x', dispensedAt: '2026-01-01',
      orgId: 'org-b', prescribedBy: 'Dr Other', admissionId: 'adm-foreign', administrations: [{ fake: true }],
    }));
    expect(ok.status).toBe(201);
    expect(captured.rx).toMatchObject({ status: 'pending', prescribedBy: 'Dr Real', orgId: 'org-a', patientName: 'Awak Deng' });
    for (const k of ['orderStatus', 'dispensedBy', 'dispensedAt', 'admissionId', 'administrations']) {
      expect(captured.rx).not.toHaveProperty(k);
    }
    captured.rx = undefined as never;
    const foreign = await rxPOST(post('/api/prescriptions', { patientId: 'p-b', medication: 'X', dose: '1', frequency: 'OD' }));
    expect(foreign.status).toBe(404);
    expect(captured.rx).toBeUndefined();
  });
});

describe('immunizations', () => {
  it('stamps org, facility, patient identity and attribution from the session and chart', async () => {
    const res = await immPOST(post('/api/immunizations', {
      patientId: 'p-a', vaccine: 'BCG', doseNumber: 1, orgId: 'org-b', facilityId: 'h-a',
      recordedBy: 'forged', recordStatus: 'entered_in_error', _id: 'imm-victim', status: 'completed',
      patientName: 'Fake', gender: 'Male',
    }));
    expect(res.status).toBe(201);
    expect(captured.imm).toMatchObject({
      orgId: 'org-a', facilityId: 'h-a', recordedBy: 'doc-1', patientName: 'Awak Deng', gender: 'Female', status: 'completed',
    });
    expect(captured.imm).not.toHaveProperty('recordStatus');
    expect(captured.imm).not.toHaveProperty('_id');
  });

  it('refuses a foreign patient and an unknown status', async () => {
    expect((await immPOST(post('/api/immunizations', { patientId: 'p-b', vaccine: 'BCG', doseNumber: 1 }))).status).toBe(404);
    expect((await immPOST(post('/api/immunizations', { patientId: 'p-a', vaccine: 'BCG', doseNumber: 1, status: 'overdue' }))).status).toBe(400);
  });
});

describe('billing', () => {
  const items = [{ description: 'Consult', quantity: 1, unitPrice: 10 }];
  it('does not accept exemptReason, a forged org or a forged biller', async () => {
    const res = await billPOST(post('/api/billing', {
      patientId: 'p-a', items, exemptReason: 'free', orgId: 'org-b', generatedBy: 'forged', facilityId: 'h-a',
    }));
    expect(res.status).toBe(201);
    expect(captured.bill).toMatchObject({ orgId: 'org-a', generatedBy: 'doc-1', facilityId: 'h-a', patientName: 'Awak Deng' });
    expect(captured.bill).not.toHaveProperty('exemptReason');
  });

  it('refuses a foreign patient and nonsense line items', async () => {
    expect((await billPOST(post('/api/billing', { patientId: 'p-b', items }))).status).toBe(404);
    expect((await billPOST(post('/api/billing', { patientId: 'p-a', items: [{ quantity: -1, unitPrice: 5 }] }))).status).toBe(400);
  });
});

describe('follow-ups and deaths', () => {
  it('follow-up starts active and refuses a foreign patient', async () => {
    const ok = await fuPOST(post('/api/follow-ups', {
      patientId: 'p-a', condition: 'htn', scheduledDate: '2026-12-01', status: 'completed', outcome: 'recovered', orgId: 'org-b',
    }));
    expect(ok.status).toBe(201);
    expect(captured.fu).toMatchObject({ status: 'active', orgId: 'org-a' });
    expect(captured.fu).not.toHaveProperty('outcome');
    expect((await fuPOST(post('/api/follow-ups', { patientId: 'p-b', condition: 'htn', scheduledDate: '2026-12-01' }))).status).toBe(404);
  });

  it('a death cannot be linked to another organisation patient (it marks the chart deceased)', async () => {
    const base = { deceasedFirstName: 'A', deceasedSurname: 'B', dateOfDeath: '2026-11-01' };
    expect((await deathPOST(post('/api/deaths', { ...base, patientId: 'p-b' }))).status).toBe(404);
    expect(captured.death).toBeUndefined();
    const ok = await deathPOST(post('/api/deaths', { ...base, patientId: 'p-a', _id: 'death-victim' }));
    expect(ok.status).toBe(201);
    expect(captured.death.patientId).toBe('p-a');
    expect(captured.death).not.toHaveProperty('_id');
  });
});
