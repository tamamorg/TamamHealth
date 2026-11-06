/**
 * A critical lab value must actively reach the ORDERING clinician's task list
 * (KAN-75). The task list joins on the user's `_id` (`getTasks(userId)` →
 * `{ userId }` selector), but lab orders historically carried only the
 * clinician's free-text NAME in `orderedBy` — so the critical-result task was
 * written under a name key and never surfaced in any clinician's TasksPanel.
 *
 * The fix records `orderedById` on new orders and, for legacy orders, resolves
 * the name against the user directory at task-raise time, falling back to the
 * name only when the lookup is ambiguous or empty.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { usersDB } from '@/lib/db';
import { createLabResult, updateLabResult } from '@/lib/services/lab-service';
import { getTasks } from '@/lib/services/clinician-task-service';

afterEach(async () => {
  await teardownTestDBs();
});

async function seedUser(id: string, name: string) {
  await putDoc(usersDB(), {
    _id: id,
    type: 'user',
    username: id.replace('user-', ''),
    name,
    role: 'doctor',
    hospitalId: 'hosp-001',
    orgId: 'org-moh-ss',
    isActive: true,
  } as never);
}

function baseOrder(overrides: Record<string, unknown> = {}) {
  return {
    patientId: 'pat-00001',
    patientName: 'Nyakuma Deng',
    testName: 'Potassium',
    status: 'pending' as const,
    result: '',
    unit: '',
    referenceRange: '3.5-5.0',
    abnormal: false,
    critical: false,
    orderedBy: 'Dr. Wani',
    orderedAt: new Date().toISOString(),
    completedAt: '',
    hospitalId: 'hosp-001',
    orgId: 'org-moh-ss',
    ...overrides,
  };
}

async function resultCritically(id: string) {
  return updateLabResult(id, {
    critical: true,
    abnormal: true,
    orderStatus: 'resulted',
    status: 'completed',
    result: '7.2',
    unit: 'mmol/L',
  });
}

describe('critical result → ordering clinician task', () => {
  it('lands in the ordering clinician task list via orderedById', async () => {
    await seedUser('user-dr-wani', 'Dr. Wani');
    const order = await createLabResult(baseOrder({ orderedById: 'user-dr-wani' }) as never);

    await resultCritically(order._id);

    const tasks = await getTasks('user-dr-wani');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toContain('Critical result: Potassium');
    expect(tasks[0].priority).toBe('high');
    expect(tasks[0].patientId).toBe('pat-00001');
  });

  it('a batch result must set orderStatus=resulted, not only status=completed, to reach the clinician', async () => {
    await seedUser('user-dr-wani', 'Dr. Wani');
    // A modern order carries an explicit granular orderStatus.
    const order = await createLabResult(baseOrder({ orderedById: 'user-dr-wani', orderStatus: 'in_process' }) as never);

    // The OLD LabBatchEntry wrote status=completed but left orderStatus stale,
    // so effectiveOrderStatus stayed 'in_process' and no critical task fired.
    await updateLabResult(order._id, { critical: true, abnormal: true, status: 'completed', result: '7.2', unit: 'mmol/L' });
    expect(await getTasks('user-dr-wani')).toHaveLength(0);

    // The fix: batch entry now also sets orderStatus='resulted'.
    await updateLabResult(order._id, { orderStatus: 'resulted', critical: true, abnormal: true, status: 'completed', result: '7.2', unit: 'mmol/L' });
    expect(await getTasks('user-dr-wani')).toHaveLength(1);
  });

  it('resolves a legacy name-only order against the user directory', async () => {
    await seedUser('user-dr-wani', 'Dr. Wani');
    await seedUser('user-dr-achol', 'Dr. Achol');
    const order = await createLabResult(baseOrder() as never); // no orderedById

    await resultCritically(order._id);

    expect(await getTasks('user-dr-wani')).toHaveLength(1);
    expect(await getTasks('Dr. Wani')).toHaveLength(0);
  });

  it('falls back to the name when it matches no unique user', async () => {
    await seedUser('user-dup-1', 'Dr. Dup');
    await seedUser('user-dup-2', 'Dr. Dup');
    const order = await createLabResult(baseOrder({ orderedBy: 'Dr. Dup' }) as never);

    await resultCritically(order._id);

    // Ambiguous — must not guess a clinician; keeps the legacy name key so the
    // notifications feed (which matches on name) still surfaces it.
    expect(await getTasks('user-dup-1')).toHaveLength(0);
    expect(await getTasks('user-dup-2')).toHaveLength(0);
    expect(await getTasks('Dr. Dup')).toHaveLength(1);
  });

  it('does not raise a second task when the same critical result is re-saved', async () => {
    await seedUser('user-dr-wani', 'Dr. Wani');
    const order = await createLabResult(baseOrder({ orderedById: 'user-dr-wani' }) as never);

    await resultCritically(order._id);
    await updateLabResult(order._id, { clinicalNotes: 'phoned the ward' });

    expect(await getTasks('user-dr-wani')).toHaveLength(1);
  });
});
