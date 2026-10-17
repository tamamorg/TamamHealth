/**
 * Facility registers (birth, death, ANC, immunization) must carry an orgId.
 * Without one CouchDB's tenant validator rejects the push and filterByScope
 * hides the row from the registrar on their own device.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-rtuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { hospitalsDB, birthsDB, deathsDB, ancDB, immunizationsDB } from '@/lib/db';
import { createBirth, getAllBirths } from '@/lib/services/birth-service';
import { createDeath, getAllDeaths } from '@/lib/services/death-service';
import { createANCVisit, getAllANCVisits } from '@/lib/services/anc-service';
import { createImmunization, getAllImmunizations, getDefaulters, getDefaulterStats, getCoverageByAgeCohort } from '@/lib/services/immunization-service';
import { saveFacilityCensus } from '@/lib/services/facility-census-service';
import { repairRegisterOrgIds } from '@/lib/services/register-org';
import { ValidationError } from '@/lib/validation';
import type { DataScope } from '@/lib/services/data-scope';

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const HOSP_A = 'hosp-a1';
const HOSP_B = 'hosp-b1';
const SCOPE_A: DataScope = { orgId: ORG_A, hospitalId: HOSP_A, role: 'clinician' as DataScope['role'] };
const NO_ORG_SCOPE: DataScope = { role: 'clinician' as DataScope['role'] };
const SCOPE_B: DataScope = { orgId: ORG_B, hospitalId: HOSP_B, role: 'clinician' as DataScope['role'] };

beforeEach(async () => {
  await putDoc(hospitalsDB(), { _id: HOSP_A, type: 'hospital', name: 'A', orgId: ORG_A } as never);
  await putDoc(hospitalsDB(), { _id: HOSP_B, type: 'hospital', name: 'B', orgId: ORG_B } as never);
});
afterEach(async () => { await teardownTestDBs(); uuidCounter = 0; });

const birth = (o: Record<string, unknown> = {}) => ({
  childFirstName: 'Baby', childSurname: 'One', childGender: 'Male', dateOfBirth: '2026-10-01',
  motherName: 'Mother One', facilityId: HOSP_A, facilityName: 'A', state: 'CES', ...o,
}) as unknown as Parameters<typeof createBirth>[0];
const death = (o: Record<string, unknown> = {}) => ({
  deceasedFirstName: 'D', deceasedSurname: 'One', dateOfDeath: '2026-10-01', immediateCause: 'x',
  facilityId: HOSP_A, facilityName: 'A', state: 'CES', ...o,
}) as unknown as Parameters<typeof createDeath>[0];
const anc = (o: Record<string, unknown> = {}) => ({
  motherId: 'm1', motherName: 'Mother One', visitNumber: 1, visitDate: '2026-10-01', riskLevel: 'low',
  facilityId: HOSP_A, facilityName: 'A', state: 'CES', ...o,
}) as unknown as Parameters<typeof createANCVisit>[0];
const imm = (o: Record<string, unknown> = {}) => ({
  patientId: 'c1', patientName: 'Child One', gender: 'Male', dateOfBirth: '2026-01-01', vaccine: 'BCG',
  doseNumber: 1, dateGiven: '2026-02-01', status: 'completed', facilityId: HOSP_A, facilityName: 'A', state: 'CES', ...o,
}) as unknown as Parameters<typeof createImmunization>[0];

describe('register creates stamp the facility org and are visible through the scoped read', () => {
  test('birth', async () => {
    const doc = await createBirth(birth(), SCOPE_A);
    expect(doc.orgId).toBe(ORG_A);
    expect((await getAllBirths(SCOPE_A)).map(b => b._id)).toContain(doc._id);
    expect(await getAllBirths(SCOPE_B)).toHaveLength(0);
  });
  test('death', async () => {
    const doc = await createDeath(death(), SCOPE_A);
    expect(doc.orgId).toBe(ORG_A);
    expect((await getAllDeaths(SCOPE_A)).map(d => d._id)).toContain(doc._id);
    expect(await getAllDeaths(SCOPE_B)).toHaveLength(0);
  });
  test('ANC', async () => {
    const doc = await createANCVisit(anc(), SCOPE_A);
    expect(doc.orgId).toBe(ORG_A);
    expect((await getAllANCVisits(SCOPE_A)).map(v => v._id)).toContain(doc._id);
    expect(await getAllANCVisits(SCOPE_B)).toHaveLength(0);
  });
  test('immunization', async () => {
    const doc = await createImmunization(imm(), SCOPE_A);
    expect(doc.orgId).toBe(ORG_A);
    expect((await getAllImmunizations(SCOPE_A)).map(i => i._id)).toContain(doc._id);
  });
  test('falls back to the caller scope when the facility is not on this device', async () => {
    const doc = await createBirth(birth({ facilityId: 'hosp-unknown-here' }), SCOPE_A);
    expect(doc.orgId).toBe(ORG_A);
  });
});

describe('creation with no resolvable organisation is refused', () => {
  const none = { facilityId: 'hosp-nowhere' };
  test.each([
    ['birth', () => createBirth(birth(none), NO_ORG_SCOPE)],
    ['death', () => createDeath(death(none), NO_ORG_SCOPE)],
    ['anc', () => createANCVisit(anc(none), NO_ORG_SCOPE)],
    ['immunization', () => createImmunization(imm(none), NO_ORG_SCOPE)],
  ])('%s', async (_n, run) => {
    await expect(run()).rejects.toBeInstanceOf(ValidationError);
  });
  test('nothing was written', async () => {
    await createBirth(birth(none), NO_ORG_SCOPE).catch(() => undefined);
    expect((await birthsDB().allDocs()).rows).toHaveLength(0);
  });
  test('facility census refuses the legacy unknown facility and stamps the org otherwise', async () => {
    await expect(saveFacilityCensus({ facilityId: 'unknown', date: '2026-10-01', census: {} })).rejects.toBeInstanceOf(ValidationError);
    const doc = await saveFacilityCensus({ facilityId: HOSP_A, date: '2026-10-01', census: {} });
    expect(doc.orgId).toBe(ORG_A);
  });
});

describe('repairRegisterOrgIds', () => {
  test('stamps orphans from their facility, leaves unresolvable ones, and is idempotent', async () => {
    await putDoc(birthsDB(), { _id: 'birth-o', type: 'birth', facilityId: HOSP_B, dateOfBirth: '2026-01-01' } as never);
    await putDoc(deathsDB(), { _id: 'death-o', type: 'death', facilityId: HOSP_A } as never);
    await putDoc(ancDB(), { _id: 'anc-o', type: 'anc_visit', facilityId: HOSP_A } as never);
    await putDoc(immunizationsDB(), { _id: 'imm-o', type: 'immunization', facilityId: HOSP_A } as never);
    await putDoc(immunizationsDB(), { _id: 'imm-x', type: 'immunization', facilityId: 'gone' } as never);
    await putDoc(immunizationsDB(), { _id: 'imm-ok', type: 'immunization', facilityId: HOSP_A, orgId: 'org-keep' } as never);

    const first = await repairRegisterOrgIds();
    expect(first.stamped).toBe(4);
    expect(first.unresolved).toBe(1);
    expect(((await birthsDB().get('birth-o')) as { orgId?: string }).orgId).toBe(ORG_B);
    expect(((await deathsDB().get('death-o')) as { orgId?: string }).orgId).toBe(ORG_A);
    expect(((await immunizationsDB().get('imm-ok')) as { orgId?: string }).orgId).toBe('org-keep');
    expect(((await immunizationsDB().get('imm-x')) as { orgId?: string }).orgId).toBeUndefined();

    const second = await repairRegisterOrgIds();
    expect(second.stamped).toBe(0);
    expect((await getAllBirths(SCOPE_B)).map(b => b._id)).toContain('birth-o');
  });
});

describe('immunization defaulters are scoped', () => {
  test('another org\'s overdue children are not returned', async () => {
    const overdue = { status: 'overdue', nextDueDate: '2026-01-01' };
    await createImmunization(imm({ patientId: 'a-child', patientName: 'A Child', ...overdue }), SCOPE_A);
    await createImmunization(imm({ patientId: 'b-child', patientName: 'B Child', facilityId: HOSP_B, ...overdue }), SCOPE_B);
    const a = await getDefaulters(SCOPE_A);
    expect(a.map(d => d.patientId)).toEqual(['a-child']);
    expect((await getDefaulterStats(SCOPE_A)).uniqueChildren).toBe(1);
    expect(Array.isArray(await getCoverageByAgeCohort(SCOPE_B))).toBe(true);
    expect((await getDefaulters(SCOPE_B)).map(d => d.patientId)).toEqual(['b-child']);
  });
});

describe('an explicit orgId cannot file into another organisation', () => {
  test('non-cross-org callers are refused; cross-org roles may name any org', async () => {
    await expect(createBirth(birth({ orgId: ORG_B }), SCOPE_A)).rejects.toBeInstanceOf(ValidationError);
    expect((await birthsDB().allDocs()).rows).toHaveLength(0);
    const own = await createBirth(birth({ orgId: ORG_A }), SCOPE_A);
    expect(own.orgId).toBe(ORG_A);
    const gov = await createBirth(birth({ orgId: ORG_B }), { orgId: ORG_A, role: 'government' as DataScope['role'] });
    expect(gov.orgId).toBe(ORG_B);
  });
  test('resolveDocOrgId refuses an explicit org that differs from the caller fallback', async () => {
    const { resolveDocOrgId } = await import('@/lib/services/register-org');
    await expect(resolveDocOrgId({ orgId: ORG_B }, 'triage', ORG_A)).rejects.toBeInstanceOf(ValidationError);
    expect(await resolveDocOrgId({ orgId: ORG_A }, 'triage', ORG_A)).toBe(ORG_A);
    expect(await resolveDocOrgId({ orgId: ORG_B }, 'announcement')).toBe(ORG_B);
  });
});
