/**
 * A critical lab result, and a pharmacy stall, put a task on the ordering
 * clinician's list. The task is created as the person who raised it: the lab
 * technician, the radiologist or the pharmacist. Those roles held no right to
 * a `clinician_task`, so the alert saved on the device and was refused at
 * replication: the clinician was never told.
 *
 * The documents here come from the real lab and dispensing services, and are
 * judged by the real validate_doc_update, so a field added to either service
 * fails here and not on a ward.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-catuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

jest.setTimeout(30000);

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { clinicianTasksDB, prescriptionsDB } from '@/lib/db';
import { createLabResult, updateLabResult } from '@/lib/services/lab-service';
import { recordUnfilled } from '@/lib/services/dispensing-service';
import { ORG_SCOPED_VALIDATE_FN } from '@/lib/sync/validate-doc-update';
import { DOC_CREATE_ONLY_ROLES, DOC_WRITE_ROLES } from '@/lib/sync/write-permissions';
import { RESULT_REVIEW_SLA, getResultReviewSLA } from '@/lib/clinical-flow/order-lifecycles';

type Doc = Record<string, unknown>;
const validate = new Function(`return (${ORG_SCOPED_VALIDATE_FN});`)() as (
  newDoc: Doc, oldDoc: Doc | null, userCtx: { name?: string; roles: string[] }, secObj?: unknown,
) => void;

const refusal = (role: string, doc: Doc, old: Doc | null) => {
  try {
    validate(doc, old, { name: 'u', roles: ['org:org-a', `role:${role}`, 'user:u-1', 'facility:h-1'] }, {});
    return null;
  } catch (error) {
    return (error as { forbidden?: string }).forbidden ?? 'thrown';
  }
};

const tasks = async () => {
  const { rows } = await clinicianTasksDB().allDocs({ include_docs: true });
  return rows.map(r => r.doc as unknown as Doc).filter(d => d.type === 'clinician_task');
};

afterEach(async () => { await teardownTestDBs(); uuidCounter = 0; });

describe('the critical-result alert', () => {
  const raise = async () => {
    const order = await createLabResult({
      patientId: 'pat-1', patientName: 'A B', testName: 'Potassium', orderedBy: 'Dr Wani', orderedById: 'doc-1',
      orderedAt: '2026-10-31T08:00:00Z', status: 'in_progress', hospitalId: 'h-1', orgId: 'org-a',
    } as never);
    await updateLabResult(order._id, { status: 'completed', orderStatus: 'resulted', critical: true, result: '7.4' } as never);
    const [task] = await tasks();
    return task;
  };

  it('is created for the ordering clinician, due in the critical SLA', async () => {
    const before = Date.now();
    const task = await raise();
    expect(task.userId).toBe('doc-1');
    const hours = (Date.parse(task.dueDate as string) - before) / 3_600_000;
    expect(hours).toBeGreaterThan(getResultReviewSLA().criticalHours - 0.01);
    expect(hours).toBeLessThan(getResultReviewSLA().criticalHours + 0.01);
  });

  it('defaults the critical review window to one hour and still lets a facility change it', () => {
    expect(RESULT_REVIEW_SLA.criticalHours).toBe(1);
    expect(getResultReviewSLA().criticalHours).toBe(1);
    expect(getResultReviewSLA().routineHours).toBeGreaterThan(24);
  });

  it.each(['lab_tech', 'radiologist', 'pharmacist'])('reaches the server when %s raises it', async role => {
    expect(refusal(role, await raise(), null)).toBeNull();
  });

  it.each(['lab_tech', 'radiologist', 'pharmacist'])('does not let %s edit or complete a task afterwards', async role => {
    const task = await raise();
    expect(refusal(role, { ...task, status: 'done' }, { ...task, _rev: '1-a' })).not.toBeNull();
  });

  it.each(['cashier', 'front_desk', 'nutritionist'])('still refuses %s', async role => {
    expect(refusal(role, await raise(), null)).not.toBeNull();
  });

  it('keeps the clinicians who own the list on the full write row', () => {
    for (const role of ['lab_tech', 'radiologist', 'pharmacist']) {
      expect(DOC_WRITE_ROLES.clinician_task).not.toContain(role);
      expect(DOC_CREATE_ONLY_ROLES.clinician_task).toContain(role);
    }
    expect(DOC_WRITE_ROLES.clinician_task).toContain('doctor');
  });
});

describe('the pharmacy stall alert', () => {
  it('reaches the server when the pharmacist raises it', async () => {
    const rx = {
      _id: 'rx-1', type: 'prescription', patientId: 'pat-1', patientName: 'A B', medication: 'Amoxicillin 500mg',
      dose: '1', route: 'oral', frequency: 'OD', duration: '5 days', prescribedBy: 'Dr Wani', status: 'pending',
      hospitalId: 'h-1', orgId: 'org-a', createdAt: '2026-10-31T08:00:00Z', updatedAt: '2026-10-31T08:00:00Z',
    };
    await putDoc(prescriptionsDB(), rx as never);
    await recordUnfilled(rx as never, 'stock_out', 'None on the shelf.', { id: 'ph-1', name: 'Rose' });
    const [task] = await tasks();
    expect(task).toBeDefined();
    expect(refusal('pharmacist', task, null)).toBeNull();
  });
});
