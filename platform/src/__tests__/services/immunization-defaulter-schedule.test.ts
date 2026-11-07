/**
 * Completing an immunisation dose must schedule the next dose in the series so
 * a child who misses it becomes a visible defaulter. The register only ever
 * wrote status:'completed', so getDefaulters found nobody (security/data audit
 * 2026-11-05, §2.1 #13). Covers the EPI schedule helpers and the end-to-end
 * create → schedule → defaulter path.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-imm` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs } from '../helpers/test-db';
import { createImmunization, getByPatient, getDefaulters } from '@/lib/services/immunization-service';
import { nextScheduledDose, dueDateFromBirth } from '@/lib/data/epi-schedule';
import type { DataScope } from '@/lib/services/data-scope';
import type { ImmunizationDoc } from '@/lib/db-types';

const SUPER: DataScope = { role: 'super_admin' };
afterEach(async () => { await teardownTestDBs(); uuidCounter = 0; });

function dose(vaccine: string, doseNumber: number, over: Partial<ImmunizationDoc> = {}) {
  return {
    patientId: 'child-1', patientName: 'Baby One', gender: 'Female', dateOfBirth: '2026-01-01',
    vaccine, doseNumber, dateGiven: '2026-02-12', nextDueDate: '', facilityId: 'h1',
    facilityName: 'Juba', state: 'CES', administeredBy: 'Nurse', batchNumber: 'B1',
    site: 'left thigh', adverseReaction: false, status: 'completed', orgId: 'org-a',
    ...over,
  } as unknown as Parameters<typeof createImmunization>[0];
}

describe('EPI schedule helpers', () => {
  it('returns the next dose within an antigen series, null at the end', () => {
    expect(nextScheduledDose('Penta', 1)).toEqual({ dose: 2, weeks: 10 });
    expect(nextScheduledDose('OPV', 0)).toEqual({ dose: 1, weeks: 6 });
    expect(nextScheduledDose('Measles', 1)).toEqual({ dose: 2, months: 18 });
    expect(nextScheduledDose('Penta', 3)).toBeNull();
    expect(nextScheduledDose('BCG', 1)).toBeNull();        // single dose
    expect(nextScheduledDose('Yellow Fever', 1)).toBeNull();
  });

  it('computes due dates from birth by weeks and by calendar months', () => {
    expect(dueDateFromBirth('2026-01-01', { dose: 2, weeks: 10 })).toBe('2026-03-12'); // +70 days
    expect(dueDateFromBirth('2026-01-15', { dose: 1, months: 9 })).toBe('2026-10-15');
  });
});

describe('createImmunization auto-schedules the next dose', () => {
  it('completing Penta1 schedules Penta2 at 10 weeks', async () => {
    await createImmunization(dose('Penta', 1), SUPER);
    const records = await getByPatient('child-1', SUPER);
    const penta2 = records.find(r => r.vaccine === 'Penta' && r.doseNumber === 2);
    expect(penta2).toBeDefined();
    expect(penta2!.status).toBe('scheduled');
    expect(penta2!.nextDueDate).toBe('2026-03-12'); // 2026-01-01 + 10 weeks
  });

  it('completing the final dose schedules nothing', async () => {
    await createImmunization(dose('Penta', 3), SUPER);
    const records = await getByPatient('child-1', SUPER);
    expect(records.filter(r => r.vaccine === 'Penta')).toHaveLength(1);
  });

  it('does not duplicate a scheduled dose already on file', async () => {
    await createImmunization(dose('Penta', 2, { status: 'scheduled', dateGiven: '', nextDueDate: '2026-03-12' }), SUPER);
    await createImmunization(dose('Penta', 1), SUPER); // would otherwise schedule Penta2
    const records = await getByPatient('child-1', SUPER);
    expect(records.filter(r => r.vaccine === 'Penta' && r.doseNumber === 2)).toHaveLength(1);
  });

  it('a scheduled dose past its due date surfaces as a defaulter', async () => {
    // DOB long ago so Penta2's 10-week due date is well in the past.
    await createImmunization(dose('Penta', 1, { dateOfBirth: '2020-01-01' }), SUPER);
    const defaulters = await getDefaulters(SUPER);
    expect(defaulters.some(d => d.patientId === 'child-1')).toBe(true);
  });
});
