/**
 * Referral progress reaches the referring team through the notification bell
 * and the referral row, never as a care alert on the patient's chart. The old
 * notices already on charts stay stored but are hidden wherever alerts are read.
 */
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs } from '../helpers/test-db';
import { patientsDB, referralsDB } from '@/lib/db';
import { completeReferralWithOutcome, updateReferralStatus } from '@/lib/services/referral-service';
import { chartCareAlerts, isReferralStatusNotice } from '@/lib/care-alert-rules';
import type { CareAlertEntry } from '@/data/mock';

afterEach(async () => { await teardownTestDBs(); });

async function seed() {
  await patientsDB().put({ _id: 'pat-1', type: 'patient', firstName: 'A', surname: 'B', orgId: 'org-1', careAlerts: [] } as never);
  await referralsDB().put({
    _id: 'ref-1', type: 'referral', patientId: 'pat-1', patientName: 'A B', status: 'sent', urgency: 'emergency',
    fromHospital: 'Wau', fromHospitalId: 'hosp-2', toHospital: 'Juba Teaching Hospital', toHospitalId: 'hosp-1',
    department: 'Emergency', orgId: 'org-1', referralDate: '2026-11-01', createdAt: '2026-11-01T08:00:00Z', updatedAt: '2026-11-01T08:00:00Z',
  } as never);
}

describe('referral progress', () => {
  it('records each step on the referral and writes nothing to the chart', async () => {
    await seed();
    await updateReferralStatus('ref-1', 'received');
    const accepted = await updateReferralStatus('ref-1', 'seen');
    expect(accepted?.statusHistory?.map(step => step.status)).toEqual(['received', 'seen']);
    const patient = await patientsDB().get('pat-1') as { careAlerts?: CareAlertEntry[] };
    expect(patient.careAlerts ?? []).toHaveLength(0);
  });

  it('records completion with the outcome time', async () => {
    await seed();
    const done = await completeReferralWithOutcome('ref-1', {
      disposition: 'treated_discharged', summary: 'Recovered', recordedAt: '2026-11-03T10:00:00Z', recordedBy: 'Dr. Lado',
    } as never);
    expect(done?.statusHistory).toEqual([{ status: 'completed', at: '2026-11-03T10:00:00Z' }]);
    const patient = await patientsDB().get('pat-1') as { careAlerts?: CareAlertEntry[] };
    expect(patient.careAlerts ?? []).toHaveLength(0);
  });
});

describe('alerts the chart shows', () => {
  const alert = (over: Partial<CareAlertEntry>): CareAlertEntry => ({
    id: Math.random().toString(36), category: 'clinical_risk', message: 'High fall risk', priority: 'normal', status: 'active', recordedAt: '2026-11-01T00:00:00Z', ...over,
  });

  it('hides the referral notices the old loop wrote', () => {
    const notice = alert({ category: 'administrative', priority: 'high', message: 'Referral to Juba Teaching Hospital (Emergency, emergency) has been received by the receiving facility.' });
    expect(isReferralStatusNotice(notice)).toBe(true);
    expect(chartCareAlerts([notice, alert({})]).map(a => a.message)).toEqual(['High fall risk']);
  });

  it('keeps an administrative alert someone wrote by hand', () => {
    expect(isReferralStatusNotice(alert({ category: 'administrative', message: 'Interpreter needed: Nuer' }))).toBe(false);
  });

  it('puts high priority first and drops resolved alerts', () => {
    const list = chartCareAlerts([
      alert({ message: 'Normal' }),
      alert({ message: 'High', priority: 'high' }),
      alert({ message: 'Gone', status: 'resolved' }),
    ]);
    expect(list.map(a => a.message)).toEqual(['High', 'Normal']);
  });
});
