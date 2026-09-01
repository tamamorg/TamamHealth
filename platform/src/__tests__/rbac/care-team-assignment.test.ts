import { canAssignCareTeamRole, CARE_TEAM_ASSIGNMENT_ROLES } from '@/lib/care-team-permissions';
import {
  assignNurseToPatient,
  assignProviderToPatient,
} from '@/lib/services/patient-assignment-service';

describe('care-team assignment authorization', () => {
  test('only the three front-desk station roles may assign care staff', () => {
    expect(CARE_TEAM_ASSIGNMENT_ROLES).toEqual([
      'front_desk', 'central_registration_clerk', 'clinic_clerk',
    ]);
    for (const role of CARE_TEAM_ASSIGNMENT_ROLES) expect(canAssignCareTeamRole(role)).toBe(true);
    for (const role of ['doctor', 'clinical_officer', 'clinician', 'nurse', 'midwife', 'super_admin'] as const) {
      expect(canAssignCareTeamRole(role)).toBe(false);
    }
  });

  test('the service rejects doctor and nurse assignment attempts before touching data', async () => {
    await expect(assignProviderToPatient({
      patientId: 'patient-1',
      patientName: 'Test Patient',
      provider: { id: 'doctor-2', name: 'Dr Two', role: 'doctor' },
      actor: { id: 'doctor-1', name: 'Dr One', role: 'doctor' },
    })).rejects.toThrow('Only front desk staff');

    await expect(assignNurseToPatient({
      patientId: 'patient-1',
      nurse: { id: 'nurse-2', name: 'Nurse Two' },
      actor: { id: 'nurse-1', name: 'Nurse One', role: 'nurse' },
    })).rejects.toThrow('Only front desk staff');
  });

  test('an actor-less call cannot bypass the assignment gate', async () => {
    await expect(assignNurseToPatient({
      patientId: 'patient-1',
      nurse: { id: 'nurse-2', name: 'Nurse Two' },
    })).rejects.toThrow('Only front desk staff');
  });
});
