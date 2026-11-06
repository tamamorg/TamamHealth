/**
 * Completing a follow-up must not erase its instructions. The dashboard used to
 * write the completion note into `notes`, overwriting the clinical instructions
 * set at creation ("repeat chest X-ray, check SpO2") — they became undefined
 * when the note was blank (security/data audit 2026-11-05, §2.1 #14). The
 * completion note now lives in its own `completionNotes` field.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-fu` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs } from '../helpers/test-db';
import { createFollowUp, updateFollowUp } from '@/lib/services/follow-up-service';

afterEach(async () => { await teardownTestDBs(); uuidCounter = 0; });

function input() {
  return {
    patientId: 'pat-1', patientName: 'A B', condition: 'TB',
    assignedWorker: 'w1', assignedWorkerName: 'Worker One',
    status: 'active', facilityLevel: 'county', scheduledDate: '2026-11-10',
    state: 'Jonglei', county: 'Bor', orgId: 'org-1',
    notes: 'Repeat chest X-ray, check SpO2',
  } as unknown as Parameters<typeof createFollowUp>[0];
}

describe('completing a follow-up keeps its instructions', () => {
  it('writes completionNotes and leaves the original notes intact', async () => {
    const created = await createFollowUp(input());
    expect(created.notes).toBe('Repeat chest X-ray, check SpO2');

    // Exactly the payload the dashboard sends at completion.
    const done = await updateFollowUp(created._id, {
      status: 'completed',
      outcome: 'recovered',
      completedDate: '2026-11-11',
      completionNotes: 'Seen, improving',
    });

    expect(done).not.toBeNull();
    expect(done!.notes).toBe('Repeat chest X-ray, check SpO2'); // instructions preserved
    expect(done!.completionNotes).toBe('Seen, improving');
    expect(done!.status).toBe('completed');
  });

  it('a blank completion note does not wipe the instructions', async () => {
    const created = await createFollowUp(input());
    const done = await updateFollowUp(created._id, {
      status: 'completed', outcome: 'recovered', completedDate: '2026-11-11',
      completionNotes: undefined,
    });
    expect(done!.notes).toBe('Repeat chest X-ray, check SpO2');
  });
});
