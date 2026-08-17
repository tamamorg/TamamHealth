/**
 * Emergency Preparedness.
 */
import type { BaseDoc } from './db-types';

export type EmergencyType = 'disease_outbreak' | 'flood' | 'conflict' | 'famine' | 'cholera_outbreak' | 'measles_outbreak' | 'ebola' | 'mass_casualty' | 'infrastructure_failure';
export type EmergencyPhase = 'preparedness' | 'alert' | 'response' | 'recovery' | 'closed';
export type EmergencySeverity = 'level_1' | 'level_2' | 'level_3'; // WHO scale: 1=watch, 2=mobilize, 3=full activation

export interface EmergencyPlanDoc extends BaseDoc {
  type: 'emergency_plan';
  planName: string;
  emergencyType: EmergencyType;
  phase: EmergencyPhase;
  severity: EmergencySeverity;
  description: string;
  facilityId: string;
  facilityName: string;
  // Activation
  activatedAt?: string;
  activatedBy?: string;
  deactivatedAt?: string;
  // Resource readiness
  resources: {
    surgeBeds: number;
    availableSurgeBeds: number;
    emergencyKits: number;
    oralRehydrationSachets: number;
    choleraCots: number;
    ppe: number; // sets
    emergencyMedications: string[];
  };
  // Communication chain
  incidentCommander: string;
  incidentCommanderPhone: string;
  contactChain: { name: string; role: string; phone: string; order: number }[];
  // Capacity
  estimatedCapacity: number; // patients per day
  currentLoad: number;
  // Geographic scope
  state: string;
  county?: string;
  affectedAreas?: string[];
  // Tracking
  totalCasesManaged: number;
  totalDeaths: number;
  totalReferralsOut: number;
  orgId?: string;
}
