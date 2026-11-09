/**
 * One open visit per patient per day, but a visit that was checked out is over:
 * the patient who comes back that afternoon books a second visit. `completed`
 * was missing from the "not open" statuses, so checkout locked the patient out
 * of any further visit that day.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-rvid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());
jest.setTimeout(30000);

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { hospitalsDB } from '@/lib/db';
import { createAppointment, BookingConflictError } from '@/lib/services/appointment-service';
import type { AppointmentDoc } from '@/lib/db-types';

const ORG = 'org-moh-ss';
const HOSP = 'hosp-001';
type New = Omit<AppointmentDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>;

const booking = (o: Partial<New>): New => ({
  patientId: 'pat-a', patientName: 'Reech Mabior', providerId: 'dr-a', providerName: 'Dr. A',
  facilityId: HOSP, facilityName: 'Juba Teaching Hospital', facilityLevel: 'payam',
  appointmentDate: '2031-03-04', appointmentTime: '08:00', duration: 15, appointmentType: 'general',
  priority: 'routine', department: 'Outpatient', reason: 'Review', status: 'scheduled',
  reminderSent: false, isRecurring: false, bookedBy: 'dr-a', bookedByName: 'Dr. A', state: '', orgId: ORG, ...o,
}) as New;

beforeEach(async () => {
  await putDoc(hospitalsDB(), { _id: HOSP, type: 'hospital', name: 'Juba Teaching Hospital', orgId: ORG } as never);
});
afterEach(async () => { await teardownTestDBs(); uuidCounter = 0; });

it('refuses a second visit while the first is still open', async () => {
  await createAppointment(booking({ status: 'in_progress' }));
  await expect(createAppointment(booking({ appointmentTime: '14:00' }))).rejects.toBeInstanceOf(BookingConflictError);
});

it('allows a second same-day visit once the first was checked out', async () => {
  await createAppointment(booking({ status: 'completed' }));
  await expect(createAppointment(booking({ appointmentTime: '14:00' }))).resolves.toBeTruthy();
});
