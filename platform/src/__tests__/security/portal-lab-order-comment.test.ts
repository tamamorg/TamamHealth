/** @jest-environment node */
/**
 * The lab order's internal comment never reaches the patient.
 *
 * The order form labels the field "Only staff see this". The portal's labs
 * route returns whole lab documents, so the moment that comment started being
 * saved on the order it would have ridden along to the patient's browser. The
 * route strips it; this holds the label to its word.
 */
const mockGetLabResultsByPatient = jest.fn();
jest.mock('@/lib/services/lab-service', () => ({
  getLabResultsByPatient: (...args: unknown[]) => mockGetLabResultsByPatient(...args),
}));
jest.mock('@/lib/patient-portal-auth', () => ({
  verifyPatientToken: jest.fn(async () => ({ sub: 'pat-1', role: 'patient' })),
}));
jest.mock('@/modules/identity', () => ({ logApiError: jest.fn() }));
jest.mock('@/lib/patient-portal-demo', () => ({
  demoFallbackEnabled: () => false,
  logDemoFallback: jest.fn(),
  getDemoLabResultsByPatient: jest.fn(),
}));

import { GET } from '@/app/api/patient-portal/labs/route';

it('strips the staff-only order comment and leaves the result intact', async () => {
  mockGetLabResultsByPatient.mockResolvedValue([
    {
      _id: 'lab-1', type: 'lab_result', patientId: 'pat-1', testName: 'Full Blood Count',
      status: 'completed', result: 'Hb 11.2', orderComment: 'Call ext. 204 with the result',
    },
    { _id: 'lab-2', type: 'lab_result', patientId: 'pat-1', testName: 'Malaria RDT', status: 'pending', result: '' },
  ]);

  const response = await GET({} as never);
  const body = await response.json();

  expect(mockGetLabResultsByPatient).toHaveBeenCalledWith('pat-1');
  expect(body.results).toHaveLength(2);
  expect(JSON.stringify(body)).not.toContain('Call ext. 204');
  expect(body.results.every((doc: Record<string, unknown>) => !('orderComment' in doc))).toBe(true);
  expect(body.results[0]).toMatchObject({ _id: 'lab-1', testName: 'Full Blood Count', result: 'Hb 11.2' });
});
