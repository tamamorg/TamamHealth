'use client';

/**
 * Notes list — the chart's Notes view, wearing the same ChartSection chrome
 * as every other chart tab: title, search bar, and a right-aligned create
 * action that opens the note-type menu (the Orders tab's "Add" pattern).
 *
 * Sorting is fixed to date of service: a chart is read chronologically by
 * encounter, and "when did I see this patient" is the question the list
 * answers. The old toolbar of dropdown filters (sort / user / display /
 * type) is gone — the search box covers those lookups in one control.
 * Unsigned notes are called out because an unsigned note is work in
 * progress, not a record.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import ChartSection, { OmrsEmptyState } from '@/components/ehr/chart/ChartSection';
import { noteTypeMenuOrder } from './CreateNoteButton';
import { useToast } from '@/components/Toast';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useMedicalRecords } from '@/lib/hooks/useMedicalRecords';
import { clickable } from '@/lib/a11y';
import { listClinicalNotes } from '@/lib/clinical-notes/note-service';
import { noteTypeLabel } from '@/lib/clinical-notes/note-labels';
import { useCreateNote } from '@/lib/clinical-notes/useCreateNote';
import { NOTE_TYPES, type NoteTypeId } from '@/lib/clinical-notes/note-catalog';
import type { ClinicalNoteDoc, NoteStatus } from '@/lib/clinical-notes/types';
import {
  mergeNoteRows, filterNoteRows, statusCounts, typeCounts, STATUS_FILTERS,
  RECORD_TYPE_KEY, type NoteRow, type StatusFilter,
} from './notes-list-model';
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
  /** Open a note in place (the chart's drawer) instead of the /notes route.
   *  `kind` is 'record' for a read-only consultation record. */
  onOpenNote?: (noteId: string, kind: 'clinical' | 'record') => void;
  /** Bump to reload, since the autosaving editor may have changed the rows. */
  refreshToken?: number;
}

const STATUS_BADGE: Record<NoteStatus, { key: string; cls: string }> = {
  draft: { key: 'notesList.statusUnsigned', cls: 'is-draft' },
  signed: { key: 'notesList.statusSigned', cls: 'is-signed' },
  amended: { key: 'notesList.statusAmended', cls: 'is-amended' },
  awaiting_cosign: { key: 'notesList.statusCosign', cls: 'is-cosign' },
};

const STATUS_CHIP_KEY: Record<StatusFilter, string> = {
  all: 'notesList.statusAll',
  unsigned: 'notesList.statusUnsigned',
  signed: 'notesList.statusSigned',
  awaiting_cosign: 'notesList.statusCosign',
  amended: 'notesList.statusAmended',
};

export default function NotesList({
  patientId, patientName, mrn, patientDob, currentUser, showCreate = true,
  onOpenNote, refreshToken,
}: NotesListProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const { showToast } = useToast();
  const scope = useDataScope();
  const { createNote, creating } = useCreateNote(currentUser);
  const { records } = useMedicalRecords(patientId);

  const [notes, setNotes] = useState<ClinicalNoteDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [newType, setNewType] = useState<NoteTypeId>('soap');
  const [search, setSearch] = useState('');
  const [typeKey, setTypeKey] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const [addMenuOpen, setAddMenuOpen] = useState(false);

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

  const handleCreate = async (noteType: NoteTypeId = newType) => {
    if (!patientId || !patientName) return;
    try {
      const note = await createNote(
        { patientId, patientName, mrn, patientDob, noteType },
        { navigate: !onOpenNote },
      );
      if (note && onOpenNote) { onOpenNote(note._id, 'clinical'); void load(); }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not start the note.', 'error');
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
  const types = useMemo(() => typeCounts(allRows), [allRows]);
  const counts = useMemo(() => statusCounts(allRows, typeKey), [allRows, typeKey]);
  const filtered = useMemo(
    () => filterNoteRows(allRows, { typeKey, status: statusFilter, search, labelOf, statusLabelOf }),
    [allRows, typeKey, statusFilter, search, labelOf, statusLabelOf],
  );

  const unsignedCount = useMemo(
    () => notes.filter(n => n.status === 'draft' || n.status === 'awaiting_cosign').length,
    [notes],
  );

  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const canCreate = showCreate && Boolean(patientId);
  const filtering = search.trim() !== '' || typeKey !== 'all' || statusFilter !== 'all';

  const openRow = (row: NoteRow) => {
    if (row.kind === 'legacy') return;
    if (onOpenNote) onOpenNote(row.id, row.kind);
    else if (row.kind === 'clinical') router.push(`/notes/${row.id}`);
  };

  return (
    <ChartSection
      title="Notes"
      addLabel="Create note"
      onAdd={canCreate ? () => setAddMenuOpen(v => !v) : undefined}
      searchValue={search}
      searchPlaceholder="Search notes…"
      onSearchChange={value => { setSearch(value); setPage(1); }}
      pagination={{ page, pageSize: PAGE_SIZE, total: filtered.length, onPageChange: setPage }}
    >
      {canCreate && addMenuOpen && (
        <div style={{ position: 'relative' }}>
          <div
            style={{ position: 'absolute', right: 0, top: -6, zIndex: 20, maxHeight: 420, overflowY: 'auto' }}
            className="tamam-actions-menu"
            role="menu"
          >
            {/* Most recently used type first, rest alphabetical — the same
                ordering the note editor's split button offers. */}
            {noteTypeMenuOrder(newType).map(id => (
              <button
                key={id}
                type="button"
                role="menuitem"
                disabled={creating}
                title={NOTE_TYPES[id].description}
                onClick={() => { setAddMenuOpen(false); setNewType(id); void handleCreate(id); }}
              >
                <FileText /> {NOTE_TYPES[id].label}
              </button>
            ))}
          </div>
        </div>
      )}

      {unsignedCount > 0 && (
        <p className="tamam-nl-helper">
          {unsignedCount} {t('notesList.statusUnsigned').toLowerCase()} · {t('notesList.count', { shown: filtered.length, total: allRows.length })}
        </p>
      )}

      {allRows.length > 0 && (
        <div className="tamam-nl-filters">
          <div className="tamam-nl-chipgroup" role="group" aria-label={t('notesList.filterType')}>
            <button type="button" className="tamam-nl-chip" aria-pressed={typeKey === 'all'}
              onClick={() => { setTypeKey('all'); setPage(1); }}>
              {t('notesList.typeAll')} <span className="tamam-nl-chip-count">{allRows.length}</span>
            </button>
            {types.map(ty => (
              <button key={ty.typeKey} type="button" className="tamam-nl-chip" aria-pressed={typeKey === ty.typeKey}
                onClick={() => { setTypeKey(ty.typeKey); setPage(1); }}>
                {ty.typeKey === RECORD_TYPE_KEY ? t('notesList.recordConsultation')
                  : ty.typeKey === 'phone' ? t('notesList.phoneEncounter') : noteTypeLabel(t, ty.typeKey)}
                {' '}<span className="tamam-nl-chip-count">{ty.count}</span>
              </button>
            ))}
          </div>
          <div className="tamam-nl-chipgroup" role="group" aria-label={t('notesList.filterStatus')}>
            {STATUS_FILTERS.map(sf => (
              <button key={sf} type="button" className="tamam-nl-chip" aria-pressed={statusFilter === sf}
                onClick={() => { setStatusFilter(sf); setPage(1); }}>
                {t(STATUS_CHIP_KEY[sf])} <span className="tamam-nl-chip-count">{counts[sf]}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && <div className="cn-empty">Loading notes…</div>}

      {/* One column per fact, Status last like every other clinical table.
          There is no Actions column: the row itself opens the note, which is
          what the buttons in it did. Column widths live in the stylesheet
          (`.tamam-table--notes`), not a colgroup: the chart CSS forces
          `col { width: auto !important }`, so colgroup widths are silently
          dropped and every column comes out the same size. */}
      {!loading && (
        <table className={`tamam-table tamam-table--fixed tamam-table--notes${patientId ? '' : ' tamam-table--notes-queue'}`}>
          <thead>
            <tr>
              <th>{t('notesList.colType')}</th>
              <th>{t('notesList.colNote')}</th>
              <th>{t('notesList.colAuthor')}</th>
              {!patientId && <th>{t('notesList.colPatient')}</th>}
              <th>{t('notesList.colDateOfService')}</th>
              <th>{t('notesList.colStatus')}</th>
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
                      onAction={canCreate ? () => setAddMenuOpen(true) : undefined}
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
                    {row.date}
                    {row.time ? ` ${row.time}` : ''}
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
