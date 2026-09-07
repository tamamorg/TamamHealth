import type { BaseDoc } from '@/lib/db-types';

export type DepartmentCode =
  | 'radiology' | 'inpatient' | 'orthopaedic_surgery' | 'pharmacy'
  | 'haemodialysis' | 'cardiology' | 'dermatology' | 'ct_scan'
  | 'dental' | 'psychiatry' | 'internal_medicine' | 'ophthalmology'
  | 'nephrology' | 'paediatrics' | 'physiotherapy'
  | 'obstetrics_gynaecology' | 'operation_theatre';

export type ClinicalSpecialty =
  | 'radiology' | 'orthopaedic_surgery' | 'renal_medicine' | 'cardiology'
  | 'dermatology' | 'dentistry' | 'psychiatry' | 'internal_medicine'
  | 'ophthalmology' | 'optometry' | 'paediatrics' | 'obstetrics_gynaecology'
  | 'physiotherapy';

export interface ClinicDay {
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  startTime: string;
  endTime: string;
  slotMinutes: number;
}

export interface DepartmentDoc extends BaseDoc {
  type: 'department';
  code: DepartmentCode;
  name: string;
  aliases: string[];
  facilityId: string;
  facilityName: string;
  orgId: string;
  parentDepartmentCode?: DepartmentCode;
  location?: string;
  roomIds: string[];
  specialties: ClinicalSpecialty[];
  clinicDays: ClinicDay[];
  /** False disables the operational queue without deleting schedule/history. */
  queueEnabled?: boolean;
  isActive: boolean;
  reportingTargets?: {
    maxWaitMinutes?: number;
    dailyCapacity?: number;
  };
}
