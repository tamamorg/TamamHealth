/** @jest-environment node */
/**
 * What the patient portal may show of a lab order.
 *
 * The labs route returned the whole document: the clinician's notes to the
 * laboratory, coded reasons, order-entry answers, rejection and amendment
 * history, staff names at every step — and the result the moment the bench
 * filed it, before any clinician had read it. Two rules now stand between the
 * record and the patient: an allow-list of fields, and release on review.
 */
import { isReleasedToPatient, toPortalLabResult } from '@/lib/patient-portal-labs';
import type { LabResultDoc } from '@/lib/db-types';

const lab = (overrides: Partial<LabResultDoc> = {}) => ({
  _id: 'lab-1', type: 'lab_result', patientId: 'pat-1', patientName: 'Mary Akol', hospitalNumber: 'JTH-1',
  testName: 'HIV Rapid Test', specimen: 'Blood', status: 'completed', result: 'Reactive', unit: '',
  referenceRange: 'Non-reactive', abnormal: true, critical: true, orderedBy: 'Dr. James Wani',
  orderedById: 'user-1', orderedAt: '2026-10-03T08:00:00.000Z', completedAt: '2026-10-03T10:00:00.000Z',
  createdAt: '2026-10-03T08:00:00.000Z', updatedAt: '2026-10-03T10:00:00.000Z', orderStatus: 'resulted',
  clinicalNotes: 'Partner recently diagnosed', orderComment: 'Call ext. 204',
  indications: [{ code: 'QA08.4', title: 'Special screening examination for human immunodeficiency virus' }],
  aoeAnswers: [{ question: 'Pre-test counselling given and consent recorded?', answer: 'Yes' }],
  specimenCollectedBy: 'Lab Tech Gatluak', specimenRejectionNotes: 'first tube haemolysed',
  amendmentReason: 'transcription', amendedFrom: 'Non-reactive', accessionNumber: 'ACC-1',
  hospitalId: 'hosp-1', orgId: 'org-1',
  ...overrides,
}) as unknown as LabResultDoc;

describe('release on review', () => {
  it('withholds a filed result until a clinician has reviewed it', () => {
    for (const orderStatus of ['resulted'] as const) {
      expect(isReleasedToPatient(lab({ orderStatus }))).toBe(false);
    }
    for (const orderStatus of ['reviewed_by_clinician', 'acted_upon', 'communicated_to_patient'] as const) {
      expect(isReleasedToPatient(lab({ orderStatus }))).toBe(true);
    }
  });

  it('never releases an order that has no result yet', () => {
    expect(isReleasedToPatient(lab({ status: 'pending', orderStatus: 'ordered' }))).toBe(false);
    expect(isReleasedToPatient(lab({ status: 'in_progress', orderStatus: 'in_process' }))).toBe(false);
  });

  it('keeps results recorded before the lifecycle existed visible, as they were', () => {
    expect(isReleasedToPatient(lab({ orderStatus: undefined }))).toBe(true);
  });

  it('shows an unreviewed critical result as pending — no value, no flags', () => {
    const shown = toPortalLabResult(lab());
    expect(shown.status).toBe('pending');
    expect(shown.awaitingReview).toBe(true);
    expect(shown).not.toHaveProperty('result');
    expect(shown).not.toHaveProperty('critical');
    expect(shown).not.toHaveProperty('abnormal');
    expect(shown).not.toHaveProperty('referenceRange');
    expect(JSON.stringify(shown)).not.toContain('Reactive');
  });

  it('shows the result once reviewed', () => {
    const shown = toPortalLabResult(lab({ orderStatus: 'reviewed_by_clinician' }));
    expect(shown).toMatchObject({
      status: 'completed', awaitingReview: false, result: 'Reactive', referenceRange: 'Non-reactive',
      abnormal: true, critical: true,
    });
  });
});

describe('the allow-list', () => {
  it('sends only what a patient should see, released or not', () => {
    const allowed = [
      '_id', 'patientId', 'testName', 'specimen', 'orderKind', 'orderedBy', 'orderedAt', 'createdAt',
      'status', 'awaitingReview', 'result', 'unit', 'referenceRange', 'abnormal', 'critical', 'completedAt',
    ];
    for (const orderStatus of ['resulted', 'reviewed_by_clinician'] as const) {
      const shown = toPortalLabResult(lab({ orderStatus }));
      expect(Object.keys(shown).filter(key => !allowed.includes(key))).toEqual([]);
      const wire = JSON.stringify(shown);
      for (const secret of ['Partner recently diagnosed', 'Call ext. 204', 'QA08.4', 'counselling', 'Gatluak', 'haemolysed', 'transcription', 'ACC-1', 'user-1', 'org-1']) {
        expect(wire).not.toContain(secret);
      }
    }
  });
});

describe('GET /api/patient-portal/labs', () => {
  const getLabResultsByPatient = jest.fn();
  beforeAll(() => {
    jest.doMock('@/lib/services/lab-service', () => ({ getLabResultsByPatient: (...a: unknown[]) => getLabResultsByPatient(...a) }));
    jest.doMock('@/lib/patient-portal-auth', () => ({ verifyPatientToken: jest.fn(async () => ({ sub: 'pat-1', role: 'patient' })) }));
    jest.doMock('@/modules/identity', () => ({ logApiError: jest.fn() }));
    jest.doMock('@/lib/patient-portal-demo', () => ({
      demoFallbackEnabled: () => true,
      logDemoFallback: jest.fn(),
      getDemoLabResultsByPatient: jest.fn(async () => [lab({ _id: 'lab-demo' })]),
    }));
  });

  it('applies both rules to what it returns', async () => {
    const { GET } = await import('@/app/api/patient-portal/labs/route');
    getLabResultsByPatient.mockResolvedValue([lab(), lab({ _id: 'lab-2', orderStatus: 'reviewed_by_clinician' })]);
    const body = await (await GET({} as never)).json();
    expect(body.results.map((r: { _id: string; status: string }) => [r._id, r.status])).toEqual([
      ['lab-1', 'pending'], ['lab-2', 'completed'],
    ]);
    expect(body.results[0].result).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('Partner recently diagnosed');
  });

  it('applies them on the demo fallback path too', async () => {
    const { GET } = await import('@/app/api/patient-portal/labs/route');
    getLabResultsByPatient.mockRejectedValue(new Error('no database'));
    const body = await (await GET({} as never)).json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({ _id: 'lab-demo', status: 'pending', awaitingReview: true });
    expect(JSON.stringify(body)).not.toContain('Reactive');
  });
});
