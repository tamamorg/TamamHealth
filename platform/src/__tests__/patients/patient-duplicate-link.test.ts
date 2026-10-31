/**
 * Marking one patient record as a duplicate of another.
 *
 * It is a reversible LINK: no clinical data moves. These tests pin the
 * refusals, the link and its undo, that lists and the matcher stop offering the
 * duplicate while a direct open by id still works, and that every role the UI
 * lets mark a duplicate can write the new fields at sync.
 */
jest.mock('uuid', () => ({ v4: () => 'tuid' }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());
jest.mock('@/lib/services/audit-service', () => ({ ...jest.requireActual('@/lib/services/audit-service'), logAuditSafe: jest.fn().mockResolvedValue(undefined) }));

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { patientsDB } from '@/lib/db';
import {
  getAllPatients, searchPatients, getPatientById, findMpiDuplicates, updatePatient,
  markPatientDuplicate, clearPatientDuplicate, getDuplicatesOf, PatientDuplicateError,
  type PatientDuplicateActor,
} from '@/lib/services/patient-service';
import { logAuditSafe } from '@/lib/services/audit-service';
import { matchPatient } from '@/lib/services/mpi-service';
import type { PatientDoc } from '@/lib/db-types';
import type { DataScope } from '@/lib/services/data-scope';
import {
  DOC_WRITE_ROLES, DOC_UPDATE_ONLY_ROLES, DOC_UPDATE_ONLY_FIELDS, PATIENT_DUPLICATE_ROLES,
} from '@/lib/sync/write-permissions';
import { ORG_SCOPED_VALIDATE_FN } from '@/lib/sync/validate-doc-update';
import phiCatalog from '@/lib/phi-field-catalog.json';

const ORG = 'org-a';
const SCOPE: DataScope = { orgId: ORG, role: 'org_admin' };
const ACTOR: PatientDuplicateActor = { id: 'user-1', name: 'Records Officer', role: 'org_admin' };

async function seed(id: string, over: Partial<PatientDoc> = {}): Promise<PatientDoc> {
  return putDoc(patientsDB(), {
    _id: id, type: 'patient', orgId: ORG, registrationHospital: 'h-1',
    firstName: 'Achol', surname: 'Deng', gender: 'Female', dateOfBirth: '1990-05-02',
    phone: '+211912345678', hospitalNumber: `JTH-${id}`,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as unknown as PatientDoc & { _id: string });
}

afterEach(async () => { await teardownTestDBs(); });

async function code(p: Promise<unknown>): Promise<string | undefined> {
  try { await p; } catch (e) { return e instanceof PatientDuplicateError ? e.code : `other:${(e as Error).message}`; }
  return undefined;
}

describe('refusals', () => {
  beforeEach(async () => { await seed('a'); await seed('b'); });

  it('refuses the same record', async () => {
    expect(await code(markPatientDuplicate('a', 'a', 'same', ACTOR, SCOPE))).toBe('same_record');
  });
  it('refuses an empty reason', async () => {
    expect(await code(markPatientDuplicate('a', 'b', '   ', ACTOR, SCOPE))).toBe('reason_required');
  });
  it('refuses a role that may not mark duplicates', async () => {
    expect(await code(markPatientDuplicate('a', 'b', 'x', { ...ACTOR, role: 'nurse' }, SCOPE))).toBe('not_allowed');
    expect(await code(clearPatientDuplicate('a', { ...ACTOR, role: 'doctor' }, SCOPE))).toBe('not_allowed');
  });
  it('refuses a survivor that is itself a duplicate (no chains)', async () => {
    await seed('c');
    await markPatientDuplicate('b', 'c', 'dup', ACTOR, SCOPE);
    expect(await code(markPatientDuplicate('a', 'b', 'x', ACTOR, SCOPE))).toBe('survivor_is_duplicate');
  });
  it('refuses to mark a record other records already point at', async () => {
    await seed('c');
    await markPatientDuplicate('b', 'a', 'dup', ACTOR, SCOPE);
    expect(await code(markPatientDuplicate('a', 'c', 'x', ACTOR, SCOPE))).toBe('has_duplicates');
  });
  it('refuses a record that is already linked', async () => {
    await markPatientDuplicate('a', 'b', 'dup', ACTOR, SCOPE);
    await seed('c');
    expect(await code(markPatientDuplicate('a', 'c', 'x', ACTOR, SCOPE))).toBe('already_linked');
  });
  it('refuses a pair in different organisations', async () => {
    await seed('x', { orgId: 'org-b' });
    expect(await code(markPatientDuplicate('a', 'x', 'r', ACTOR, { role: 'super_admin' }))).toBe('different_organisation');
  });
  it('refuses a record outside the caller scope', async () => {
    await seed('x', { orgId: 'org-b' });
    expect(await code(markPatientDuplicate('a', 'x', 'r', ACTOR, SCOPE))).toBe('not_found');
  });
  it('refuses a record that does not exist', async () => {
    expect(await code(markPatientDuplicate('a', 'ghost', 'r', ACTOR, SCOPE))).toBe('not_found');
  });
  it('a generic update cannot set the link', async () => {
    await updatePatient('a', { duplicateOf: 'b' } as Partial<PatientDoc>, SCOPE);
    expect((await getPatientById('a', SCOPE))?.duplicateOf).toBeUndefined();
  });
});

describe('the link and its undo', () => {
  it('links, moves nothing, audits without PHI, and undoes', async () => {
    await seed('a', { allergies: ['penicillin'] } as Partial<PatientDoc>);
    await seed('b');
    const dup = await markPatientDuplicate('a', 'b', 'Registered twice', ACTOR, SCOPE);
    expect(dup.duplicateOf).toBe('b');
    expect(dup.duplicateMarkedBy).toBe('user-1');
    expect(dup.duplicateReason).toBe('Registered twice');
    expect((dup as unknown as { allergies: string[] }).allergies).toEqual(['penicillin']);
    const audited = (logAuditSafe as jest.Mock).mock.calls.map(c => `${c[0]} ${c[3]}`).join('\n');
    expect(audited).toContain('MARK_PATIENT_DUPLICATE');
    expect(audited).not.toMatch(/Registered twice|Achol|Deng/);
    const survivor = await getPatientById('b', SCOPE);
    expect(survivor?.duplicateOf).toBeUndefined();
    expect((await getDuplicatesOf('b', SCOPE)).map(p => p._id)).toEqual(['a']);

    const cleared = await clearPatientDuplicate('a', ACTOR, SCOPE);
    expect(cleared.duplicateOf).toBeUndefined();
    expect(cleared.duplicateReason).toBeUndefined();
    expect(cleared.duplicateMarkedAt).toBeUndefined();
    expect((await getAllPatients(SCOPE)).map(p => p._id).sort()).toEqual(['a', 'b']);
  });
});

describe('a marked duplicate leaves lists, search and matching, but opens by id', () => {
  beforeEach(async () => {
    await seed('a', { firstName: 'Nyibol', surname: 'Garang', nationalId: 'ID-1' } as Partial<PatientDoc>);
    await seed('b', { firstName: 'Nyibol', surname: 'Garang', nationalId: 'ID-1' } as Partial<PatientDoc>);
    await markPatientDuplicate('a', 'b', 'dup', ACTOR, SCOPE);
  });

  it('is absent from getAllPatients and searchPatients', async () => {
    expect((await getAllPatients(SCOPE)).map(p => p._id)).toEqual(['b']);
    expect((await searchPatients('Nyibol', SCOPE)).map(p => p._id)).toEqual(['b']);
  });
  it('can be listed on request (review screen)', async () => {
    expect((await getAllPatients(SCOPE, { includeDuplicates: true })).map(p => p._id).sort()).toEqual(['a', 'b']);
  });
  it('is absent from matchPatient and findMpiDuplicates', async () => {
    const q = { firstName: 'Nyibol', surname: 'Garang', dateOfBirth: '1990-05-02', phone: '+211912345678' };
    expect((await matchPatient(q, 10, SCOPE)).map(c => c.patient._id)).toEqual(['b']);
    expect((await findMpiDuplicates(q, SCOPE)).map(c => c.patient._id)).toEqual(['b']);
  });
  it('still opens by id, history intact', async () => {
    const opened = await getPatientById('a', SCOPE);
    expect(opened?._id).toBe('a');
    expect(opened?.duplicateOf).toBe('b');
  });
});

describe('sync permission for the roles that may mark duplicates', () => {
  type Validate = (n: Record<string, unknown>, o: Record<string, unknown> | null, u: { name: string; roles: string[] }, s?: unknown) => void;
  const validate = new Function(`return (${ORG_SCOPED_VALIDATE_FN});`)() as Validate;
  const reason = (n: Record<string, unknown>, o: Record<string, unknown> | null, role: string): string | null => {
    try { validate(n, o, { name: 'u', roles: [`org:${ORG}`, `role:${role}`] }, {}); return null; }
    catch (e) { return (e as { forbidden?: string }).forbidden ?? 'thrown'; }
  };
  const before = { _id: 'a', type: 'patient', orgId: ORG, firstName: 'A', surname: 'B', updatedAt: '1' };
  const linked = {
    ...before, duplicateOf: 'b', duplicateMarkedAt: '2', duplicateMarkedBy: 'u',
    duplicateMarkedByName: 'U', duplicateReason: 'oenc:x', updatedAt: '2',
    offlineSync: { status: 'pending' },
  };

  it.each(PATIENT_DUPLICATE_ROLES)('%s can write the link fields and the undo', (role) => {
    expect(reason(linked, before, role)).toBeNull();
    expect(reason(before, linked, role)).toBeNull();
  });

  it('a role limited to the link fields cannot edit demographics or register', () => {
    for (const role of PATIENT_DUPLICATE_ROLES) {
      const full = (DOC_WRITE_ROLES.patient as readonly string[]).includes(role);
      if (full) continue;
      expect(reason({ ...linked, firstName: 'Changed' }, before, role)).toMatch(/may not amend firstName/);
      expect(reason(before, null, role)).not.toBeNull();
    }
  });

  it('no role holds both the full patient row and the amend-only grant', () => {
    const amend = DOC_UPDATE_ONLY_ROLES.patient ?? [];
    for (const role of amend) expect(DOC_WRITE_ROLES.patient).not.toContain(role);
    expect(DOC_UPDATE_ONLY_FIELDS.patient).toEqual(expect.arrayContaining(['duplicateOf', 'duplicateReason']));
  });

  it('every marking role is covered by exactly one of the two grants', () => {
    for (const role of PATIENT_DUPLICATE_ROLES) {
      const full = (DOC_WRITE_ROLES.patient as readonly string[]).includes(role);
      const amend = (DOC_UPDATE_ONLY_ROLES.patient as readonly string[] | undefined)?.includes(role) ?? false;
      expect(full || amend).toBe(true);
    }
  });
});

describe('PHI catalog', () => {
  it('seals the free-text reason and leaves the link readable', () => {
    const fields = (phiCatalog as unknown as { types: { patient: { fields: string[] } } }).types.patient.fields;
    expect(fields).toContain('duplicateReason');
    expect(fields).not.toContain('duplicateOf');
  });
});
