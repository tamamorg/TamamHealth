/**
 * Nobody named on a visit can be in two visits at once — the provider AND the
 * second staff member (the nurse), wherever their other booking names them.
 * Before, only the provider's own provider-bookings were checked, so a nurse
 * could be booked into two 10:00 visits with two different doctors, and a
 * doctor down as the second clinician on one visit could be booked as the
 * provider of another at the same time.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-scuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

jest.setTimeout(30000);

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { hospitalsDB } from '@/lib/db';
import { createAppointment, BookingConflictError } from '@/lib/services/appointment-service';
import type { AppointmentDoc } from '@/lib/db-types';

const ORG = 'org-moh-ss';
const HOSP = 'hosp-001';
const DAY = '2031-03-04';

type NewAppointment = Omit<AppointmentDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>;

function booking(overrides: Partial<NewAppointment>): NewAppointment {
  return {
    patientId: 'pat-a',
    patientName: 'Akech Deng',
    providerId: 'dr-a',
    providerName: 'Dr. A',
    facilityId: HOSP,
    facilityName: 'Juba Teaching Hospital',
    facilityLevel: 'payam',
    appointmentDate: DAY,
    appointmentTime: '10:00',
    duration: 30,
    appointmentType: 'general',
    priority: 'routine',
    department: 'Outpatient',
    reason: 'Review',
    status: 'scheduled',
    reminderSent: false,
    isRecurring: false,
    bookedBy: 'dr-a',
    bookedByName: 'Dr. A',
    state: '',
    orgId: ORG,
    ...overrides,
  } as NewAppointment;
}

beforeEach(async () => {
  await putDoc(hospitalsDB(), { _id: HOSP, type: 'hospital', name: 'Juba Teaching Hospital', orgId: ORG } as never);
});
afterEach(async () => {
  await teardownTestDBs();
  uuidCounter = 0;
});

describe('staff calendar conflicts', () => {
  it('refuses a nurse already rooming another visit at that time', async () => {
    await createAppointment(booking({ staffId: 'nurse-s', staffName: 'Stella' }));
    await expect(createAppointment(booking({
      patientId: 'pat-b', patientName: 'Nyibol Garang', providerId: 'dr-b', providerName: 'Dr. B',
      staffId: 'nurse-s', staffName: 'Stella', appointmentTime: '10:15',
    }))).rejects.toThrow(/Stella already has Akech Deng/);
  });

  it('refuses a provider who is the second clinician on another visit then', async () => {
    await createAppointment(booking({ staffId: 'dr-b', staffName: 'Dr. B' }));
    await expect(createAppointment(booking({
      patientId: 'pat-b', patientName: 'Nyibol Garang', providerId: 'dr-b', providerName: 'Dr. B',
    }))).rejects.toBeInstanceOf(BookingConflictError);
  });

  it('allows the same nurse at a time that does not overlap', async () => {
    await createAppointment(booking({ staffId: 'nurse-s', staffName: 'Stella' }));
    await expect(createAppointment(booking({
      patientId: 'pat-b', patientName: 'Nyibol Garang', providerId: 'dr-b', providerName: 'Dr. B',
      staffId: 'nurse-s', staffName: 'Stella', appointmentTime: '10:30',
    }))).resolves.toMatchObject({ staffId: 'nurse-s' });
  });

  it('ignores a cancelled visit on the nurse\'s calendar', async () => {
    const first = await createAppointment(booking({ staffId: 'nurse-s', staffName: 'Stella', status: 'cancelled' }));
    expect(first.status).toBe('cancelled');
    await expect(createAppointment(booking({
      patientId: 'pat-b', patientName: 'Nyibol Garang', providerId: 'dr-b', providerName: 'Dr. B',
      staffId: 'nurse-s', staffName: 'Stella',
    }))).resolves.toBeTruthy();
  });
});
