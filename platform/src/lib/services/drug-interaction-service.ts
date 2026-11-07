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
import { INTERACTION_DATABASE } from '../data/drug-interactions';

export type InteractionSeverity = 'contraindicated' | 'serious' | 'moderate';

export interface DrugInteraction {
  drug1: string;
  drug2: string;
  severity: InteractionSeverity;
  /**
   * Where the rule comes from. US prescribing labels are the standard: a pair
   * a label lists under Contraindications is `contraindicated`, one it says to
   * avoid or not recommend is `serious`, one it says to monitor is `moderate`.
   * `other` marks a rule no US label states, kept from WHO and national
   * guidance because the medicine has no US label or the label is silent.
   */
  source: 'us-label' | 'other';
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
// Eye, ear and skin preparations reach the blood in amounts too small for the
// systemic interactions below, which the US labels describe for tablets and
// injections. Without this, ciprofloxacin eye drops raised a QT warning.
const LOCAL_PREPARATION = /\b(eye|ear)\b|\bdrops\b|ointment|\bcream\b|topical|pessary|mouthwash|lotion|\(skin\)|cord care/i;

function interactionName(name: string): string {
  if (LOCAL_PREPARATION.test(name)) return '';
  return normalize(name)
    .replace(/\bphenobarbitone\b/g, 'phenobarbital')
    .replace(/\biron\b/g, 'ferrous')
    .replace(/\bsulphate\b/g, 'sulfate')
    .replace(/\b(co-trimoxazole|septrin|bactrim|sulfamethoxazole[-/ +]+trimethoprim|trimethoprim[-/ +]+sulfamethoxazole)\b/g, 'cotrimoxazole')
    .replace(/\b(coartem|artemether[-/ +]+lumefantrine)\b/g, 'artemether-lumefantrine')
    .replace(/\b(co-amoxiclav|augmentin)\b/g, 'amoxicillin');
}

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

  const normalized = medications.map(interactionName).filter(Boolean);
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
  if (!med) return findInteractions([]);
  return findInteractions(
    currentMedications.map(interactionName).filter(Boolean).map(current => [med, current]),
  );
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
const SULFONAMIDES = ['cotrimoxazole', 'co-trimoxazole', 'septrin', 'bactrim', 'sulfamethoxazole', 'sulphamethoxazole', 'sulfadoxine', 'sulphadoxine', 'sulfasalazine', 'sulfadiazine', 'sulphadiazine'];

const ALLERGY_CLASS_MEMBERS: Record<string, string[]> = {
  penicillin: ['penicillin', 'amoxicillin', 'ampicillin', 'flucloxacillin', 'cloxacillin', 'co-amoxiclav', 'amoxiclav', 'benzylpenicillin', 'piperacillin', 'augmentin', 'tazocin', 'benzathine', 'phenoxymethylpenicillin'],
  sulfa: SULFONAMIDES,
  sulpha: SULFONAMIDES,
  sulfonamide: SULFONAMIDES,
  nsaid: ['ibuprofen', 'diclofenac', 'aspirin', 'naproxen', 'indomethacin', 'ketorolac', 'mefenamic', 'piroxicam', 'meloxicam', 'ketoprofen', 'celecoxib'],
  aspirin: ['aspirin', 'acetylsalicylic'],
  cephalosporin: ['ceftriaxone', 'cefixime', 'cefuroxime', 'cephalexin', 'cefalexin', 'cefotaxime', 'cefazolin', 'ceftazidime', 'cefpodoxime', 'cefaclor', 'cefepime'],
  // The mefloquine and quinine US labels each list hypersensitivity to the other.
  quinine: ['quinine', 'quinidine', 'mefloquine'],
  sulphonamide: SULFONAMIDES,
  aminoglycoside: ['gentamicin', 'amikacin', 'kanamycin', 'streptomycin', 'paromomycin', 'tobramycin'],
  fluoroquinolone: ['ciprofloxacin', 'levofloxacin', 'moxifloxacin'],
  macrolide: ['azithromycin', 'erythromycin'],
  tetracycline: ['tetracycline', 'doxycycline', 'oxytetracycline'],
  'ace inhibitor': ['enalapril', 'lisinopril', 'captopril'],
  'local anaesthetic': ['lidocaine', 'lignocaine', 'bupivacaine', 'tetracaine'],
  iodine: ['iodine', 'iohexol', 'amidotrizoate', 'contrast dye', 'contrast medium'],
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

/**
 * Cross-check a list of medications against a patient's recorded allergies.
 * Class-aware (penicillin allergy flags amoxicillin, etc.).
 */
export function checkAllergies(medications: string[], allergies: string[]): AllergyAlert[] {
  const alerts: AllergyAlert[] = [];
  const meds = (medications || []).filter(m => m?.trim());
  const allgs = (allergies || [])
    .filter(Boolean)
    .filter(a => !isNoAllergySentinel(a));
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
  const meds = (medications || []).filter(m => m?.trim());
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
