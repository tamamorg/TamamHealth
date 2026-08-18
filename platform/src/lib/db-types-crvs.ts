/**
 * Civil Registration & Vital Statistics (CRVS) — birth and death registration.
 */
import type { BaseDoc } from './db-types';

export interface BirthRegistrationDoc extends BaseDoc {
  type: 'birth';
  childFirstName: string;
  childSurname: string;
  childGender: 'Male' | 'Female';
  dateOfBirth: string;
  placeOfBirth: string;
  facilityId: string;
  facilityName: string;
  motherName: string;
  motherAge: number;
  motherNationality: string;
  fatherName: string;
  fatherNationality: string;
  birthWeight: number; // grams
  birthType: 'single' | 'twin' | 'multiple';
  deliveryType: 'normal' | 'caesarean' | 'assisted';
  attendedBy: string; // doctor/midwife/TBA/none
  registeredBy: string;
  state: string;
  county: string;
  certificateNumber: string;
  childPatientId?: string;
  motherPatientId?: string;
  /** ANC mother record id linked to this birth (if the mother had prenatal
   *  visits in the ANC module). Birth registration writes this back to all
   *  matching ANC visits via linkedBirthId. */
  linkedAncMotherId?: string;
  isDeleted?: boolean;
  orgId?: string;
}

export interface DeathRegistrationDoc extends BaseDoc {
  type: 'death';
  /** The visit during which the death occurred, when registered from one. */
  encounterId?: string;
  deceasedFirstName: string;
  deceasedSurname: string;
  deceasedGender: 'Male' | 'Female';
  dateOfBirth: string;
  dateOfDeath: string;
  ageAtDeath: number;
  placeOfDeath: string;
  facilityId: string;
  facilityName: string;
  // ICD-11 Cause of Death (WHO Medical Certificate format)
  immediateCause: string;         // Line a: immediate cause
  immediateICD11: string;         // ICD-11 code
  antecedentCause1: string;       // Line b: due to
  antecedentICD11_1: string;
  antecedentCause2: string;       // Line c: due to
  antecedentICD11_2: string;
  underlyingCause: string;        // Line d: underlying cause
  underlyingICD11: string;
  contributingConditions: string;
  contributingICD11: string;
  mannerOfDeath: 'natural' | 'accident' | 'intentional_self_harm' | 'assault' | 'pending_investigation' | 'unknown';
  maternalDeath: boolean;
  pregnancyRelated: boolean;
  certifiedBy: string;
  certifierRole: string;
  state: string;
  county: string;
  certificateNumber: string;
  deathNotified: boolean;
  deathRegistered: boolean;
  patientId?: string;
  isDeleted?: boolean;
  orgId?: string;
}
