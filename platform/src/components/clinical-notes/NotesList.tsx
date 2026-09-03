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
import { clickable } from '@/lib/a11y';
import {
  listClinicalNotes, notePreview, createClinicalNote,
} from '@/lib/clinical-notes/note-service';
import {
  NOTE_TYPES, getNoteType, type NoteTypeId,
} from '@/lib/clinical-notes/note-catalog';
import type { ClinicalNoteDoc } from '@/lib/clinical-notes/types';
import './clinical-notes.css';
import { todayIso } from '@/lib/date-utils';

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
  /** Open a note in place (the chart's drawer) instead of the /notes route. */
  onOpenNote?: (noteId: string) => void;
  /** Bump to reload — the chart increments this when its note drawer closes,
   *  since the autosaving editor may have changed what the rows should say. */
  refreshToken?: number;
}

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  draft: { text: 'Unsigned', cls: 'is-draft' },
  signed: { text: 'Signed', cls: 'is-signed' },
  amended: { text: 'Amended', cls: 'is-amended' },
  awaiting_cosign: { text: 'Awaiting co-sign', cls: 'is-cosign' },
};

export default function NotesList({
  patientId, patientName, mrn, patientDob, currentUser, showCreate = true,
  onOpenNote, refreshToken,
}: NotesListProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const { showToast } = useToast();
  const scope = useDataScope();

  const [notes, setNotes] = useState<ClinicalNoteDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newType, setNewType] = useState<NoteTypeId>('soap');
  const [search, setSearch] = useState('');
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
    setCreating(true);
    try {
      const note = await createClinicalNote({
        patientId,
        patientName,
        mrn,
        patientDob,
        noteType,
        serviceDate: todayIso(),
        serviceTime: new Date().toTimeString().slice(0, 5),
        assignedToId: currentUser?._id,
        assignedToName: currentUser?.name || currentUser?.username,
        authorId: currentUser?._id,
        authorName: currentUser?.name || currentUser?.username,
        hospitalId: currentUser?.hospitalId,
        hospitalName: currentUser?.hospitalName,
        orgId: currentUser?.orgId,
      });
      if (onOpenNote) { onOpenNote(note._id); setCreating(false); void load(); }
      else router.push(`/notes/${note._id}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not start the note.', 'error');
      setCreating(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(n => [
      getNoteType(n.noteType).label,
      notePreview(n),
      n.signedByName, n.assignedToName, n.authorName,
      n.serviceDate,
      STATUS_LABEL[n.status]?.text,
    ].some(field => field?.toLowerCase().includes(q)));
  }, [notes, search]);

  const unsignedCount = useMemo(
    () => notes.filter(n => n.status === 'draft' || n.status === 'awaiting_cosign').length,
    [notes],
  );

  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const canCreate = showCreate && Boolean(patientId);

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
        <p style={{ fontSize: 12.5, color: 'var(--color-text-muted, #5d728b)', margin: '0 0 10px' }}>
          {unsignedCount} unsigned {unsignedCount === 1 ? 'note' : 'notes'} — unsigned notes are not
          yet part of the record.
        </p>
      )}

      {loading && <div className="cn-empty">Loading notes…</div>}

      {!loading && filtered.length === 0 && (
        search.trim() ? (
          <div className="cn-empty">
            <FileText size={22} style={{ opacity: 0.4, display: 'block', margin: '0 auto 8px' }} />
            No notes match &ldquo;{search.trim()}&rdquo;.
          </div>
        ) : (
          <OmrsEmptyState
            itemLabel="notes"
            actionLabel="Create clinical note"
            onAction={canCreate ? () => setAddMenuOpen(true) : undefined}
          />
        )
      )}

      {/* One column per fact, Status last like every other clinical table.
          There is no Actions column: the row itself opens the note, which is
          what the buttons in it did. Column widths live in the stylesheet
          (`.tamam-table--notes`), not a colgroup: the chart CSS forces
          `col { width: auto !important }`, so colgroup widths are silently
          dropped and every column comes out the same size. */}
      {!loading && filtered.length > 0 && (
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
            {pageRows.map((note) => {
              const status = STATUS_LABEL[note.status] ?? STATUS_LABEL.draft;
              return (
                <tr
                  key={note._id}
                  className="tamam-clickable-row"
                  {...clickable(
                    () => (onOpenNote ? onOpenNote(note._id) : router.push(`/notes/${note._id}`)),
                    { label: `Open ${getNoteType(note.noteType).label} note — ${note.serviceDate}` },
                  )}
                >
                  <td className="tamam-cell-strong">{getNoteType(note.noteType).label}</td>
                  <td className="tamam-cell-note">{notePreview(note)}</td>
                  <td>{note.signedByName || note.assignedToName || note.authorName || '—'}</td>
                  {!patientId && <td>{note.patientName}</td>}
                  <td>
                    {note.serviceDate}
                    {note.serviceTime ? ` ${note.serviceTime}` : ''}
                  </td>
                  <td><span className={`cn-badge ${status.cls}`}>{status.text}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </ChartSection>
  );
}
