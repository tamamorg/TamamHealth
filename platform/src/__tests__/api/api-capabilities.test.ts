/** @jest-environment node */
import { NextRequest } from 'next/server';
import { VITAL_EVENTS } from '@/lib/sync/write-permissions';
import { VITAL_EVENTS_READ_ROLES, VITAL_EVENTS_REGISTER_ROLES } from '@/lib/api-capabilities';

describe('shared API capabilities vs the sync write groups', () => {
  it('the API register list is exactly the sync VITAL_EVENTS group', () => {
    expect([...VITAL_EVENTS_REGISTER_ROLES].sort()).toEqual([...VITAL_EVENTS].sort());
  });

  it('includes the four roles that previously replicated but got 403', () => {
    for (const role of ['triage_nurse', 'rooming_nurse', 'records_hmis_officer', 'hrio']) {
      expect(VITAL_EVENTS_REGISTER_ROLES).toContain(role);
    }
  });

  it('pins the exact read set', () => {
    expect([...VITAL_EVENTS_READ_ROLES].sort()).toEqual([
      'clinical_officer', 'clinician', 'data_entry_clerk', 'doctor', 'front_desk',
      'government', 'hrio', 'medical_superintendent', 'midwife', 'nurse',
      'org_admin', 'super_admin',
    ]);
  });
});

describe('authorizeJson', () => {
  afterEach(() => jest.resetModules());

  async function load(auth: unknown) {
    jest.resetModules();
    jest.doMock('@/modules/identity', () => ({
      getAuthPayload: jest.fn().mockResolvedValue(auth),
      hasRole: (a: { role: string }, roles: readonly string[]) => roles.includes(a.role),
      unauthorized: () => new Response(null, { status: 401 }),
      forbidden: () => new Response(null, { status: 403 }),
    }));
    return (await import('@/lib/api-json-guard')).authorizeJson;
  }
  const req = (body: string) =>
    new NextRequest('http://localhost/api/x', { method: 'POST', body, headers: { 'content-type': 'application/json' } });

  it('401 without a session, 403 for the wrong role', async () => {
    expect((await (await load(null))(req('{}'), ['doctor'])).response?.status).toBe(401);
    expect((await (await load({ role: 'nurse' }))(req('{}'), ['doctor'])).response?.status).toBe(403);
  });

  it('400 "Invalid JSON body" on malformed JSON', async () => {
    const res = (await (await load({ role: 'doctor' }))(req('{nope'), ['doctor'])).response;
    expect(res?.status).toBe(400);
    expect(await res?.json()).toEqual({ error: 'Invalid JSON body' });
  });

  it('returns auth and the sanitized body', async () => {
    const out = await (await load({ role: 'doctor' }))(req('{"a":"<script>x</script>hi"}'), ['doctor']);
    expect(out.response).toBeUndefined();
    if (out.response) throw new Error('unreachable');
    expect(out.auth.role).toBe('doctor');
    expect(JSON.stringify(out.body)).not.toContain('<script>');
  });
});
