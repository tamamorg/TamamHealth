import {
  canAssignCareTeamRole,
  canAssignStaffAtFacility,
  CARE_TEAM_ASSIGNMENT_ROLES,
} from '@/lib/care-team-permissions';
import {
  assignNurseToPatient,
  assignProviderToPatient,
} from '@/lib/services/patient-assignment-service';
import { getUserById } from '@/modules/identity/services/user-service';

jest.mock('@/modules/identity/services/user-service', () => ({ getUserById: jest.fn() }));

const mockGetUserById = getUserById as jest.MockedFunction<typeof getUserById>;

beforeEach(() => jest.clearAllMocks());

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

  test('staff assignment is restricted to the front desk facility and fails closed without one', () => {
    expect(canAssignStaffAtFacility('facility-a', 'facility-a')).toBe(true);
    expect(canAssignStaffAtFacility('facility-a', 'facility-b')).toBe(false);
    expect(canAssignStaffAtFacility(undefined, 'facility-a')).toBe(false);
    expect(canAssignStaffAtFacility('facility-a', undefined)).toBe(false);
  });

  test('the service rejects a cross-facility provider before changing the patient', async () => {
    mockGetUserById.mockImplementation(async id => ({
      _id: id,
      type: 'user',
      username: id,
      passwordHash: 'test-hash',
      name: id,
      role: id === 'desk-1' ? 'front_desk' : 'doctor',
      hospitalId: id === 'desk-1' ? 'facility-a' : 'facility-b',
      orgId: 'org-a',
      isActive: true,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    }));

    await expect(assignProviderToPatient({
      patientId: 'patient-1',
      patientName: 'Test Patient',
      provider: { id: 'doctor-2', name: 'Dr Two', role: 'doctor' },
      actor: { id: 'desk-1', name: 'Desk One', role: 'front_desk' },
      hospitalId: 'facility-a',
      orgId: 'org-a',
    })).rejects.toThrow('not assignable at this facility');
  });

  test('the service verifies the actor record instead of trusting a claimed front-desk role', async () => {
    mockGetUserById.mockResolvedValue({
      _id: 'doctor-1', type: 'user', username: 'doctor-1', name: 'Dr One', role: 'doctor',
      passwordHash: 'test-hash',
      hospitalId: 'facility-a', orgId: 'org-a', isActive: true,
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    });

    await expect(assignNurseToPatient({
      patientId: 'patient-1',
      nurse: { id: 'nurse-2', name: 'Nurse Two' },
      actor: { id: 'doctor-1', name: 'Dr One', role: 'front_desk' },
      hospitalId: 'facility-a',
      orgId: 'org-a',
    })).rejects.toThrow('actor is not authorized');
  });

  test('the service rejects staff from another organization even at a matching facility', async () => {
    mockGetUserById.mockImplementation(async id => ({
      _id: id,
      type: 'user',
      username: id,
      passwordHash: 'test-hash',
      name: id,
      role: id === 'desk-1' ? 'front_desk' : 'nurse',
      hospitalId: 'facility-a',
      orgId: id === 'desk-1' ? 'org-a' : 'org-b',
      isActive: true,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    }));

    await expect(assignNurseToPatient({
      patientId: 'patient-1',
      nurse: { id: 'nurse-2', name: 'Nurse Two' },
      actor: { id: 'desk-1', name: 'Desk One', role: 'front_desk' },
      hospitalId: 'facility-a',
      orgId: 'org-a',
    })).rejects.toThrow('not assignable at this facility');
  });
});
