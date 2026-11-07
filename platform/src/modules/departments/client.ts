export type { DepartmentDoc, DepartmentCode, ClinicalSpecialty, ClinicDay } from './core/types';
export { TAMAM_DEPARTMENT_CATALOG, CLINICAL_SPECIALTIES, departmentDefinitionFor, appointmentBelongsToDepartment, buildDepartmentReport, sortDepartmentAppointments, isClinicalSpecialty, specialtyFromLegacy, specialtyLabel } from './core/catalog';
export { HOSPITAL_DEPARTMENTS, HOSPITAL_DEPARTMENT_GROUPS, hospitalDepartmentFor, sameDepartment, departmentKey } from './core/hospital-departments';
export type { HospitalDepartment, HospitalDepartmentGroup } from './core/hospital-departments';
