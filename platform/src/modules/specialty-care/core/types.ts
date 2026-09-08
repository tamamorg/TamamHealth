import type { BaseDoc } from '@/lib/db-types';

export type SpecialtyPathwayCode =
  | 'haemodialysis'
  | 'dental'
  | 'theatre'
  | 'cardiac_diagnostics'
  | 'ophthalmology_optical'
  | 'mental_health'
  | 'dermatology'
  | 'physiotherapy'
  | 'paediatrics'
  | 'obstetrics_gynaecology';

export type SpecialtyEpisodeStatus =
  | 'planned'
  | 'in_progress'
  | 'awaiting_review'
  | 'completed'
  | 'cancelled';

export type SpecialtyFieldValue = string | number | boolean | string[];

export interface SpecialtyEpisodeEvent {
  at: string;
  actorId?: string;
  actorName?: string;
  action: 'created' | 'updated' | 'status_changed';
  fromStatus?: SpecialtyEpisodeStatus;
  toStatus?: SpecialtyEpisodeStatus;
  note?: string;
}

/**
 * One ordered/performed unit of specialty care. The domain catalogue defines
 * the structured fields for each pathway. Free-text psychotherapy/psychiatry
 * notes are deliberately forbidden here because this database replicates to
 * ordinary clinical devices; those belong in the restricted-notes store.
 */
export interface SpecialtyCareEpisodeDoc extends BaseDoc {
  type: 'specialty_care_episode';
  pathway: SpecialtyPathwayCode;
  status: SpecialtyEpisodeStatus;
  patientId: string;
  patientName: string;
  hospitalId: string;
  facilityName?: string;
  orgId: string;
  departmentId?: string;
  appointmentId?: string;
  encounterId?: string;
  serviceRequestId?: string;
  responsibleClinicianId?: string;
  responsibleClinicianName?: string;
  scheduledAt?: string;
  startedAt?: string;
  completedAt?: string;
  cancellationReason?: string;
  values: Record<string, SpecialtyFieldValue>;
  events: SpecialtyEpisodeEvent[];
}

export interface SpecialtyPathwayConfigDoc extends BaseDoc {
  type: 'specialty_pathway_config';
  pathway: SpecialtyPathwayCode;
  hospitalId: string;
  facilityName?: string;
  orgId: string;
  status: 'draft' | 'pilot' | 'active' | 'paused';
  version: number;
  clinicalOwnerId?: string;
  clinicalOwnerName?: string;
  sopReference?: string;
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: string;
  reviewDueAt?: string;
  notes?: string;
}

export type SpecialtyFieldKind = 'text' | 'long_text' | 'number' | 'date' | 'datetime' | 'boolean' | 'select' | 'multi_select';

export interface SpecialtyFieldDefinition {
  key: string;
  label: string;
  kind: SpecialtyFieldKind;
  section: string;
  requiredToComplete?: boolean;
  unit?: string;
  min?: number;
  max?: number;
  options?: readonly { value: string; label: string }[];
  help?: string;
  /** Optional quick-entry terms; free narrative remains supported. */
  suggestions?: readonly string[];
  step?: number | 'any';
  allowNotApplicable?: boolean;
  exclusiveOptions?: readonly string[];
  referenceSource?: 'staff' | 'assets';
}

export interface SpecialtyPathwayDefinition {
  code: SpecialtyPathwayCode;
  name: string;
  summary: string;
  departmentCodes: readonly string[];
  evidenceLabel: string;
  evidenceUrl: string;
  safetyNote: string;
  fields: readonly SpecialtyFieldDefinition[];
}

export interface SpecialtyValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
