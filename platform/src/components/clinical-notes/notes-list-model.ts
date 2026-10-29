/**
 * Pure model behind the chart's Notes list and the mobile notes tab: turns
 * clinical notes, consultation records and legacy internal notes into one
 * list of rows, then filters it. No React, no I/O.
 *
 * Why records are merged in: seeded and older consultations were written as
 * MedicalRecordDocs (the Visits tab reads those); only notes made in the note
 * editor are ClinicalNoteDocs. Showing only the latter left the Notes tab
 * reading "no notes" beside a Visits tab full of consultations.
 */

import type { MedicalRecordDoc, PatientNoteDoc } from '@/lib/db-types';
import type { ClinicalNoteDoc, NoteStatus } from '@/lib/clinical-notes/types';
import { getNoteType } from '@/lib/clinical-notes/note-catalog';
import { notePreview } from '@/lib/clinical-notes/note-service';
import { localClockOf, localDayOf, toIsoDate } from '@/lib/date-utils';

export type NoteRowKind = 'clinical' | 'record' | 'legacy';

/** Type filter key: a note type id, or one of the two synthetic kinds. */
export const RECORD_TYPE_KEY = 'record_consultation';
export const LEGACY_TYPE_KEY = 'legacy_note';

export type StatusFilter = 'all' | 'unsigned' | 'signed' | 'awaiting_cosign' | 'amended';
export const STATUS_FILTERS: readonly StatusFilter[] = ['all', 'unsigned', 'signed', 'awaiting_cosign', 'amended'];

export interface NoteRow {
  key: string;
  id: string;
  kind: NoteRowKind;
  typeKey: string;
  /** English fallback label; the UI swaps in a translation for synthetic kinds. */
  typeLabel: string;
  preview: string;
  author: string;
  patientName: string;
  /** YYYY-MM-DD. */
  date: string;
  time?: string;
  /** True when date/time are the draft's last edit rather than its date of
   *  service. */
  edited?: boolean;
  status: NoteStatus;
  /** Full ISO-ish string used only for ordering. */
  sortKey: string;
}

/**
 * An unsigned draft is dated by its last edit: it is one note being worked on,
 * and the service stamp (fixed when it was started) made every reopen look like
 * a new note. Once signed, the date of service is the clinical fact.
 */
export function clinicalNoteToRow(n: ClinicalNoteDoc): NoteRow {
  const edit = n.status === 'draft' && n.updatedAt ? new Date(n.updatedAt) : null;
  const edited = Boolean(edit && !Number.isNaN(edit.getTime()));
  const date = edited ? toIsoDate(edit!) : n.serviceDate;
  const time = edited ? edit!.toTimeString().slice(0, 5) : n.serviceTime;
  return {
    key: `c:${n._id}`,
    id: n._id,
    kind: 'clinical',
    typeKey: n.noteType,
    typeLabel: getNoteType(n.noteType).label,
    preview: notePreview(n),
    author: n.signedByName || n.assignedToName || n.authorName || '',
    patientName: n.patientName,
    date,
    time,
    edited,
    status: n.status,
    sortKey: `${date || ''}T${time || '00:00'}`,
  };
}

function recordPreview(r: MedicalRecordDoc): string {
  const raw = [r.chiefComplaint, r.historyOfPresentIllness, r.treatmentPlan]
    .map(s => (s || '').replace(/\s+/g, ' ').trim())
    .find(Boolean);
  if (!raw) return 'No content yet';
  return raw.length > 120 ? `${raw.slice(0, 119)}…` : raw;
}

export function recordToRow(r: MedicalRecordDoc, patientName = ''): NoteRow {
  const stamp = r.consultedAt || r.startedAt || '';
  const date = r.visitDate || localDayOf(stamp) || localDayOf(r.createdAt);
  const time = localClockOf(stamp);
  return {
    key: `r:${r._id}`,
    id: r._id,
    kind: 'record',
    typeKey: RECORD_TYPE_KEY,
    typeLabel: 'Consultation (record)',
    preview: recordPreview(r),
    author: r.signedByName || r.providerName || '',
    patientName,
    date,
    time,
    status: r.documentStatus ?? 'draft',
    sortKey: stamp || `${date}T00:00`,
  };
}

export function legacyNoteToRow(n: PatientNoteDoc): NoteRow {
  const created = n.createdAt || '';
  return {
    key: `l:${n._id}`,
    id: n._id,
    kind: 'legacy',
    typeKey: LEGACY_TYPE_KEY,
    typeLabel: 'Internal note',
    preview: (n.body || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    author: n.authorName || '',
    patientName: '',
    date: localDayOf(created),
    time: localClockOf(created),
    status: 'signed',
    sortKey: created,
  };
}

/**
 * Clinical notes plus consultation records, newest first. A record is dropped
 * when a clinical note already documents the same encounter (the note editor
 * and the consultation flow can both write for one visit), and nursing vitals
 * snapshots are not narrative notes.
 */
export function mergeNoteRows(
  notes: readonly ClinicalNoteDoc[],
  records: readonly MedicalRecordDoc[] = [],
  legacy: readonly PatientNoteDoc[] = [],
  patientName = '',
): NoteRow[] {
  const covered = new Set(notes.map(n => n.encounterId).filter((x): x is string => Boolean(x)));
  const rows: NoteRow[] = notes.map(clinicalNoteToRow);
  for (const r of records) {
    if (r.recordKind === 'nursing_vitals') continue;
    if (r.correctsRecordId) continue;
    if (r.encounterId && covered.has(r.encounterId)) continue;
    rows.push(recordToRow(r, patientName));
  }
  for (const l of legacy) rows.push(legacyNoteToRow(l));
  return rows.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
}

export function matchesStatus(status: NoteStatus, filter: StatusFilter): boolean {
  switch (filter) {
    case 'all': return true;
    case 'unsigned': return status === 'draft';
    case 'signed': return status === 'signed';
    case 'awaiting_cosign': return status === 'awaiting_cosign';
    case 'amended': return status === 'amended';
  }
}

export interface NoteRowFilter {
  typeKey: string | 'all';
  status: StatusFilter;
  search: string;
  /** Resolves the label shown for a row's type (translated), for search. */
  labelOf?: (row: NoteRow) => string;
  statusLabelOf?: (status: NoteStatus) => string;
}

export function filterNoteRows(rows: readonly NoteRow[], f: NoteRowFilter): NoteRow[] {
  const q = f.search.trim().toLowerCase();
  const statusOf = (s: NoteStatus) => (f.statusLabelOf ? f.statusLabelOf(s) : s).toLowerCase();
  // A status typed in full filters to exactly that status, so "signed"
  // does not also pull in every "Unsigned" note by substring.
  const exactStatus = q !== '' && rows.some(r => statusOf(r.status) === q);
  return rows.filter(r => {
    if (f.typeKey !== 'all' && r.typeKey !== f.typeKey) return false;
    if (!matchesStatus(r.status, f.status)) return false;
    if (!q) return true;
    if (exactStatus) return statusOf(r.status) === q;
    return [
      f.labelOf ? f.labelOf(r) : r.typeLabel, r.preview, r.author, r.date, statusOf(r.status),
    ].some(s => s?.toLowerCase().includes(q));
  });
}

/** Per-status counts, computed after the type filter so chips agree with the table. */
export function statusCounts(rows: readonly NoteRow[], typeKey: string | 'all'): Record<StatusFilter, number> {
  const scoped = typeKey === 'all' ? rows : rows.filter(r => r.typeKey === typeKey);
  const out = { all: scoped.length, unsigned: 0, signed: 0, awaiting_cosign: 0, amended: 0 } as Record<StatusFilter, number>;
  for (const r of scoped) {
    if (r.status === 'draft') out.unsigned++;
    else if (r.status === 'signed') out.signed++;
    else if (r.status === 'awaiting_cosign') out.awaiting_cosign++;
    else if (r.status === 'amended') out.amended++;
  }
  return out;
}

/** Types present in the rows, in first-seen (newest-first) order, with counts. */
export function typeCounts(rows: readonly NoteRow[]): { typeKey: string; typeLabel: string; count: number }[] {
  const map = new Map<string, { typeKey: string; typeLabel: string; count: number }>();
  for (const r of rows) {
    const e = map.get(r.typeKey);
    if (e) e.count++;
    else map.set(r.typeKey, { typeKey: r.typeKey, typeLabel: r.typeLabel, count: 1 });
  }
  return [...map.values()];
}
