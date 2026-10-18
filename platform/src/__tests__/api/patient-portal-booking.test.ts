/**
 * @jest-environment node
 *
 * Portal booking: the reasons and slots a patient sees, and the request they
 * submit. Facility, organisation and patient class come from the patient's own
 * record; the slot is re-verified server-side; provider name and duration are
 * never taken from the client.
 */
import { NextRequest } from 'next/server';
import type { AppointmentDoc } from '@/lib/db-types';
import type { VisitReasonDoc } from '@/lib/db-types-booking';

const putMock = jest.fn(async (doc: AppointmentDoc) => ({ ok: true, id: doc._id, rev: '1-x' }));
let demoFallback = false;
const getPatient = jest.fn();
const getAppointments = jest.fn();
const verifySlot = jest.fn();
const getSlots = jest.fn();
const assertNoConflicts = jest.fn();

class FakeConflict extends Error {}

const reason = (over: Partial<VisitReasonDoc> = {}): VisitReasonDoc => ({
  _id: 'vr-1', type: 'visit_reason', orgId: 'org-1', name: 'General consultation', slug: 'general',
  durationMinutes: 30, availableToNewPatients: true, availableToReturningPatients: true,
  modality: 'in_person', providerIds: [], department: 'Outpatient', appointmentType: 'general',
  sortOrder: 0, isActive: true, createdAt: 'x', updatedAt: 'x', ...over,
} as VisitReasonDoc);

let menu: VisitReasonDoc[] = [];

jest.mock('@/lib/patient-portal-auth', () => ({
  verifyPatientToken: jest.fn(async () => ({ sub: 'pat-1', name: 'Mary Lado', hospitalNumber: 'H1', role: 'patient' })),
  guardPortalWrite: jest.fn(async () => null),
}));
jest.mock('@/modules/identity', () => ({ logApiError: jest.fn() }));
jest.mock('@/lib/services/audit-service', () => ({ logAuditSafe: jest.fn(async () => undefined) }));
jest.mock('@/lib/services/sync-event-service', () => ({ emitSyncEvent: jest.fn() }));
const staff = jest.fn();
jest.mock('@/modules/identity/services/user-service', () => ({ getAllUsersUnscoped: () => staff() }));
jest.mock('@/lib/db', () => ({ appointmentsDB: () => ({ put: (d: AppointmentDoc) => putMock(d) }) }));
jest.mock('@/lib/patient-portal-demo', () => ({
  demoFallbackEnabled: () => demoFallback, logDemoFallback: jest.fn(),
  getDemoAppointmentsByPatient: jest.fn(), recordDemoAppointment: jest.fn(),
}));
jest.mock('@/lib/services/patient-service', () => ({ getPatientByIdUnscopedForPortal: (...a: unknown[]) => getPatient(...a) }));
jest.mock('@/lib/services/hospital-service', () => ({
  getHospitalById: jest.fn(async () => ({ _id: 'hosp-1', name: 'Juba Teaching Hospital', facilityLevel: 'state' })),
}));
jest.mock('@/lib/services/visit-reason-service', () => ({
  getVisitReasonsForFacility: jest.fn(async () => menu),
  bookableBy: (rs: VisitReasonDoc[], pc: string) => rs.filter(r => (pc === 'new' ? r.availableToNewPatients : r.availableToReturningPatients)),
}));
jest.mock('@/lib/services/booking-policy-service', () => ({
  getEffectiveBookingPolicy: jest.fn(async () => ({ maxAdvanceDays: 14 })),
}));
jest.mock('@/lib/services/booking-service', () => ({
  facilityNow: () => ({ date: '2026-09-01', time: '08:00' }),
  verifySlotStillOpen: (...a: unknown[]) => verifySlot(...a),
  getAvailableSlots: (...a: unknown[]) => getSlots(...a),
}));
jest.mock('@/lib/services/appointment-service', () => ({
  getAppointmentsByPatient: (...a: unknown[]) => getAppointments(...a),
  assertNoBookingConflicts: (...a: unknown[]) => assertNoConflicts(...a),
  BookingConflictError: FakeConflict,
}));

import { GET as getReasons } from '@/app/api/patient-portal/booking/reasons/route';
import { GET as getSlotsRoute } from '@/app/api/patient-portal/booking/slots/route';
import { POST } from '@/app/api/patient-portal/appointments/route';

const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) =>
  new NextRequest(`http://localhost${url}`, { headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, ...init });
const post = (body: Record<string, unknown>) => POST(req('/api/patient-portal/appointments', { method: 'POST', body: JSON.stringify(body) }));

const slotBody = {
  visitReasonId: 'vr-1', providerId: 'dr-wani', appointmentDate: '2026-09-07', appointmentTime: '09:00',
  patientNotes: 'Cough', contactPreference: 'sms',
};

beforeEach(() => {
  demoFallback = false;
  putMock.mockClear();
  menu = [reason(), reason({ _id: 'vr-ret', name: 'Review', availableToNewPatients: false }), reason({ _id: 'vr-off', isActive: false })];
  getPatient.mockReset().mockResolvedValue({ _id: 'pat-1', orgId: 'org-1', registrationHospital: 'hosp-1', phone: '+211900' });
  getAppointments.mockReset().mockResolvedValue([]);
  verifySlot.mockReset().mockResolvedValue(true);
  getSlots.mockReset().mockResolvedValue({
    slots: [{ providerId: 'dr-wani', providerName: 'Dr. Wani', facilityId: 'hosp-1', facilityName: 'JTH', date: '2026-09-07', startTime: '09:00', endTime: '09:30', durationMinutes: 30, capacityLeft: 1 }],
    from: '2026-09-07', to: '2026-09-07',
  });
  assertNoConflicts.mockReset().mockResolvedValue(undefined);
  require('@/lib/patient-portal-booking').clearBookableProviderCache();
  staff.mockReset().mockResolvedValue([
    { _id: 'dr-wani', role: 'doctor', hospitalId: 'hosp-1', isActive: true },
    { _id: 'dr-elsewhere', role: 'doctor', hospitalId: 'hosp-2', isActive: true },
  ]);
});

describe('GET /booking/reasons', () => {
  it('lists active reasons offered to a new patient, with the facility from the patient record', async () => {
    const res = await getReasons(req('/api/patient-portal/booking/reasons'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.patientClass).toBe('new');
    expect(json.facility).toEqual({ id: 'hosp-1', name: 'Juba Teaching Hospital' });
    expect(json.reasons.map((r: { id: string }) => r.id)).toEqual(['vr-1']);
    expect(json.reasons[0]).toEqual({ id: 'vr-1', name: 'General consultation', durationMinutes: 30 });
  });

  it('treats a patient who has been seen before as returning', async () => {
    getAppointments.mockResolvedValue([{ status: 'completed' }]);
    const json = await (await getReasons(req('/api/patient-portal/booking/reasons'))).json();
    expect(json.patientClass).toBe('returning');
    expect(json.reasons.map((r: { id: string }) => r.id)).toEqual(['vr-1', 'vr-ret']);
  });

  it('409s when the patient has no organisation', async () => {
    getPatient.mockResolvedValue({ _id: 'pat-1' });
    expect((await getReasons(req('/api/patient-portal/booking/reasons'))).status).toBe(409);
  });
});

describe('GET /booking/slots', () => {
  it('requires a reason and 404s an unknown or inactive one', async () => {
    expect((await getSlotsRoute(req('/api/patient-portal/booking/slots'))).status).toBe(400);
    expect((await getSlotsRoute(req('/api/patient-portal/booking/slots?reason=nope'))).status).toBe(404);
    expect((await getSlotsRoute(req('/api/patient-portal/booking/slots?reason=vr-off'))).status).toBe(404);
  });

  it('queries the portal channel at the patient facility and returns only free/busy fields', async () => {
    const res = await getSlotsRoute(req('/api/patient-portal/booking/slots?reason=vr-1&from=2026-09-07&to=2026-09-09&facilityId=EVIL'));
    expect(res.status).toBe(200);
    expect(getSlots.mock.calls[0][0]).toMatchObject({ facilityId: 'hosp-1', orgId: 'org-1', channel: 'portal', from: '2026-09-07', to: '2026-09-09' });
    const json = await res.json();
    expect(json.slots[0]).toEqual({ providerId: 'dr-wani', providerName: 'Dr. Wani', date: '2026-09-07', startTime: '09:00', endTime: '09:30', durationMinutes: 30 });
  });

  it('clamps a past start to today and a long range to the horizon', async () => {
    await getSlotsRoute(req('/api/patient-portal/booking/slots?reason=vr-1&from=2020-01-01&to=2030-01-01'));
    expect(getSlots.mock.calls[0][0]).toMatchObject({ from: '2026-09-01', to: '2026-09-15' });
  });

  it('caps a call at 31 days', async () => {
    const orig = jest.requireMock('@/lib/services/booking-policy-service');
    orig.getEffectiveBookingPolicy.mockResolvedValueOnce({ maxAdvanceDays: 365 });
    await getSlotsRoute(req('/api/patient-portal/booking/slots?reason=vr-1&from=2026-09-01&to=2027-01-01'));
    expect(getSlots.mock.calls[0][0]).toMatchObject({ from: '2026-09-01', to: '2026-10-01' });
  });

  it('returns nothing, without querying, when the range is wholly beyond the horizon', async () => {
    const res = await getSlotsRoute(req('/api/patient-portal/booking/slots?reason=vr-1&from=2027-01-01&to=2027-01-07'));
    expect((await res.json()).slots).toEqual([]);
    expect(getSlots).not.toHaveBeenCalled();
  });

  it('rejects a malformed date', async () => {
    expect((await getSlotsRoute(req('/api/patient-portal/booking/slots?reason=vr-1&from=tomorrow'))).status).toBe(400);
  });
});

describe('POST /appointments with a slot', () => {
  it('files a requested portal appointment resolved from the slot and the reason', async () => {
    const res = await post({ ...slotBody, providerName: 'Dr. EVIL', duration: 5, facilityId: 'hosp-EVIL', orgId: 'org-EVIL' });
    expect(res.status).toBe(201);
    expect(verifySlot.mock.calls[0][0]).toMatchObject({ channel: 'portal', providerId: 'dr-wani', date: '2026-09-07', startTime: '09:00', patientClass: 'new' });
    const doc = putMock.mock.calls[0][0];
    expect(doc).toMatchObject({
      orgId: 'org-1', facilityId: 'hosp-1', patientId: 'pat-1', status: 'requested', source: 'portal',
      providerId: 'dr-wani', providerName: 'Dr. Wani', duration: 30, endTime: '09:30',
      reason: 'General consultation (Outpatient)', patientNotes: 'Cough', contactPreference: 'sms',
      patientPhone: '+211900', visitReasonId: 'vr-1',
    });
  });

  it('prefers the phone the patient typed', async () => {
    await post({ ...slotBody, patientPhone: '+211111' });
    expect(putMock.mock.calls[0][0].patientPhone).toBe('+211111');
  });

  it('409s with slot_unavailable when the slot is gone', async () => {
    verifySlot.mockResolvedValue(false);
    const res = await post(slotBody);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('slot_unavailable');
    expect(putMock).not.toHaveBeenCalled();
  });

  it('409s without leaking the other patient when the conflict guard trips', async () => {
    assertNoConflicts.mockRejectedValue(new FakeConflict('Scheduling conflict: Jane Doe at 09:00'));
    const res = await post(slotBody);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe('slot_unavailable');
    expect(JSON.stringify(json)).not.toContain('Jane');
    expect(putMock).not.toHaveBeenCalled();
  });

  it('refuses a reason the facility does not offer', async () => {
    const res = await post({ ...slotBody, visitReasonId: 'vr-elsewhere' });
    expect(res.status).toBe(400);
    expect(putMock).not.toHaveBeenCalled();
  });

  it('rejects a bad contact preference or time', async () => {
    expect((await post({ ...slotBody, contactPreference: 'pigeon' })).status).toBe(400);
    expect((await post({ ...slotBody, appointmentTime: '9am' })).status).toBe(400);
  });
});

describe('POST /appointments legacy body', () => {
  it('still files a free-form request with no slot check', async () => {
    const res = await post({ facilityId: 'hosp-1', appointmentDate: '2099-01-05', appointmentTime: '', reason: 'Checkup' });
    expect(res.status).toBe(201);
    expect(verifySlot).not.toHaveBeenCalled();
    expect(putMock.mock.calls[0][0]).toMatchObject({ status: 'requested', reason: 'Checkup', orgId: 'org-1' });
  });
});


describe('portal booking only offers clinicians the desk can assign', () => {
  it('drops slots for a provider who is not active staff at the patient facility', async () => {
    staff.mockResolvedValue([{ _id: 'dr-wani', role: 'doctor', hospitalId: 'hosp-2', isActive: true }]);
    const res = await getSlotsRoute(req('/api/patient-portal/booking/slots?reason=vr-1&from=2026-09-07&to=2026-09-07'));
    expect((await res.json()).slots).toEqual([]);
  });

  it('refuses a request for such a provider with the generic slot-taken 409', async () => {
    staff.mockResolvedValue([]);
    const res = await post(slotBody);
    expect(res.status).toBe(409);
    expect(putMock).not.toHaveBeenCalled();
  });
});


describe('the slot-less (legacy) request cannot name a clinician', () => {
  it('ignores client provider and facility names, and stamps the portal source', async () => {
    const res = await post({
      facilityId: 'hosp-1', appointmentDate: '2099-01-05', appointmentTime: '09:00', reason: 'Checkup',
      providerId: 'dr-real', providerName: 'Dr. Consultant', facilityName: 'Fake Hospital',
    });
    expect(res.status).toBe(201);
    const doc = putMock.mock.calls[0][0];
    expect(doc.providerId).toBe('');
    expect(doc.providerName).toBe('');
    expect(doc.facilityName).not.toBe('Fake Hospital');
    expect(doc.source).toBe('portal');
  });
});

describe('pending request cap', () => {
  it('refuses a fourth pending request with 429', async () => {
    getAppointments.mockResolvedValue([1, 2, 3].map(i => ({ status: 'requested', appointmentDate: '2099-01-0' + i })));
    const res = await post(slotBody);
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe('too_many_requests');
    expect(putMock).not.toHaveBeenCalled();
  });
});

describe('slots on a day the patient already has an open visit', () => {
  // Mocked facility "today" is 2026-09-01 with a 14-day horizon, so 09-07 is in range.
  it('are dropped and the day is named, instead of offering times that 409', async () => {
    getAppointments.mockResolvedValue([{ orgId: 'org-1', facilityId: 'hosp-1', status: 'scheduled', appointmentDate: '2026-09-07' }]);
    const json = await (await getSlotsRoute(req('/api/patient-portal/booking/slots?reason=vr-1&from=2026-09-07&to=2026-09-07'))).json();
    expect(json.slots).toEqual([]);
    expect(json.ownVisitDates).toEqual(['2026-09-07']);
  });

  it('ignores a cancelled visit that day', async () => {
    getAppointments.mockResolvedValue([{ orgId: 'org-1', facilityId: 'hosp-1', status: 'cancelled', appointmentDate: '2026-09-07' }]);
    const json = await (await getSlotsRoute(req('/api/patient-portal/booking/slots?reason=vr-1&from=2026-09-07&to=2026-09-07'))).json();
    expect(json.slots).toHaveLength(1);
    expect(json.ownVisitDates).toEqual([]);
  });
});
