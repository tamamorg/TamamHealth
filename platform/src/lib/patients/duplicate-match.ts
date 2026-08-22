/**
 * Possible-duplicate detection at the registration desk.
 *
 * The Settings screen has offered "Warn on possible duplicates — Matches name,
 * age, and locality" (`reg.duplicates`, default ON) for as long as the
 * registration form has existed. The form read the flag into a variable and
 * never used it, so the toggle did nothing in either position. This is the
 * check it was always describing.
 *
 * Why it matters more here than in most systems: a duplicate record splits one
 * person's history in two. The next clinician sees half an allergy list and
 * none of the prior results, and nothing on the screen says a second chart
 * exists. In a setting where the national ID is optional and most patients
 * carry no document at all, the desk has only the name, an age that is often a
 * guess, and where the person lives — which is precisely the three-way match
 * the setting names.
 *
 * ## Why fuzzy, and why only slightly
 *
 * Requiring an exact string match would find almost nothing. South Sudanese
 * names have no settled orthography — the same person is written Achol/Acol,
 * Nyandeng/Nyandeeng, Deng/Dheng depending on who holds the pen — and a desk
 * clerk transcribing by ear will not reproduce yesterday's spelling. So tokens
 * of four characters or more match within a single edit.
 *
 * The tolerance stops there on purpose. Widen it and short South Sudanese
 * names collide wholesale: at two edits "Deng" reaches "Deno", "Dang", "Peng"
 * and "Den", which are different people. A warning that fires on unrelated
 * patients is worse than none — the desk learns to click past it, and it is
 * still there when a real duplicate arrives.
 *
 * ## What is deliberately NOT done
 *
 * This never blocks a registration. A duplicate warning is a question for the
 * person who can see the patient, not an assertion: twins share a surname, an
 * age and a county, and a household can hold two people with one name. The
 * clerk is shown what matched and decides.
 */

import type { PatientDoc } from '@/lib/db-types';
import { patientAge, patientDisplayName } from '@/lib/patient-utils';

/** The fields of an in-progress registration this check needs. */
export interface DuplicateCandidate {
  firstName: string;
  middleName?: string;
  surname: string;
  dateOfBirth?: string;
  estimatedAge?: number;
  gender?: string;
  state?: string;
  county?: string;
}

/**
 * Why a record matched, as a code plus its value.
 *
 * Not a formatted sentence: this module is reached from a form that renders in
 * English and in Juba Arabic, and a string built here would arrive at an
 * Arabic-reading clerk in English. The caller translates.
 */
export type DuplicateReason =
  | { code: 'name-exact' }
  | { code: 'name-similar' }
  | { code: 'age-same'; years: number }
  | { code: 'age-near'; gap: number }
  | { code: 'same-county'; place: string }
  | { code: 'same-state'; place: string }
  | { code: 'hospital-number'; number: string };

export interface DuplicateMatch {
  patient: PatientDoc;
  /** The patient's name, ready to show. */
  name: string;
  /**
   * `strong` means every name token matched exactly, the ages agree to the
   * year, and the county is the same — the shape of the same person entered
   * twice. `possible` is a fuzzy or approximate hit and is much likelier to be
   * a relative. They are ordered but both are shown; the difference is only
   * how loudly to phrase it.
   */
  strength: 'strong' | 'possible';
  /** Why it matched, in the order a clerk would check them. */
  reasons: DuplicateReason[];
}

/** Ages this far apart are still treated as the same person. */
const AGE_TOLERANCE_YEARS = 2;
/** Below this length a token must match exactly — see the header. */
const FUZZY_MIN_LENGTH = 4;
/** More than this and the list stops being readable at a busy desk. */
const MAX_MATCHES = 5;

/** Lowercase, strip diacritics and punctuation, collapse whitespace. */
export function normalizeName(value: string | undefined): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    // An apostrophe sits INSIDE a name — D'eng, N'gor — so it is deleted, not
    // turned into a space. Treating it as a separator split "D'eng" into "d"
    // and "eng" and stopped it matching "Deng", which is the same name.
    // A hyphen genuinely joins two name parts, so it does become a space.
    .replace(/['\u2019`]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameTokens(...parts: (string | undefined)[]): string[] {
  return normalizeName(parts.filter(Boolean).join(' ')).split(' ').filter(Boolean);
}

/**
 * True when `a` and `b` are at most one insertion, deletion or substitution
 * apart. Written as a single forward pass rather than a Levenshtein matrix:
 * the answer is only ever needed as a yes/no at distance 1, and this runs over
 * every patient on the device.
 */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (long.length - short.length > 1) return false;

  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) { i += 1; j += 1; continue; }
    edits += 1;
    if (edits > 1) return false;
    // Equal lengths means a substitution: step both. Otherwise the extra
    // character is in `long`, so step only that one.
    if (short.length === long.length) { i += 1; j += 1; } else { j += 1; }
  }
  return true;
}

/** Does a token from one name appear in the other, allowing for spelling? */
function tokenMatches(token: string, against: string[]): 'exact' | 'near' | null {
  if (against.includes(token)) return 'exact';
  if (token.length < FUZZY_MIN_LENGTH) return null;
  for (const other of against) {
    if (other.length >= FUZZY_MIN_LENGTH && withinOneEdit(token, other)) return 'near';
  }
  return null;
}

/**
 * Find existing patients who might be the person being registered.
 *
 * All three axes must agree — name, age and locality. Any one of them alone
 * matches far too many people to be worth showing: a county holds tens of
 * thousands, an age holds thousands, and a common surname holds hundreds.
 */
export function findPossibleDuplicates(
  candidate: DuplicateCandidate,
  patients: PatientDoc[],
): DuplicateMatch[] {
  const first = nameTokens(candidate.firstName);
  const surname = nameTokens(candidate.surname);
  // Without both halves of a name there is nothing specific enough to match on.
  if (first.length === 0 || surname.length === 0) return [];

  const candidateAge = patientAge({
    estimatedAge: candidate.estimatedAge,
    dateOfBirth: candidate.dateOfBirth,
  });
  const candidateCounty = normalizeName(candidate.county);
  const candidateState = normalizeName(candidate.state);
  const candidateGender = normalizeName(candidate.gender);

  const matches: DuplicateMatch[] = [];

  for (const patient of patients) {
    // A different recorded sex is the one cheap signal that these are two
    // people, and it rules out enough same-name relatives to be worth the
    // first test. Missing on either side proves nothing, so it passes.
    const patientGender = normalizeName(patient.gender);
    if (candidateGender && patientGender && candidateGender !== patientGender) continue;

    const otherFirst = nameTokens(patient.firstName, patient.middleName);
    const otherSurname = nameTokens(patient.surname, patient.maidenName);
    if (otherFirst.length === 0 || otherSurname.length === 0) continue;

    const firstHit = first.map(t => tokenMatches(t, otherFirst)).find(Boolean) ?? null;
    if (!firstHit) continue;
    const surnameHit = surname.map(t => tokenMatches(t, otherSurname)).find(Boolean) ?? null;
    if (!surnameHit) continue;

    // Age. Unknown on either side is not a match — it is an absence, and
    // treating it as agreement would reduce this to a name-and-county check.
    const otherAge = patientAge(patient);
    if (candidateAge == null || otherAge == null) continue;
    const ageGap = Math.abs(candidateAge - otherAge);
    if (ageGap > AGE_TOLERANCE_YEARS) continue;

    // Locality. County is the meaningful unit; state is the fallback when one
    // of the two records never captured a county.
    const otherCounty = normalizeName(patient.county);
    const otherState = normalizeName(patient.state);
    const sameCounty = Boolean(candidateCounty) && candidateCounty === otherCounty;
    const sameState = Boolean(candidateState) && candidateState === otherState;
    if (!sameCounty && !(sameState && (!candidateCounty || !otherCounty))) continue;

    const exactName = firstHit === 'exact' && surnameHit === 'exact';
    const reasons: DuplicateReason[] = [
      exactName ? { code: 'name-exact' } : { code: 'name-similar' },
      ageGap === 0 ? { code: 'age-same', years: otherAge } : { code: 'age-near', gap: ageGap },
      sameCounty
        ? { code: 'same-county', place: patient.county }
        : { code: 'same-state', place: patient.state },
    ];
    if (patient.hospitalNumber) {
      reasons.push({ code: 'hospital-number', number: patient.hospitalNumber });
    }

    matches.push({
      patient,
      name: patientDisplayName(patient),
      strength: exactName && ageGap === 0 && sameCounty ? 'strong' : 'possible',
      reasons,
    });
  }

  // Strongest first, then most recently registered — a duplicate of someone
  // seen last week is likelier than one of a record from three years ago.
  matches.sort((a, b) => {
    if (a.strength !== b.strength) return a.strength === 'strong' ? -1 : 1;
    return (b.patient.createdAt ?? '').localeCompare(a.patient.createdAt ?? '');
  });
  return matches.slice(0, MAX_MATCHES);
}
