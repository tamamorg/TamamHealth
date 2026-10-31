/**
 * The records the structured clinical forms file (StructuredFormPanel), against
 * the two things that stand between them and other users' screens: the real
 * `validate_doc_update` source and the at-rest encryption catalogue. A new note
 * type or field that either rejected or left in the clear would look fine on
 * the device that saved it and never reach anyone else.
 */
import PouchDB from 'pouchdb-browser';
import memoryAdapter from 'pouchdb-adapter-memory';
import { wrapEncrypted } from '@/lib/encrypted-db';
import { isOrgEncrypted } from '@/lib/org-data-cipher';
import { ORG_SCOPED_VALIDATE_FN } from '@/lib/sync/validate-doc-update';

PouchDB.plugin(memoryAdapter);

type UserCtx = { name?: string; roles: string[] };
const validate = new Function(`return (${ORG_SCOPED_VALIDATE_FN});`)() as (
  newDoc: Record<string, unknown>, oldDoc: Record<string, unknown> | null, userCtx: UserCtx, secObj?: unknown,
) => void;
const refusal = (doc: Record<string, unknown>, old: Record<string, unknown> | null, user: UserCtx) => {
  try {
    validate(doc, old, user, {});
    return null;
  } catch (error) {
    return (error as { forbidden?: string }).forbidden ?? 'thrown';
  }
};
const staff = (role: string): UserCtx => ({
  name: `${role}-1`, roles: ['org:org-a', `role:${role}`, `user:user-${role}`, 'facility:h-1'],
});

const note = (noteType: string, over: Record<string, unknown> = {}) => ({
  _id: 'note-1', type: 'clinical_note', orgId: 'org-a', hospitalId: 'h-1',
  patientId: 'pat-1', patientName: 'Nyabol Koang', mrn: 'JTH-1', noteType,
  sections: [{ sectionId: 'memo', text: 'Procedure: Laparotomy' }],
  formData: { 'op.procedure': 'Laparotomy', 'phq.score9': '12' },
  status: 'draft', authorId: 'user-doctor', authorName: 'Dr', createdBy: 'user-doctor',
  serviceDate: '2026-10-30', createdAt: '2026-10-30T10:00:00Z', updatedAt: '2026-10-30T10:00:00Z',
  ...over,
});
const labResult = (over: Record<string, unknown> = {}) => ({
  _id: 'lab-1', type: 'lab_result', orgId: 'org-a', hospitalId: 'h-1',
  patientId: 'pat-1', patientName: 'Nyabol Koang', hospitalNumber: 'JTH-1',
  testName: 'Hematology', specimen: 'Blood', status: 'completed', orderStatus: 'resulted', orderKind: 'lab',
  result: 'White blood cells (WBC): 7.2 10³/µL',
  observations: [{ id: 'cbc.wbc', label: 'White blood cells (WBC)', group: 'Complete blood count', value: '7.2', unit: '10³/µL' }],
  unit: '', referenceRange: '', abnormal: false, critical: false,
  orderedBy: 'Dr', orderedById: 'user-doctor', orderedAt: '2026-10-30T10:00:00Z', completedAt: '2026-10-30T10:00:00Z',
  ...over,
});

describe('the sync validator accepts what the forms file', () => {
  it.each(['covid19', 'mental_health', 'surgical_operation'])('%s note from a doctor, draft then signed', noteType => {
    const draft = note(noteType);
    expect(refusal(draft, null, staff('doctor'))).toBeNull();
    const signed = note(noteType, { status: 'signed', signedBy: 'user-doctor', signedByName: 'Dr', signedAt: '2026-10-30T10:01:00Z' });
    expect(refusal(signed, draft, staff('doctor'))).toBeNull();
  });

  it('refuses a form note from a role the chart greys the form out for', () => {
    expect(refusal(note('covid19'), null, staff('nurse'))).not.toBeNull();
    expect(refusal(note('covid19'), null, staff('front_desk'))).not.toBeNull();
  });

  it('accepts a directly entered lab result from every role the form opens for', () => {
    for (const role of ['doctor', 'clinical_officer', 'clinician', 'nurse', 'lab_tech', 'medical_superintendent']) {
      expect([role, refusal(labResult(), null, staff(role))]).toEqual([role, null]);
    }
  });

  it('refuses a lab result aimed at another organisation', () => {
    expect(refusal(labResult({ orgId: 'org-b' }), null, staff('doctor'))).not.toBeNull();
  });
});

describe('the answers are sealed at rest', () => {
  const savedSwitch = process.env.NEXT_PUBLIC_PHI_ENCRYPTION;
  let raw: PouchDB.Database;
  let db: PouchDB.Database;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_PHI_ENCRYPTION = 'true';
    raw = new PouchDB(`form-records-${Date.now()}-${Math.random()}`, { adapter: 'memory' });
    db = wrapEncrypted(raw, 'tamamhealth_test');
  });
  afterEach(async () => {
    await raw.destroy();
    if (savedSwitch === undefined) delete process.env.NEXT_PUBLIC_PHI_ENCRYPTION;
    else process.env.NEXT_PUBLIC_PHI_ENCRYPTION = savedSwitch;
  });

  it('holds a form note\'s answers as ciphertext and reads them back', async () => {
    await db.put(note('surgical_operation'));
    const stored = await raw.get('note-1') as unknown as { formData: Record<string, string> };
    expect(isOrgEncrypted(stored.formData['op.procedure'])).toBe(true);
    expect(JSON.stringify(stored)).not.toContain('Laparotomy');
    const read = await db.get('note-1') as unknown as { formData: Record<string, string> };
    expect(read.formData['op.procedure']).toBe('Laparotomy');
  });

  it('seals the desk\'s note on a station assignment, leaving who it is for readable', async () => {
    await db.put({
      _id: 'pat-1', type: 'patient', orgId: 'org-a',
      stationAssignments: { radiology: { staffId: 'user-rad', staffName: 'Rad', note: 'Febrile, query pneumonia', assignedAt: '2026-10-30T10:00:00Z' } },
    });
    const stored = await raw.get('pat-1') as unknown as { stationAssignments: { radiology: { staffId: string; note: string } } };
    expect(isOrgEncrypted(stored.stationAssignments.radiology.note)).toBe(true);
    expect(stored.stationAssignments.radiology.staffId).toBe('user-rad');
    const read = await db.get('pat-1') as unknown as { stationAssignments: { radiology: { note: string } } };
    expect(read.stationAssignments.radiology.note).toBe('Febrile, query pneumonia');
  });
});
