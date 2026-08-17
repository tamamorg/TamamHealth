/**
 * Immunization tracker.
 */
import type { BaseDoc } from './db-types';

export interface ImmunizationDoc extends BaseDoc {
  type: 'immunization';
  patientId: string;
  patientName: string;
  /** Visit/note that ordered the dose, when given from a consultation plan. */
  encounterId?: string;
  noteId?: string;
  gender: 'Male' | 'Female';
  dateOfBirth: string;
  vaccine: string; // BCG, OPV0-3, Penta1-3, PCV1-3, Rota1-2, Measles1-2, Yellow Fever, Vitamin A
  doseNumber: number;
  dateGiven: string;
  nextDueDate: string;
  facilityId: string;
  facilityName: string;
  state: string;
  administeredBy: string;
  batchNumber: string;
  site: 'left arm' | 'right arm' | 'left thigh' | 'right thigh' | 'oral';
  adverseReaction: boolean;
  adverseReactionDetails?: string;
  status: 'completed' | 'scheduled' | 'overdue' | 'missed';
  orgId?: string;
}
