/**
 * Follow-Up Tracking.
 */
import type { BaseDoc, FacilityLevel } from './db-types';

export interface FollowUpDoc extends BaseDoc {
  type: 'follow_up';
  patientId: string;
  patientName: string;
  /** The visit that asked for this follow-up. */
  encounterId?: string;
  /** Facility that owns the follow-up — without it filterByScope can only narrow to org. */
  hospitalId?: string;
  geocodeId?: string;
  assignedWorker: string;        // Health worker responsible
  assignedWorkerName: string;
  status: 'active' | 'completed' | 'missed' | 'lost_to_followup';
  outcome?: 'recovered' | 'died' | 'referred' | 'under_treatment';
  condition: string;
  facilityLevel: FacilityLevel;
  scheduledDate: string;
  completedDate?: string;
  notes?: string;
  state: string;
  county: string;
  sourceVisitId?: string;
  orgId?: string;
}
