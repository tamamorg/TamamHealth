/**
 * A birth only links to ANC visits inside its own organisation, and an explicit
 * mother id beats a name match. Two orgs share a mother with the same name.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-ancl` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { hospitalsDB, ancDB } from '@/lib/db';
import { createBirth } from '@/lib/services/birth-service';
import type { DataScope } from '@/lib/services/data-scope';

const SCOPE_A: DataScope = { orgId: 'org-a', hospitalId: 'hosp-a', role: 'clinician' as DataScope['role'] };
const visit = (id: string, orgId: string, motherId: string, extra: Record<string, unknown> = {}) => ({
  _id: id, type: 'anc_visit', orgId, motherId, motherName: 'Mary Deng', visitNumber: 1,
  facilityId: orgId === 'org-a' ? 'hosp-a' : 'hosp-b', ...extra,
}) as never;
const birth = (o: Record<string, unknown> = {}) => ({
  childFirstName: 'Baby', childSurname: 'One', childGender: 'Male', dateOfBirth: '2026-10-01',
  motherName: 'Mary Deng', facilityId: 'hosp-a', facilityName: 'A', state: 'CES', ...o,
}) as unknown as Parameters<typeof createBirth>[0];

beforeEach(async () => {
  await putDoc(hospitalsDB(), { _id: 'hosp-a', type: 'hospital', name: 'A', orgId: 'org-a' } as never);
  await putDoc(ancDB(), visit('anc-a', 'org-a', 'mother-a'));
  await putDoc(ancDB(), visit('anc-b', 'org-b', 'mother-b'));
});
afterEach(async () => { await teardownTestDBs(); uuidCounter = 0; });

const linked = async (id: string) => ((await ancDB().get(id)) as unknown as { linkedBirthId?: string }).linkedBirthId;

describe('birth to ANC linkage', () => {
  it('links same-name visits in its own org only, never across orgs', async () => {
    const doc = await createBirth(birth(), SCOPE_A);
    expect(await linked('anc-a')).toBe(doc._id);
    expect(await linked('anc-b')).toBeUndefined();
    expect(doc.linkedAncMotherId).toBe('mother-a');
  });

  it('an explicit foreign linkedAncMotherId links nothing and is dropped', async () => {
    const doc = await createBirth(birth({ linkedAncMotherId: 'mother-b' }), SCOPE_A);
    expect(await linked('anc-b')).toBeUndefined();
    expect(await linked('anc-a')).toBeUndefined();
    expect(doc.linkedAncMotherId).toBeUndefined();
  });

  it('an explicit mother id wins over the name', async () => {
    await putDoc(ancDB(), visit('anc-a2', 'org-a', 'mother-a2'));
    const doc = await createBirth(birth({ linkedAncMotherId: 'mother-a2' }), SCOPE_A);
    expect(await linked('anc-a2')).toBe(doc._id);
    expect(await linked('anc-a')).toBeUndefined();
    expect(doc.linkedAncMotherId).toBe('mother-a2');
  });

  it('a motherPatientId matches the visit patientId', async () => {
    await putDoc(ancDB(), visit('anc-p', 'org-a', 'mother-x', { patientId: 'pat-1', motherName: 'Other Name' }));
    const doc = await createBirth(birth({ motherPatientId: 'pat-1' }), SCOPE_A);
    expect(await linked('anc-p')).toBe(doc._id);
    expect(await linked('anc-a')).toBeUndefined();
  });
});
