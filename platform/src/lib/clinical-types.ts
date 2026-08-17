/**
 * Clinical domain types & South Sudan reference data — canonical import path.
 *
 * The type definitions still live in `src/data/mock.ts` for a historical
 * reason: that module doubles as the deterministic demo-roster generator, and
 * its PRNG draw order is version-locked (see SEED_VERSION in lib/db.ts), so
 * physically relocating the interleaved declarations is riskier than it is
 * worth. Type-only re-exports cost nothing at runtime; the reference lists,
 * which do, are sourced from leaf modules that never pull the generator in.
 * This module is the *name* that tells the truth: import clinical types and
 * reference lists from here, not from a path that says "mock".
 *
 * Nothing exported here is mock data: these are the base shapes the `*Doc`
 * PouchDB types in db-types.ts extend (MedicalRecord → MedicalRecordDoc,
 * DiseaseAlert → DiseaseAlertDoc, …) plus real reference lists (states and
 * counties, languages, tribes, the WHO EML formulary).
 */

// ── Base clinical shapes (extended by the *Doc types in db-types.ts) ──
export type {
  Hospital,
  CareTeamMember,
  Patient,
  Attachment,
  TransferPackage,
  VitalSigns,
  Diagnosis,
  Prescription,
  LabResult,
  ROSStatus,
  ReviewOfSystemEntry,
  PastMedicalHistory,
  SocialHistory,
  DrugHistory,
  MedicalRecord,
  ReferralDisposition,
  ReferralOutcome,
  Referral,
  DiseaseAlert,
} from '@/data/mock';

// ── Patient-clinical entry types (allergies, directives, care alerts) ──
export type {
  AllergyEntry,
  DirectiveType,
  DirectiveEntry,
  CareAlertCategory,
  CareAlertEntry,
  ScreeningEntry,
} from '@/lib/types/patient-clinical';

// ── Reference data (real, not mock) ──
export { statesAndCounties, states, tribes, languages, bloodTypes } from '@/lib/data/south-sudan-reference';
export { medications } from '@/lib/data/formulary';
