/**
 * Ward Management & Bed Tracking types.
 * Supports inpatient admission, bed assignment, and discharge workflows
 * for county hospitals and above (Levels 3-5).
 */
import type { BaseDoc, FacilityLevel } from './db-types';

export type WardType = 'general_male' | 'general_female' | 'paediatric' | 'maternity' | 'surgical' | 'icu' | 'isolation' | 'emergency' | 'neonatal' | 'private';
export type BedStatus = 'available' | 'occupied' | 'reserved' | 'maintenance' | 'cleaning';
export type AdmissionStatus = 'admitted' | 'transferred' | 'discharged' | 'deceased' | 'absconded';

export interface WardDoc extends BaseDoc {
  type: 'ward';
  name: string;
  wardType: WardType;
  facilityId: string;
  facilityName: string;
  facilityLevel: FacilityLevel;
  floor?: string;
  totalBeds: number;
  occupiedBeds: number;
  availableBeds: number;
  nurseInCharge?: string;
  nurseInChargeName?: string;
  isActive: boolean;
  orgId?: string;
}

export interface BedDoc extends BaseDoc {
  type: 'bed';
  bedNumber: string;        // e.g., "W1-B01" (Ward 1, Bed 01)
  wardId: string;
  wardName: string;
  facilityId: string;
  status: BedStatus;
  currentPatientId?: string;
  currentPatientName?: string;
  currentAdmissionId?: string;
  lastCleanedAt?: string;
  notes?: string;
  orgId?: string;
}

export interface AdmissionDoc extends BaseDoc {
  type: 'admission';
  patientId: string;
  patientName: string;
  hospitalNumber?: string;
  /**
   * The outpatient encounter this admission grew out of. Links the visit
   * lineage and lets admission close the OPD encounter (status `admitted`)
   * instead of leaving it open to absorb the patient's next arrival.
   */
  encounterId?: string;
  // Admission details
  admissionDate: string;
  admittingDiagnosis: string;
  icd11Code?: string;
  severity: 'mild' | 'moderate' | 'severe' | 'critical';
  admittedBy: string;
  admittedByName: string;
  // Ward & bed
  wardId: string;
  wardName: string;
  bedId?: string;
  bedNumber?: string;
  // Facility
  facilityId: string;
  facilityName: string;
  facilityLevel: FacilityLevel;
  // Clinical
  attendingPhysician: string;
  attendingPhysicianName: string;
  nurseAssigned?: string;
  nurseAssignedName?: string;
  dietaryRequirements?: string;
  isolationRequired: boolean;
  isolationReason?: string;
  // Status tracking
  status: AdmissionStatus;
  // Discharge
  dischargeDate?: string;
  dischargeType?: 'normal' | 'against_medical_advice' | 'transfer' | 'death' | 'absconded';
  dischargeDiagnosis?: string;
  dischargeIcd11?: string;
  dischargeSummary?: string;
  dischargedBy?: string;
  dischargedByName?: string;
  followUpRequired: boolean;
  followUpDate?: string;
  followUpInstructions?: string;
  /** Clinician confirmed which inpatient medicines stop or continue at exit. */
  medicationReconciled?: boolean;
  medicationReconciledAt?: string;
  // Transfer
  transferredFrom?: string;
  transferredTo?: string;
  transferReason?: string;
  // Length of stay (calculated on discharge)
  lengthOfStay?: number;     // days
  // Administrative
  state: string;
  county?: string;
  orgId?: string;
}
