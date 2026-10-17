import { unreviewedAbnormalResults } from '@/components/ehr/chart/sections/ResultsSection';
import type { LabResultDoc } from '@/lib/db-types';

const result = (overrides: Partial<LabResultDoc>): LabResultDoc => ({
  _id: 'lab-1',
  type: 'lab_result',
  patientId: 'pat-1',
  patientName: 'Patient One',
  hospitalNumber: 'P-1',
  testName: 'Full Blood Count',
  specimen: 'Blood',
  status: 'completed',
  orderStatus: 'resulted',
  result: 'Hb 7.2',
  unit: 'g/dL',
  referenceRange: '12-16',
  abnormal: true,
  critical: false,
  orderedBy: 'Dr. Wani',
  orderedAt: '2026-10-16T09:00:00.000Z',
  completedAt: '2026-10-16T10:00:00.000Z',
  createdAt: '2026-10-16T09:00:00.000Z',
  updatedAt: '2026-10-16T10:00:00.000Z',
  ...overrides,
});

describe('unreviewedAbnormalResults', () => {
  it('returns only abnormal results still awaiting clinician review', () => {
    const waiting = result({ _id: 'waiting' });
    const normal = result({ _id: 'normal', abnormal: false });
    const reviewed = result({ _id: 'reviewed', orderStatus: 'reviewed_by_clinician', reviewedAt: '2026-10-16T11:00:00.000Z' });

    expect(unreviewedAbnormalResults([normal, reviewed, waiting])).toEqual([waiting]);
  });

  it('does not treat an abnormal pending order as a reported result', () => {
    expect(unreviewedAbnormalResults([
      result({ status: 'pending', orderStatus: 'ordered' }),
    ])).toEqual([]);
  });
});
