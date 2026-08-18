/**
 * Health Facility Assessment (service readiness / infrastructure scoring).
 */
import type { BaseDoc } from './db-types';

export interface FacilityAssessmentDoc extends BaseDoc {
  type: 'facility_assessment';
  facilityId: string;
  facilityName: string;
  assessmentDate: string;
  assessedBy: string;
  // Service readiness
  generalEquipmentScore: number;     // 0-100
  diagnosticCapacityScore: number;
  essentialMedicinesScore: number;
  infectionControlScore: number;
  // Infrastructure
  hasCleanWater: boolean;
  hasSanitation: boolean;
  hasWasteManagement: boolean;
  hasEmergencyTransport: boolean;
  hasCommunication: boolean;
  powerReliabilityScore: number;     // 0-100
  // Staffing adequacy
  staffingScore: number;             // 0-100
  hisStaffCount: number;
  hisStaffTrained: number;
  // Data management
  hasPatientRegisters: boolean;
  hasDHIS2Reporting: boolean;
  reportingCompleteness: number;     // 0-100
  reportingTimeliness: number;       // 0-100
  dataQualityScore: number;          // 0-100
  // Summary
  overallScore: number;              // 0-100
  state: string;
  recommendations: string;
  orgId?: string;
}
