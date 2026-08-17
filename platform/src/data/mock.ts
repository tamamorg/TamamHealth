// ============================================
// TamamHealth — clinical base types, South Sudan reference data, and the
// deterministic DEMO ROSTER generator. Despite the filename this module is
// load-bearing, not throwaway: the *Doc types in db-types.ts extend the
// interfaces defined here, and db-seed.ts + the patient-portal demo fallback
// both build the same seeded roster from it. Import types/reference lists
// via `@/lib/clinical-types` (the honestly-named path); only seeding code
// should import the generated rosters directly from here.
// ============================================

// Deterministic PRNG (mulberry32) behind every "random" draw in this module.
// The generated roster MUST be identical in every process that builds it: the
// browser seeds it into PouchDB (db-seed.ts) while the patient-portal API's
// demo fallback (lib/patient-portal-demo.ts) re-imports this module server-side
// and matches patients by hospital number + phone. With Math.random the two
// sides generated different identities and portal login could never match a
// generated patient. Fixed seed → same names/phones/DOBs everywhere. Bump
// SEED_VERSION in lib/db.ts if the seed constant or draw order ever changes,
// so existing browser profiles reseed to the matching roster.
let _randState = 0x5eed2026;
function rand(): number {
  _randState = (_randState + 0x6D2B79F5) | 0;
  let t = Math.imul(_randState ^ (_randState >>> 15), 1 | _randState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// Patient-chart clinical list types now live in lib/types; re-exported here so
// existing `from '@/data/mock'` imports keep working.
import type {
  AllergyEntry, DirectiveEntry, CareAlertEntry, ScreeningEntry,
} from '@/lib/types/patient-clinical';
export type {
  AllergyEntry, DirectiveType, DirectiveEntry,
  CareAlertCategory, CareAlertEntry, ScreeningEntry,
} from '@/lib/types/patient-clinical';

// The roster generator draws from these; the re-export further down is a
// separate statement and creates no local binding.
import { states, statesAndCounties, bloodTypes } from '@/lib/data/south-sudan-reference';

export interface Hospital {
  id: string;
  name: string;
  type: 'national_referral' | 'state_hospital' | 'county_hospital' | 'phcc' | 'phcu';
  state: string;
  town: string;
  totalBeds: number;
  icuBeds: number;
  maternityBeds: number;
  pediatricBeds: number;
  doctors: number;
  clinicalOfficers: number;
  nurses: number;
  labTechnicians: number;
  pharmacists: number;
  hasElectricity: boolean;
  electricityHours: number;
  hasGenerator: boolean;
  hasSolar: boolean;
  hasInternet: boolean;
  internetType: string;
  hasAmbulance: boolean;
  emergency24hr: boolean;
  services: string[];
  lat: number;
  lng: number;
  syncStatus: 'online' | 'offline' | 'syncing';
  lastSync: string;
  patientCount: number;
  todayVisits: number;
  ownership?: 'public' | 'ngo' | 'private' | 'faith_based';
  operationalStatus?: 'functional' | 'partially_functional' | 'non_functional' | 'closed';
  /**
   * Facility-level review gate for reporting to the Ministry of Health.
   * Facility data is reviewed and explicitly submitted from "My Facility"
   * rather than flowing to the Ministry automatically. Absent = not yet
   * submitted (draft).
   */
  mohSubmission?: {
    submittedAt: string;
    submittedBy: string;
    submittedByName?: string;
  };
  county?: string;
  serviceFlags?: {
    epi: boolean;
    anc: boolean;
    delivery: boolean;
    hiv: boolean;
    tb: boolean;
    emergencySurgery: boolean;
    laboratory: boolean;
    pharmacy: boolean;
  };
  performance?: {
    reportingCompleteness: number;
    serviceReadinessScore: number;
    tracerMedicineAvailability: number;
    staffingScore: number;
    opdVisitsPerMonth: number;
    ancCoverage: number;
    immunizationCoverage: number;
    stockOutDays: number;
    qualityScore: number;
  };
  monthlyTrends?: {
    month: string;
    opdVisits: number;
    reportingTimeliness: number;
    ancVisits: number;
    immunizations: number;
  }[];
}

// Helper to generate 6 months of trend data for a facility
function generateTrends(baseOpd: number, baseReporting: number, baseAnc: number, baseImm: number): Hospital['monthlyTrends'] {
  const months = ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02'];
  return months.map((month, i) => ({
    month,
    opdVisits: Math.round(baseOpd * (0.85 + Math.sin(i * 0.8) * 0.15 + i * 0.02)),
    reportingTimeliness: Math.min(100, Math.round(baseReporting + (i - 2) * 2 + (rand() * 6 - 3))),
    ancVisits: Math.round(baseAnc * (0.9 + i * 0.03 + (rand() * 0.1 - 0.05))),
    immunizations: Math.round(baseImm * (0.88 + i * 0.025 + (rand() * 0.1 - 0.05))),
  }));
}

export const hospitals: Hospital[] = [
  // ═══════════════════════════════════════════════════
  //  1 NATIONAL REFERRAL
  // ═══════════════════════════════════════════════════
  {
    id: 'hosp-001',
    name: 'Juba Teaching Hospital',
    type: 'national_referral',
    state: 'Central Equatoria',
    town: 'Juba',
    totalBeds: 600,
    icuBeds: 12,
    maternityBeds: 80,
    pediatricBeds: 100,
    doctors: 45,
    clinicalOfficers: 120,
    nurses: 800,
    labTechnicians: 35,
    pharmacists: 18,
    hasElectricity: true,
    electricityHours: 18,
    hasGenerator: true,
    hasSolar: true,
    hasInternet: true,
    internetType: 'Satellite + 4G',
    hasAmbulance: true,
    emergency24hr: true,
    services: ['Surgery', 'Maternity', 'Pediatrics', 'Laboratory', 'X-ray', 'Ultrasound', 'Pharmacy', 'Emergency', 'ICU', 'Cardiology', 'Orthopedics'],
    lat: 4.8517,
    lng: 31.5825,
    syncStatus: 'online',
    lastSync: '2026-02-09T14:30:00Z',
    patientCount: 34521,
    todayVisits: 187,
    ownership: 'public',
    operationalStatus: 'functional',
    county: 'Juba',
    serviceFlags: { epi: true, anc: true, delivery: true, hiv: true, tb: true, emergencySurgery: true, laboratory: true, pharmacy: true },
    performance: { reportingCompleteness: 92, serviceReadinessScore: 88, tracerMedicineAvailability: 78, staffingScore: 85, opdVisitsPerMonth: 5620, ancCoverage: 82, immunizationCoverage: 79, stockOutDays: 2, qualityScore: 84 },
    monthlyTrends: generateTrends(5620, 92, 420, 380),
  },
  // ═══════════════════════════════════════════════════
  //  9 STATE HOSPITALS (one per state)
  // ═══════════════════════════════════════════════════
  {
    id: 'hosp-002',
    name: 'Wau State Hospital',
    type: 'state_hospital',
    state: 'Western Bahr el Ghazal',
    town: 'Wau',
    totalBeds: 200,
    icuBeds: 4,
    maternityBeds: 30,
    pediatricBeds: 40,
    doctors: 12,
    clinicalOfficers: 35,
    nurses: 180,
    labTechnicians: 8,
    pharmacists: 4,
    hasElectricity: true,
    electricityHours: 10,
    hasGenerator: true,
    hasSolar: false,
    hasInternet: true,
    internetType: '4G Mobile',
    hasAmbulance: true,
    emergency24hr: true,
    services: ['Surgery', 'Maternity', 'Pediatrics', 'Laboratory', 'X-ray', 'Pharmacy', 'Emergency'],
    lat: 7.7027,
    lng: 28.0025,
    syncStatus: 'online',
    lastSync: '2026-02-09T12:15:00Z',
    patientCount: 12340,
    todayVisits: 73,
    ownership: 'public',
    operationalStatus: 'functional',
    county: 'Wau',
    serviceFlags: { epi: true, anc: true, delivery: true, hiv: true, tb: true, emergencySurgery: true, laboratory: true, pharmacy: true },
    performance: { reportingCompleteness: 78, serviceReadinessScore: 72, tracerMedicineAvailability: 65, staffingScore: 68, opdVisitsPerMonth: 2180, ancCoverage: 71, immunizationCoverage: 68, stockOutDays: 5, qualityScore: 70 },
    monthlyTrends: generateTrends(2180, 78, 190, 165),
  },
  {
    id: 'hosp-003',
    name: 'Malakal Teaching Hospital',
    type: 'state_hospital',
    state: 'Upper Nile',
    town: 'Malakal',
    totalBeds: 180,
    icuBeds: 3,
    maternityBeds: 25,
    pediatricBeds: 35,
    doctors: 8,
    clinicalOfficers: 28,
    nurses: 150,
    labTechnicians: 6,
    pharmacists: 3,
    hasElectricity: true,
    electricityHours: 8,
    hasGenerator: true,
    hasSolar: false,
    hasInternet: true,
    internetType: '3G Mobile',
    hasAmbulance: false,
    emergency24hr: true,
    services: ['Surgery', 'Maternity', 'Pediatrics', 'Laboratory', 'Pharmacy', 'Emergency'],
    lat: 9.5334,
    lng: 31.6605,
    syncStatus: 'syncing',
    lastSync: '2026-02-09T08:30:00Z',
    patientCount: 9870,
    todayVisits: 54,
    ownership: 'public',
    operationalStatus: 'functional',
    county: 'Malakal',
    serviceFlags: { epi: true, anc: true, delivery: true, hiv: true, tb: true, emergencySurgery: false, laboratory: true, pharmacy: true },
    performance: { reportingCompleteness: 65, serviceReadinessScore: 58, tracerMedicineAvailability: 52, staffingScore: 55, opdVisitsPerMonth: 1620, ancCoverage: 54, immunizationCoverage: 51, stockOutDays: 9, qualityScore: 56 },
    monthlyTrends: generateTrends(1620, 65, 140, 130),
  },
  {
    id: 'hosp-004',
    name: 'Bentiu State Hospital',
    type: 'state_hospital',
    state: 'Unity',
    town: 'Bentiu',
    totalBeds: 150,
    icuBeds: 2,
    maternityBeds: 20,
    pediatricBeds: 30,
    doctors: 6,
    clinicalOfficers: 22,
    nurses: 120,
    labTechnicians: 5,
    pharmacists: 2,
    hasElectricity: true,
    electricityHours: 6,
    hasGenerator: true,
    hasSolar: false,
    hasInternet: false,
    internetType: 'None',
    hasAmbulance: false,
    emergency24hr: true,
    services: ['Maternity', 'Pediatrics', 'Laboratory', 'Pharmacy', 'Emergency'],
    lat: 9.2333,
    lng: 29.8333,
    syncStatus: 'offline',
    lastSync: '2026-02-07T16:00:00Z',
    patientCount: 7654,
    todayVisits: 38,
    ownership: 'public',
    operationalStatus: 'partially_functional',
    county: 'Rubkona',
    serviceFlags: { epi: true, anc: true, delivery: true, hiv: true, tb: false, emergencySurgery: false, laboratory: true, pharmacy: true },
    performance: { reportingCompleteness: 48, serviceReadinessScore: 45, tracerMedicineAvailability: 38, staffingScore: 42, opdVisitsPerMonth: 1140, ancCoverage: 40, immunizationCoverage: 37, stockOutDays: 14, qualityScore: 43 },
    monthlyTrends: generateTrends(1140, 48, 95, 85),
  },
  {
    id: 'hosp-005',
    name: 'Rumbek State Hospital',
    type: 'state_hospital',
    state: 'Lakes',
    town: 'Rumbek',
    totalBeds: 140,
    icuBeds: 2,
    maternityBeds: 20,
    pediatricBeds: 25,
    doctors: 5,
    clinicalOfficers: 20,
    nurses: 110,
    labTechnicians: 4,
    pharmacists: 2,
    hasElectricity: true,
    electricityHours: 6,
    hasGenerator: true,
    hasSolar: true,
    hasInternet: true,
    internetType: '3G Mobile',
    hasAmbulance: false,
    emergency24hr: false,
    services: ['Maternity', 'Pediatrics', 'Laboratory', 'Pharmacy'],
    lat: 6.8000,
    lng: 29.6833,
    syncStatus: 'online',
    lastSync: '2026-02-09T10:00:00Z',
    patientCount: 6890,
    todayVisits: 31,
    ownership: 'public',
    operationalStatus: 'functional',
    county: 'Rumbek Centre',
    serviceFlags: { epi: true, anc: true, delivery: true, hiv: true, tb: true, emergencySurgery: false, laboratory: true, pharmacy: true },
    performance: { reportingCompleteness: 72, serviceReadinessScore: 63, tracerMedicineAvailability: 58, staffingScore: 60, opdVisitsPerMonth: 1420, ancCoverage: 62, immunizationCoverage: 59, stockOutDays: 7, qualityScore: 62 },
    monthlyTrends: generateTrends(1420, 72, 160, 145),
  },
  {
    id: 'hosp-006',
    name: 'Bor State Hospital',
    type: 'state_hospital',
    state: 'Jonglei',
    town: 'Bor',
    totalBeds: 130,
    icuBeds: 1,
    maternityBeds: 18,
    pediatricBeds: 22,
    doctors: 4,
    clinicalOfficers: 18,
    nurses: 95,
    labTechnicians: 4,
    pharmacists: 2,
    hasElectricity: true,
    electricityHours: 5,
    hasGenerator: true,
    hasSolar: false,
    hasInternet: false,
    internetType: 'None',
    hasAmbulance: false,
    emergency24hr: false,
    services: ['Maternity', 'Pediatrics', 'Laboratory', 'Pharmacy'],
    lat: 6.2088,
    lng: 31.5592,
    syncStatus: 'offline',
    lastSync: '2026-02-06T09:00:00Z',
    patientCount: 5430,
    todayVisits: 27,
    ownership: 'public',
    operationalStatus: 'partially_functional',
    county: 'Bor South',
    serviceFlags: { epi: true, anc: true, delivery: true, hiv: false, tb: false, emergencySurgery: false, laboratory: true, pharmacy: true },
    performance: { reportingCompleteness: 52, serviceReadinessScore: 48, tracerMedicineAvailability: 42, staffingScore: 45, opdVisitsPerMonth: 810, ancCoverage: 47, immunizationCoverage: 44, stockOutDays: 12, qualityScore: 48 },
    monthlyTrends: generateTrends(810, 52, 80, 72),
  },
  {
    id: 'hosp-007',
    name: 'Torit State Hospital',
    type: 'state_hospital',
    state: 'Eastern Equatoria',
    town: 'Torit',
    totalBeds: 120,
    icuBeds: 1,
    maternityBeds: 15,
    pediatricBeds: 20,
    doctors: 4,
    clinicalOfficers: 16,
    nurses: 85,
    labTechnicians: 3,
    pharmacists: 2,
    hasElectricity: true,
    electricityHours: 7,
    hasGenerator: true,
    hasSolar: true,
    hasInternet: true,
    internetType: '3G Mobile',
    hasAmbulance: true,
    emergency24hr: true,
    services: ['Maternity', 'Pediatrics', 'Laboratory', 'Pharmacy', 'Emergency'],
    lat: 4.4090,
    lng: 32.5736,
    syncStatus: 'online',
    lastSync: '2026-02-09T11:45:00Z',
    patientCount: 4980,
    todayVisits: 24,
    ownership: 'public',
    operationalStatus: 'functional',
    county: 'Torit',
    serviceFlags: { epi: true, anc: true, delivery: true, hiv: true, tb: true, emergencySurgery: false, laboratory: true, pharmacy: true },
    performance: { reportingCompleteness: 75, serviceReadinessScore: 68, tracerMedicineAvailability: 62, staffingScore: 64, opdVisitsPerMonth: 1280, ancCoverage: 66, immunizationCoverage: 63, stockOutDays: 6, qualityScore: 66 },
    monthlyTrends: generateTrends(1280, 75, 150, 140),
  },
  {
    id: 'hosp-008',
    name: 'Yambio State Hospital',
    type: 'state_hospital',
    state: 'Western Equatoria',
    town: 'Yambio',
    totalBeds: 110,
    icuBeds: 1,
    maternityBeds: 15,
    pediatricBeds: 18,
    doctors: 5,
    clinicalOfficers: 15,
    nurses: 80,
    labTechnicians: 4,
    pharmacists: 2,
    hasElectricity: true,
    electricityHours: 8,
    hasGenerator: true,
    hasSolar: true,
    hasInternet: true,
    internetType: '4G Mobile',
    hasAmbulance: false,
    emergency24hr: true,
    services: ['Surgery', 'Maternity', 'Pediatrics', 'Laboratory', 'Pharmacy', 'Emergency'],
    lat: 4.5696,
    lng: 28.3944,
    syncStatus: 'online',
    lastSync: '2026-02-09T13:00:00Z',
    patientCount: 5210,
    todayVisits: 29,
    ownership: 'public',
    operationalStatus: 'functional',
    county: 'Yambio',
    serviceFlags: { epi: true, anc: true, delivery: true, hiv: true, tb: true, emergencySurgery: true, laboratory: true, pharmacy: true },
    performance: { reportingCompleteness: 82, serviceReadinessScore: 76, tracerMedicineAvailability: 70, staffingScore: 72, opdVisitsPerMonth: 1560, ancCoverage: 74, immunizationCoverage: 71, stockOutDays: 4, qualityScore: 74 },
    monthlyTrends: generateTrends(1560, 82, 170, 155),
  },
  {
    id: 'hosp-009',
    name: 'Aweil State Hospital',
    type: 'state_hospital',
    state: 'Northern Bahr el Ghazal',
    town: 'Aweil',
    totalBeds: 100,
    icuBeds: 1,
    maternityBeds: 12,
    pediatricBeds: 18,
    doctors: 3,
    clinicalOfficers: 14,
    nurses: 70,
    labTechnicians: 3,
    pharmacists: 1,
    hasElectricity: true,
    electricityHours: 5,
    hasGenerator: true,
    hasSolar: false,
    hasInternet: false,
    internetType: 'None',
    hasAmbulance: false,
    emergency24hr: false,
    services: ['Maternity', 'Pediatrics', 'Laboratory', 'Pharmacy'],
    lat: 8.7670,
    lng: 27.3923,
    syncStatus: 'offline',
    lastSync: '2026-02-05T14:00:00Z',
    patientCount: 4320,
    todayVisits: 19,
    ownership: 'public',
    operationalStatus: 'partially_functional',
    county: 'Aweil Centre',
    serviceFlags: { epi: true, anc: true, delivery: true, hiv: false, tb: false, emergencySurgery: false, laboratory: true, pharmacy: true },
    performance: { reportingCompleteness: 45, serviceReadinessScore: 42, tracerMedicineAvailability: 35, staffingScore: 38, opdVisitsPerMonth: 870, ancCoverage: 38, immunizationCoverage: 35, stockOutDays: 15, qualityScore: 40 },
    monthlyTrends: generateTrends(870, 45, 70, 62),
  },
  {
    id: 'hosp-010',
    name: 'Kuajok State Hospital',
    type: 'state_hospital',
    state: 'Warrap',
    town: 'Kuajok',
    totalBeds: 90,
    icuBeds: 0,
    maternityBeds: 10,
    pediatricBeds: 15,
    doctors: 3,
    clinicalOfficers: 12,
    nurses: 60,
    labTechnicians: 2,
    pharmacists: 1,
    hasElectricity: true,
    electricityHours: 4,
    hasGenerator: true,
    hasSolar: false,
    hasInternet: false,
    internetType: 'None',
    hasAmbulance: false,
    emergency24hr: false,
    services: ['Maternity', 'Pediatrics', 'Pharmacy'],
    lat: 8.3090,
    lng: 28.0822,
    syncStatus: 'offline',
    lastSync: '2026-02-04T10:00:00Z',
    patientCount: 3210,
    todayVisits: 15,
    ownership: 'public',
    operationalStatus: 'partially_functional',
    county: 'Kuajok',
    serviceFlags: { epi: true, anc: true, delivery: true, hiv: false, tb: false, emergencySurgery: false, laboratory: false, pharmacy: true },
    performance: { reportingCompleteness: 40, serviceReadinessScore: 38, tracerMedicineAvailability: 30, staffingScore: 35, opdVisitsPerMonth: 650, ancCoverage: 34, immunizationCoverage: 31, stockOutDays: 18, qualityScore: 36 },
    monthlyTrends: generateTrends(650, 40, 55, 48),
  },
  // ═══════════════════════════════════════════════════
  //  10 COUNTY HOSPITALS
  // ═══════════════════════════════════════════════════
  {
    id: 'county-001',
    name: 'Yei County Hospital',
    type: 'county_hospital',
    state: 'Central Equatoria',
    town: 'Yei',
    totalBeds: 60,
    icuBeds: 0,
    maternityBeds: 10,
    pediatricBeds: 10,
    doctors: 2,
    clinicalOfficers: 8,
    nurses: 35,
    labTechnicians: 2,
    pharmacists: 1,
    hasElectricity: true,
    electricityHours: 8,
    hasGenerator: true,
    hasSolar: true,
    hasInternet: true,
    internetType: '3G Mobile',
    hasAmbulance: false,
    emergency24hr: false,
    services: ['Maternity', 'Pediatrics', 'Laboratory', 'Pharmacy', 'Outpatient'],
    lat: 4.0960,
    lng: 30.6790,
    syncStatus: 'online',
    lastSync: '2026-02-09T09:00:00Z',
    patientCount: 2840,
    todayVisits: 32,
    ownership: 'public',
    operationalStatus: 'functional',
    county: 'Yei',
    serviceFlags: { epi: true, anc: true, delivery: true, hiv: true, tb: false, emergencySurgery: false, laboratory: true, pharmacy: true },
    performance: { reportingCompleteness: 68, serviceReadinessScore: 55, tracerMedicineAvailability: 52, staffingScore: 50, opdVisitsPerMonth: 960, ancCoverage: 58, immunizationCoverage: 55, stockOutDays: 8, qualityScore: 56 },
    monthlyTrends: generateTrends(960, 68, 110, 95),
  },
  {
    id: 'county-002',
    name: 'Renk County Hospital',
    type: 'county_hospital',
    state: 'Upper Nile',
    town: 'Renk',
    totalBeds: 45,
    icuBeds: 0,
    maternityBeds: 8,
    pediatricBeds: 8,
    doctors: 1,
    clinicalOfficers: 5,
    nurses: 25,
    labTechnicians: 1,
    pharmacists: 1,
    hasElectricity: true,
    electricityHours: 6,
    hasGenerator: true,
    hasSolar: false,
    hasInternet: true,
    internetType: '3G Mobile',
    hasAmbulance: false,
    emergency24hr: false,
    services: ['Maternity', 'Pediatrics', 'Laboratory', 'Pharmacy'],
    lat: 11.7500,
    lng: 32.7800,
    syncStatus: 'syncing',
    lastSync: '2026-02-08T14:00:00Z',
    patientCount: 1920,
    todayVisits: 18,
    ownership: 'public',
    operationalStatus: 'functional',
    county: 'Renk',
    serviceFlags: { epi: true, anc: true, delivery: true, hiv: false, tb: false, emergencySurgery: false, laboratory: true, pharmacy: true },
    performance: { reportingCompleteness: 60, serviceReadinessScore: 48, tracerMedicineAvailability: 45, staffingScore: 42, opdVisitsPerMonth: 540, ancCoverage: 50, immunizationCoverage: 46, stockOutDays: 10, qualityScore: 48 },
    monthlyTrends: generateTrends(540, 60, 65, 58),
  },
  {
    id: 'county-003',
    name: 'Kapoeta County Hospital',
    type: 'county_hospital',
    state: 'Eastern Equatoria',
    town: 'Kapoeta',
    totalBeds: 40,
    icuBeds: 0,
    maternityBeds: 6,
    pediatricBeds: 6,
    doctors: 1,
    clinicalOfficers: 4,
    nurses: 20,
    labTechnicians: 1,
    pharmacists: 1,
    hasElectricity: true,
    electricityHours: 5,
    hasGenerator: true,
    hasSolar: true,
    hasInternet: false,
    internetType: 'None',
    hasAmbulance: false,
    emergency24hr: false,
    services: ['Maternity', 'Pediatrics', 'Laboratory', 'Pharmacy'],
    lat: 4.7715,
    lng: 33.5893,
    syncStatus: 'offline',
    lastSync: '2026-02-07T10:00:00Z',
    patientCount: 1450,
    todayVisits: 14,
    ownership: 'ngo',
    operationalStatus: 'functional',
    county: 'Kapoeta East',
    serviceFlags: { epi: true, anc: true, delivery: true, hiv: false, tb: false, emergencySurgery: false, laboratory: true, pharmacy: true },
    performance: { reportingCompleteness: 55, serviceReadinessScore: 50, tracerMedicineAvailability: 48, staffingScore: 45, opdVisitsPerMonth: 420, ancCoverage: 45, immunizationCoverage: 42, stockOutDays: 11, qualityScore: 47 },
    monthlyTrends: generateTrends(420, 55, 52, 46),
  },
  {
    id: 'county-004',
    name: 'Gogrial County Hospital',
    type: 'county_hospital',
    state: 'Warrap',
    town: 'Gogrial',
    totalBeds: 35,
    icuBeds: 0,
    maternityBeds: 6,
    pediatricBeds: 5,
    doctors: 0,
    clinicalOfficers: 4,
    nurses: 18,
    labTechnicians: 1,
    pharmacists: 0,
    hasElectricity: true,
    electricityHours: 4,
    hasGenerator: true,
    hasSolar: false,
    hasInternet: false,
    internetType: 'None',
    hasAmbulance: false,
    emergency24hr: false,
    services: ['Maternity', 'Pediatrics', 'Pharmacy'],
    lat: 8.5300,
    lng: 28.1200,
    syncStatus: 'offline',
    lastSync: '2026-02-05T08:00:00Z',
    patientCount: 1180,
    todayVisits: 11,
    ownership: 'public',
    operationalStatus: 'partially_functional',
    county: 'Gogrial West',
    serviceFlags: { epi: true, anc: true, delivery: true, hiv: false, tb: false, emergencySurgery: false, laboratory: false, pharmacy: true },
    performance: { reportingCompleteness: 38, serviceReadinessScore: 35, tracerMedicineAvailability: 28, staffingScore: 30, opdVisitsPerMonth: 330, ancCoverage: 32, immunizationCoverage: 28, stockOutDays: 18, qualityScore: 33 },
    monthlyTrends: generateTrends(330, 38, 38, 32),
  },
  {
    id: 'county-005',
    name: 'Maridi County Hospital',
    type: 'county_hospital',
    state: 'Western Equatoria',
    town: 'Maridi',
    totalBeds: 50,
    icuBeds: 0,
    maternityBeds: 8,
    pediatricBeds: 8,
    doctors: 1,
    clinicalOfficers: 5,
    nurses: 28,
    labTechnicians: 2,
    pharmacists: 1,
    hasElectricity: true,
    electricityHours: 7,
    hasGenerator: true,
    hasSolar: true,
    hasInternet: true,
    internetType: '3G Mobile',
    hasAmbulance: false,
    emergency24hr: false,
    services: ['Maternity', 'Pediatrics', 'Laboratory', 'Pharmacy', 'Outpatient'],
    lat: 4.9167,
    lng: 29.4700,
    syncStatus: 'online',
    lastSync: '2026-02-09T10:30:00Z',
    patientCount: 2150,
    todayVisits: 22,
    ownership: 'faith_based',
    operationalStatus: 'functional',
    county: 'Maridi',
    serviceFlags: { epi: true, anc: true, delivery: true, hiv: true, tb: true, emergencySurgery: false, laboratory: true, pharmacy: true },
    performance: { reportingCompleteness: 70, serviceReadinessScore: 62, tracerMedicineAvailability: 58, staffingScore: 55, opdVisitsPerMonth: 660, ancCoverage: 65, immunizationCoverage: 62, stockOutDays: 6, qualityScore: 63 },
    monthlyTrends: generateTrends(660, 70, 85, 78),
  },
  {
    id: 'county-006',
    name: 'Leer County Hospital',
    type: 'county_hospital',
    state: 'Unity',
    town: 'Leer',
    totalBeds: 30,
    icuBeds: 0,
    maternityBeds: 5,
    pediatricBeds: 5,
    doctors: 0,
    clinicalOfficers: 3,
    nurses: 15,
    labTechnicians: 1,
    pharmacists: 0,
    hasElectricity: false,
    electricityHours: 0,
    hasGenerator: true,
    hasSolar: true,
    hasInternet: false,
    internetType: 'None',
    hasAmbulance: false,
    emergency24hr: false,
    services: ['Maternity', 'Outpatient'],
    lat: 8.3000,
    lng: 30.1500,
    syncStatus: 'offline',
    lastSync: '2026-01-28T06:00:00Z',
    patientCount: 980,
    todayVisits: 8,
    ownership: 'ngo',
    operationalStatus: 'partially_functional',
    county: 'Leer',
    serviceFlags: { epi: false, anc: true, delivery: true, hiv: false, tb: false, emergencySurgery: false, laboratory: false, pharmacy: false },
    performance: { reportingCompleteness: 28, serviceReadinessScore: 25, tracerMedicineAvailability: 18, staffingScore: 22, opdVisitsPerMonth: 240, ancCoverage: 24, immunizationCoverage: 18, stockOutDays: 22, qualityScore: 24 },
    monthlyTrends: generateTrends(240, 28, 28, 20),
  },
  {
    id: 'county-007',
    name: 'Cueibet County Hospital',
    type: 'county_hospital',
    state: 'Lakes',
    town: 'Cueibet',
    totalBeds: 35,
    icuBeds: 0,
    maternityBeds: 5,
    pediatricBeds: 5,
    doctors: 0,
    clinicalOfficers: 4,
    nurses: 18,
    labTechnicians: 1,
    pharmacists: 1,
    hasElectricity: true,
    electricityHours: 4,
    hasGenerator: true,
    hasSolar: false,
    hasInternet: false,
    internetType: 'None',
    hasAmbulance: false,
    emergency24hr: false,
    services: ['Maternity', 'Pediatrics', 'Pharmacy'],
    lat: 7.0600,
    lng: 29.3300,
    syncStatus: 'offline',
    lastSync: '2026-02-06T12:00:00Z',
    patientCount: 1320,
    todayVisits: 12,
    ownership: 'public',
    operationalStatus: 'functional',
    county: 'Cueibet',
    serviceFlags: { epi: true, anc: true, delivery: true, hiv: false, tb: false, emergencySurgery: false, laboratory: false, pharmacy: true },
    performance: { reportingCompleteness: 50, serviceReadinessScore: 42, tracerMedicineAvailability: 38, staffingScore: 36, opdVisitsPerMonth: 360, ancCoverage: 42, immunizationCoverage: 38, stockOutDays: 13, qualityScore: 40 },
    monthlyTrends: generateTrends(360, 50, 48, 42),
  },
  {
    id: 'county-008',
    name: 'Pibor County Hospital',
    type: 'county_hospital',
    state: 'Jonglei',
    town: 'Pibor',
    totalBeds: 25,
    icuBeds: 0,
    maternityBeds: 4,
    pediatricBeds: 4,
    doctors: 0,
    clinicalOfficers: 3,
    nurses: 12,
    labTechnicians: 0,
    pharmacists: 0,
    hasElectricity: false,
    electricityHours: 0,
    hasGenerator: true,
    hasSolar: true,
    hasInternet: false,
    internetType: 'None',
    hasAmbulance: false,
    emergency24hr: false,
    services: ['Maternity', 'Outpatient'],
    lat: 6.8000,
    lng: 33.1300,
    syncStatus: 'offline',
    lastSync: '2026-01-25T08:00:00Z',
    patientCount: 760,
    todayVisits: 6,
    ownership: 'ngo',
    operationalStatus: 'partially_functional',
    county: 'Pibor',
    serviceFlags: { epi: false, anc: true, delivery: true, hiv: false, tb: false, emergencySurgery: false, laboratory: false, pharmacy: false },
    performance: { reportingCompleteness: 22, serviceReadinessScore: 20, tracerMedicineAvailability: 15, staffingScore: 18, opdVisitsPerMonth: 180, ancCoverage: 20, immunizationCoverage: 15, stockOutDays: 24, qualityScore: 19 },
    monthlyTrends: generateTrends(180, 22, 22, 16),
  },
  {
    id: 'county-009',
    name: 'Aweil East County Hospital',
    type: 'county_hospital',
    state: 'Northern Bahr el Ghazal',
    town: 'Wanyjok',
    totalBeds: 40,
    icuBeds: 0,
    maternityBeds: 6,
    pediatricBeds: 6,
    doctors: 1,
    clinicalOfficers: 4,
    nurses: 22,
    labTechnicians: 1,
    pharmacists: 1,
    hasElectricity: true,
    electricityHours: 5,
    hasGenerator: true,
    hasSolar: false,
    hasInternet: false,
    internetType: 'None',
    hasAmbulance: false,
    emergency24hr: false,
    services: ['Maternity', 'Pediatrics', 'Laboratory', 'Pharmacy'],
    lat: 8.7200,
    lng: 27.9800,
    syncStatus: 'offline',
    lastSync: '2026-02-06T15:00:00Z',
    patientCount: 1680,
    todayVisits: 16,
    ownership: 'public',
    operationalStatus: 'functional',
    county: 'Aweil East',
    serviceFlags: { epi: true, anc: true, delivery: true, hiv: false, tb: false, emergencySurgery: false, laboratory: true, pharmacy: true },
    performance: { reportingCompleteness: 52, serviceReadinessScore: 45, tracerMedicineAvailability: 40, staffingScore: 38, opdVisitsPerMonth: 480, ancCoverage: 44, immunizationCoverage: 40, stockOutDays: 12, qualityScore: 43 },
    monthlyTrends: generateTrends(480, 52, 56, 48),
  },
  {
    id: 'county-010',
    name: 'Magwi County Hospital',
    type: 'county_hospital',
    state: 'Eastern Equatoria',
    town: 'Magwi',
    totalBeds: 45,
    icuBeds: 0,
    maternityBeds: 7,
    pediatricBeds: 7,
    doctors: 1,
    clinicalOfficers: 5,
    nurses: 24,
    labTechnicians: 1,
    pharmacists: 1,
    hasElectricity: true,
    electricityHours: 6,
    hasGenerator: true,
    hasSolar: true,
    hasInternet: true,
    internetType: '3G Mobile',
    hasAmbulance: false,
    emergency24hr: false,
    services: ['Maternity', 'Pediatrics', 'Laboratory', 'Pharmacy', 'Outpatient'],
    lat: 3.9500,
    lng: 32.2900,
    syncStatus: 'syncing',
    lastSync: '2026-02-08T11:00:00Z',
    patientCount: 1890,
    todayVisits: 19,
    ownership: 'faith_based',
    operationalStatus: 'functional',
    county: 'Magwi',
    serviceFlags: { epi: true, anc: true, delivery: true, hiv: true, tb: false, emergencySurgery: false, laboratory: true, pharmacy: true },
    performance: { reportingCompleteness: 65, serviceReadinessScore: 58, tracerMedicineAvailability: 55, staffingScore: 52, opdVisitsPerMonth: 570, ancCoverage: 60, immunizationCoverage: 56, stockOutDays: 7, qualityScore: 58 },
    monthlyTrends: generateTrends(570, 65, 72, 65),
  },
  // ═══════════════════════════════════════════════════
  //  12 PHCCs
  // ═══════════════════════════════════════════════════
  {
    id: 'phcc-001',
    name: 'Kajo-keji PHCC',
    type: 'phcc',
    state: 'Central Equatoria',
    town: 'Kajo-keji',
    totalBeds: 12,
    icuBeds: 0,
    maternityBeds: 4,
    pediatricBeds: 2,
    doctors: 0,
    clinicalOfficers: 2,
    nurses: 8,
    labTechnicians: 1,
    pharmacists: 0,
    hasElectricity: true,
    electricityHours: 6,
    hasGenerator: false,
    hasSolar: true,
    hasInternet: false,
    internetType: 'None',
    hasAmbulance: false,
    emergency24hr: false,
    services: ['Outpatient', 'ANC', 'EPI', 'Basic Lab'],
    lat: 3.5747,
    lng: 31.6612,
    syncStatus: 'offline',
    lastSync: '2026-02-10T08:00:00Z',
    patientCount: 890,
    todayVisits: 22,
    ownership: 'ngo',
    operationalStatus: 'functional',
    county: 'Kajo-keji',
    serviceFlags: { epi: true, anc: true, delivery: false, hiv: false, tb: false, emergencySurgery: false, laboratory: true, pharmacy: false },
    performance: { reportingCompleteness: 55, serviceReadinessScore: 42, tracerMedicineAvailability: 38, staffingScore: 40, opdVisitsPerMonth: 660, ancCoverage: 52, immunizationCoverage: 48, stockOutDays: 10, qualityScore: 44 },
    monthlyTrends: generateTrends(660, 55, 62, 55),
  },
  {
    id: 'phcc-002',
    name: 'Yei PHCC',
    type: 'phcc',
    state: 'Central Equatoria',
    town: 'Yei',
    totalBeds: 15,
    icuBeds: 0,
    maternityBeds: 5,
    pediatricBeds: 3,
    doctors: 0,
    clinicalOfficers: 3,
    nurses: 10,
    labTechnicians: 1,
    pharmacists: 1,
    hasElectricity: true,
    electricityHours: 8,
    hasGenerator: true,
    hasSolar: false,
    hasInternet: true,
    internetType: '3G Modem',
    hasAmbulance: false,
    emergency24hr: false,
    services: ['Outpatient', 'ANC', 'EPI', 'Basic Lab', 'Pharmacy'],
    lat: 4.0952,
    lng: 30.6784,
    syncStatus: 'syncing',
    lastSync: '2026-02-12T10:00:00Z',
    patientCount: 1240,
    todayVisits: 31,
    ownership: 'public',
    operationalStatus: 'functional',
    county: 'Yei',
    serviceFlags: { epi: true, anc: true, delivery: true, hiv: false, tb: false, emergencySurgery: false, laboratory: true, pharmacy: true },
    performance: { reportingCompleteness: 62, serviceReadinessScore: 48, tracerMedicineAvailability: 45, staffingScore: 44, opdVisitsPerMonth: 930, ancCoverage: 56, immunizationCoverage: 52, stockOutDays: 8, qualityScore: 50 },
    monthlyTrends: generateTrends(930, 62, 78, 68),
  },
  {
    id: 'phcc-003',
    name: 'Bor PHCC',
    type: 'phcc',
    state: 'Jonglei',
    town: 'Bor South',
    totalBeds: 10,
    icuBeds: 0,
    maternityBeds: 3,
    pediatricBeds: 2,
    doctors: 0,
    clinicalOfficers: 2,
    nurses: 6,
    labTechnicians: 1,
    pharmacists: 0,
    hasElectricity: true,
    electricityHours: 4,
    hasGenerator: false,
    hasSolar: true,
    hasInternet: false,
    internetType: 'None',
    hasAmbulance: false,
    emergency24hr: false,
    services: ['Outpatient', 'ANC', 'EPI'],
    lat: 6.1900,
    lng: 31.5400,
    syncStatus: 'offline',
    lastSync: '2026-02-06T07:00:00Z',
    patientCount: 710,
    todayVisits: 14,
    ownership: 'public',
    operationalStatus: 'partially_functional',
    county: 'Bor South',
    serviceFlags: { epi: true, anc: true, delivery: false, hiv: false, tb: false, emergencySurgery: false, laboratory: false, pharmacy: false },
    performance: { reportingCompleteness: 35, serviceReadinessScore: 28, tracerMedicineAvailability: 22, staffingScore: 25, opdVisitsPerMonth: 420, ancCoverage: 30, immunizationCoverage: 26, stockOutDays: 16, qualityScore: 28 },
    monthlyTrends: generateTrends(420, 35, 38, 32),
  },
  {
    id: 'phcc-004',
    name: 'Rubkona PHCC',
    type: 'phcc',
    state: 'Unity',
    town: 'Rubkona',
    totalBeds: 8,
    icuBeds: 0,
    maternityBeds: 3,
    pediatricBeds: 2,
    doctors: 0,
    clinicalOfficers: 2,
    nurses: 7,
    labTechnicians: 0,
    pharmacists: 0,
    hasElectricity: false,
    electricityHours: 0,
    hasGenerator: false,
    hasSolar: true,
    hasInternet: false,
    internetType: 'None',
    hasAmbulance: false,
    emergency24hr: false,
    services: ['Outpatient', 'ANC', 'EPI'],
    lat: 9.2400,
    lng: 29.7800,
    syncStatus: 'offline',
    lastSync: '2026-02-03T06:00:00Z',
    patientCount: 620,
    todayVisits: 12,
    ownership: 'ngo',
    operationalStatus: 'partially_functional',
    county: 'Rubkona',
    serviceFlags: { epi: true, anc: true, delivery: false, hiv: false, tb: false, emergencySurgery: false, laboratory: false, pharmacy: false },
    performance: { reportingCompleteness: 30, serviceReadinessScore: 25, tracerMedicineAvailability: 18, staffingScore: 22, opdVisitsPerMonth: 360, ancCoverage: 28, immunizationCoverage: 22, stockOutDays: 20, qualityScore: 25 },
    monthlyTrends: generateTrends(360, 30, 32, 26),
  },
  {
    id: 'phcc-005',
    name: 'Tonj PHCC',
    type: 'phcc',
    state: 'Warrap',
    town: 'Tonj',
    totalBeds: 10,
    icuBeds: 0,
    maternityBeds: 3,
    pediatricBeds: 2,
    doctors: 0,
    clinicalOfficers: 2,
    nurses: 6,
    labTechnicians: 1,
    pharmacists: 0,
    hasElectricity: true,
    electricityHours: 4,
    hasGenerator: false,
    hasSolar: true,
    hasInternet: false,
    internetType: 'None',
    hasAmbulance: false,
    emergency24hr: false,
    services: ['Outpatient', 'ANC', 'EPI', 'Basic Lab'],
    lat: 7.2700,
    lng: 28.6800,
    syncStatus: 'offline',
    lastSync: '2026-02-05T09:00:00Z',
    patientCount: 540,
    todayVisits: 10,
    ownership: 'public',
    operationalStatus: 'functional',
    county: 'Tonj North',
    serviceFlags: { epi: true, anc: true, delivery: false, hiv: false, tb: false, emergencySurgery: false, laboratory: true, pharmacy: false },
    performance: { reportingCompleteness: 42, serviceReadinessScore: 35, tracerMedicineAvailability: 30, staffingScore: 32, opdVisitsPerMonth: 300, ancCoverage: 38, immunizationCoverage: 34, stockOutDays: 14, qualityScore: 35 },
    monthlyTrends: generateTrends(300, 42, 35, 30),
  },
  {
    id: 'phcc-006',
    name: 'Nzara PHCC',
    type: 'phcc',
    state: 'Western Equatoria',
    town: 'Nzara',
    totalBeds: 14,
    icuBeds: 0,
    maternityBeds: 4,
    pediatricBeds: 3,
    doctors: 0,
    clinicalOfficers: 3,
    nurses: 9,
    labTechnicians: 1,
    pharmacists: 1,
    hasElectricity: true,
    electricityHours: 7,
    hasGenerator: true,
    hasSolar: true,
    hasInternet: true,
    internetType: '3G Mobile',
    hasAmbulance: false,
    emergency24hr: false,
    services: ['Outpatient', 'ANC', 'EPI', 'Basic Lab', 'Pharmacy'],
    lat: 4.6500,
    lng: 28.5300,
    syncStatus: 'online',
    lastSync: '2026-02-09T12:00:00Z',
    patientCount: 1100,
    todayVisits: 25,
    ownership: 'faith_based',
    operationalStatus: 'functional',
    county: 'Nzara',
    serviceFlags: { epi: true, anc: true, delivery: true, hiv: true, tb: false, emergencySurgery: false, laboratory: true, pharmacy: true },
    performance: { reportingCompleteness: 65, serviceReadinessScore: 55, tracerMedicineAvailability: 52, staffingScore: 50, opdVisitsPerMonth: 750, ancCoverage: 60, immunizationCoverage: 58, stockOutDays: 6, qualityScore: 56 },
    monthlyTrends: generateTrends(750, 65, 72, 68),
  },
  {
    id: 'phcc-007',
    name: 'Fashoda PHCC',
    type: 'phcc',
    state: 'Upper Nile',
    town: 'Kodok',
    totalBeds: 8,
    icuBeds: 0,
    maternityBeds: 2,
    pediatricBeds: 2,
    doctors: 0,
    clinicalOfficers: 1,
    nurses: 5,
    labTechnicians: 0,
    pharmacists: 0,
    hasElectricity: false,
    electricityHours: 0,
    hasGenerator: false,
    hasSolar: true,
    hasInternet: false,
    internetType: 'None',
    hasAmbulance: false,
    emergency24hr: false,
    services: ['Outpatient', 'ANC', 'EPI'],
    lat: 9.8900,
    lng: 32.1200,
    syncStatus: 'offline',
    lastSync: '2026-01-30T07:00:00Z',
    patientCount: 420,
    todayVisits: 8,
    ownership: 'public',
    operationalStatus: 'partially_functional',
    county: 'Fashoda',
    serviceFlags: { epi: true, anc: true, delivery: false, hiv: false, tb: false, emergencySurgery: false, laboratory: false, pharmacy: false },
    performance: { reportingCompleteness: 25, serviceReadinessScore: 20, tracerMedicineAvailability: 15, staffingScore: 18, opdVisitsPerMonth: 240, ancCoverage: 22, immunizationCoverage: 18, stockOutDays: 22, qualityScore: 20 },
    monthlyTrends: generateTrends(240, 25, 25, 20),
  },
  {
    id: 'phcc-008',
    name: 'Rumbek East PHCC',
    type: 'phcc',
    state: 'Lakes',
    town: 'Yirol',
    totalBeds: 10,
    icuBeds: 0,
    maternityBeds: 3,
    pediatricBeds: 2,
    doctors: 0,
    clinicalOfficers: 2,
    nurses: 6,
    labTechnicians: 0,
    pharmacists: 0,
    hasElectricity: true,
    electricityHours: 3,
    hasGenerator: false,
    hasSolar: true,
    hasInternet: false,
    internetType: 'None',
    hasAmbulance: false,
    emergency24hr: false,
    services: ['Outpatient', 'ANC', 'EPI'],
    lat: 6.5600,
    lng: 30.0500,
    syncStatus: 'offline',
    lastSync: '2026-02-04T08:00:00Z',
    patientCount: 580,
    todayVisits: 11,
    ownership: 'public',
    operationalStatus: 'functional',
    county: 'Rumbek East',
    serviceFlags: { epi: true, anc: true, delivery: false, hiv: false, tb: false, emergencySurgery: false, laboratory: false, pharmacy: false },
    performance: { reportingCompleteness: 40, serviceReadinessScore: 32, tracerMedicineAvailability: 28, staffingScore: 28, opdVisitsPerMonth: 330, ancCoverage: 35, immunizationCoverage: 30, stockOutDays: 15, qualityScore: 32 },
    monthlyTrends: generateTrends(330, 40, 38, 32),
  },
  {
    id: 'phcc-009',
    name: 'Aweil West PHCC',
    type: 'phcc',
    state: 'Northern Bahr el Ghazal',
    town: 'Nyamlel',
    totalBeds: 10,
    icuBeds: 0,
    maternityBeds: 3,
    pediatricBeds: 2,
    doctors: 0,
    clinicalOfficers: 2,
    nurses: 6,
    labTechnicians: 1,
    pharmacists: 0,
    hasElectricity: true,
    electricityHours: 4,
    hasGenerator: false,
    hasSolar: true,
    hasInternet: false,
    internetType: 'None',
    hasAmbulance: false,
    emergency24hr: false,
    services: ['Outpatient', 'ANC', 'EPI', 'Basic Lab'],
    lat: 8.5500,
    lng: 27.0500,
    syncStatus: 'offline',
    lastSync: '2026-02-05T10:00:00Z',
    patientCount: 480,
    todayVisits: 9,
    ownership: 'ngo',
    operationalStatus: 'functional',
    county: 'Aweil West',
    serviceFlags: { epi: true, anc: true, delivery: false, hiv: false, tb: false, emergencySurgery: false, laboratory: true, pharmacy: false },
    performance: { reportingCompleteness: 45, serviceReadinessScore: 38, tracerMedicineAvailability: 32, staffingScore: 30, opdVisitsPerMonth: 270, ancCoverage: 40, immunizationCoverage: 36, stockOutDays: 14, qualityScore: 36 },
    monthlyTrends: generateTrends(270, 45, 32, 28),
  },
  {
    id: 'phcc-010',
    name: 'Lafon PHCC',
    type: 'phcc',
    state: 'Eastern Equatoria',
    town: 'Lafon',
    totalBeds: 8,
    icuBeds: 0,
    maternityBeds: 2,
    pediatricBeds: 2,
    doctors: 0,
    clinicalOfficers: 1,
    nurses: 5,
    labTechnicians: 0,
    pharmacists: 0,
    hasElectricity: false,
    electricityHours: 0,
    hasGenerator: false,
    hasSolar: true,
    hasInternet: false,
    internetType: 'None',
    hasAmbulance: false,
    emergency24hr: false,
    services: ['Outpatient', 'ANC', 'EPI'],
    lat: 4.6700,
    lng: 32.5200,
    syncStatus: 'offline',
    lastSync: '2026-02-03T07:00:00Z',
    patientCount: 380,
    todayVisits: 7,
    ownership: 'public',
    operationalStatus: 'functional',
    county: 'Lafon',
    serviceFlags: { epi: true, anc: true, delivery: false, hiv: false, tb: false, emergencySurgery: false, laboratory: false, pharmacy: false },
    performance: { reportingCompleteness: 38, serviceReadinessScore: 28, tracerMedicineAvailability: 22, staffingScore: 24, opdVisitsPerMonth: 210, ancCoverage: 32, immunizationCoverage: 28, stockOutDays: 18, qualityScore: 28 },
    monthlyTrends: generateTrends(210, 38, 28, 24),
  },
  {
    id: 'phcc-011',
    name: 'Jur River PHCC',
    type: 'phcc',
    state: 'Western Bahr el Ghazal',
    town: 'Jur River',
    totalBeds: 10,
    icuBeds: 0,
    maternityBeds: 3,
    pediatricBeds: 2,
    doctors: 0,
    clinicalOfficers: 2,
    nurses: 7,
    labTechnicians: 1,
    pharmacists: 0,
    hasElectricity: true,
    electricityHours: 5,
    hasGenerator: false,
    hasSolar: true,
    hasInternet: false,
    internetType: 'None',
    hasAmbulance: false,
    emergency24hr: false,
    services: ['Outpatient', 'ANC', 'EPI', 'Basic Lab'],
    lat: 7.5500,
    lng: 27.8500,
    syncStatus: 'offline',
    lastSync: '2026-02-07T09:00:00Z',
    patientCount: 520,
    todayVisits: 10,
    ownership: 'public',
    operationalStatus: 'functional',
    county: 'Jur River',
    serviceFlags: { epi: true, anc: true, delivery: false, hiv: false, tb: false, emergencySurgery: false, laboratory: true, pharmacy: false },
    performance: { reportingCompleteness: 48, serviceReadinessScore: 40, tracerMedicineAvailability: 35, staffingScore: 34, opdVisitsPerMonth: 300, ancCoverage: 42, immunizationCoverage: 38, stockOutDays: 12, qualityScore: 38 },
    monthlyTrends: generateTrends(300, 48, 36, 32),
  },
  {
    id: 'phcc-012',
    name: 'Terekeka PHCC',
    type: 'phcc',
    state: 'Central Equatoria',
    town: 'Terekeka',
    totalBeds: 12,
    icuBeds: 0,
    maternityBeds: 4,
    pediatricBeds: 2,
    doctors: 0,
    clinicalOfficers: 2,
    nurses: 8,
    labTechnicians: 1,
    pharmacists: 0,
    hasElectricity: true,
    electricityHours: 5,
    hasGenerator: false,
    hasSolar: true,
    hasInternet: false,
    internetType: 'None',
    hasAmbulance: false,
    emergency24hr: false,
    services: ['Outpatient', 'ANC', 'EPI', 'Basic Lab'],
    lat: 5.4400,
    lng: 31.7500,
    syncStatus: 'syncing',
    lastSync: '2026-02-08T08:00:00Z',
    patientCount: 680,
    todayVisits: 15,
    ownership: 'public',
    operationalStatus: 'functional',
    county: 'Terekeka',
    serviceFlags: { epi: true, anc: true, delivery: false, hiv: false, tb: false, emergencySurgery: false, laboratory: true, pharmacy: false },
    performance: { reportingCompleteness: 50, serviceReadinessScore: 40, tracerMedicineAvailability: 35, staffingScore: 36, opdVisitsPerMonth: 450, ancCoverage: 48, immunizationCoverage: 44, stockOutDays: 11, qualityScore: 42 },
    monthlyTrends: generateTrends(450, 50, 52, 46),
  },
  // ═══════════════════════════════════════════════════
  //  8 PHCUs
  // ═══════════════════════════════════════════════════
  {
    id: 'phcu-001',
    name: 'Kajo-keji Boma PHCU',
    type: 'phcu',
    state: 'Central Equatoria',
    town: 'Kajo-keji',
    totalBeds: 0,
    icuBeds: 0,
    maternityBeds: 0,
    pediatricBeds: 0,
    doctors: 0,
    clinicalOfficers: 0,
    nurses: 2,
    labTechnicians: 0,
    pharmacists: 0,
    hasElectricity: false,
    electricityHours: 0,
    hasGenerator: false,
    hasSolar: true,
    hasInternet: false,
    internetType: 'None',
    hasAmbulance: false,
    emergency24hr: false,
    services: ['Outpatient', 'ANC', 'EPI', 'Community Health'],
    lat: 3.5680,
    lng: 31.6550,
    syncStatus: 'offline',
    lastSync: '2026-02-08T06:00:00Z',
    patientCount: 340,
    todayVisits: 8,
    ownership: 'public',
    operationalStatus: 'functional',
    county: 'Kajo-keji',
    serviceFlags: { epi: true, anc: true, delivery: false, hiv: false, tb: false, emergencySurgery: false, laboratory: false, pharmacy: false },
    performance: { reportingCompleteness: 30, serviceReadinessScore: 18, tracerMedicineAvailability: 15, staffingScore: 20, opdVisitsPerMonth: 240, ancCoverage: 25, immunizationCoverage: 22, stockOutDays: 20, qualityScore: 20 },
    monthlyTrends: generateTrends(240, 30, 22, 18),
  },
  {
    id: 'phcu-002',
    name: 'Morobo PHCU',
    type: 'phcu',
    state: 'Central Equatoria',
    town: 'Morobo',
    totalBeds: 0,
    icuBeds: 0,
    maternityBeds: 0,
    pediatricBeds: 0,
    doctors: 0,
    clinicalOfficers: 0,
    nurses: 2,
    labTechnicians: 0,
    pharmacists: 0,
    hasElectricity: false,
    electricityHours: 0,
    hasGenerator: false,
    hasSolar: true,
    hasInternet: false,
    internetType: 'None',
    hasAmbulance: false,
    emergency24hr: false,
    services: ['Outpatient', 'ANC', 'EPI', 'Community Health'],
    lat: 3.9100,
    lng: 31.7700,
    syncStatus: 'offline',
    lastSync: '2026-02-07T06:00:00Z',
    patientCount: 290,
    todayVisits: 6,
    ownership: 'ngo',
    operationalStatus: 'functional',
    county: 'Morobo',
    serviceFlags: { epi: true, anc: true, delivery: false, hiv: false, tb: false, emergencySurgery: false, laboratory: false, pharmacy: false },
    performance: { reportingCompleteness: 28, serviceReadinessScore: 16, tracerMedicineAvailability: 12, staffingScore: 18, opdVisitsPerMonth: 180, ancCoverage: 22, immunizationCoverage: 20, stockOutDays: 22, qualityScore: 18 },
    monthlyTrends: generateTrends(180, 28, 18, 16),
  },
  {
    id: 'phcu-003',
    name: 'Duk PHCU',
    type: 'phcu',
    state: 'Jonglei',
    town: 'Duk',
    totalBeds: 0,
    icuBeds: 0,
    maternityBeds: 0,
    pediatricBeds: 0,
    doctors: 0,
    clinicalOfficers: 0,
    nurses: 1,
    labTechnicians: 0,
    pharmacists: 0,
    hasElectricity: false,
    electricityHours: 0,
    hasGenerator: false,
    hasSolar: false,
    hasInternet: false,
    internetType: 'None',
    hasAmbulance: false,
    emergency24hr: false,
    services: ['Outpatient', 'Community Health'],
    lat: 7.7200,
    lng: 31.6800,
    syncStatus: 'offline',
    lastSync: '2026-01-20T06:00:00Z',
    patientCount: 190,
    todayVisits: 4,
    ownership: 'public',
    operationalStatus: 'non_functional',
    county: 'Duk',
    serviceFlags: { epi: false, anc: false, delivery: false, hiv: false, tb: false, emergencySurgery: false, laboratory: false, pharmacy: false },
    performance: { reportingCompleteness: 10, serviceReadinessScore: 8, tracerMedicineAvailability: 5, staffingScore: 10, opdVisitsPerMonth: 120, ancCoverage: 8, immunizationCoverage: 5, stockOutDays: 28, qualityScore: 8 },
    monthlyTrends: generateTrends(120, 10, 8, 5),
  },
  {
    id: 'phcu-004',
    name: 'Mayendit PHCU',
    type: 'phcu',
    state: 'Unity',
    town: 'Mayendit',
    totalBeds: 0,
    icuBeds: 0,
    maternityBeds: 0,
    pediatricBeds: 0,
    doctors: 0,
    clinicalOfficers: 0,
    nurses: 2,
    labTechnicians: 0,
    pharmacists: 0,
    hasElectricity: false,
    electricityHours: 0,
    hasGenerator: false,
    hasSolar: true,
    hasInternet: false,
    internetType: 'None',
    hasAmbulance: false,
    emergency24hr: false,
    services: ['Outpatient', 'ANC', 'Community Health'],
    lat: 7.9500,
    lng: 30.1800,
    syncStatus: 'offline',
    lastSync: '2026-02-01T06:00:00Z',
    patientCount: 250,
    todayVisits: 5,
    ownership: 'public',
    operationalStatus: 'partially_functional',
    county: 'Mayendit',
    serviceFlags: { epi: false, anc: true, delivery: false, hiv: false, tb: false, emergencySurgery: false, laboratory: false, pharmacy: false },
    performance: { reportingCompleteness: 18, serviceReadinessScore: 12, tracerMedicineAvailability: 8, staffingScore: 15, opdVisitsPerMonth: 150, ancCoverage: 15, immunizationCoverage: 10, stockOutDays: 25, qualityScore: 12 },
    monthlyTrends: generateTrends(150, 18, 14, 10),
  },
  {
    id: 'phcu-005',
    name: 'Wulu PHCU',
    type: 'phcu',
    state: 'Lakes',
    town: 'Wulu',
    totalBeds: 0,
    icuBeds: 0,
    maternityBeds: 0,
    pediatricBeds: 0,
    doctors: 0,
    clinicalOfficers: 0,
    nurses: 2,
    labTechnicians: 0,
    pharmacists: 0,
    hasElectricity: false,
    electricityHours: 0,
    hasGenerator: false,
    hasSolar: true,
    hasInternet: false,
    internetType: 'None',
    hasAmbulance: false,
    emergency24hr: false,
    services: ['Outpatient', 'ANC', 'EPI', 'Community Health'],
    lat: 6.4800,
    lng: 29.1500,
    syncStatus: 'offline',
    lastSync: '2026-02-05T06:00:00Z',
    patientCount: 310,
    todayVisits: 6,
    ownership: 'public',
    operationalStatus: 'functional',
    county: 'Wulu',
    serviceFlags: { epi: true, anc: true, delivery: false, hiv: false, tb: false, emergencySurgery: false, laboratory: false, pharmacy: false },
    performance: { reportingCompleteness: 32, serviceReadinessScore: 20, tracerMedicineAvailability: 18, staffingScore: 20, opdVisitsPerMonth: 180, ancCoverage: 28, immunizationCoverage: 24, stockOutDays: 19, qualityScore: 22 },
    monthlyTrends: generateTrends(180, 32, 22, 20),
  },
  {
    id: 'phcu-006',
    name: 'Mundri PHCU',
    type: 'phcu',
    state: 'Western Equatoria',
    town: 'Mundri',
    totalBeds: 0,
    icuBeds: 0,
    maternityBeds: 0,
    pediatricBeds: 0,
    doctors: 0,
    clinicalOfficers: 0,
    nurses: 2,
    labTechnicians: 0,
    pharmacists: 0,
    hasElectricity: false,
    electricityHours: 0,
    hasGenerator: false,
    hasSolar: true,
    hasInternet: false,
    internetType: 'None',
    hasAmbulance: false,
    emergency24hr: false,
    services: ['Outpatient', 'ANC', 'EPI', 'Community Health'],
    lat: 5.2000,
    lng: 29.9600,
    syncStatus: 'offline',
    lastSync: '2026-02-06T07:00:00Z',
    patientCount: 360,
    todayVisits: 7,
    ownership: 'faith_based',
    operationalStatus: 'functional',
    county: 'Mundri West',
    serviceFlags: { epi: true, anc: true, delivery: false, hiv: false, tb: false, emergencySurgery: false, laboratory: false, pharmacy: false },
    performance: { reportingCompleteness: 35, serviceReadinessScore: 22, tracerMedicineAvailability: 20, staffingScore: 22, opdVisitsPerMonth: 210, ancCoverage: 30, immunizationCoverage: 28, stockOutDays: 17, qualityScore: 24 },
    monthlyTrends: generateTrends(210, 35, 26, 22),
  },
  {
    id: 'phcu-007',
    name: 'Pariang PHCU',
    type: 'phcu',
    state: 'Unity',
    town: 'Pariang',
    totalBeds: 0,
    icuBeds: 0,
    maternityBeds: 0,
    pediatricBeds: 0,
    doctors: 0,
    clinicalOfficers: 0,
    nurses: 1,
    labTechnicians: 0,
    pharmacists: 0,
    hasElectricity: false,
    electricityHours: 0,
    hasGenerator: false,
    hasSolar: false,
    hasInternet: false,
    internetType: 'None',
    hasAmbulance: false,
    emergency24hr: false,
    services: ['Outpatient', 'Community Health'],
    lat: 10.0500,
    lng: 29.7000,
    syncStatus: 'offline',
    lastSync: '2026-01-22T06:00:00Z',
    patientCount: 160,
    todayVisits: 3,
    ownership: 'public',
    operationalStatus: 'non_functional',
    county: 'Pariang',
    serviceFlags: { epi: false, anc: false, delivery: false, hiv: false, tb: false, emergencySurgery: false, laboratory: false, pharmacy: false },
    performance: { reportingCompleteness: 8, serviceReadinessScore: 5, tracerMedicineAvailability: 3, staffingScore: 8, opdVisitsPerMonth: 90, ancCoverage: 5, immunizationCoverage: 3, stockOutDays: 30, qualityScore: 6 },
    monthlyTrends: generateTrends(90, 8, 5, 3),
  },
  {
    id: 'phcu-008',
    name: 'Ikotos PHCU',
    type: 'phcu',
    state: 'Eastern Equatoria',
    town: 'Ikotos',
    totalBeds: 0,
    icuBeds: 0,
    maternityBeds: 0,
    pediatricBeds: 0,
    doctors: 0,
    clinicalOfficers: 0,
    nurses: 2,
    labTechnicians: 0,
    pharmacists: 0,
    hasElectricity: false,
    electricityHours: 0,
    hasGenerator: false,
    hasSolar: true,
    hasInternet: false,
    internetType: 'None',
    hasAmbulance: false,
    emergency24hr: false,
    services: ['Outpatient', 'ANC', 'Community Health'],
    lat: 4.1700,
    lng: 32.8800,
    syncStatus: 'offline',
    lastSync: '2026-02-04T07:00:00Z',
    patientCount: 280,
    todayVisits: 5,
    ownership: 'public',
    operationalStatus: 'functional',
    county: 'Ikotos',
    serviceFlags: { epi: false, anc: true, delivery: false, hiv: false, tb: false, emergencySurgery: false, laboratory: false, pharmacy: false },
    performance: { reportingCompleteness: 22, serviceReadinessScore: 15, tracerMedicineAvailability: 10, staffingScore: 16, opdVisitsPerMonth: 150, ancCoverage: 20, immunizationCoverage: 15, stockOutDays: 23, qualityScore: 16 },
    monthlyTrends: generateTrends(150, 22, 16, 12),
  },
];

// South Sudan states and counties, tribes, languages and blood types now live
// in lib/data/south-sudan-reference.ts; re-exported here so existing
// `from '@/data/mock'` imports keep working.
export {
  statesAndCounties, states, tribes, languages, bloodTypes,
} from '@/lib/data/south-sudan-reference';

// South Sudanese names
const dinkaFirstNamesMale = ['Deng', 'Kuol', 'Garang', 'Makuei', 'Majok', 'Atem', 'Bior', 'Mabior', 'Akol', 'Bol', 'Malith', 'Mayen', 'Chol', 'Jok', 'Ayuel', 'Thiik', 'Akok', 'Dut', 'Mach', 'Wol'];
const dinkaFirstNamesFemale = ['Achol', 'Ayen', 'Nyandit', 'Adut', 'Abuk', 'Akuol', 'Yar', 'Athieng', 'Agot', 'Ajok', 'Nyandeng', 'Alek', 'Angeth', 'Aluel', 'Awut', 'Adau', 'Achai', 'Aluong', 'Adieng', 'Adhaldit'];
const nuerFirstNamesMale = ['Gatluak', 'Riek', 'Duoth', 'Puok', 'Koang', 'Gai', 'Tut', 'Ruot', 'Nyuon', 'Both', 'Lam', 'Jal', 'Chuol', 'Gatdet', 'Rier', 'Mun', 'Lat', 'Kueth', 'Bul', 'Thon'];
const nuerFirstNamesFemale = ['Nyamal', 'Nyakuoth', 'Nyadak', 'Nyariek', 'Nyabuay', 'Nyagak', 'Nyapuok', 'Nyaluak', 'Nyakoang', 'Nyajal', 'Nyayien', 'Nyathak', 'Nyagoa', 'Nyamer', 'Nyayiel', 'Nyagany', 'Nyachan', 'Nyawech', 'Nyakume', 'Nyawuor'];
const zandeFirstNames = ['Bazungula', 'Ezibon', 'Khamis', 'Samson', 'Zakaria', 'Yona', 'Seme', 'Marko', 'Lino', 'Tito', 'Rose', 'Mary', 'Sarah', 'Grace', 'Ruth', 'Agnes', 'Anna', 'Esther', 'Florence', 'Josephine'];
const bariFirstNames = ['Ladu', 'Wani', 'Tombe', 'Lemi', 'Soro', 'Loro', 'Keji', 'Lado', 'Modi', 'TamamHealth', 'Bakhita', 'Hellen', 'Janet', 'Monica', 'Stella', 'Viola', 'Lucy', 'Tabitha', 'Cecilia', 'Patricia'];
const familyNames = ['Deng', 'Garang', 'Mabior', 'Kuol', 'Bol', 'Atem', 'Kiir', 'Machar', 'Wani', 'TamamHealth', 'Lado', 'Laku', 'Gore', 'Tombura', 'Gbudue', 'Akot', 'Ajith', 'Mayom', 'Nyuon', 'Gatdet', 'Koang', 'Jok', 'Ring', 'Aguer', 'Achien', 'Makuei', 'Thiik', 'Ayuel', 'Malual', 'Madhol', 'Arou', 'Ngor', 'Biel', 'Ruot', 'Gai', 'Puok', 'Duoth'];

// AllergyEntry, DirectiveType/Entry, CareAlertCategory/Entry and ScreeningEntry
// moved to lib/types/patient-clinical.ts (imported + re-exported at the top).

/**
 * A non-owning member of a patient's care team. Distinct from
 * `Patient.assignedDoctor`, which is the single accountable owner: a care-team
 * member can read and contribute to the chart, but responsibility has not moved
 * to them.
 */
export interface CareTeamMember {
  providerId: string;
  providerName?: string;
  department?: string;
  facilityId?: string;
  /** Why they have access — 'shared_care' consult, or the displaced owner of a
   *  temporary transfer waiting to get the patient back. */
  role: 'consult' | 'covering' | 'previous_owner';
  /** Transfer that granted the access, so it can be traced and revoked. */
  transferId?: string;
  grantedAt: string;
  /** Absent means open-ended (only valid for `consult`). */
  expiresAt?: string;
}

export interface Patient {
  id: string;
  hospitalNumber: string;
  // Geocode-based identification (expert-recommended for South Sudan)
  geocodeId?: string;           // Format: BOMA-{bomaCode}-HH{householdNumber} e.g. "BOMA-XY-HH1001"
  householdNumber?: number;     // Household number within the boma
  nationalId?: string;          // Optional — most people don't have one
  firstName: string;
  middleName: string;
  surname: string;
  maidenName?: string;
  dateOfBirth: string;
  estimatedAge?: number;
  gender: 'Male' | 'Female';
  phone: string;
  altPhone?: string;
  whatsapp?: string;
  /**
   * Patient's own email address, for things addressed TO the patient — the
   * intake-form request being the first. Optional: most patients at these
   * facilities are reachable by phone only, so every surface that uses it has
   * to handle its absence rather than assume it.
   */
  email?: string;
  /** Patient's preferred pharmacy for prescription pickup / e-prescribing. */
  preferredPharmacy?: {
    name: string;
    address?: string;
    phone?: string;
  };
  state: string;
  county: string;
  payam?: string;
  boma?: string;
  bomaCode?: string;           // Short code for the boma (e.g. "XY")
  address?: string;
  gpsLatitude?: number;
  gpsLongitude?: number;
  tribe: string;
  primaryLanguage: string;
  bloodType: string;
  /** Denormalised mirror: active substance names only. Source of truth is
   *  `structuredAllergies`. Kept for backward-compatible read sites. */
  allergies: string[];
  /** Structured allergy/adverse-reaction records (P0.3). */
  structuredAllergies?: AllergyEntry[];
  /** Directives / consent records on the chart (P2.1). */
  directives?: DirectiveEntry[];
  /** Chart-permanent care alerts / safety flags (P1.2). */
  careAlerts?: CareAlertEntry[];
  /** Preventive-care / health-maintenance screenings due on the chart. */
  screenings?: ScreeningEntry[];
  chronicConditions: string[];
  nokName: string;
  nokRelationship: string;
  nokPhone: string;
  nokAddress?: string;
  /** Additional next-of-kin contacts beyond the primary (up to 3 additional). */
  additionalNextOfKin?: Array<{ name: string; relationship: string; phone: string; address?: string }>;
  /** Payment coverage collected at registration. */
  payorInfo?: {
    coverageType: 'out-of-pocket' | 'program' | 'exemption' | 'ngo';
    programEnrollment?: string;
    ngoName?: string;
    exemptionReason?: string;
  };
  registrationHospital: string;
  registrationDate: string;
  /** ISO 8601 timestamp (date + time) captured when patient is first registered. */
  registeredAt?: string;
  /** Name of user who first registered this patient. */
  registeredBy?: string;
  lastVisitDate: string;
  lastVisitHospital: string;
  /** ISO 8601 timestamp (date + time) of the most recent consultation. */
  lastConsultedAt?: string;
  /** Name of the provider who conducted the most recent consultation. */
  lastConsultedBy?: string;
  // ── Care assignment (nurse → doctor handoff) ──
  /** User id of the doctor/clinician a nurse has assigned to provide care. */
  assignedDoctor?: string;
  /** Display name of the assigned doctor at time of assignment. */
  assignedDoctorName?: string;
  /** ISO datetime the assignment was made. */
  assignedAt?: string;
  /** User id of the nurse who made the assignment. */
  assignedBy?: string;
  /** Display name of the nurse who made the assignment. */
  assignedByName?: string;
  /** Optional handoff note from the nurse to the doctor. */
  assignmentNote?: string;
  /** Current visit-level state after the patient is assigned to a provider. */
  assignmentStatus?: 'assigned' | 'accepted' | 'in_progress' | 'completed';
  /** When the receiving provider acknowledged the assignment. */
  assignmentAcceptedAt?: string;
  assignmentAcceptedBy?: string;
  assignmentAcceptedByName?: string;
  /**
   * The nurse covering this patient. Separate from `assignedBy`, which records
   * who *made* the doctor assignment — the front desk was reading that field as
   * "the nurse", which showed whoever last assigned a provider instead of who
   * is actually looking after the patient.
   */
  assignedNurse?: string;
  assignedNurseName?: string;
  assignedNurseAt?: string;
  assignedNurseBy?: string;
  assignedNurseByName?: string;
  /** Department currently responsible for the patient (e.g. "Paediatrics"). */
  assignedDepartment?: string;
  /**
   * Additional clinicians with care-team access who are NOT the owner —
   * specialist consults, covering providers, co-management. Written by the
   * internal-transfer workflow for `shared_care` transfers and by `temporary`
   * transfers (which park the original owner here so ownership can return).
   * Entries past their `expiresAt` are lapsed and must be treated as revoked
   * — see `activeCareTeam()` in patient-transfer-service.
   */
  careTeam?: CareTeamMember[];
  isActive: boolean;
  /** Set when patient death is recorded within the platform. */
  deceasedAt?: string;
  deathCause?: string;
  deathPlace?: string;
  deathInformant?: string;
  photoUrl?: string;
  /** Patient-portal login username. Only set for the handful of demo
   *  accounts that can actually sign in to the patient portal. */
  portalUsername?: string;
  /** bcrypt hash (cost 12) of the patient-portal login password. This is
   *  server-side-only secret material — NEVER include it in any API
   *  response or object sent to the browser. */
  portalPasswordHash?: string;
  // Follow-up tracking (expert-recommended)
  followUpStatus?: 'recovered' | 'died' | 'referred' | 'under_treatment' | 'lost_to_followup';
  assignedHealthWorker?: string;  // BHW ID for community follow-up
  lastFollowUp?: string;
  nextFollowUp?: string;
  isDeceased?: boolean;
  deceasedDate?: string;
}

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

function generateHospitalNumber(index: number): string {
  return `JTH-${String(index + 1).padStart(6, '0')}`;
}

// Hospitals that have seeded staff accounts (mirrors the db-seed.ts user roster,
// which only staffs hosp-001..004). Generated patients are distributed across
// these so every demo user — at whichever of these facilities — sees a
// populated registry, instead of being scattered across unstaffed hospitals.
const STAFFED_HOSPITAL_IDS = ['hosp-001', 'hosp-002', 'hosp-003', 'hosp-004'];

function generatePhone(): string {
  // Canonical stored form: E.164 with no separators (+211 + 9 national digits).
  // National prefixes drop their leading 0 so the result is always +2119XXXXXXXX.
  const prefixes = ['912', '916', '921', '925', '955', '977'];
  return `+211${randomFrom(prefixes)}${Math.floor(100000 + rand() * 900000)}`;
}

function generateDOB(): string {
  const year = 1960 + Math.floor(rand() * 55);
  const month = String(Math.floor(1 + rand() * 12)).padStart(2, '0');
  const day = String(Math.floor(1 + rand() * 28)).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getAge(dob: string): number {
  const birthDate = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
  return age;
}

const commonAllergies = ['Penicillin', 'Sulfa drugs', 'Chloroquine', 'Aspirin', 'Ibuprofen', 'None known'];
const chronicConditionsList = ['HIV/AIDS', 'Tuberculosis', 'Hypertension', 'Diabetes Type 2', 'Sickle Cell Disease', 'Epilepsy', 'Asthma', 'Hepatitis B', 'Rheumatic Heart Disease', 'None'];
const relationships = ['Spouse', 'Parent', 'Child', 'Sibling', 'Uncle', 'Aunt', 'Cousin', 'Friend'];

// Portrait photos of real African people, bundled locally in public/assets/patients.
// Grouped by gender so the gender-based deterministic pick below never
// assigns a visibly male photo to a female patient.
export const MALE_PATIENT_PHOTOS = [
  '/assets/patients/founder-teny.jpg',
  '/assets/patients/founder-toye.jpg',
  '/assets/patients/founder-ekow.jpg',
  '/assets/patients/doctor-tablet-review.jpg',
  '/assets/patients/doctor-writing-notes.jpg',
  '/assets/patients/african-nurse.jpg',
  '/assets/patients/portrait-man-camera.jpg',
  '/assets/patients/portrait-man-beanie.jpg',
];
export const FEMALE_PATIENT_PHOTOS = [
  '/assets/patients/doctor-tablet-smiling.jpg',
  '/assets/patients/doctor-prescription.jpg',
  '/assets/patients/doctor-nurse-consultation.jpg',
  '/assets/patients/community-health-worker.jpg',
];

function generatePatient(index: number): Patient {
  const gender = rand() > 0.48 ? 'Male' : 'Female';
  const pool = gender === 'Male' ? MALE_PATIENT_PHOTOS : FEMALE_PATIENT_PHOTOS;
  const photoUrl = pool[index % pool.length];
  const tribeIndex = Math.floor(rand() * 4);
  let firstName: string;
  const tribe = ['Dinka', 'Nuer', 'Zande', 'Bari'][tribeIndex];

  if (tribeIndex === 0) {
    firstName = gender === 'Male' ? randomFrom(dinkaFirstNamesMale) : randomFrom(dinkaFirstNamesFemale);
  } else if (tribeIndex === 1) {
    firstName = gender === 'Male' ? randomFrom(nuerFirstNamesMale) : randomFrom(nuerFirstNamesFemale);
  } else if (tribeIndex === 2) {
    firstName = randomFrom(zandeFirstNames);
  } else {
    firstName = randomFrom(bariFirstNames);
  }

  const dob = generateDOB();
  const state = randomFrom(states);
  const counties = statesAndCounties[state];
  // Place each patient at one of the STAFFED hospitals (round-robin by index),
  // not a random one of all facilities. Only these hospitals have seeded user
  // accounts, so a patient registered at an unstaffed facility would be visible
  // to nobody. Deterministic distribution guarantees every staff login lands on
  // a hospital with a populated patient registry.
  const hospital = STAFFED_HOSPITAL_IDS[index % STAFFED_HOSPITAL_IDS.length];

  const numAllergies = rand() > 0.7 ? Math.floor(1 + rand() * 2) : 0;
  const allergies: string[] = numAllergies > 0
    ? Array.from({ length: numAllergies }, () => randomFrom(commonAllergies.filter(a => a !== 'None known')))
    : ['None known'];

  const numConditions = rand() > 0.6 ? Math.floor(1 + rand() * 2) : 0;
  const conditions: string[] = numConditions > 0
    ? Array.from({ length: numConditions }, () => randomFrom(chronicConditionsList.filter(c => c !== 'None')))
    : ['None'];

  return {
    id: `pat-${String(index + 1).padStart(5, '0')}`,
    hospitalNumber: generateHospitalNumber(index),
    firstName,
    middleName: randomFrom(familyNames),
    surname: randomFrom(familyNames),
    dateOfBirth: dob,
    estimatedAge: rand() > 0.7 ? getAge(dob) : undefined,
    gender,
    phone: generatePhone(),
    state,
    county: randomFrom(counties),
    tribe,
    primaryLanguage: tribe === 'Dinka' ? 'Dinka' : tribe === 'Nuer' ? 'Nuer' : tribe === 'Zande' ? 'Zande' : 'Bari',
    bloodType: randomFrom(bloodTypes),
    allergies: [...new Set(allergies)],
    chronicConditions: [...new Set(conditions)],
    nokName: `${randomFrom([...dinkaFirstNamesMale, ...nuerFirstNamesMale, ...bariFirstNames])} ${randomFrom(familyNames)}`,
    nokRelationship: randomFrom(relationships),
    nokPhone: generatePhone(),
    registrationHospital: hospital,
    // registrationDate and registeredAt must describe the SAME event, so derive
    // the timestamp from the date rather than rolling two independent randoms
    // (which previously let a patient's two registration fields disagree).
    ...(() => {
      const m = String(Math.floor(1 + rand() * 12)).padStart(2, '0');
      const d = String(Math.floor(1 + rand() * 28)).padStart(2, '0');
      const hh = String(Math.floor(7 + rand() * 12)).padStart(2, '0');
      const mm = String(Math.floor(rand() * 60)).padStart(2, '0');
      const registrationDate = `2025-${m}-${d}`;
      return {
        registrationDate,
        registeredAt: `${registrationDate}T${hh}:${mm}:00.000Z`,
      };
    })(),
    lastVisitDate: `2026-0${Math.floor(1 + rand() * 2)}-${String(Math.floor(1 + rand() * 9)).padStart(2, '0')}`,
    lastVisitHospital: hospital,
    lastConsultedAt: (() => {
      const mo = Math.floor(1 + rand() * 2);
      const d = String(Math.floor(1 + rand() * 9)).padStart(2, '0');
      const hh = String(Math.floor(8 + rand() * 10)).padStart(2, '0');
      const mm = String(Math.floor(rand() * 60)).padStart(2, '0');
      return `2026-0${mo}-${d}T${hh}:${mm}:00.000Z`;
    })(),
    isActive: true,
    photoUrl,
  };
}

const _generatedPatients: Patient[] = [
  // Core roster: pat-00001..pat-00050.
  ...Array.from({ length: 50 }, (_, i) => generatePatient(i)),
  // Extra roster: ids start at index 86 (→ pat-00087, JTH-000087) so they never
  // collide with the hand-seeded patients pat-00051..pat-00086 in db-seed.ts.
  // Gives every registry/list page a fuller, fully-detailed patient list.
  ...Array.from({ length: 50 }, (_, i) => generatePatient(i + 86)),
];

// Override first 3 patients with deterministic demo-patient data (used across
// the app — front-desk, registry lookups, etc.). These are no longer
// patient-portal login accounts: portal login now requires
// portalUsername/portalPasswordHash, which only Mary Lado (index 3, below)
// carries.
_generatedPatients[0] = {
  ..._generatedPatients[0],
  firstName: 'Deng',
  middleName: 'Mabior',
  surname: 'Garang',
  phone: '+211912345678',
  gender: 'Male',
  dateOfBirth: '1988-03-15',
  bloodType: 'O+',
  allergies: ['Penicillin'],
  chronicConditions: ['Hypertension'],
  registrationHospital: 'hosp-001',
  photoUrl: '/assets/patients/portrait-man-camera.jpg',
  preferredPharmacy: { name: 'Konyokonyo Pharmacy', address: 'Konyokonyo Market, Juba', phone: '+211911220145' },
};
_generatedPatients[1] = {
  ..._generatedPatients[1],
  firstName: 'Nyabol',
  middleName: 'Gatdet',
  surname: 'Koang',
  phone: '+211916111222',
  gender: 'Female',
  dateOfBirth: '1995-07-22',
  bloodType: 'A+',
  allergies: ['None known'],
  chronicConditions: ['None'],
  registrationHospital: 'hosp-001',
  photoUrl: '/assets/patients/doctor-tablet-smiling.jpg',
};
_generatedPatients[2] = {
  ..._generatedPatients[2],
  firstName: 'Achol',
  middleName: 'Mayen',
  surname: 'Deng',
  phone: '+211921333444',
  gender: 'Female',
  dateOfBirth: '2001-11-05',
  bloodType: 'B+',
  allergies: ['None known'],
  chronicConditions: ['Asthma'],
  registrationHospital: 'hosp-001',
  photoUrl: '/assets/patients/doctor-prescription.jpg',
  preferredPharmacy: { name: 'Juba Pharmacy', address: 'Airport Road, Juba', phone: '+211922778301' },
};

// Dedicated end-to-end demo patient (pat-00004 / JTH-000004). Fully populated —
// chronic conditions, allergies and a chronic medication — so the consultation
// wizard pre-fills the history and every step can be exercised start to finish.
_generatedPatients[3] = {
  ..._generatedPatients[3],
  firstName: 'Mary',
  middleName: 'Nyandeng',
  surname: 'Lado',
  phone: '+211912000004',
  gender: 'Female',
  dateOfBirth: '1979-06-12',
  bloodType: 'O+',
  allergies: ['Penicillin', 'Sulfa'],
  chronicConditions: ['Diabetes Type 2', 'Hypertension'],
  registrationHospital: 'hosp-001',
  preferredPharmacy: { name: 'Konyokonyo Pharmacy', address: 'Konyokonyo Market, Juba', phone: '+211911220145' },
  // The ONE patient-portal login account. Password: patient1234 (bcrypt cost 12).
  portalUsername: 'patient.mary',
  portalPasswordHash: '$2b$12$6SRLnqnuoVlZDt0UJa9w6.AWuKeRxXWciunE1NTnECgmfzYGR4/NS',
};

// Showcase patients that already carry seeded insurance policies (pat-00012 /
// pat-00022) — give them a preferred pharmacy so the summary strip is complete.
if (_generatedPatients[11]) {
  _generatedPatients[11] = {
    ..._generatedPatients[11],
    preferredPharmacy: { name: 'All Heart Pharmacy', address: 'Hai Cinema, Juba', phone: '+211918540922' },
  };
}
if (_generatedPatients[21]) {
  _generatedPatients[21] = {
    ..._generatedPatients[21],
    preferredPharmacy: { name: 'Nimra Talata Pharmacy', address: 'Nimra Talata, Juba', phone: '+211915332110' },
  };
}

export const patients: Patient[] = _generatedPatients;

// File attachments
export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  base64Data: string;
  sizeBytes: number;
  description?: string;
  uploadedAt: string;
  uploadedBy: string;
}

// Transfer package for referrals
export interface TransferPackage {
  patientDemographics: {
    id: string;
    hospitalNumber: string;
    firstName: string;
    middleName: string;
    surname: string;
    dateOfBirth: string;
    gender: string;
    phone: string;
    state: string;
    county: string;
    tribe: string;
    bloodType: string;
    allergies: string[];
    chronicConditions: string[];
    nokName: string;
    nokPhone: string;
    nokRelationship: string;
  };
  medicalRecords: MedicalRecord[];
  labResults: { testName: string; result: string; unit: string; referenceRange: string; abnormal: boolean; critical: boolean; date: string; hospitalName?: string }[];
  attachments: Attachment[];
  packagedAt: string;
  packagedBy: string;
  packageSizeBytes: number;
}

// Medical records
export interface VitalSigns {
  temperature: number;
  systolic: number;
  diastolic: number;
  pulse: number;
  respiratoryRate: number;
  oxygenSaturation: number;
  weight: number;
  height: number;
  bmi: number;
  muac?: number;
  /** Pain score, 0–10 numeric rating scale. */
  painScore?: number;
  /** Capillary blood glucose, mmol/L. */
  bloodGlucose?: number;
  /** Glasgow Coma Scale, 3–15. */
  gcs?: number;
  recordedAt: string;
  recordedBy?: string;
  recordedByRole?: string;
}

export interface Diagnosis {
  /** Legacy/compat code field. NOTE: the consultation writes the ICD-11 code
   *  here too (many readers key off `icd10Code`), so prefer `icd11Code` +
   *  `codeSystem` below when the coding system matters (interop / DHIS2). */
  icd10Code: string;
  /** ICD-11 (MMS) code — the system this platform actually codes in. */
  icd11Code?: string;
  /** Coding system for the codes above, e.g. 'ICD-11-MMS'. */
  codeSystem?: string;
  name: string;
  type: 'primary' | 'secondary' | 'differential';
  certainty: 'confirmed' | 'suspected';
  severity: 'mild' | 'moderate' | 'severe';
}

export interface Prescription {
  drugName: string;
  genericName: string;
  dose: string;
  route: string;
  frequency: string;
  duration: string;
  instructions: string;
  /**
   * Clinical timing of the order. 'immediate' = emergency/stat treatment given
   * before lab results return (IV fluids for hypotension, antipyretics for
   * fever, anticonvulsants for paediatric seizures). 'definitive' = treatment
   * started after a diagnosis is established. Defaults to definitive.
   */
  urgency?: 'immediate' | 'definitive';
}

export interface LabResult {
  testName: string;
  result: string;
  unit: string;
  referenceRange: string;
  abnormal: boolean;
  critical: boolean;
  date: string;
  /**
   * 'basic' = routine panels ordered broadly (CBC, urinalysis). 'special' =
   * targeted investigations the clinician selects per case (ANA, rheumatoid
   * factor, vitamin D, uric acid, cultures). Defaults to basic.
   */
  tier?: 'basic' | 'special';
}

/** Per-system entry for the Review of Systems (14-system CMS standard). */
export type ROSStatus = 'not_reviewed' | 'negative' | 'positive';
export interface ReviewOfSystemEntry {
  status: ROSStatus;
  /** Free-text positive findings when status is 'positive'. */
  findings?: string;
}

/** Structured past medical history. */
export interface PastMedicalHistory {
  /** Chronic conditions: diabetes, hypertension, hyperlipidemia, asthma, etc. */
  chronicConditions: string[];
  pastAdmissions?: string;
  pastSurgeries?: string;
  bloodTransfusion?: boolean;
  notes?: string;
}

/** Social history — includes insurance + socioeconomic status, which drive
 *  affordability of chronic medications in the South Sudan / regional context. */
export interface SocialHistory {
  smoking?: 'never' | 'former' | 'current';
  alcohol?: 'never' | 'occasional' | 'regular';
  substanceUse?: string;
  occupation?: string;
  hasHealthInsurance?: boolean;
  insuranceProvider?: string;
  socioeconomicStatus?: 'low' | 'middle' | 'high';
  notes?: string;
}

/** Drug history and allergies. */
export interface DrugHistory {
  chronicMedications?: string;
  allergies: string[];
  noKnownAllergies?: boolean;
}

export interface MedicalRecord {
  id: string;
  patientId: string;
  hospitalId: string;
  hospitalName: string;
  visitDate: string;
  /** ISO 8601 timestamp (date + time) captured when the consultation/visit is recorded. */
  consultedAt?: string;
  /** ISO 8601 timestamp (date + time) captured when the consultation was started. */
  startedAt?: string;
  visitType: 'outpatient' | 'inpatient' | 'emergency' | 'referral';
  visitDisposition?: 'checkout' | 'referred' | 'admitted';
  providerName: string;
  providerRole: string;
  department: string;
  chiefComplaint: string;
  historyOfPresentIllness: string;
  /** Structured clinical history (history-taking workflow). All optional/additive. */
  chiefComplaints?: string[];
  reviewOfSystems?: Record<string, ReviewOfSystemEntry>;
  pastMedicalHistory?: PastMedicalHistory;
  familyHistory?: string;
  socialHistory?: SocialHistory;
  drugHistory?: DrugHistory;
  vitalSigns: VitalSigns;
  triageVitals?: {
    temperature?: string; systolic?: string; diastolic?: string; pulse?: string;
    respiratoryRate?: string; oxygenSaturation?: string; weight?: string;
    muac?: string; bloodGlucose?: string; capturedAt?: string; capturedBy?: string;
  };
  /** Physical examination findings by system, captured in the consultation
   *  exam step. Additive/optional; only populated systems are stored. */
  physicalExamination?: {
    general?: string;
    cardiovascular?: string;
    respiratory?: string;
    abdominal?: string;
    neurological?: string;
  };
  diagnoses: Diagnosis[];
  prescriptions: Prescription[];
  labResults: LabResult[];
  treatmentPlan: string;
  attachments?: Attachment[];
  followUp?: { date: string; reason: string };
  syncStatus: 'synced' | 'pending';
  aiEvaluation?: {
    suggestedDiagnoses: { icd10Code: string; name: string; confidence: number; reasoning: string; severity: 'mild' | 'moderate' | 'severe'; suggestedTreatment?: string }[];
    vitalSignAlerts: string[];
    recommendedTests: string[];
    severityAssessment: string;
    clinicalNotes: string;
    evaluatedAt: string;
  };
}

const departments = ['Internal Medicine', 'Pediatrics', 'Obstetrics & Gynecology', 'Surgery', 'Emergency', 'Outpatient'];
const providerNames = ['Dr. James Wani Igga', 'Dr. Achol Mayen Deng', 'Dr. Gatluak Puok Riek', 'Dr. Rose Gbudue', 'Dr. TamamHealth Ladu Soro', 'Dr. Nyamal Koang Jal', 'CO Deng Mabior Kuol', 'CO Stella Keji Lemi', 'CO Riek Duoth Gai'];
const complaints = [
  'Fever and headache for 3 days',
  'Persistent cough for 2 weeks',
  'Abdominal pain and diarrhea',
  'Difficulty breathing',
  'Wound infection on left leg',
  'Prenatal check-up, 28 weeks',
  'Chest pain radiating to left arm',
  'Severe malaria symptoms',
  'Joint pain and swelling',
  'Chronic fatigue and weight loss',
  'Eye pain and blurred vision',
  'Skin rash and itching for 1 week',
  'High blood pressure follow-up',
  'HIV clinic - ARV refill',
  'TB treatment month 3 follow-up',
  'Child immunization visit',
  'Burn injury - hot water',
  'Snake bite on right foot',
];

const commonDiagnoses: Diagnosis[] = [
  { icd10Code: 'B50.9', name: 'Plasmodium falciparum malaria', type: 'primary', certainty: 'confirmed', severity: 'moderate' },
  { icd10Code: 'A09', name: 'Acute gastroenteritis', type: 'primary', certainty: 'confirmed', severity: 'mild' },
  { icd10Code: 'J06.9', name: 'Upper respiratory tract infection', type: 'primary', certainty: 'confirmed', severity: 'mild' },
  { icd10Code: 'A15.0', name: 'Pulmonary tuberculosis', type: 'primary', certainty: 'suspected', severity: 'severe' },
  { icd10Code: 'B20', name: 'HIV disease', type: 'primary', certainty: 'confirmed', severity: 'moderate' },
  { icd10Code: 'I10', name: 'Essential hypertension', type: 'primary', certainty: 'confirmed', severity: 'moderate' },
  { icd10Code: 'E11', name: 'Type 2 diabetes mellitus', type: 'secondary', certainty: 'confirmed', severity: 'moderate' },
  { icd10Code: 'J18.9', name: 'Community-acquired pneumonia', type: 'primary', certainty: 'confirmed', severity: 'severe' },
  { icd10Code: 'A00.9', name: 'Cholera', type: 'primary', certainty: 'confirmed', severity: 'severe' },
  { icd10Code: 'B05.9', name: 'Measles', type: 'primary', certainty: 'confirmed', severity: 'moderate' },
  { icd10Code: 'D57', name: 'Sickle cell disease', type: 'primary', certainty: 'confirmed', severity: 'moderate' },
  { icd10Code: 'O80', name: 'Normal delivery', type: 'primary', certainty: 'confirmed', severity: 'mild' },
];

const commonPrescriptions: Prescription[] = [
  { drugName: 'Artemether-Lumefantrine', genericName: 'Coartem', dose: '80/480mg', route: 'Oral', frequency: 'BD x 3 days', duration: '3 days', instructions: 'Take with food' },
  { drugName: 'Amoxicillin', genericName: 'Amoxicillin', dose: '500mg', route: 'Oral', frequency: 'TDS', duration: '7 days', instructions: 'Complete full course' },
  { drugName: 'Paracetamol', genericName: 'Acetaminophen', dose: '1g', route: 'Oral', frequency: 'QDS PRN', duration: '5 days', instructions: 'As needed for pain/fever' },
  { drugName: 'ORS', genericName: 'Oral Rehydration Salts', dose: '1 sachet', route: 'Oral', frequency: 'After each loose stool', duration: '3 days', instructions: 'Dissolve in 1L clean water' },
  { drugName: 'Metformin', genericName: 'Metformin', dose: '500mg', route: 'Oral', frequency: 'BD', duration: '30 days', instructions: 'Take with meals' },
  { drugName: 'Amlodipine', genericName: 'Amlodipine', dose: '5mg', route: 'Oral', frequency: 'OD', duration: '30 days', instructions: 'Take in the morning' },
  { drugName: 'TDF/3TC/DTG', genericName: 'Tenofovir/Lamivudine/Dolutegravir', dose: '300/300/50mg', route: 'Oral', frequency: 'OD', duration: '90 days', instructions: 'Take at same time daily' },
];

function generateLabResults(): LabResult[] {
  const allLabs: LabResult[] = [
    { testName: 'Malaria RDT', result: rand() > 0.4 ? 'Positive' : 'Negative', unit: '', referenceRange: 'Negative', abnormal: rand() > 0.4, critical: false, date: '2026-02-09' },
    { testName: 'Hemoglobin', result: (8 + rand() * 8).toFixed(1), unit: 'g/dL', referenceRange: '12.0-16.0', abnormal: rand() > 0.5, critical: false, date: '2026-02-09' },
    { testName: 'WBC Count', result: (4 + rand() * 12).toFixed(1), unit: '×10³/μL', referenceRange: '4.0-11.0', abnormal: rand() > 0.6, critical: false, date: '2026-02-09' },
    { testName: 'Blood Glucose (Random)', result: (70 + rand() * 150).toFixed(0), unit: 'mg/dL', referenceRange: '70-140', abnormal: rand() > 0.6, critical: false, date: '2026-02-08' },
    { testName: 'HIV Rapid Test', result: rand() > 0.85 ? 'Reactive' : 'Non-reactive', unit: '', referenceRange: 'Non-reactive', abnormal: rand() > 0.85, critical: false, date: '2026-02-08' },
    { testName: 'Urinalysis', result: 'Normal', unit: '', referenceRange: 'Normal', abnormal: false, critical: false, date: '2026-02-07' },
    { testName: 'CD4 Count', result: (150 + rand() * 700).toFixed(0), unit: 'cells/μL', referenceRange: '500-1500', abnormal: rand() > 0.5, critical: false, date: '2026-02-06' },
    { testName: 'Creatinine', result: (0.5 + rand() * 1.5).toFixed(1), unit: 'mg/dL', referenceRange: '0.6-1.2', abnormal: rand() > 0.7, critical: false, date: '2026-02-05' },
  ];
  const count = 2 + Math.floor(rand() * 4);
  return allLabs.slice(0, count);
}

export function generateMedicalRecords(patientId: string, count: number, homeHospitalId?: string): MedicalRecord[] {
  // Generate a coherent chronological series so trend charts are meaningful.
  // Records are spaced roughly monthly going back from "now".
  const startMonth = 8; // months back
  // All visits happen at the patient's home facility. The old per-visit
  // `randomFrom(hospitals)` bounced each patient across six random facilities
  // in eight months, which read as nonsense on the chart's vitals history.
  const homeHospital = hospitals.find(h => h.id === homeHospitalId) || randomFrom(hospitals);
  const baseWeight = 55 + rand() * 25;
  const baseSystolic = 115 + rand() * 25;
  const baseTemp = 36.5 + rand() * 0.8;
  const basePulse = 70 + rand() * 15;
  const baseGlucose = 85 + rand() * 25;

  return Array.from({ length: count }, (_, i) => {
    const hospital = homeHospital;
    // Older records have higher index (we'll reverse-chronologically sort anyway)
    const monthsAgo = startMonth - Math.floor((i / Math.max(1, count - 1)) * startMonth);
    const visitDateObj = new Date();
    visitDateObj.setMonth(visitDateObj.getMonth() - monthsAgo);
    visitDateObj.setDate(1 + Math.floor(rand() * 27));
    visitDateObj.setHours(8 + Math.floor(rand() * 9), Math.floor(rand() * 60), 0, 0);
    const visitDate = visitDateObj.toISOString().split('T')[0];
    const consultedAt = visitDateObj.toISOString();

    const numDiagnoses = 1 + Math.floor(rand() * 2);
    const numPrescriptions = 1 + Math.floor(rand() * 3);

    // Drift vitals slightly over time for trends
    const drift = (i / Math.max(1, count - 1)) * (rand() > 0.5 ? 1 : -1);
    const weight = +(baseWeight + drift * 3 + (rand() - 0.5) * 1.5).toFixed(1);
    const height = +(155 + rand() * 25).toFixed(1);
    const systolic = Math.floor(baseSystolic + drift * 10 + (rand() - 0.5) * 6);
    const diastolic = Math.floor(70 + (rand() - 0.5) * 10 + drift * 5);
    const temperature = +(baseTemp + (rand() - 0.5) * 0.6 + Math.max(0, drift) * 0.8).toFixed(1);
    const pulse = Math.floor(basePulse + (rand() - 0.5) * 8 + drift * 6);
    const respRate = Math.floor(16 + rand() * 6);
    const o2Sat = Math.floor(94 + rand() * 5);
    const bmi = +(weight / ((height / 100) ** 2)).toFixed(1);

    return {
      id: `rec-${patientId}-${String(i + 1).padStart(3, '0')}`,
      patientId,
      hospitalId: hospital.id,
      hospitalName: hospital.name,
      visitDate,
      consultedAt,
      startedAt: consultedAt,
      visitType: randomFrom(['outpatient', 'outpatient', 'outpatient', 'emergency', 'inpatient', 'referral'] as const),
      providerName: randomFrom(providerNames),
      providerRole: randomFrom(['Doctor', 'Clinical Officer']),
      department: randomFrom(departments),
      chiefComplaint: randomFrom(complaints),
      historyOfPresentIllness: 'Patient presents with the above complaints. Onset was gradual. No associated symptoms initially but condition has worsened over recent days. No significant travel history. Patient reports taking traditional medicine without improvement.',
      vitalSigns: {
        temperature,
        systolic,
        diastolic,
        pulse,
        respiratoryRate: respRate,
        oxygenSaturation: o2Sat,
        weight,
        height,
        bmi,
        muac: rand() > 0.5 ? +(12 + rand() * 8).toFixed(1) : undefined,
        recordedAt: consultedAt,
      },
      diagnoses: Array.from({ length: numDiagnoses }, () => randomFrom(commonDiagnoses)),
      prescriptions: Array.from({ length: numPrescriptions }, () => randomFrom(commonPrescriptions)),
      labResults: generateLabResults().map(lab => {
        if (lab.testName === 'Blood Glucose (Random)') {
          return { ...lab, result: (baseGlucose + drift * 20 + (rand() - 0.5) * 10).toFixed(0), date: visitDate };
        }
        return { ...lab, date: visitDate };
      }),
      treatmentPlan: 'Continue prescribed medications. Adequate hydration. Rest. Return if symptoms worsen. Follow-up in 1 week.',
      followUp: rand() > 0.3 ? { date: '2026-02-16', reason: 'Review and follow-up assessment' } : undefined,
      syncStatus: rand() > 0.2 ? 'synced' : 'pending',
    };
  });
}

// Referrals
/**
 * Structured close-out the receiving facility sends back to the referrer when
 * a referral is completed — so the sender learns what actually happened to
 * their patient, not just that the status flipped to `completed`.
 */
export type ReferralDisposition =
  | 'treated_discharged'
  | 'admitted'
  | 'referred_onward'
  | 'did_not_arrive'
  | 'deceased';

export interface ReferralOutcome {
  disposition: ReferralDisposition;
  /** Diagnosis + treatment/management summary for the referring clinician. */
  summary: string;
  /** Optional follow-up instructions handed back to the referring facility. */
  followUp?: string;
  recordedBy: string;
  recordedAt: string;
}

export interface Referral {
  id: string;
  patientId: string;
  patientName: string;
  fromHospital: string;
  fromHospitalId: string;
  toHospital: string;
  toHospitalId: string;
  referralDate: string;
  urgency: 'routine' | 'urgent' | 'emergency';
  reason: string;
  department: string;
  status: 'sent' | 'received' | 'seen' | 'completed' | 'cancelled';
  referringDoctor: string;
  notes: string;
  outcome?: ReferralOutcome;
  transferPackage?: TransferPackage;
  referralAttachments?: Attachment[];
  /**
   * Organization that owns the DESTINATION facility (KAN-101).
   *
   * `orgId` on a referral resolves to the *sending* org, and `filterByScope`
   * filters on org before it ever looks at hospital — so a referral sent across
   * an organisational boundary was invisible to the receiving org. The
   * referring clinician saw a sent referral that the receiver would never get.
   *
   * Carrying the destination org lets scope enforcement grant read access to
   * both sides of a cross-org referral without widening anything else.
   * Undefined for same-org referrals, where `orgId` already covers both ends.
   */
  toOrgId?: string;
  /**
   * When the receiving facility is expected to have acknowledged this referral,
   * derived from `urgency` at creation (emergency +4h, urgent +24h, routine
   * +72h). Optional because referrals created before SLA tracking existed do
   * not carry one — treat a missing value as "no SLA", never as "breached".
   * See REFERRAL_SLA_HOURS in services/referral-service.ts.
   */
  expectedAt?: string;
}

export const referrals: Referral[] = [
  { id: 'ref-001', patientId: 'pat-00001', patientName: 'Deng Mabior Garang', fromHospital: 'Wau State Hospital', fromHospitalId: 'hosp-002', toHospital: 'Juba Teaching Hospital', toHospitalId: 'hosp-001', referralDate: '2026-02-09', urgency: 'urgent', reason: 'Suspected cardiac condition requiring echocardiography', department: 'Cardiology', status: 'sent', referringDoctor: 'Dr. Achol Mayen Deng', notes: 'Patient with progressive dyspnea, murmur on auscultation' },
  { id: 'ref-002', patientId: 'pat-00005', patientName: 'Nyamal Koang Gatdet', fromHospital: 'Bentiu State Hospital', fromHospitalId: 'hosp-004', toHospital: 'Juba Teaching Hospital', toHospitalId: 'hosp-001', referralDate: '2026-02-08', urgency: 'emergency', reason: 'Complicated delivery requiring C-section', department: 'Obstetrics & Gynecology', status: 'received', referringDoctor: 'CO Riek Duoth Gai', notes: 'Primigravida, prolonged labor >24hrs, fetal distress' },
  { id: 'ref-003', patientId: 'pat-00012', patientName: 'Gatluak Ruot Nyuon', fromHospital: 'Malakal Teaching Hospital', fromHospitalId: 'hosp-003', toHospital: 'Juba Teaching Hospital', toHospitalId: 'hosp-001', referralDate: '2026-02-07', urgency: 'urgent', reason: 'Suspected TB meningitis, CT scan needed', department: 'Internal Medicine', status: 'seen', referringDoctor: 'Dr. James Wani Igga', notes: 'Altered consciousness, neck stiffness, chronic cough' },
  { id: 'ref-004', patientId: 'pat-00018', patientName: 'Rose Tombura Gbudue', fromHospital: 'Yambio State Hospital', fromHospitalId: 'hosp-008', toHospital: 'Juba Teaching Hospital', toHospitalId: 'hosp-001', referralDate: '2026-02-06', urgency: 'routine', reason: 'Orthopedic consultation for chronic knee pain', department: 'Orthopedics', status: 'completed', referringDoctor: 'Dr. TamamHealth Ladu Soro', notes: 'Bilateral knee osteoarthritis, failed conservative management' },
  { id: 'ref-005', patientId: 'pat-00022', patientName: 'Kuol Akot Ajith', fromHospital: 'Rumbek State Hospital', fromHospitalId: 'hosp-005', toHospital: 'Juba Teaching Hospital', toHospitalId: 'hosp-001', referralDate: '2026-02-08', urgency: 'urgent', reason: 'Sickle cell crisis with severe anemia', department: 'Internal Medicine', status: 'received', referringDoctor: 'CO Deng Mabior Kuol', notes: 'Hb 4.2 g/dL, severe bone pain, needs transfusion' },
  { id: 'ref-006', patientId: 'pat-00030', patientName: 'Achol Mayen Ring', fromHospital: 'Bor State Hospital', fromHospitalId: 'hosp-006', toHospital: 'Juba Teaching Hospital', toHospitalId: 'hosp-001', referralDate: '2026-02-09', urgency: 'emergency', reason: 'Severe burn injury >30% TBSA', department: 'Surgery', status: 'sent', referringDoctor: 'Dr. Nyamal Koang Jal', notes: 'Hot water burn, hemodynamically unstable' },
  { id: 'ref-007', patientId: 'pat-00035', patientName: 'Ladu Tombe Keji', fromHospital: 'Torit State Hospital', fromHospitalId: 'hosp-007', toHospital: 'Juba Teaching Hospital', toHospitalId: 'hosp-001', referralDate: '2026-02-05', urgency: 'routine', reason: 'Eye surgery - bilateral cataracts', department: 'Ophthalmology', status: 'completed', referringDoctor: 'CO Stella Keji Lemi', notes: 'Progressive visual impairment, mature cataracts bilateral' },
  { id: 'ref-008', patientId: 'pat-00040', patientName: 'Majok Chol Wol', fromHospital: 'Aweil State Hospital', fromHospitalId: 'hosp-009', toHospital: 'Wau State Hospital', toHospitalId: 'hosp-002', referralDate: '2026-02-07', urgency: 'urgent', reason: 'Surgical consultation - acute abdomen', department: 'Surgery', status: 'seen', referringDoctor: 'Dr. Rose Gbudue', notes: 'Suspected appendicitis, ultrasound needed' },
  // Outgoing referrals from Juba Teaching Hospital (hosp-001) — populate the
  // "Outgoing" tab for the default demo users and cover every status/urgency.
  { id: 'ref-009', patientId: 'pat-00002', patientName: 'Nyandeng Achol Bol', fromHospital: 'Juba Teaching Hospital', fromHospitalId: 'hosp-001', toHospital: 'Wau State Hospital', toHospitalId: 'hosp-002', referralDate: '2026-02-09', urgency: 'routine', reason: 'Physiotherapy after fracture fixation', department: 'Rehabilitation', status: 'sent', referringDoctor: 'Dr. James Wani Igga', notes: 'ORIF 6 weeks ago, for structured physiotherapy near home' },
  { id: 'ref-010', patientId: 'pat-00008', patientName: 'Simon Deng Akol', fromHospital: 'Juba Teaching Hospital', fromHospitalId: 'hosp-001', toHospital: 'Malakal Teaching Hospital', toHospitalId: 'hosp-003', referralDate: '2026-02-08', urgency: 'urgent', reason: 'Dialysis — acute kidney injury, not improving', department: 'Nephrology', status: 'received', referringDoctor: 'Dr. Achol Mayen Deng', notes: 'Creatinine rising, oliguric; needs renal replacement therapy' },
  { id: 'ref-011', patientId: 'pat-00015', patientName: 'Mary Aluel Deng', fromHospital: 'Juba Teaching Hospital', fromHospitalId: 'hosp-001', toHospital: 'Bor State Hospital', toHospitalId: 'hosp-006', referralDate: '2026-02-06', urgency: 'emergency', reason: 'Obstetric haemorrhage — closer to family/blood donors', department: 'Obstetrics & Gynecology', status: 'seen', referringDoctor: 'Dr. James Wani Igga', notes: 'Stabilised post-PPH, transferred for continued care' },
  { id: 'ref-012', patientId: 'pat-00021', patientName: 'Peter Lado Wani', fromHospital: 'Juba Teaching Hospital', fromHospitalId: 'hosp-001', toHospital: 'Yambio State Hospital', toHospitalId: 'hosp-008', referralDate: '2026-02-03', urgency: 'routine', reason: 'Follow-up of treated TB near residence', department: 'Internal Medicine', status: 'completed', referringDoctor: 'Dr. Achol Mayen Deng', notes: 'Completed intensive phase; continuation phase at local DOT site' },
  { id: 'ref-013', patientId: 'pat-00027', patientName: 'Rebecca Nyibol Gai', fromHospital: 'Juba Teaching Hospital', fromHospitalId: 'hosp-001', toHospital: 'Wau State Hospital', toHospitalId: 'hosp-002', referralDate: '2026-02-05', urgency: 'urgent', reason: 'Specialist ENT review', department: 'ENT', status: 'cancelled', referringDoctor: 'Dr. James Wani Igga', notes: 'Cancelled — patient opted to be seen at JTH ENT clinic instead' },
  { id: 'ref-014', patientId: 'pat-00033', patientName: 'John Garang Mawut', fromHospital: 'Torit State Hospital', fromHospitalId: 'hosp-007', toHospital: 'Juba Teaching Hospital', toHospitalId: 'hosp-001', referralDate: '2026-02-09', urgency: 'emergency', reason: 'Snakebite with coagulopathy — antivenom + ICU', department: 'Emergency', status: 'sent', referringDoctor: 'CO Emmanuel Lokeris', notes: 'Spitting cobra bite, bleeding gums; needs polyvalent antivenom' },
];

// Disease Surveillance
export interface DiseaseAlert {
  id: string;
  disease: string;
  state: string;
  county: string;
  cases: number;
  deaths: number;
  alertLevel: 'normal' | 'watch' | 'warning' | 'emergency';
  reportDate: string;
  trend: 'increasing' | 'stable' | 'decreasing';
}

// Weekly time-series so the surveillance / government "Weekly Disease Trends"
// line chart renders a real wavelike trend. Those charts bucket alerts by ISO
// week, so a single week of data would draw a flat (straight) line — this
// spreads each tracked disease across 8 recent weeks with a rise/dip pattern.
const WEEKLY_TREND_SERIES: { disease: string; state: string; county: string; cases: number[]; deaths: number[] }[] = [
  { disease: 'Malaria',               state: 'Jonglei',           county: 'Bor South', cases: [1200, 1450, 1100, 1600, 1300, 1750, 1400, 1900], deaths: [8, 11, 7, 14, 9, 16, 10, 18] },
  { disease: 'Cholera',               state: 'Upper Nile',        county: 'Malakal',   cases: [45, 89, 52, 102, 60, 130, 70, 95],              deaths: [4, 9, 5, 12, 6, 15, 7, 10] },
  { disease: 'Measles',               state: 'Unity',             county: 'Rubkona',   cases: [78, 110, 85, 156, 95, 180, 120, 140],           deaths: [2, 3, 2, 4, 3, 5, 3, 4] },
  { disease: 'Pneumonia',             state: 'Warrap',            county: 'Kuajok',    cases: [234, 289, 210, 301, 250, 330, 270, 360],        deaths: [5, 6, 4, 7, 5, 8, 6, 9] },
  { disease: 'Acute Watery Diarrhea', state: 'Central Equatoria', county: 'Juba',      cases: [567, 678, 512, 645, 590, 720, 600, 760],        deaths: [5, 7, 4, 6, 5, 9, 6, 10] },
];
const WEEKLY_TREND_DATES = ['2026-04-20', '2026-04-27', '2026-05-04', '2026-05-11', '2026-05-18', '2026-05-25', '2026-06-01', '2026-06-08'];
const weeklyTrendAlerts: DiseaseAlert[] = WEEKLY_TREND_SERIES.flatMap((d, di) =>
  WEEKLY_TREND_DATES.map((reportDate, wi): DiseaseAlert => {
    const cases = d.cases[wi];
    const prev = wi > 0 ? d.cases[wi - 1] : cases;
    return {
      id: `alert-wk-${di}-${wi}`,
      disease: d.disease,
      state: d.state,
      county: d.county,
      cases,
      deaths: d.deaths[wi],
      alertLevel: cases > prev * 1.3 ? 'warning' : 'watch',
      reportDate,
      trend: cases > prev ? 'increasing' : cases < prev ? 'decreasing' : 'stable',
    };
  })
);

export const diseaseAlerts: DiseaseAlert[] = [
  ...weeklyTrendAlerts,
  { id: 'alert-001', disease: 'Malaria', state: 'Jonglei', county: 'Bor South', cases: 342, deaths: 8, alertLevel: 'warning', reportDate: '2026-02-09', trend: 'increasing' },
  { id: 'alert-002', disease: 'Cholera', state: 'Upper Nile', county: 'Malakal', cases: 87, deaths: 12, alertLevel: 'emergency', reportDate: '2026-02-09', trend: 'increasing' },
  { id: 'alert-003', disease: 'Measles', state: 'Unity', county: 'Rubkona', cases: 156, deaths: 3, alertLevel: 'warning', reportDate: '2026-02-08', trend: 'stable' },
  { id: 'alert-004', disease: 'Acute Watery Diarrhea', state: 'Central Equatoria', county: 'Juba', cases: 234, deaths: 5, alertLevel: 'watch', reportDate: '2026-02-09', trend: 'decreasing' },
  { id: 'alert-005', disease: 'Meningitis', state: 'Northern Bahr el Ghazal', county: 'Aweil Centre', cases: 23, deaths: 4, alertLevel: 'watch', reportDate: '2026-02-07', trend: 'stable' },
  { id: 'alert-006', disease: 'Tuberculosis', state: 'Western Bahr el Ghazal', county: 'Wau', cases: 45, deaths: 2, alertLevel: 'watch', reportDate: '2026-02-08', trend: 'increasing' },
  { id: 'alert-007', disease: 'Kala-azar', state: 'Eastern Equatoria', county: 'Kapoeta East', cases: 18, deaths: 1, alertLevel: 'normal', reportDate: '2026-02-06', trend: 'stable' },
  { id: 'alert-008', disease: 'Hepatitis E', state: 'Lakes', county: 'Rumbek Centre', cases: 31, deaths: 0, alertLevel: 'watch', reportDate: '2026-02-07', trend: 'increasing' },
  // Fuller Cases-by-State coverage for Unity and Western Bahr el Ghazal —
  // previously Unity had only Measles and W. Bahr el Ghazal only TB, so their
  // bars were near-empty. Add the remaining tracked diseases (malaria, cholera,
  // tb, hiv) for both states.
  { id: 'alert-009', disease: 'Malaria', state: 'Unity', county: 'Rubkona', cases: 1980, deaths: 12, alertLevel: 'warning', reportDate: '2026-02-09', trend: 'increasing' },
  { id: 'alert-010', disease: 'Cholera', state: 'Unity', county: 'Leer', cases: 64, deaths: 7, alertLevel: 'warning', reportDate: '2026-02-08', trend: 'increasing' },
  { id: 'alert-011', disease: 'Tuberculosis', state: 'Unity', county: 'Mayom', cases: 73, deaths: 3, alertLevel: 'watch', reportDate: '2026-02-07', trend: 'stable' },
  { id: 'alert-012', disease: 'HIV/AIDS', state: 'Unity', county: 'Rubkona', cases: 512, deaths: 4, alertLevel: 'watch', reportDate: '2026-02-06', trend: 'stable' },
  { id: 'alert-013', disease: 'Malaria', state: 'Western Bahr el Ghazal', county: 'Wau', cases: 2240, deaths: 15, alertLevel: 'warning', reportDate: '2026-02-09', trend: 'increasing' },
  { id: 'alert-014', disease: 'Cholera', state: 'Western Bahr el Ghazal', county: 'Jur River', cases: 38, deaths: 3, alertLevel: 'watch', reportDate: '2026-02-08', trend: 'stable' },
  { id: 'alert-015', disease: 'Measles', state: 'Western Bahr el Ghazal', county: 'Wau', cases: 96, deaths: 2, alertLevel: 'warning', reportDate: '2026-02-07', trend: 'increasing' },
  { id: 'alert-016', disease: 'HIV/AIDS', state: 'Western Bahr el Ghazal', county: 'Wau', cases: 634, deaths: 5, alertLevel: 'watch', reportDate: '2026-02-06', trend: 'increasing' },
];

// (The old `weeklyDiseaseData` / `casesByState` chart mocks are gone: the
// surveillance page computes both live from disease-alert docs.)

// Common medications for prescription
// Medications are sourced from the bundled WHO EML formulary (single source of
// truth, ATC-coded) rather than hardcoded here.
export { medications } from '@/lib/data/formulary';
