/**
 * @jest-environment node
 *
 * A patient's portal message must be saved where their clinic can read it:
 * stamped with the organisation and facility from the patient's own record
 * (never from the request), and addressed to the clinician they are answering.
 */
import { NextRequest } from 'next/server';
import type { MessageDoc } from '@/lib/db-types';

const createMessage = jest.fn(async (data: Partial<MessageDoc>) => ({ _id: 'msg-new', ...data }));
const getPortalMessagesByPatient = jest.fn(async (): Promise<Partial<MessageDoc>[]> => []);
let demoFallback = false;
const getPatientById = jest.fn();

jest.mock('@/lib/patient-portal-auth', () => ({
  verifyPatientToken: jest.fn(async () => ({ sub: 'pat-1', name: 'Deng Mabior Garang', hospitalNumber: 'JTH-1', role: 'patient' })),
  guardPortalWrite: jest.fn(async () => null),
}));
jest.mock('@/modules/identity', () => ({ logApiError: jest.fn() }));
jest.mock('@/lib/services/audit-service', () => ({ logAuditSafe: jest.fn(async () => undefined) }));
jest.mock('@/lib/patient-portal-demo', () => ({
  demoFallbackEnabled: () => demoFallback, logDemoFallback: jest.fn(),
  getDemoMessagesByPatient: jest.fn(), recordDemoMessage: jest.fn(),
}));
jest.mock('@/lib/services/patient-service', () => ({ getPatientById: (...a: unknown[]) => getPatientById(...a) }));
jest.mock('@/modules/communication/services/message-service', () => ({
  createMessage: (...a: [Partial<MessageDoc>]) => createMessage(...a),
  getPortalMessagesByPatient: () => getPortalMessagesByPatient(),
}));

import { GET, POST } from '@/app/api/patient-portal/messages/route';

const post = (body: Record<string, unknown>) => POST(new NextRequest('http://localhost/api/patient-portal/messages', {
  method: 'POST', body: JSON.stringify(body), headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
}));

beforeEach(() => {
  demoFallback = false;
  createMessage.mockClear();
  getPortalMessagesByPatient.mockReset().mockResolvedValue([]);
  getPatientById.mockReset().mockResolvedValue({
    _id: 'pat-1', orgId: 'org-moh-ss', registrationHospital: 'hosp-001',
    assignedDoctor: 'user-dr-achol', assignedDoctorName: 'Dr. Achol',
  });
});

it('stamps the organisation and facility from the patient record, not the request', async () => {
  const res = await post({ body: 'Is my result back?', recipientHospitalId: 'hosp-EVIL', fromHospitalId: 'hosp-EVIL', orgId: 'org-EVIL' });
  expect(res.status).toBe(201);
  expect(createMessage.mock.calls[0][0]).toMatchObject({
    orgId: 'org-moh-ss', recipientHospitalId: 'hosp-001', fromHospitalId: 'hosp-001',
    direction: 'patient_to_staff', fromDoctorId: 'patient', patientId: 'pat-1', body: 'Is my result back?',
  });
});

it('addresses the reply to the clinician who last wrote to the patient', async () => {
  getPortalMessagesByPatient.mockResolvedValue([
    { _id: 'm1', patientId: 'pat-1', direction: 'staff_to_patient', fromDoctorId: 'user-dr-wani', fromDoctorName: 'Dr. James Wani', sentAt: '2026-10-08T08:00:00Z' },
  ]);
  await post({ body: 'Thank you doctor' });
  expect(createMessage.mock.calls[0][0]).toMatchObject({ recipientStaffId: 'user-dr-wani', recipientStaffName: 'Dr. James Wani' });
});

it('addresses a first message to the assigned doctor', async () => {
  await post({ body: 'Hello' });
  expect(createMessage.mock.calls[0][0]).toMatchObject({ recipientStaffId: 'user-dr-achol' });
});

it('cannot be addressed by the patient to a clinician of their choosing', async () => {
  await post({ body: 'Hello', recipientStaffId: 'user-someone-else' });
  expect(createMessage.mock.calls[0][0].recipientStaffId).toBe('user-dr-achol');
});

it('files the reply at the facility of the clinician being answered', async () => {
  // Registered at hosp-001, seen at hosp-002: the doctor there is scoped to
  // hosp-002 and would never see a reply filed only at the registration site.
  getPortalMessagesByPatient.mockResolvedValue([
    { _id: 'm1', patientId: 'pat-1', direction: 'staff_to_patient', fromDoctorId: 'user-dr-wau', fromDoctorName: 'Dr. Wau', fromHospitalId: 'hosp-002', sentAt: '2026-10-08T08:00:00Z' },
  ]);
  await post({ body: 'Thank you' });
  expect(createMessage.mock.calls[0][0]).toMatchObject({
    recipientStaffId: 'user-dr-wau', recipientHospitalId: 'hosp-002', fromHospitalId: 'hosp-001',
  });
});

it('does not address a reply to the lab because the lab raised an alert about the patient', async () => {
  getPortalMessagesByPatient.mockResolvedValue([
    { _id: 'm1', patientId: 'pat-1', direction: 'staff_to_patient', fromDoctorId: 'user-dr-wani', fromDoctorName: 'Dr. James Wani', sentAt: '2026-10-08T08:00:00Z' },
    // Internal: staff to staff, about the patient, no direction.
    { _id: 'alert', patientId: 'pat-1', recipientType: 'staff', fromDoctorId: 'user-lab-tech', fromDoctorName: 'Lab Tech', sentAt: '2026-10-08T09:00:00Z' },
  ]);
  await post({ body: 'Hello' });
  expect(createMessage.mock.calls[0][0].recipientStaffId).toBe('user-dr-wani');
});

it('never shows the patient an internal alert that carries their id', async () => {
  getPortalMessagesByPatient.mockResolvedValue([
    { _id: 'to-me', patientId: 'pat-1', direction: 'staff_to_patient', fromDoctorId: 'user-dr-wani', body: 'See you Monday' },
    { _id: 'mine', patientId: 'pat-1', direction: 'patient_to_staff', fromDoctorId: 'patient', body: 'Thanks' },
    { _id: 'legacy', patientId: 'pat-1', fromDoctorId: 'user-dr-wani', body: 'Older message, no direction' },
    { _id: 'alert', patientId: 'pat-1', recipientType: 'staff', fromDoctorId: 'user-lab-tech', body: 'CRITICAL: potassium 6.9' },
  ]);
  const res = await GET(new NextRequest('http://localhost/api/patient-portal/messages', { headers: { authorization: 'Bearer t' } }));
  const { messages } = await res.json();
  expect(messages.map((m: { _id: string }) => m._id)).toEqual(['to-me', 'mine', 'legacy']);
});

it('stamps the time itself, whatever the phone claims', async () => {
  const before = Date.now();
  await post({ body: 'Hello', sentAt: '2099-01-01T00:00:00.000Z' });
  const sentAt = Date.parse(createMessage.mock.calls[0][0].sentAt as string);
  expect(sentAt).toBeGreaterThanOrEqual(before);
  expect(sentAt).toBeLessThanOrEqual(Date.now());
});

it('refuses an empty or oversized message', async () => {
  expect((await post({ body: '  ' })).status).toBe(400);
  expect((await post({ body: 'x'.repeat(5000) })).status).toBe(400);
  expect(createMessage).not.toHaveBeenCalled();
});

it('refuses, rather than saves, a message it cannot route to an organisation', async () => {
  getPatientById.mockRejectedValue(new Error('db down'));
  const res = await post({ body: 'Hello', recipientHospitalId: 'hosp-001' });
  expect(res.status).toBe(503);
  expect(createMessage).not.toHaveBeenCalled();
});

it('keeps the demo build’s fallback, which has no patient records to route by', async () => {
  demoFallback = true;
  getPatientById.mockRejectedValue(new Error('no database'));
  const res = await post({ body: 'Hello', recipientHospitalId: 'hosp-001' });
  expect(res.status).toBe(201);
  expect(createMessage.mock.calls[0][0]).toMatchObject({ recipientHospitalId: 'hosp-001', body: 'Hello' });
});
