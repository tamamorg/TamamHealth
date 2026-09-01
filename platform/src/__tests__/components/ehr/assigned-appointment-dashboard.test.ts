import { filterRoleOwnedAppointments } from '@/components/ehr/EhrClinicalDashboard';
import { makeAppointment } from '../doctor/fixtures';

describe('assigned appointments on the clinical dashboard', () => {
  test('keeps a nurse-owned appointment whose providerName is the assigned doctor', () => {
    const appointment = makeAppointment({
      _id: 'appointment-with-care-team',
      providerId: 'doctor-1',
      providerName: 'Dr. Deng',
      staffId: 'nurse-1',
      staffName: 'Nurse Stella',
      facilityName: 'Juba Teaching Hospital',
    });

    expect(filterRoleOwnedAppointments([appointment])).toEqual([appointment]);
    expect(filterRoleOwnedAppointments([appointment], 'Juba Teaching Hospital')).toEqual([appointment]);
    expect(filterRoleOwnedAppointments([appointment], 'Wau State Hospital')).toEqual([]);
  });
});
