/**
 * Drug Interaction Checking Service
 *
 * Provides clinical decision support by checking for known dangerous
 * drug-drug interactions. Focused on medications commonly used in
 * South Sudanese hospitals.
 *
 * Interaction severity levels:
 * - CONTRAINDICATED: Must not be co-administered
 * - SERIOUS: May cause significant harm; consider alternatives
 * - MODERATE: Monitor closely; adjust dose if needed
 *
 * Based on WHO Essential Medicines interactions and BNF/BNFC guidelines.
 */
import { isNoAllergySentinel } from '../clinical-roles';

export type InteractionSeverity = 'contraindicated' | 'serious' | 'moderate';

export interface DrugInteraction {
  drug1: string;
  drug2: string;
  severity: InteractionSeverity;
  description: string;
  clinicalAdvice: string;
}

export interface InteractionCheckResult {
  hasInteractions: boolean;
  interactions: DrugInteraction[];
  highestSeverity: InteractionSeverity | null;
}

// Normalized drug name lookup (lowercase, trimmed)
function normalize(name: string): string {
  return name.toLowerCase().trim();
}

// The formulary and the rules below must spell a drug the same way or a rule
// never fires, so other names for it are folded into the rule's spelling here.
// Interactions only: allergy matching compares what was recorded, as recorded.
function interactionName(name: string): string {
  return normalize(name)
    .replace(/\bphenobarbitone\b/g, 'phenobarbital')
    .replace(/\biron\b/g, 'ferrous');
}

// Known drug interactions database
// This covers the most clinically significant interactions for medications
// commonly available in South Sudanese hospital pharmacies.
const INTERACTION_DATABASE: DrugInteraction[] = [
  // === CONTRAINDICATED ===
  {
    drug1: 'methotrexate',
    drug2: 'cotrimoxazole',
    severity: 'contraindicated',
    description: 'Cotrimoxazole increases methotrexate toxicity by reducing renal clearance.',
    clinicalAdvice: 'Do NOT co-prescribe. Use alternative antibiotic.',
  },
  {
    drug1: 'warfarin',
    drug2: 'metronidazole',
    severity: 'contraindicated',
    description: 'Metronidazole significantly increases warfarin anticoagulant effect, risking haemorrhage.',
    clinicalAdvice: 'Avoid combination. If essential, reduce warfarin dose by 30-50% and monitor INR daily.',
  },
  {
    drug1: 'artemether-lumefantrine',
    drug2: 'quinine',
    severity: 'contraindicated',
    description: 'Both prolong QT interval; combined use risks fatal cardiac arrhythmia.',
    clinicalAdvice: 'Never co-administer. Wait at least 12 hours after quinine before starting AL.',
  },
  {
    drug1: 'ciprofloxacin',
    drug2: 'tizanidine',
    severity: 'contraindicated',
    description: 'Ciprofloxacin inhibits CYP1A2, dramatically increasing tizanidine levels.',
    clinicalAdvice: 'Do NOT co-prescribe. Use alternative muscle relaxant.',
  },

  // === SERIOUS ===
  {
    drug1: 'gentamicin',
    drug2: 'furosemide',
    severity: 'serious',
    description: 'Combined ototoxicity and nephrotoxicity. Hearing loss may be irreversible.',
    clinicalAdvice: 'Monitor renal function and hearing. Avoid if possible; if essential, use lowest effective doses.',
  },
  {
    drug1: 'morphine',
    drug2: 'diazepam',
    severity: 'serious',
    description: 'Combined respiratory depression; risk of respiratory arrest especially in malnourished patients.',
    clinicalAdvice: 'Use with extreme caution. Reduce doses. Have naloxone and flumazenil available.',
  },
  {
    drug1: 'amlodipine',
    drug2: 'simvastatin',
    severity: 'serious',
    description: 'Amlodipine increases simvastatin levels, increasing risk of rhabdomyolysis.',
    clinicalAdvice: 'Limit simvastatin to 20mg daily when co-prescribed with amlodipine.',
  },
  {
    drug1: 'metformin',
    drug2: 'contrast dye',
    severity: 'serious',
    description: 'Risk of lactic acidosis with iodinated contrast media.',
    clinicalAdvice: 'Withhold metformin 48h before and after contrast administration. Check renal function.',
  },
  {
    drug1: 'insulin',
    drug2: 'ciprofloxacin',
    severity: 'serious',
    description: 'Fluoroquinolones can cause both hypo- and hyperglycaemia.',
    clinicalAdvice: 'Monitor blood glucose closely. Adjust insulin doses as needed.',
  },
  {
    drug1: 'isoniazid',
    drug2: 'rifampicin',
    severity: 'serious',
    description: 'Both are hepatotoxic. Combined use increases risk of drug-induced liver injury.',
    clinicalAdvice: 'Standard TB treatment — monitor LFTs baseline and monthly. Stop if ALT >5x ULN.',
  },
  {
    drug1: 'phenobarbital',
    drug2: 'artemether-lumefantrine',
    severity: 'serious',
    description: 'Phenobarbitone induces CYP3A4, reducing lumefantrine levels and antimalarial efficacy.',
    clinicalAdvice: 'Consider artesunate monotherapy or quinine for epileptic patients on phenobarbitone.',
  },
  {
    drug1: 'magnesium sulfate',
    drug2: 'gentamicin',
    severity: 'serious',
    description: 'Additive neuromuscular blockade; risk of respiratory paralysis.',
    clinicalAdvice: 'Avoid if possible. If co-administration required, monitor closely for respiratory depression.',
  },

  // === MODERATE ===
  {
    drug1: 'amoxicillin',
    drug2: 'warfarin',
    severity: 'moderate',
    description: 'Amoxicillin may enhance anticoagulant effect of warfarin.',
    clinicalAdvice: 'Monitor INR more frequently during antibiotic course.',
  },
  {
    drug1: 'ibuprofen',
    drug2: 'enalapril',
    severity: 'moderate',
    description: 'NSAIDs reduce antihypertensive effect and increase nephrotoxicity risk.',
    clinicalAdvice: 'Use paracetamol as alternative analgesic. If NSAID needed, monitor BP and renal function.',
  },
  {
    drug1: 'ciprofloxacin',
    drug2: 'ferrous',
    severity: 'moderate',
    description: 'Iron chelates ciprofloxacin, reducing its absorption and efficacy.',
    clinicalAdvice: 'Give ciprofloxacin 2 hours before or 6 hours after iron supplements.',
  },
  {
    drug1: 'doxycycline',
    drug2: 'ferrous',
    severity: 'moderate',
    description: 'Iron reduces doxycycline absorption.',
    clinicalAdvice: 'Separate doses by at least 2-3 hours.',
  },
  {
    drug1: 'metformin',
    drug2: 'enalapril',
    severity: 'moderate',
    description: 'ACE inhibitors may increase risk of hypoglycaemia.',
    clinicalAdvice: 'Monitor blood glucose, especially when starting or adjusting ACE inhibitor.',
  },
  {
    drug1: 'diclofenac',
    drug2: 'ciprofloxacin',
    severity: 'moderate',
    description: 'Increased risk of seizures with NSAID + fluoroquinolone combination.',
    clinicalAdvice: 'Use paracetamol instead if possible. Avoid in patients with seizure history.',
  },
  {
    drug1: 'oral rehydration salts',
    drug2: 'ciprofloxacin',
    severity: 'moderate',
    description: 'Minerals in ORS can chelate ciprofloxacin, reducing absorption.',
    clinicalAdvice: 'Give ciprofloxacin 2h before ORS or 2h after.',
  },
];

/**
 * Check for drug interactions between a list of medications.
 */
function findInteractions(pairs: [string, string][]): InteractionCheckResult {
  const found: DrugInteraction[] = [];

  for (const [med1, med2] of pairs) {
    for (const interaction of INTERACTION_DATABASE) {
      const d1 = normalize(interaction.drug1);
      const d2 = normalize(interaction.drug2);

      // Check both directions: (med1↔d1, med2↔d2) or (med1↔d2, med2↔d1)
      if (
        (med1.includes(d1) && med2.includes(d2)) ||
        (med1.includes(d2) && med2.includes(d1)) ||
        (d1.includes(med1) && d2.includes(med2)) ||
        (d1.includes(med2) && d2.includes(med1))
      ) {
        // Avoid duplicate entries
        const key = `${interaction.drug1}|${interaction.drug2}`;
        if (!found.some(f => `${f.drug1}|${f.drug2}` === key)) {
          found.push(interaction);
        }
      }
    }
  }

  // Sort by severity
  const severityOrder: Record<InteractionSeverity, number> = {
    contraindicated: 0,
    serious: 1,
    moderate: 2,
  };
  found.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return {
    hasInteractions: found.length > 0,
    interactions: found,
    highestSeverity: found.length > 0 ? found[0].severity : null,
  };
}

export function checkInteractions(medications: string[]): InteractionCheckResult {
  if (!medications || medications.length < 2) {
    return { hasInteractions: false, interactions: [], highestSeverity: null };
  }

  const normalized = medications.map(interactionName);
  const pairs: [string, string][] = [];
  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      pairs.push([normalized[i], normalized[j]]);
    }
  }
  return findInteractions(pairs);
}

/**
 * Check a new prescription against a patient's existing medications.
 * Returns only interactions between the new drug and a current one: a pair
 * already on the chart was answered when it was ordered, and asking again on
 * every later order for that patient teaches prescribers to ignore the stop.
 */
export function checkNewPrescription(
  newMedication: string,
  currentMedications: string[]
): InteractionCheckResult {
  const med = interactionName(newMedication);
  return findInteractions(currentMedications.map(current => [med, interactionName(current)]));
}

/**
 * Get all known interactions for a specific medication.
 */
export function getInteractionsForDrug(medication: string): DrugInteraction[] {
  const med = interactionName(medication);
  return INTERACTION_DATABASE.filter(i =>
    normalize(i.drug1).includes(med) || normalize(i.drug2).includes(med) ||
    med.includes(normalize(i.drug1)) || med.includes(normalize(i.drug2))
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Drug–allergy checking
// Maps a recorded allergy term to the drug names / class members it should
// flag. Both directions are substring-matched so "penicillin allergy" trips on
// "Amoxicillin 500mg" and a recorded "amoxicillin" allergy trips on the same.
// ─────────────────────────────────────────────────────────────────────────
const ALLERGY_CLASS_MEMBERS: Record<string, string[]> = {
  penicillin: ['penicillin', 'amoxicillin', 'ampicillin', 'flucloxacillin', 'cloxacillin', 'co-amoxiclav', 'amoxiclav', 'benzylpenicillin', 'piperacillin'],
  sulfa: ['cotrimoxazole', 'co-trimoxazole', 'sulfamethoxazole', 'sulfadoxine', 'sulfasalazine'],
  sulfonamide: ['cotrimoxazole', 'co-trimoxazole', 'sulfamethoxazole', 'sulfadoxine', 'sulfasalazine'],
  nsaid: ['ibuprofen', 'diclofenac', 'aspirin', 'naproxen', 'indomethacin'],
  aspirin: ['aspirin', 'acetylsalicylic'],
  cephalosporin: ['ceftriaxone', 'cefixime', 'cefuroxime', 'cephalexin', 'cefotaxime'],
  quinine: ['quinine', 'quinidine'],
  sulphonamide: ['cotrimoxazole', 'co-trimoxazole', 'sulfamethoxazole', 'sulfadoxine'],
};

export interface AllergyAlert {
  medication: string;
  allergy: string;
  /** Why it matched: direct name hit vs same drug-class member. */
  reason: 'direct' | 'class';
}

/** Criticality-aware allergy alert (P0.3) used by the structured check. */
export interface StructuredAllergyAlert extends AllergyAlert {
  criticality: 'mild' | 'moderate' | 'severe' | 'unknown';
  /** Free-text reaction recorded for the allergy, if any. */
  reaction?: string;
  /**
   * Severe-criticality matches set this. The prescribing UI should require an
   * explicit, reasoned override before proceeding rather than silently warning
   * — without hard-blocking, so emergency care is never gated (see consultation
   * page: alerts are advisory by design).
   */
  requiresOverride: boolean;
}

/** Minimal shape this module needs from a structured allergy entry. */
export interface AllergyLike {
  substance: string;
  criticality?: 'mild' | 'moderate' | 'severe' | 'unknown';
  reaction?: string;
  status?: string;
}

/** Returns the drug-name fragments an allergy term should flag. */
function allergyTargets(allergy: string): string[] {
  const a = normalize(allergy);
  const targets = new Set<string>([a]);
  for (const [klass, members] of Object.entries(ALLERGY_CLASS_MEMBERS)) {
    if (a.includes(klass) || members.some(m => a.includes(m))) {
      members.forEach(m => targets.add(m));
      targets.add(klass);
    }
  }
  return [...targets].filter(Boolean);
}

/**
 * The medicine as allergy matching should read it. "sulfa" sits inside
 * "sulfate", and a sulfate salt is not a sulfonamide: without this a sulfa
 * allergy flags zinc, ferrous and magnesium sulfate, and an unknown-severity
 * entry then stops eclampsia treatment for a written reason. An allergy that
 * names the sulfate itself still matches.
 */
function medicationForAllergy(medication: string, allergy: string): string {
  const med = normalize(medication);
  if (/sul(f|ph)ate/.test(normalize(allergy))) return med;
  return med.replace(/\bsul(f|ph)ates?\b/g, '').trim() || med;
}

const NO_ALLERGY_SENTINELS = ['none', 'nkda', 'no known', 'nil', 'n/a', 'na'];

/**
 * Cross-check a list of medications against a patient's recorded allergies.
 * Class-aware (penicillin allergy flags amoxicillin, etc.).
 */
export function checkAllergies(medications: string[], allergies: string[]): AllergyAlert[] {
  const alerts: AllergyAlert[] = [];
  const meds = (medications || []).filter(Boolean);
  const allgs = (allergies || [])
    .filter(Boolean)
    .filter(a => !NO_ALLERGY_SENTINELS.some(s => normalize(a) === s || normalize(a).startsWith(s)));
  for (const allergy of allgs) {
    const targets = allergyTargets(allergy);
    for (const med of meds) {
      const m = medicationForAllergy(med, allergy);
      const direct = m.includes(normalize(allergy)) || normalize(allergy).includes(m);
      const klass = targets.some(t => t.length >= 4 && m.includes(t));
      if (direct || klass) {
        alerts.push({ medication: med, allergy, reason: direct ? 'direct' : 'class' });
      }
    }
  }
  return alerts;
}

/**
 * Criticality-aware drug–allergy check (P0.3). Same class-aware matching as
 * {@link checkAllergies}, but driven by structured allergy entries so each
 * alert carries the recorded criticality and reaction, and severe matches are
 * flagged `requiresOverride` for the prescribing UI to escalate.
 *
 * Only `active` allergies are considered. Inactive / resolved / entered-in-error
 * entries are ignored.
 */
export function checkAllergiesStructured(
  medications: string[],
  allergies: AllergyLike[],
): StructuredAllergyAlert[] {
  const alerts: StructuredAllergyAlert[] = [];
  const meds = (medications || []).filter(Boolean);
  const allgs = (allergies || [])
    .filter((a) => a && a.substance && (a.status === undefined || a.status === 'active'))
    .filter((a) => !isNoAllergySentinel(a.substance));
  for (const allergy of allgs) {
    const targets = allergyTargets(allergy.substance);
    for (const med of meds) {
      const m = medicationForAllergy(med, allergy.substance);
      const direct = m.includes(normalize(allergy.substance)) || normalize(allergy.substance).includes(m);
      const klass = targets.some((t) => t.length >= 4 && m.includes(t));
      if (direct || klass) {
        const criticality = allergy.criticality ?? 'unknown';
        alerts.push({
          medication: med,
          allergy: allergy.substance,
          reason: direct ? 'direct' : 'class',
          criticality,
          reaction: allergy.reaction,
          // Fail-safe: a severe match clearly needs an override, but so does an
          // 'unknown'-criticality match (common for migrated/legacy allergies) —
          // we must not silently treat "we don't know" as safe. Only explicitly
          // mild/moderate matches stay advisory.
          requiresOverride: criticality === 'severe' || criticality === 'unknown',
        });
      }
    }
  }
  return alerts;
}

/** Dose/strength/form tokens to drop when keying a medication by its drug name. */
const DOSE_FORM_TOKENS = new Set([
  'mg', 'g', 'mcg', 'ug', 'ml', 'l', 'iu', 'u', 'meq', 'mmol', '%',
  'tab', 'tabs', 'tablet', 'tablets', 'cap', 'caps', 'capsule', 'capsules',
  'syrup', 'suspension', 'susp', 'solution', 'soln', 'drops', 'cream', 'ointment',
  'injection', 'inj', 'vial', 'amp', 'ampoule', 'sachet', 'suppository',
  'oral', 'iv', 'im', 'sc', 'po', 'pr', 'od', 'bd', 'tds', 'qds', 'prn', 'stat', 'x',
]);

/**
 * Key a medication on its full drug name, stripping dose/strength/form tokens.
 * Keeps multi-word/combination names intact ("artemether-lumefantrine"), so
 * "Amoxicillin 250mg" and "Amoxicillin 500mg" collide (same drug) while
 * "Artemether-Lumefantrine" and "Artemether" do NOT (different drugs).
 */
function drugNameKey(med: string): string {
  return normalize(med)
    .split(/[\s,]+/)
    .filter((tok) => tok && !/\d/.test(tok) && !DOSE_FORM_TOKENS.has(tok))
    .join(' ')
    .trim();
}

/**
 * Detect duplicate / therapeutic-overlap orders within a single medication
 * list (same drug ordered twice). Returns the duplicated drug display names.
 */
export function findDuplicateMedications(medications: string[]): string[] {
  const seen = new Map<string, string>();
  const dupes = new Set<string>();
  for (const med of (medications || []).filter(Boolean)) {
    const key = drugNameKey(med);
    if (!key) continue;
    if (seen.has(key)) dupes.add(seen.get(key)!);
    else seen.set(key, med);
  }
  return [...dupes];
}
