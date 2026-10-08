/**
 * The patient's standing history: what the domains are, what a clinician picks
 * from, and how an entry reads as one line.
 *
 * Pure data and pure functions — no database, no React — so the chart's History
 * tab, the note's history sections and the tests all read the same wording. A
 * history line that reads one way on the chart and another way inside a signed
 * note is two records of one fact.
 */

import type { HistoryDomain, HistoryEntryDoc, ProblemDoc, ProcedureDoc } from '../db-types';

export interface HistoryDomainDef {
  id: HistoryDomain;
}

/**
 * In the order a history is taken, which is the order the tab shows them.
 * Screens read their wording from the locale files (`history.domain.<id>`).
 */
export const HISTORY_DOMAINS: readonly HistoryDomainDef[] = [
  { id: 'medical' },
  { id: 'surgical' },
  { id: 'family' },
  { id: 'social' },
];

export function isHistoryDomain(value: unknown): value is HistoryDomain {
  return typeof value === 'string' && HISTORY_DOMAINS.some(d => d.id === value);
}

export interface SocialFactorDef {
  id: string;
  /**
   * The English name stored as the entry's `title`, and so what a note's
   * snapshot reads ("Tobacco: Never smoked"). Stored content is English, like
   * every other chart snapshot; the form's own labels are translated.
   */
  label: string;
  /** Common answers, offered as one-tap choices. Free text is always allowed. */
  options?: readonly string[];
}

/**
 * The social factors a history asks about. Each is a single current answer —
 * a patient has one smoking status — so recording a factor again replaces the
 * line already there (see `existingSocialEntry`). 'other' is the exception: it
 * holds anything this list does not name, and there can be several.
 */
export const SOCIAL_FACTORS: readonly SocialFactorDef[] = [
  { id: 'tobacco', label: 'Tobacco', options: ['Never smoked', 'Former smoker', 'Current smoker'] },
  { id: 'alcohol', label: 'Alcohol', options: ['None', 'Occasional', 'Regular'] },
  { id: 'substances', label: 'Other substances', options: ['None'] },
  { id: 'occupation', label: 'Occupation' },
  { id: 'living', label: 'Living situation' },
  { id: 'other', label: 'Other' },
];

export const OTHER_SOCIAL_FACTOR = 'other';

export function getSocialFactor(id?: string): SocialFactorDef | undefined {
  return SOCIAL_FACTORS.find(f => f.id === id);
}

/** Offered as suggestions; the field takes any text ("Paternal aunt"). */
export const FAMILY_RELATIONS: readonly string[] = [
  'Mother', 'Father', 'Sister', 'Brother', 'Daughter', 'Son',
  'Maternal grandmother', 'Maternal grandfather',
  'Paternal grandmother', 'Paternal grandfather',
  'Other relative',
];

/** Entries a reader should see: withdrawn mistakes are kept, not shown. */
export function activeHistory(entries: readonly HistoryEntryDoc[]): HistoryEntryDoc[] {
  return entries.filter(e => e.status !== 'entered_in_error');
}

export function historyForDomain(
  entries: readonly HistoryEntryDoc[],
  domain: HistoryDomain,
): HistoryEntryDoc[] {
  const rows = activeHistory(entries).filter(e => e.domain === domain);
  if (domain !== 'social') return rows;
  // Social history reads in the order it is asked, not the order it was typed.
  const rank = (e: HistoryEntryDoc) => {
    const index = SOCIAL_FACTORS.findIndex(f => f.id === e.factor);
    return index === -1 ? SOCIAL_FACTORS.length : index;
  };
  return [...rows].sort((a, b) => rank(a) - rank(b));
}

/**
 * The line already holding a single-answer social factor, if there is one.
 * Saving that factor again updates this entry instead of adding a second,
 * contradictory smoking status beside the first.
 */
export function existingSocialEntry(
  entries: readonly HistoryEntryDoc[],
  factor: string | undefined,
): HistoryEntryDoc | undefined {
  if (!factor || factor === OTHER_SOCIAL_FACTOR) return undefined;
  return activeHistory(entries).find(e => e.domain === 'social' && e.factor === factor);
}

/**
 * One entry as one line.
 *
 * Social history is written "Label: answer" because that is how it is read
 * aloud and because the referral summary splits on that colon; family history
 * leads with the relative for the same reason. Everything optional is left out
 * rather than rendered as a dash — a line is a statement, not a form.
 */
export function formatHistoryEntry(entry: Pick<HistoryEntryDoc,
  'domain' | 'title' | 'relation' | 'when' | 'facility' | 'detail'>): string {
  const title = (entry.title || '').trim();
  const when = (entry.when || '').trim();
  const detail = (entry.detail || '').trim();

  if (entry.domain === 'social') {
    return detail ? `${title}: ${detail}` : title;
  }

  const head = when ? `${title} (${when})` : title;
  const tail: string[] = [];
  if (entry.domain === 'surgical' && entry.facility?.trim()) tail.push(entry.facility.trim());
  if (detail) tail.push(detail);
  const body = [head, ...tail].join(' — ');

  if (entry.domain === 'family' && entry.relation?.trim()) {
    return `${entry.relation.trim()}: ${body}`;
  }
  return body;
}

function bullets(lines: string[]): string {
  return lines.filter(Boolean).map(line => `• ${line}`).join('\n');
}

/** A domain's entries as a bulleted block, or '' when there are none. */
export function formatHistoryDomain(
  entries: readonly HistoryEntryDoc[],
  domain: HistoryDomain,
): string {
  return bullets(historyForDomain(entries, domain).map(formatHistoryEntry));
}

/** Statuses that mean the operation actually happened. */
const PERFORMED_PROCEDURE_STATUSES = new Set(['completed', 'in_observation', 'released', 'complication', 'ae_reported']);

/**
 * Procedures on the chart that are history rather than work in hand. A
 * procedure with no status predates the lifecycle and is a record of something
 * already done (the same rule `isProcedureSettled` applies); one merely ordered
 * or consented has not happened and is not anybody's surgical history yet.
 */
export function performedProcedures(procedures: readonly ProcedureDoc[]): ProcedureDoc[] {
  return procedures.filter(p =>
    p.recordStatus !== 'entered_in_error'
    && (!p.status || PERFORMED_PROCEDURE_STATUSES.has(p.status)));
}

export interface PastHistoryInput {
  entries: readonly HistoryEntryDoc[];
  problems?: readonly ProblemDoc[];
  procedures?: readonly ProcedureDoc[];
}

/**
 * "Past Medical History" as a note carries it: the problem list, then the
 * medical history entries, then operations — the patient's own surgical history
 * followed by procedures done here.
 *
 * The problem list is read, not copied, so a diagnosis is still recorded in
 * exactly one place. Inactive problems are left out (set aside as not
 * relevant); resolved ones stay, because an illness the patient has recovered
 * from is precisely what past medical history is.
 */
export function formatPastHistory({ entries, problems = [], procedures = [] }: PastHistoryInput): string {
  const lines: string[] = [];

  for (const p of problems) {
    if (p.status === 'inactive') continue;
    const code = p.icd11Code ? ` [${p.icd11Code}]` : '';
    const state = p.status === 'resolved'
      ? ` — resolved${p.resolvedDate ? ` ${p.resolvedDate}` : ''}`
      : p.status === 'chronic' ? ' — chronic' : '';
    const since = p.onsetDate && p.status !== 'resolved' ? ` (since ${p.onsetDate})` : '';
    lines.push(`${p.name}${code}${since}${state}`);
  }

  for (const e of historyForDomain(entries, 'medical')) lines.push(formatHistoryEntry(e));
  for (const e of historyForDomain(entries, 'surgical')) lines.push(`Surgical: ${formatHistoryEntry(e)}`);
  for (const p of performedProcedures(procedures)) {
    lines.push(`Surgical: ${p.name}${p.date ? ` (${p.date})` : ''}${p.hospitalName ? ` — ${p.hospitalName}` : ''}`);
  }

  return bullets(lines);
}
