/**
 * Reason for test — what the order is trying to find out.
 *
 * A lab order is usually placed BEFORE there is a diagnosis: the result is
 * what makes the diagnosis. So the requisition asks for a reason, and a
 * symptom, a suspected condition, or "screening, no complaint" are all
 * complete answers. This module is where those answers come from — the picker
 * just renders whatever it returns.
 *
 * Every reason is still a coded indication (ICD-11), so the bench, the printed
 * requisition and a payer read exactly what they did before.
 */

import { COMMON_ICD11_CODES } from '@/lib/icd11-codes';
import type { CodedOption } from '@/components/CodedSearchField';
import type { OrderIndication } from './lab-order-types';

const SYMPTOM_CHAPTER = 'Symptoms & signs';

/** What a patient walks in with, ahead of what an examination finds. */
const COMPLAINTS_FIRST = ['MG26', 'MD12', 'MB4D', 'MD81.4', 'MG22', 'MD11.5', 'MC16', 'MG29', 'MG45'];

const toReason = ({ code, title }: OrderIndication): OrderIndication => ({ code, title });

/** ICD-11 chapter 21, presenting complaints first. */
export const SYMPTOM_REASONS: OrderIndication[] = (() => {
  const rank = (code: string) => {
    const i = COMPLAINTS_FIRST.indexOf(code);
    return i === -1 ? COMPLAINTS_FIRST.length : i;
  };
  return COMMON_ICD11_CODES
    .filter(entry => entry.chapter === SYMPTOM_CHAPTER)
    .sort((a, b) => rank(a.code) - rank(b.code))
    .map(toReason);
})();

/**
 * Reasons that are neither a symptom nor a disease: the patient is well and
 * the test is a screen, or it checks on treatment already given. ICD-11
 * chapter 24 (factors influencing health status or contact with health
 * services), verified against the WHO ICD-11 MMS listing (via findacode.com),
 * not inferred.
 */
export const NO_SYMPTOM_REASONS: (OrderIndication & { keywords: string[] })[] = [
  {
    code: 'QA00',
    title: 'General examination or investigation of persons without complaint or reported diagnosis',
    keywords: ['routine', 'check-up', 'checkup', 'medical examination', 'no complaint', 'well'],
  },
  {
    code: 'QA08',
    title: 'Special screening examination for infectious diseases',
    keywords: ['screening', 'screen'],
  },
  {
    code: 'QA08.4',
    title: 'Special screening examination for human immunodeficiency virus',
    keywords: ['hiv screening', 'hiv test', 'screening', 'vct', 'pitc'],
  },
  {
    code: 'QA07',
    title: 'Follow-up examination after treatment for conditions other than malignant neoplasms',
    keywords: ['follow-up', 'follow up', 'monitoring', 'test of cure', 'repeat', 'review'],
  },
];

/**
 * Conditions a clinician may suspect before any result exists. Offered last
 * and labelled as suspected, so picking one never reads as a confirmed
 * diagnosis.
 */
export const SUSPECTED_REASONS: OrderIndication[] = COMMON_ICD11_CODES
  .filter(entry => entry.notifiable || entry.causeOfDeath)
  .map(toReason);

/** Everything the search box can find: the clinical list plus the no-symptom reasons. */
export const REASON_SEARCH_OPTIONS: CodedOption[] = [
  ...COMMON_ICD11_CODES.map(entry => ({ code: entry.code, name: entry.title, meta: entry.chapter, keywords: entry.keywords })),
  ...NO_SYMPTOM_REASONS.map(reason => ({ code: reason.code, name: reason.title, meta: 'Screening & follow-up', keywords: reason.keywords })),
];

const NEGATION = /\b(no|not|nil|never|denies|denied|without|negative|absent)\b/;
const CLAUSE_BREAK = /[.,;:!?\n]/;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Where `term` is first mentioned without being negated in its own clause
 * ("no cough, fever for 3 days" affirms the fever, not the cough). -1 if never.
 */
function firstAffirmedMention(haystack: string, term: string): number {
  // Leading boundary only, so "cough" also finds "coughing" and "headache"
  // finds "headaches".
  const pattern = new RegExp(`\\b${escapeRegExp(term)}`, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(haystack))) {
    let clauseStart = match.index;
    while (clauseStart > 0 && !CLAUSE_BREAK.test(haystack[clauseStart - 1])) clauseStart--;
    if (!NEGATION.test(haystack.slice(clauseStart, match.index))) return match.index;
  }
  return -1;
}

/**
 * Symptom codes named in free text — a chief complaint, an HPI line — in the
 * order they are mentioned.
 *
 * Only symptoms are suggested: "fever" in a complaint is a fever, and offering
 * "Malaria due to Plasmodium falciparum" because its keyword list mentions
 * fever would put the conclusion on the order before the test has run. The
 * match is by keyword, so callers offer these un-ticked for the clinician to
 * confirm.
 */
export function suggestReasonsFromText(text: string | undefined, limit = 6): OrderIndication[] {
  const haystack = (text || '').toLowerCase();
  if (!haystack.trim()) return [];
  const hits: { reason: OrderIndication; at: number }[] = [];
  for (const entry of COMMON_ICD11_CODES) {
    if (entry.chapter !== SYMPTOM_CHAPTER) continue;
    const terms = [entry.title, ...(entry.keywords || [])]
      .map(term => term.toLowerCase())
      .filter(term => term.length >= 3);
    let first = -1;
    for (const term of terms) {
      const at = firstAffirmedMention(haystack, term);
      if (at !== -1 && (first === -1 || at < first)) first = at;
    }
    if (first !== -1) hits.push({ reason: toReason(entry), at: first });
  }
  return hits.sort((a, b) => a.at - b.at).slice(0, limit).map(hit => hit.reason);
}

/**
 * The chart's active problems, matched back to ICD titles so a tick adds a
 * properly coded indication rather than a free-text string.
 */
export function problemListReasons(conditions: string[] | undefined): OrderIndication[] {
  const seen = new Set<string>();
  const out: OrderIndication[] = [];
  for (const condition of conditions || []) {
    const needle = condition.trim().toLowerCase();
    if (!needle) continue;
    const hit = COMMON_ICD11_CODES.find(
      entry => entry.title.toLowerCase() === needle
        || entry.title.toLowerCase().includes(needle)
        || (entry.keywords || []).some(keyword => keyword.toLowerCase() === needle),
    );
    if (!hit || seen.has(hit.code)) continue;
    seen.add(hit.code);
    out.push(toReason(hit));
  }
  return out;
}

/**
 * The slice of a clinical note the order flow reads. Structural on purpose, so
 * this module never has to import the note model.
 */
export interface NoteReasonSource {
  sections: {
    sectionId: string;
    text?: string;
    diagnoses?: { name: string; icd11Code?: string }[];
  }[];
}

/** What an order opened from somewhere already knows about why it is placed. */
export interface LabOrderReasonContext {
  /** Coded reasons to put on the order up front; the clinician can remove any. */
  indications: OrderIndication[];
  /** Complaint text the symptom suggestions are drawn from. */
  complaintText: string;
}

const COMPLAINT_SECTIONS = ['cc', 'hpi', 'subjective'];

/**
 * An order raised from a note starts with what the note already says: the
 * coded working diagnoses from the Assessment go straight on the order, and
 * the complaint narrative feeds the symptom suggestions — so the clinician
 * confirms a reason instead of re-entering one.
 */
export function reasonContextFromNote(note: NoteReasonSource): LabOrderReasonContext {
  const seen = new Set<string>();
  const indications: OrderIndication[] = [];
  for (const section of note.sections) {
    if (section.sectionId !== 'assessment') continue;
    for (const diagnosis of section.diagnoses || []) {
      // A line written without a code still counts when its name is a title
      // the ICD list knows; anything else cannot be coded and is left out.
      const name = (diagnosis.name || '').trim();
      const code = diagnosis.icd11Code?.trim().toUpperCase()
        || (name && COMMON_ICD11_CODES.find(entry => entry.title.toLowerCase() === name.toLowerCase())?.code);
      if (!code || seen.has(code)) continue;
      seen.add(code);
      indications.push({ code, title: name || code });
    }
  }
  const complaintText = COMPLAINT_SECTIONS
    .map(id => note.sections.find(section => section.sectionId === id)?.text?.trim())
    .filter(Boolean)
    .join('. ');
  return { indications, complaintText };
}
