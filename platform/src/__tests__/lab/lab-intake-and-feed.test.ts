/**
 * Two small lab/radiology rules from the 2026-11-08 sweep.
 *  - An outside request with no named clinician is "ordered by" the sending
 *    facility, not by the lab tech who typed it in.
 *  - Radiology's "Imaging moving" card lists imaging studies only.
 */
const mockPlace = jest.fn();
jest.mock('@/components/lab/order/place-lab-order', () => ({ placeLabOrder: (...a: unknown[]) => mockPlace(...a) }));

import { submitLabIntake } from '@/components/lab/order/lab-intake';
import { labsForFeed } from '@/lib/clinical-flow/progress-feed';

const patient = { _id: 'pat-1', firstName: 'Bol', surname: 'Gai' };
const tech = { _id: 'user-lab', name: 'Lab Tech Gatluak Puok', hospitalId: 'hosp-001', orgId: 'org-1' };
const base = {
  patient, newPatient: undefined, tests: [], priority: 'routine', notes: '', requester: '', facility: '', reference: '',
  arrivedCollected: false, collectedAt: '', collectedBy: '',
};

describe('lab intake requester', () => {
  beforeEach(() => { mockPlace.mockReset(); mockPlace.mockResolvedValue({ createdIds: [] }); });
  const ordering = () => mockPlace.mock.calls[0][0].draft;

  it('names the sending facility when an outside request has no clinician', async () => {
    await submitLabIntake({ ...base, source: 'external_facility', facility: 'Gudele Clinic' } as never, tech as never, {} as never);
    expect(ordering().orderedByName).toBe('Gudele Clinic');
  });

  it('prefers the named clinician', async () => {
    await submitLabIntake({ ...base, source: 'external_facility', facility: 'Gudele Clinic', requester: 'Dr. Ayen' } as never, tech as never, {} as never);
    expect(ordering().orderedByName).toBe('Dr. Ayen');
  });

  it('keeps Self-request for a walk-in', async () => {
    await submitLabIntake({ ...base, source: 'walk_in' } as never, tech as never, {} as never);
    expect(ordering().orderedByName).toBe('Self-request');
  });
});

describe('labsForFeed', () => {
  const labs = [
    { testName: 'Malaria RDT', specimen: 'Blood' },
    { testName: 'X-Ray - Chest', specimen: 'Imaging' },
    { testName: 'Ultrasound - Obstetric' },
  ];
  it('gives radiology only imaging studies', () => {
    expect(labsForFeed('radiologist', labs).map(l => l.testName)).toEqual(['X-Ray - Chest', 'Ultrasound - Obstetric']);
  });
  it('leaves every other role untouched', () => {
    expect(labsForFeed('lab_tech', labs)).toHaveLength(3);
    expect(labsForFeed(undefined, labs)).toHaveLength(3);
  });
});
