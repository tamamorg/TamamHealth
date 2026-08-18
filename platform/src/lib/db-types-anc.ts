/**
 * ANC (Antenatal Care) Module.
 */
import type { BaseDoc } from './db-types';

export interface ANCVisitDoc extends BaseDoc {
  type: 'anc_visit';
  motherId: string;
  patientId?: string;
  motherName: string;
  motherAge: number;
  gravida: number;
  parity: number;
  visitNumber: number; // 1-8 (WHO recommends 8 contacts)
  visitDate: string;
  gestationalAge: number; // weeks
  facilityId: string;
  facilityName: string;
  state: string;
  bloodPressure: string;
  weight: number;
  fundalHeight: number;
  fetalHeartRate: number;
  hemoglobin: number;
  urineProtein: string;
  bloodGroup: string;
  rhFactor: string;
  hivStatus: string;
  malariaTest: string;
  syphilisTest: string;
  ironFolateGiven: boolean;
  tetanusVaccine: boolean;
  iptpDose: number;
  riskFactors: string[];
  riskLevel: 'low' | 'moderate' | 'high';
  birthPlan: { facility: string; transport: string; bloodDonor: string };
  nextVisitDate: string;
  notes: string;
  attendedBy: string;
  attendedByRole: string;
  orgId?: string;
  /** Set when the mother gives birth and the birth registration links back
   *  to this ANC visit. Lets the ANC module display "Delivered" status and
   *  lets the birth module surface the prenatal history. */
  linkedBirthId?: string;
  isDeleted?: boolean;
}
