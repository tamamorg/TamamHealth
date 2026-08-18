/**
 * Five-Level Facility Hierarchy (South Sudan Health System) — descriptive
 * config for each `FacilityLevel`. The `FacilityLevel` type itself stays in
 * db-types.ts since it is a widely-shared primitive referenced from many
 * other db-types-*.ts modules.
 */
import type { FacilityLevel } from './db-types';

export interface FacilityLevelConfig {
  level: FacilityLevel;
  name: string;
  description: string;
  diagnosisCapability: 'suspected' | 'clinical' | 'definitive' | 'specialist';
  exampleFacility: string;
}

export const FACILITY_LEVELS: FacilityLevelConfig[] = [
  {
    level: 'boma',
    name: 'Boma (Village)',
    description: '40 households per Boma health worker. Most basic care, referrals up.',
    diagnosisCapability: 'suspected',
    exampleFacility: 'Community Health Post',
  },
  {
    level: 'payam',
    name: 'Payam (Sub-county)',
    description: 'Primary Health Care Units (PHCUs). Basic diagnoses and treatments.',
    diagnosisCapability: 'clinical',
    exampleFacility: 'Primary Health Care Unit',
  },
  {
    level: 'county',
    name: 'County',
    description: 'County hospitals with more advanced care, lab, and pharmacy.',
    diagnosisCapability: 'definitive',
    exampleFacility: 'County Hospital',
  },
  {
    level: 'state',
    name: 'State',
    description: 'State general hospitals with specialist services.',
    diagnosisCapability: 'specialist',
    exampleFacility: 'Wau State Hospital',
  },
  {
    level: 'national',
    name: 'National',
    description: 'Teaching hospitals with highest level of care and training.',
    diagnosisCapability: 'specialist',
    exampleFacility: 'Juba Teaching Hospital',
  },
];
