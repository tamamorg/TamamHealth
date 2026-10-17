'use client';

/**
 * Mobile Notes tab, read only. Lists the clinical notes written in the desktop
 * editor together with the older internal notes (the legacy store), newest
 * first. Tapping a clinical note opens it in place.
 */

import { useEffect, useState } from 'react';
import { Loader2 } from '@/components/icons/lucide';
import EmptyState from '@/components/EmptyState';
import type { PatientNoteDoc } from '@/lib/db-types';
import type { ClinicalNoteDoc } from '@/lib/clinical-notes/types';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useTranslation } from '@/lib/i18n/useTranslation';
import ClinicalNoteViewer from '@/components/clinical-notes/ClinicalNoteViewer';
import { mergeNoteRows, type NoteRow } from '@/components/clinical-notes/notes-list-model';

const STATUS: Record<string, { key: string; cls: string }> = {
  draft: { key: 'notesList.statusUnsigned', cls: 'is-draft' },
  signed: { key: 'notesList.statusSigned', cls: 'is-signed' },
  amended: { key: 'notesList.statusAmended', cls: 'is-amended' },
  awaiting_cosign: { key: 'notesList.statusCosign', cls: 'is-cosign' },
};

export default function MobileNotesTab({ patientId }: { patientId: string }) {
  const [rows, setRows] = useState<NoteRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const scope = useDataScope();
  const { t } = useTranslation();

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    const clinical = import('@/lib/clinical-notes/note-service')
      .then((m) => m.getNotesByPatient(patientId, scope))
      .catch((): ClinicalNoteDoc[] => []);
    const legacy = import('@/lib/services/patient-note-service')
      .then((m) => m.getNotesByPatient(patientId, scope))
      .catch((): PatientNoteDoc[] => []);
    Promise.all([clinical, legacy]).then(([c, l]) => {
      if (!cancelled) setRows(mergeNoteRows(c, [], l));
    });
    return () => { cancelled = true; };
  }, [patientId, scope]);

  if (rows === null) {
    return (
      <div className="mobile-shell-loading">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  if (openId) {
    return (
      <div className="mobile-chart-tab-body">
        <ClinicalNoteViewer noteId={openId} kind="clinical" onClose={() => setOpenId(null)} />
      </div>
    );
  }

  if (rows.length === 0) {
    return <EmptyState title="No notes" message="Clinical notes for this patient will appear here." />;
  }

  return (
    <div className="mobile-chart-tab-body">
      {rows.map((r) => {
        const status = STATUS[r.status] ?? STATUS.draft;
        const label = r.kind === 'legacy' ? t('notesList.legacyNote')
          : r.typeKey === 'phone' ? t('notesList.phoneEncounter') : r.typeLabel;
        const body = (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <strong>{label}</strong>
              {r.kind === 'clinical' && <span className={`cn-badge ${status.cls}`}>{t(status.key)}</span>}
            </div>
            <p className="mobile-note-body">{r.preview}</p>
            <small className="mobile-note-meta">
              {[r.author, r.date].filter(Boolean).join(' · ')}
            </small>
          </>
        );
        return r.kind === 'clinical' ? (
          <button
            key={r.key}
            type="button"
            className="mobile-chart-card"
            style={{ width: '100%', textAlign: 'start', cursor: 'pointer' }}
            onClick={() => setOpenId(r.id)}
          >
            {body}
          </button>
        ) : (
          <div key={r.key} className="mobile-chart-card">{body}</div>
        );
      })}
    </div>
  );
}
