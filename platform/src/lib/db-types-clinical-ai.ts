/**
 * AI Clinical Decision Support types.
 */
import type { FacilityLevel } from './db-types';

export interface AIDiagnosisSuggestion {
  icd10Code: string;
  icd11Code?: string;           // ICD-11 code (WHO standard)
  name: string;
  confidence: number;           // 0-100
  reasoning: string;
  severity: 'mild' | 'moderate' | 'severe';
  suggestedTreatment?: string;
  diagnosisLevel?: FacilityLevel;  // Level at which this diagnosis was made
  diagnosisType?: 'suspected' | 'clinical' | 'definitive' | 'confirmed';
  confirmedBy?: string;            // "RDT", "microscopy", "clinical only", etc.
}

export interface AIEvaluation {
  suggestedDiagnoses: AIDiagnosisSuggestion[];
  vitalSignAlerts: string[];
  recommendedTests: string[];
  severityAssessment: string;
  clinicalNotes: string;
  evaluatedAt: string;
}
