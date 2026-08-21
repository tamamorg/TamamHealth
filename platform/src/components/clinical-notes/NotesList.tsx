'use client';

/**
 * Notes list — the chart's Notes view and the standalone /notes queue.
 *
 * Sorting defaults to date of service rather than last edit: a chart is read
 * chronologically by encounter, and "when did I see this patient" is the
 * question the list answers. Unsigned notes are called out because an unsigned
 * note is work in progress, not a record.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Trash2 } from '@/components/icons/lucide';
import CreateNoteButton from './CreateNoteButton';
import { useToast } from '@/components/Toast';
import { useDataScope } from '@/lib/hooks/useDataScope';
import {
  listClinicalNotes, notePreview, deleteClinicalNote, createClinicalNote,
} from '@/lib/clinical-notes/note-service';
import {
  NOTE_TYPE_ORDER, NOTE_TYPES, getNoteType, isNoteTypeId,
  type NoteTypeId,
} from '@/lib/clinical-notes/note-catalog';
import type { ClinicalNoteDoc, NoteListFilters } from '@/lib/clinical-notes/types';
import './clinical-notes.css';
import Select from '@/components/Select';
import { todayIso } from '@/lib/date-utils';

interface NotesListProps {
  /** Omit for the cross-patient queue. */
  patientId?: string;
  patientName?: string;
  mrn?: string;
  patientDob?: string;
  currentUser: { _id: string; name?: string; username?: string; hospitalId?: string; hospitalName?: string; orgId?: string } | null;
  /** Author/assignee options for the User filter. */
  users?: Array<{ _id: string; name: string }>;
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
  patientId, patientName, mrn, patientDob, currentUser, users = [], showCreate = true,
  onOpenNote, refreshToken,
}: NotesListProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const scope = useDataScope();

  const [notes, setNotes] = useState<ClinicalNoteDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<NoteListFilters['sortBy']>('service_date');
  const [userId, setUserId] = useState('all');
  const [display, setDisplay] = useState<NoteListFilters['display']>('active');
  const [noteType, setNoteType] = useState<string>('all');
  const [creating, setCreating] = useState(false);
  const [newType, setNewType] = useState<NoteTypeId>('soap');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listClinicalNotes({
        patientId,
        userId,
        display,
        sortBy,
        noteType: isNoteTypeId(noteType) ? noteType : undefined,
      }, scope);
      setNotes(rows);
    } finally {
      setLoading(false);
    }
  }, [patientId, userId, display, sortBy, noteType, scope]);

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

  const handleDelete = async (note: ClinicalNoteDoc) => {
    if (!window.confirm(`Delete this unsigned ${getNoteType(note.noteType).label} note?`)) return;
    try {
      await deleteClinicalNote(note._id, currentUser?.name);
      showToast('Draft deleted.', 'success');
      void load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not delete the note.', 'error');
    }
  };

  const unsignedCount = useMemo(
    () => notes.filter(n => n.status === 'draft' || n.status === 'awaiting_cosign').length,
    [notes],
  );

  return (
    <div>
      <div className="cn-list-toolbar">
        <label className="cn-field">
          <span className="cn-label">Sort by</span>
          <Select
            className="cn-select"
            value={sortBy}
            onChange={e => setSortBy(e.target.value as NoteListFilters['sortBy'])}
          >
            <option value="service_date">Date of Service</option>
            <option value="last_update">Last update</option>
          </Select>
        </label>

        <label className="cn-field">
          <span className="cn-label">User</span>
          <Select className="cn-select" value={userId} onChange={e => setUserId(e.target.value)}>
            <option value="all">All</option>
            {users.map(u => <option key={u._id} value={u._id}>{u.name}</option>)}
          </Select>
        </label>

        <label className="cn-field">
          <span className="cn-label">Display</span>
          <Select
            className="cn-select"
            value={display}
            onChange={e => setDisplay(e.target.value as NoteListFilters['display'])}
          >
            <option value="active">Active</option>
            <option value="unsigned">Unsigned</option>
            <option value="signed">Signed</option>
          </Select>
        </label>

        <label className="cn-field">
          <span className="cn-label">Note type</span>
          <Select className="cn-select" value={noteType} onChange={e => setNoteType(e.target.value)}>
            <option value="all">All</option>
            {NOTE_TYPE_ORDER.map(id => (
              <option key={id} value={id}>{NOTE_TYPES[id].label}</option>
            ))}
          </Select>
        </label>

        <div className="cn-footer-spacer" />

        {showCreate && patientId && (
          // The same split control the visit card uses, so starting a note
          // looks and behaves identically wherever a clinician reaches for it.
          <CreateNoteButton
            defaultType={newType}
            disabled={creating}
            onCreate={(type) => { setNewType(type); void handleCreate(type); }}
          />
        )}
      </div>

      {unsignedCount > 0 && (
        <p style={{ fontSize: 12.5, color: 'var(--color-text-muted, #5d728b)', margin: '0 0 10px' }}>
          {unsignedCount} unsigned {unsignedCount === 1 ? 'note' : 'notes'} — unsigned notes are not
          yet part of the record.
        </p>
      )}

      {loading && <div className="cn-empty">Loading notes…</div>}

      {!loading && notes.length === 0 && (
        <div className="cn-empty">
          <FileText size={22} style={{ opacity: 0.4, display: 'block', margin: '0 auto 8px' }} />
          No notes match these filters.
        </div>
      )}

      {!loading && notes.map((note) => {
        const status = STATUS_LABEL[note.status] ?? STATUS_LABEL.draft;
        const unsigned = note.status === 'draft' || note.status === 'awaiting_cosign';
        return (
          <article className="cn-note-card" key={note._id}>
            <div className="cn-note-card-main">
              <div className="cn-note-card-title">
                <span className="cn-note-card-type">{getNoteType(note.noteType).label}</span>
                <span className="cn-note-card-preview">{notePreview(note)}</span>
              </div>
              <div className="cn-note-card-meta">
                <span className={`cn-badge ${status.cls}`}>{status.text}</span>
                {' '}
                {note.signedByName || note.assignedToName || note.authorName || '—'}
                {'  ·  DoS: '}{note.serviceDate}
                {note.serviceTime ? ` ${note.serviceTime}` : ''}
                {!patientId && `  ·  ${note.patientName}`}
              </div>
            </div>

            <button
              type="button"
              className="cn-btn"
              onClick={() => (onOpenNote ? onOpenNote(note._id) : router.push(`/notes/${note._id}`))}
            >
              {unsigned ? 'Open' : 'View'}
            </button>

            {unsigned && (
              <button
                type="button"
                className="cn-btn"
                onClick={() => handleDelete(note)}
                aria-label="Delete draft"
                title="Delete draft"
              >
                <Trash2 size={14} />
              </button>
            )}
          </article>
        );
      })}
    </div>
  );
}
