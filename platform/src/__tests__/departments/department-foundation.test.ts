import { TAMAM_DEPARTMENT_CATALOG, CLINICAL_SPECIALTIES, appointmentBelongsToDepartment, buildDepartmentReport, departmentDefinitionFor, isClinicalSpecialty, sortDepartmentAppointments, specialtyFromLegacy, specialtyLabel } from '@/modules/departments';
import type { DepartmentDoc } from '@/modules/departments';
import type { AppointmentDoc } from '@/lib/db-types';

const department: DepartmentDoc = {
  _id: 'department:hosp-1:orthopaedic_surgery', type: 'department', code: 'orthopaedic_surgery',
  name: 'Orthopaedic Surgery', aliases: ['Orthopedics'], facilityId: 'hosp-1', facilityName: 'Hospital',
  orgId: 'org-1', roomIds: [], specialties: ['orthopaedic_surgery'], clinicDays: [], isActive: true,
  queueEnabled: true,
  createdAt: '2026-09-07T00:00:00Z', updatedAt: '2026-09-07T00:00:00Z',
};

function appointment(patch: Partial<AppointmentDoc>): AppointmentDoc {
  return {
    _id: 'appt-1', type: 'appointment', patientId: 'patient-1', patientName: 'Patient One',
    providerId: 'doctor-1', providerName: 'Doctor One', facilityId: 'hosp-1', facilityName: 'Hospital',
    facilityLevel: 'state', appointmentDate: '2026-09-07', appointmentTime: '09:00', duration: 30,
    appointmentType: 'specialist', priority: 'routine', department: 'Orthopedics', reason: 'Review',
    status: 'scheduled', reminderSent: false, isRecurring: false, bookedBy: 'desk-1', bookedByName: 'Desk',
    state: 'Central Equatoria', orgId: 'org-1', createdAt: '2026-09-07T00:00:00Z', updatedAt: '2026-09-07T00:00:00Z',
    ...patch,
  };
}

describe('department foundation', () => {
  it('represents Tamam specialty services and nests CT under radiology', () => {
    expect(TAMAM_DEPARTMENT_CATALOG).toHaveLength(17);
    expect(TAMAM_DEPARTMENT_CATALOG.map((item) => item.code)).toEqual(expect.arrayContaining([
      'paediatrics', 'physiotherapy', 'obstetrics_gynaecology', 'operation_theatre',
    ]));
    expect(departmentDefinitionFor('CT Scan')?.parentDepartmentCode).toBe('radiology');
  });

  it('keeps legacy free-text appointment aliases connected to stable departments', () => {
    expect(appointmentBelongsToDepartment(appointment({}), department)).toBe(true);
    expect(appointmentBelongsToDepartment(appointment({ departmentId: department._id, department: 'Legacy value' }), department)).toBe(true);
  });

  it('derives operational metrics from the appointment source of truth', () => {
    expect(buildDepartmentReport([
      appointment({ status: 'checked_in', priority: 'urgent' }),
      appointment({ _id: 'appt-2', status: 'completed' }),
      appointment({ _id: 'appt-3', status: 'no_show' }),
    ])).toEqual({ total: 3, waiting: 1, inProgress: 0, completed: 1, urgent: 1, noShows: 1, averageWaitMinutes: undefined });
  });

  it('normalizes controlled clinician specialties without guessing unknown values', () => {
    expect(new Set(CLINICAL_SPECIALTIES.map(item => item.value)).size).toBe(CLINICAL_SPECIALTIES.length);
    expect(specialtyFromLegacy(' Cardiologist ')).toBe('cardiology');
    expect(specialtyFromLegacy('Orthopedic Surgeon')).toBe('orthopaedic_surgery');
    expect(specialtyFromLegacy('unverified specialty')).toBeUndefined();
    expect(isClinicalSpecialty('renal_medicine')).toBe(true);
    expect(specialtyLabel('renal_medicine')).toBe('Renal medicine');
    expect(specialtyFromLegacy('OB/GYN')).toBe('obstetrics_gynaecology');
    expect(specialtyFromLegacy('Physical Therapy')).toBe('physiotherapy');
  });

  it('orders the worklist by clinical priority and arrival time and calculates wait', () => {
    const rows = sortDepartmentAppointments([
      appointment({ _id: 'routine', priority: 'routine', appointmentTime: '08:00' }),
      appointment({ _id: 'urgent-late', priority: 'urgent', appointmentTime: '10:00' }),
      appointment({ _id: 'urgent-early', priority: 'urgent', appointmentTime: '09:00' }),
      appointment({ _id: 'emergency', priority: 'emergency', appointmentTime: '11:00' }),
    ]);
    expect(rows.map(row => row._id)).toEqual(['emergency', 'urgent-early', 'urgent-late', 'routine']);
    expect(buildDepartmentReport([
      appointment({ checkedInAt: '2026-09-07T08:00:00Z', startedAt: '2026-09-07T08:20:00Z' }),
      appointment({ _id: 'appt-2', checkedInAt: '2026-09-07T09:00:00Z', startedAt: '2026-09-07T09:10:00Z' }),
    ]).averageWaitMinutes).toBe(15);
  });
});
