/**
 * ICD-11 diagnosis validation (KAN-49 / HIGH-18).
 *
 * `validateMedicalRecord()` never referenced the ICD-11 catalogue, so nothing
 * checked a coded diagnosis against the facility that recorded it. A boma-level
 * BHW could enter a definitive "Tuberculosis of lung" (minLevel: county) with
 * no signal at all.
 *
 * Everything here is ADVISORY except a malformed code. That is deliberate:
 *
 *   - A clinician at a boma who strongly suspects TB must still be able to
 *     record it. Blocking the entry would push the diagnosis out of the record
 *     and into someone's memory, which is worse for the patient and worse for
 *     surveillance. The warning tells them it needs confirmation upstream.
 *
 *   - The ticket also asked to BLOCK a `causeOfDeath` code on a living patient.
 *     That rule is not implemented as written, because `causeOfDeath: true` in
 *     this catalogue means "commonly used on a death certificate", not "only
 *     valid for the dead". 43 of the 93 codes carry it — including malaria
 *     (1A40), cholera (1A00), measles (1E30) and TB (1B10), which are the most
 *     frequently recorded LIVING diagnoses in South Sudan. Blocking them would
 *     make the app refuse the country's commonest diagnosis. It is surfaced as
 *     an informational note instead. See `causeOfDeathNotes`.
 */

import { COMMON_ICD11_CODES } from '../icd11-codes';
import type { ICD11CodeEntry } from '../icd11-codes';
import type { FacilityLevel } from '../db-types';

/**
 * Facility levels ordered least → most capable. `minLevel` on a code is the
 * lowest level that can *confirm* that diagnosis.
 */
const LEVEL_RANK: Record<FacilityLevel, number> = {
  boma: 0,
  payam: 1,
  county: 2,
  state: 3,
  national: 4,
};

/**
 * ICD-11 MMS stem codes: a letter or digit, then alphanumerics, optionally
 * dotted (e.g. '1A40', 'DA90', '1C62.Z', 'BA00.0'). Deliberately permissive —
 * the catalogue here is ~93 South Sudan-relevant codes, not the full ~17,000
 * entry MMS linearisation, so an unrecognised-but-well-formed code is a
 * catalogue gap rather than a data-entry error.
 */
const ICD11_CODE_PATTERN = /^[A-Z0-9][A-Z0-9]{1,3}(\.[A-Z0-9]{1,3})?$/i;

export function isWellFormedIcd11(code: string): boolean {
  return ICD11_CODE_PATTERN.test(code.trim());
}

const BY_CODE = new Map<string, ICD11CodeEntry>(
  COMMON_ICD11_CODES.map((c) => [c.code.toUpperCase(), c]),
);

/**
 * Free-text → notifiable-disease matching (surveillance safety net).
 *
 * A free-text "measles" with no ICD-11 code used to skip surveillance
 * entirely — only coded diagnoses raised disease alerts, so the commonest way
 * of writing a diagnosis was also the one the ministry never saw. This maps
 * an uncoded diagnosis name onto a notifiable catalogue entry so the alert
 * still fires (and the clinician is nudged to add the code).
 *
 * Matching is deliberately conservative: only *disease-name* terms count.
 * Symptom keywords the catalogue carries for search ("fever", "rash",
 * "cough"…) are excluded — free-text "fever" must not become a malaria case.
 */
const GENERIC_SYMPTOM_TERMS = new Set([
  'fever', 'chills', 'cough', 'rash', 'jaundice', 'headache',
  'diarrhea', 'watery diarrhea', 'bloody diarrhea', 'neck stiffness',
  'dog bite', 'vomiting', 'weakness', 'paralysis',
]);

/** The head of a title is its disease name: "Tuberculosis, extrapulmonary" → "tuberculosis". */
function titleHead(title: string): string {
  return title.toLowerCase().split(/,| due to | of /)[0].trim();
}

const NOTIFIABLE_NAME_INDEX: { entry: ICD11CodeEntry; terms: string[] }[] =
  COMMON_ICD11_CODES.filter((c) => c.notifiable).map((entry) => ({
    entry,
    terms: [
      entry.title.toLowerCase().trim(),
      titleHead(entry.title),
      ...(entry.keywords || []).map((k) => k.toLowerCase().trim()),
    ].filter((t) => t.length >= 2 && !GENERIC_SYMPTOM_TERMS.has(t)),
  }));

function containsWholePhrase(text: string, phrase: string): boolean {
  const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${esc}($|[^a-z0-9])`, 'i').test(text);
}

/**
 * Match an uncoded diagnosis name against the notifiable catalogue.
 * Preference order: exact title match, then an "unspecified" variant (the
 * honest bucket for an uncoded entry), then first catalogue match.
 */
export function matchNotifiableByName(name: string): ICD11CodeEntry | undefined {
  const text = name.toLowerCase().trim();
  if (!text) return undefined;
  const hits = NOTIFIABLE_NAME_INDEX.filter(({ terms }) =>
    terms.some((t) => containsWholePhrase(text, t)));
  if (hits.length === 0) return undefined;
  const exact = hits.find(({ entry }) => entry.title.toLowerCase().trim() === text);
  if (exact) return exact.entry;
  const unspecified = hits.find(({ entry }) => /unspecified/i.test(entry.title));
  return (unspecified || hits[0]).entry;
}

export function lookupIcd11(code: string): ICD11CodeEntry | undefined {
  return BY_CODE.get(code.trim().toUpperCase());
}

/** The subset of a Diagnosis this validator needs. */
export interface DiagnosisLike {
  name?: string;
  icd11Code?: string;
  icd10Code?: string;
  certainty?: 'confirmed' | 'suspected';
}

export interface DiagnosisValidationResult {
  /** Fatal problems — the caller should refuse the save. */
  errors: string[];
  /** Advisory findings — show them, but let the clinician proceed. */
  warnings: string[];
  /** Codes above the facility's confirmation level. */
  aboveFacilityLevel: string[];
  /** Codes commonly used for death certification (informational only). */
  causeOfDeathNotes: string[];
  /** Notifiable codes found — the caller raises disease alerts for these. */
  notifiableCodes: string[];
  /** Well-formed codes absent from COMMON_ICD11_CODES. */
  unknownCodes: string[];
  /**
   * Uncoded free-text diagnoses that name a notifiable disease. The caller
   * raises disease alerts for these too — a free-text "measles" must reach
   * surveillance even before anyone adds the code.
   */
  freeTextNotifiableMatches: { name: string; code: string; title: string }[];
}

/** Prefer the explicit ICD-11 field; fall back to the legacy compat field. */
function codeOf(d: DiagnosisLike): string {
  return (d.icd11Code || d.icd10Code || '').trim();
}

export interface ValidateDiagnosisOptions {
  /** Level of the recording facility. Omit to skip the level check. */
  facilityLevel?: FacilityLevel;
  /** Require at least one named diagnosis. Defaults to false. */
  requireDiagnosis?: boolean;
}

/**
 * Validate a consultation's diagnoses against the ICD-11 catalogue.
 * Pure — no I/O — so it runs identically in the browser, an API route, and tests.
 */
export function validateDiagnosisCodes(
  diagnoses: readonly DiagnosisLike[] | undefined,
  options: ValidateDiagnosisOptions = {},
): DiagnosisValidationResult {
  const { facilityLevel, requireDiagnosis = false } = options;
  const result: DiagnosisValidationResult = {
    errors: [],
    warnings: [],
    aboveFacilityLevel: [],
    causeOfDeathNotes: [],
    notifiableCodes: [],
    unknownCodes: [],
    freeTextNotifiableMatches: [],
  };

  const list = diagnoses ?? [];
  const named = list.filter((d) => (d.name || '').trim().length > 0);

  if (requireDiagnosis && named.length === 0) {
    result.errors.push('At least one diagnosis with a name is required to finalize the consultation.');
  }

  for (const d of list) {
    const name = (d.name || '').trim();
    const code = codeOf(d);

    // A row with a code but no name is a half-filled entry, not a diagnosis.
    if (code && !name) {
      result.errors.push(`Diagnosis ${code} has no name — remove the row or name the condition.`);
      continue;
    }
    if (!code) {
      // Free-text diagnosis. If it names a notifiable disease, surface the
      // match so surveillance still counts the case, and nudge for the code.
      const match = name ? matchNotifiableByName(name) : undefined;
      if (match) {
        result.freeTextNotifiableMatches.push({ name, code: match.code, title: match.title });
        result.warnings.push(
          `"${name}" looks like ${match.title} (${match.code}), a notifiable disease — add the ICD-11 code so the case is counted precisely; it has been reported to surveillance as ${match.title}.`,
        );
      }
      continue;
    }

    if (!isWellFormedIcd11(code)) {
      result.errors.push(`"${code}" is not a valid ICD-11 code format.`);
      continue;
    }

    const entry = lookupIcd11(code);
    if (!entry) {
      result.unknownCodes.push(code);
      result.warnings.push(
        `${code} (${name}) is not in the South Sudan ICD-11 reference list — it will not be counted in notifiable-disease surveillance.`,
      );
      continue;
    }

    if (entry.notifiable) result.notifiableCodes.push(entry.code);

    if (entry.causeOfDeath) {
      result.causeOfDeathNotes.push(entry.code);
    }

    // Confirmed diagnoses above the facility's level need onward referral. A
    // *suspected* one is exactly what a lower-level facility should be
    // recording, so it passes without comment.
    if (
      facilityLevel &&
      entry.minLevel &&
      d.certainty === 'confirmed' &&
      LEVEL_RANK[entry.minLevel] > LEVEL_RANK[facilityLevel]
    ) {
      result.aboveFacilityLevel.push(entry.code);
      result.warnings.push(
        `${entry.code} (${entry.title}) is normally confirmed at ${entry.minLevel} level or above, ` +
          `but this facility is ${facilityLevel}. Record it as suspected and refer for confirmation.`,
      );
    }
  }

  return result;
}

/**
 * Validate the `immediateICD11` cause on a death certificate. Stricter than the
 * clinical path: a cause of death feeds national mortality statistics, so a
 * malformed code is rejected outright rather than warned about.
 */
export function validateCauseOfDeathCode(code: string | undefined): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const trimmed = (code || '').trim();

  if (!trimmed) return { errors, warnings };

  if (!isWellFormedIcd11(trimmed)) {
    errors.push(`Immediate cause of death "${trimmed}" is not a valid ICD-11 code format.`);
    return { errors, warnings };
  }

  const entry = lookupIcd11(trimmed);
  if (!entry) {
    warnings.push(
      `Cause of death ${trimmed} is not in the South Sudan ICD-11 reference list — confirm it before the certificate is registered.`,
    );
  } else if (!entry.causeOfDeath) {
    warnings.push(
      `${entry.code} (${entry.title}) is not normally used for cause-of-death certification — confirm this is the underlying cause.`,
    );
  }

  return { errors, warnings };
}
