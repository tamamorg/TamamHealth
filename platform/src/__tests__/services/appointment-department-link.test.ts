jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { appointmentsDB, hospitalsDB } from '@/lib/db';
import type { AppointmentDoc } from '@/lib/db-types';
import type { DepartmentDoc } from '@/modules/departments';
import { updateAppointment } from '@/lib/services/appointment-service';
import { teardownTestDBs } from '../helpers/test-db';

const baseAppointment: AppointmentDoc = {
  _id: 'apt-department-link', type: 'appointment', patientId: 'patient-1', patientName: 'Patient One',
  providerId: 'doctor-1', providerName: 'Doctor One', facilityId: 'facility-1', facilityName: 'Hospital One',
  facilityLevel: 'county', appointmentDate: '2026-09-08', appointmentTime: '09:00', duration: 30,
  appointmentType: 'specialist', priority: 'routine', department: 'Cardiology',
  departmentId: 'department:facility-1:cardiology', reason: 'Review', status: 'confirmed',
  reminderSent: false, isRecurring: false, bookedBy: 'clerk-1', bookedByName: 'Clerk One',
  state: 'Central Equatoria', orgId: 'org-1', createdAt: '2026-09-07T08:00:00Z', updatedAt: '2026-09-07T08:00:00Z',
};

afterEach(async () => { await teardownTestDBs(); });

describe('appointment department links', () => {
  it('replaces the stable link when the display department changes', async () => {
    const dental: DepartmentDoc = {
      _id: 'department:facility-1:dental', type: 'department', code: 'dental', name: 'Dental', aliases: ['Dentistry'],
      facilityId: 'facility-1', facilityName: 'Hospital One', orgId: 'org-1', roomIds: [], specialties: ['dentistry'],
      clinicDays: [], queueEnabled: true, isActive: true, createdAt: '2026-09-07T08:00:00Z', updatedAt: '2026-09-07T08:00:00Z',
    };
    await hospitalsDB().put(dental);
    await appointmentsDB().put(baseAppointment);
    expect((await updateAppointment(baseAppointment._id, { department: 'Dentistry' }))?.departmentId).toBe(dental._id);
  });

  it('clears a stale link when the renamed department is not configured', async () => {
    await appointmentsDB().put(baseAppointment);
    expect((await updateAppointment(baseAppointment._id, { department: 'Unconfigured clinic' }))?.departmentId).toBeUndefined();
  });
});
