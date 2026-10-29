'use client';

/**
 * Notes list — the chart's Notes view, wearing the same ChartSection chrome
 * as every other chart tab: title, search bar, and a right-aligned create
 * action. In the chart, Create note opens the Consultation form straight in
 * the slider (`onCreate`); the form's own type picker changes the type.
 *
 * Sorting is fixed to date of service: a chart is read chronologically by
 * encounter, and "when did I see this patient" is the question the list
 * answers. There are no filter chips or dropdowns — the search box covers
 * type, status ("unsigned", "signed", …), author, date and note text in
 * one control.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useColumnSort } from '@/components/table/useColumnSort';
import { useRouter } from 'next/navigation';
import { FileText } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import ChartSection, { OmrsEmptyState } from '@/components/ehr/chart/ChartSection';
import { useToast } from '@/components/Toast';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useMedicalRecords } from '@/lib/hooks/useMedicalRecords';
import { clickable } from '@/lib/a11y';
import { listClinicalNotes } from '@/lib/clinical-notes/note-service';
import { noteTypeLabel } from '@/lib/clinical-notes/note-labels';
import { useCreateNote } from '@/lib/clinical-notes/useCreateNote';
import type { NoteTypeId } from '@/lib/clinical-notes/note-catalog';
import type { ClinicalNoteDoc, NoteStatus } from '@/lib/clinical-notes/types';
import { mergeNoteRows, filterNoteRows, type NoteRow } from './notes-list-model';
import { describeError } from '@/lib/user-facing-error';
import './clinical-notes.css';
import './note-viewer.css';

const PAGE_SIZE = 10;

interface NotesListProps {
  /** Omit for the cross-patient queue. */
  patientId?: string;
  patientName?: string;
  mrn?: string;
  patientDob?: string;
  currentUser: { _id: string; name?: string; username?: string; hospitalId?: string; hospitalName?: string; orgId?: string } | null;
  /** Hides the create controls where the caller has its own. */
  showCreate?: boolean;
  /** Start a note in place (the chart's slider). Without it, Create note
   *  starts a Consultation draft and opens it via `onOpenNote` or /notes. */
  onCreate?: () => void;
  /** Open a note in place (the chart's drawer) instead of the /notes route.
   *  `kind` is 'record' for a read-only consultation record. */
  onOpenNote?: (noteId: string, kind: 'clinical' | 'record', status: NoteStatus) => void;
  /** Bump to reload, since the autosaving editor may have changed the rows. */
  refreshToken?: number;
}

const STATUS_BADGE: Record<NoteStatus, { key: string; cls: string }> = {
  draft: { key: 'notesList.statusUnsigned', cls: 'is-draft' },
  signed: { key: 'notesList.statusSigned', cls: 'is-signed' },
  amended: { key: 'notesList.statusAmended', cls: 'is-amended' },
  awaiting_cosign: { key: 'notesList.statusCosign', cls: 'is-cosign' },
};

export default function NotesList({
  patientId, patientName, mrn, patientDob, currentUser, showCreate = true,
  onCreate, onOpenNote, refreshToken,
}: NotesListProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const { showToast } = useToast();
  const scope = useDataScope();
  const { createNote, creating } = useCreateNote(currentUser);
  const { records } = useMedicalRecords(patientId);

  const [notes, setNotes] = useState<ClinicalNoteDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listClinicalNotes({
        patientId,
        userId: 'all',
        display: 'active',
        sortBy: 'service_date',
      }, scope);
      setNotes(rows);
    } finally {
      setLoading(false);
    }
  }, [patientId, scope]);

  useEffect(() => { void load(); }, [load, refreshToken]);

  const handleCreate = async (noteType: NoteTypeId = 'soap') => {
    if (onCreate) { onCreate(); return; }
    if (!patientId || !patientName) return;
    try {
      const note = await createNote(
        { patientId, patientName, mrn, patientDob, noteType },
        { navigate: !onOpenNote },
      );
      if (note && onOpenNote) { onOpenNote(note._id, 'clinical', note.status); void load(); }
    } catch (err) {
      showToast(describeError(err, t('msg.noteNotStartedTryAgain')), 'error');
    }
  };

  const labelOf = useCallback((r: NoteRow) => {
    if (r.kind === 'record') return t('notesList.recordConsultation');
    if (r.typeKey === 'phone') return t('notesList.phoneEncounter');
    if (r.kind === 'legacy') return t('notesList.legacyNote');
    return noteTypeLabel(t, r.typeKey);
  }, [t]);
  const statusLabelOf = useCallback((s: NoteStatus) => t(STATUS_BADGE[s]?.key ?? STATUS_BADGE.draft.key), [t]);

  const allRows = useMemo(
    () => mergeNoteRows(notes, patientId ? records : [], [], patientName),
    [notes, records, patientId, patientName],
  );
  const filtered = useMemo(
    () => filterNoteRows(allRows, { typeKey: 'all', status: 'all', search, labelOf, statusLabelOf }),
    [allRows, search, labelOf, statusLabelOf],
  );

  const columnSort = useColumnSort<NoteRow>();
  const sorted = columnSort.sort(filtered);
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const canCreate = showCreate && Boolean(patientId);
  const filtering = search.trim() !== '';

  const openRow = (row: NoteRow) => {
    if (row.kind === 'legacy') return;
    if (onOpenNote) onOpenNote(row.id, row.kind, row.status);
    else if (row.kind === 'clinical') router.push(`/notes/${row.id}`);
  };

  return (
    <ChartSection
      title="Notes"
      addLabel="Create note"
      onAdd={canCreate && !creating ? () => void handleCreate() : undefined}
      searchValue={search}
      searchPlaceholder="Search notes…"
      onSearchChange={value => { setSearch(value); setPage(1); }}
      pagination={{ page, pageSize: PAGE_SIZE, total: filtered.length, onPageChange: setPage }}
    >
      {loading && <div className="cn-empty">Loading notes…</div>}

      {/* One column per fact, Status last like every other clinical table.
          There is no Actions column: the row itself opens the note, which is
          what the buttons in it did. Column widths live in the stylesheet
          (`.tamam-table--notes`), not a colgroup: the chart CSS forces
          `col { width: auto !important }`, so colgroup widths are silently
          dropped and every column comes out the same size. */}
      {!loading && (
        <table data-sort="data" className={`tamam-table tamam-table--fixed tamam-table--notes${patientId ? '' : ' tamam-table--notes-queue'}`}>
          <thead>
            <tr>
              <th {...columnSort.headerProps(0, labelOf)}>{t('notesList.colType')}</th>
              <th {...columnSort.headerProps(1, r => r.preview)}>{t('notesList.colNote')}</th>
              <th {...columnSort.headerProps(2, r => r.author || '')}>{t('notesList.colAuthor')}</th>
              {!patientId && <th {...columnSort.headerProps(3, r => r.patientName)}>{t('notesList.colPatient')}</th>}
              <th {...columnSort.headerProps(4, r => `${r.date}${r.time ? ` ${r.time}` : ''}`)}>{t('notesList.colDateOfService')}</th>
              <th {...columnSort.headerProps(5, r => statusLabelOf(r.status))}>{t('notesList.colStatus')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={patientId ? 5 : 6} style={{ cursor: 'default', background: 'transparent' }}>
                  {filtering && allRows.length > 0 ? (
                    <div className="cn-empty">
                      <FileText size={22} style={{ opacity: 0.4, display: 'block', margin: '0 auto 8px' }} />
                      {t('notesList.noMatch')}
                    </div>
                  ) : (
                    <OmrsEmptyState
                      itemLabel="notes"
                      actionLabel="Create clinical note"
                      onAction={canCreate && !creating ? () => void handleCreate() : undefined}
                    />
                  )}
                </td>
              </tr>
            )}
            {pageRows.map((row) => {
              const status = STATUS_BADGE[row.status] ?? STATUS_BADGE.draft;
              const openable = row.kind !== 'legacy' && (Boolean(onOpenNote) || row.kind === 'clinical');
              const label = labelOf(row);
              return (
                <tr
                  key={row.key}
                  className={openable ? 'tamam-clickable-row' : undefined}
                  {...(openable
                    ? clickable(() => openRow(row), { label: t('notesList.openNote', { type: label, date: row.date }) })
                    : {})}
                >
                  <td className="tamam-cell-strong">{label}</td>
                  <td className="tamam-cell-note">{row.preview}</td>
                  <td>{row.author || '—'}</td>
                  {!patientId && <td>{row.patientName}</td>}
                  <td>
                    {row.edited
                      ? t('notesList.editedAt', { date: `${row.date}${row.time ? ` ${row.time}` : ''}` })
                      : `${row.date}${row.time ? ` ${row.time}` : ''}`}
                  </td>
                  <td><span className={`cn-badge ${status.cls}`}>{t(status.key)}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </ChartSection>
  );
}
