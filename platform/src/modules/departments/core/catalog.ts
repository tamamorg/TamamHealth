import type { ClinicalSpecialty, DepartmentCode } from './types';

export interface DepartmentDefinition {
  code: DepartmentCode;
  name: string;
  aliases: readonly string[];
  specialties: readonly ClinicalSpecialty[];
  parentDepartmentCode?: DepartmentCode;
}

/** Tamam's reusable specialty-service vocabulary. CT remains a radiology service line. */
export const TAMAM_DEPARTMENT_CATALOG: readonly DepartmentDefinition[] = [
  { code: 'radiology', name: 'Radiology', aliases: ['Imaging'], specialties: ['radiology'] },
  { code: 'inpatient', name: 'In-patient Services', aliases: ['Inpatient', 'IPD', 'Wards'], specialties: [] },
  { code: 'orthopaedic_surgery', name: 'Orthopaedic Surgery', aliases: ['Orthopedics', 'Orthopaedics'], specialties: ['orthopaedic_surgery'] },
  { code: 'pharmacy', name: 'Pharmacy', aliases: ['Dispensary'], specialties: [] },
  { code: 'haemodialysis', name: 'Haemodialysis', aliases: ['Hemodialysis', 'Dialysis', 'Renal Unit'], specialties: ['renal_medicine'] },
  { code: 'cardiology', name: 'Cardiology', aliases: ['Cardiac Clinic'], specialties: ['cardiology'] },
  { code: 'dermatology', name: 'Dermatology', aliases: ['Skin Clinic'], specialties: ['dermatology'] },
  { code: 'ct_scan', name: 'CT Scan', aliases: ['Computed Tomography', 'CT'], specialties: ['radiology'], parentDepartmentCode: 'radiology' },
  { code: 'dental', name: 'Dental', aliases: ['Dental Clinic', 'Dentistry'], specialties: ['dentistry'] },
  { code: 'psychiatry', name: 'Psychiatry', aliases: ['Mental Health'], specialties: ['psychiatry'] },
  { code: 'internal_medicine', name: 'Specialist Internal Medicine', aliases: ['Internal Medicine', 'General Medicine'], specialties: ['internal_medicine'] },
  { code: 'ophthalmology', name: 'Ophthalmology', aliases: ['Eye Clinic', 'Opthalmology'], specialties: ['ophthalmology', 'optometry'] },
  { code: 'nephrology', name: 'Nephrology', aliases: ['Renal Medicine', 'Kidney Clinic'], specialties: ['renal_medicine'] },
  { code: 'paediatrics', name: 'Paediatrics', aliases: ['Pediatrics', 'Child Health'], specialties: ['paediatrics'] },
  { code: 'physiotherapy', name: 'Physiotherapy', aliases: ['Physical Therapy', 'Rehabilitation'], specialties: ['physiotherapy'] },
  { code: 'obstetrics_gynaecology', name: 'Obstetrics & Gynaecology', aliases: ['Obstetrics and Gynaecology', 'OB/GYN', 'OBGYN'], specialties: ['obstetrics_gynaecology'] },
  { code: 'operation_theatre', name: 'Operation Theatre', aliases: ['Advanced Operation Theatre', 'Operating Room', 'Theatre'], specialties: ['orthopaedic_surgery', 'obstetrics_gynaecology'] },
] as const;

export const CLINICAL_SPECIALTIES: readonly { value: ClinicalSpecialty; label: string; aliases: readonly string[] }[] = [
  { value: 'internal_medicine', label: 'Internal medicine', aliases: ['internist', 'physician', 'specialist internal medicine'] },
  { value: 'cardiology', label: 'Cardiology', aliases: ['cardiologist'] },
  { value: 'renal_medicine', label: 'Renal medicine', aliases: ['nephrology', 'nephrologist', 'renal physician'] },
  { value: 'dermatology', label: 'Dermatology', aliases: ['dermatologist'] },
  { value: 'ophthalmology', label: 'Ophthalmology', aliases: ['ophthalmologist', 'eye surgeon'] },
  { value: 'optometry', label: 'Optometry', aliases: ['optometrist', 'optician'] },
  { value: 'orthopaedic_surgery', label: 'Orthopaedic surgery', aliases: ['orthopedic surgery', 'orthopaedics', 'orthopedics', 'orthopaedic surgeon', 'orthopedic surgeon'] },
  { value: 'dentistry', label: 'Dentistry', aliases: ['dental', 'dentist', 'dental surgeon'] },
  { value: 'psychiatry', label: 'Psychiatry', aliases: ['psychiatrist'] },
  { value: 'radiology', label: 'Radiology', aliases: ['radiologist'] },
  { value: 'paediatrics', label: 'Paediatrics', aliases: ['pediatrics', 'paediatrician', 'pediatrician'] },
  { value: 'obstetrics_gynaecology', label: 'Obstetrics & gynaecology', aliases: ['obstetrics and gynaecology', 'obstetrics and gynecology', 'ob/gyn', 'obgyn'] },
  { value: 'physiotherapy', label: 'Physiotherapy', aliases: ['physiotherapist', 'physical therapy', 'rehabilitation'] },
] as const;

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function isClinicalSpecialty(value: unknown): value is ClinicalSpecialty {
  return typeof value === 'string' && CLINICAL_SPECIALTIES.some((item) => item.value === value);
}

export function specialtyFromLegacy(value?: string | null): ClinicalSpecialty | undefined {
  if (!value) return undefined;
  const needle = normalized(value);
  return CLINICAL_SPECIALTIES.find((item) =>
    normalized(item.value) === needle || normalized(item.label) === needle
      || item.aliases.some((alias) => normalized(alias) === needle))?.value;
}

export function specialtyLabel(value?: string | null): string | undefined {
  return CLINICAL_SPECIALTIES.find((item) => item.value === value)?.label;
}

export function departmentDefinitionFor(value: string | undefined): DepartmentDefinition | undefined {
  if (!value) return undefined;
  const needle = normalized(value);
  return TAMAM_DEPARTMENT_CATALOG.find((item) =>
    normalized(item.code) === needle || normalized(item.name) === needle || item.aliases.some((alias) => normalized(alias) === needle));
}

export function appointmentBelongsToDepartment(
  appointment: { department: string; departmentId?: string },
  department: { _id: string; code: DepartmentCode; name: string; aliases: string[] },
): boolean {
  if (appointment.departmentId) return appointment.departmentId === department._id;
  const appointmentDefinition = departmentDefinitionFor(appointment.department);
  return appointmentDefinition?.code === department.code
    || [department.name, department.code, ...department.aliases].some((value) => normalized(value) === normalized(appointment.department));
}

export interface DepartmentReport {
  total: number;
  waiting: number;
  inProgress: number;
  completed: number;
  urgent: number;
  noShows: number;
  averageWaitMinutes?: number;
}

export function sortDepartmentAppointments<T extends { priority: string; appointmentDate: string; appointmentTime: string; checkedInAt?: string }>(appointments: T[]): T[] {
  const priority = (value: string) => value === 'emergency' ? 0 : value === 'urgent' ? 1 : 2;
  return [...appointments].sort((a, b) => priority(a.priority) - priority(b.priority)
    || (a.checkedInAt || `${a.appointmentDate}T${a.appointmentTime}`).localeCompare(
      b.checkedInAt || `${b.appointmentDate}T${b.appointmentTime}`,
    ));
}

export function buildDepartmentReport(appointments: Array<{ status: string; priority: string; checkedInAt?: string; startedAt?: string }>): DepartmentReport {
  const waitingStatuses = new Set(['requested', 'scheduled', 'reminder_sent', 'confirmed', 'arrived', 'checked_in', 'triaged']);
  const waits = appointments.flatMap((appointment) => {
    if (!appointment.checkedInAt || !appointment.startedAt) return [];
    const minutes = (Date.parse(appointment.startedAt) - Date.parse(appointment.checkedInAt)) / 60_000;
    return Number.isFinite(minutes) && minutes >= 0 ? [minutes] : [];
  });
  return {
    total: appointments.length,
    waiting: appointments.filter((a) => waitingStatuses.has(a.status)).length,
    inProgress: appointments.filter((a) => a.status === 'in_progress').length,
    completed: appointments.filter((a) => a.status === 'completed').length,
    urgent: appointments.filter((a) => a.priority === 'urgent' || a.priority === 'emergency').length,
    noShows: appointments.filter((a) => a.status === 'no_show').length,
    averageWaitMinutes: waits.length
      ? Math.round((waits.reduce((sum, value) => sum + value, 0) / waits.length) * 10) / 10
      : undefined,
  };
}
