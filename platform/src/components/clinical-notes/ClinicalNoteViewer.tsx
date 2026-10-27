'use client';

/**
 * Read-only view of one note: header, every section that has content,
 * diagnoses with their ICD-11 codes, addenda, and the signature lines.
 *
 * Renders a ClinicalNoteDoc (`kind="clinical"`) or a consultation
 * MedicalRecordDoc (`kind="record"`, always read only). The caller owns the
 * container (the chart's drawer, or a mobile sheet) and `onClose`.
 *
 * Print goes through printElementById on this component's own root, so only
 * the note reaches paper, never the chart around it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useAuth } from '@/lib/context';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { printElementById } from '@/lib/safe-html';
import {
  getClinicalNoteById, addNoteAddendum, sectionBody,
} from '@/lib/clinical-notes/note-service';
import { noteTypeLabel, sectionLabel } from '@/lib/clinical-notes/note-labels';
import type { ClinicalNoteDoc, NoteStatus } from '@/lib/clinical-notes/types';
import type { MedicalRecordDoc } from '@/lib/db-types';
import { formatDateTime } from '@/lib/format-utils';
import { describeError } from '@/lib/user-facing-error';
import './clinical-notes.css';
import './note-viewer.css';

const STATUS_KEY: Record<NoteStatus, { key: string; cls: string }> = {
  draft: { key: 'notesList.statusUnsigned', cls: 'is-draft' },
  signed: { key: 'notesList.statusSigned', cls: 'is-signed' },
  amended: { key: 'notesList.statusAmended', cls: 'is-amended' },
  awaiting_cosign: { key: 'notesList.statusCosign', cls: 'is-cosign' },
};

export interface ViewerSection {
  id: string;
  label: string;
  text: string;
  diagnoses?: { name: string; code?: string }[];
}

export interface ViewerAddendum { id: string; text: string; authorName: string; createdAt: string }

/** Sections that carry content, in note order. Exported for tests. */
export function clinicalViewerSections(
  note: ClinicalNoteDoc,
  t: (key: string) => string = (k) => k,
): ViewerSection[] {
  return note.sections
    .map(s => ({
      id: s.sectionId,
      label: sectionLabel(t, s.sectionId),
      text: sectionBody(s),
      diagnoses: (s.diagnoses || []).map(d => ({ name: d.name, code: d.icd11Code })),
    }))
    .filter(s => s.text || (s.diagnoses && s.diagnoses.length > 0));
}

export function recordViewerSections(
  r: MedicalRecordDoc,
  labels: { cc: string; hpi: string; exam: string; dx: string; plan: string; follow: string },
): ViewerSection[] {
  const exam = r.physicalExamination
    ? Object.entries(r.physicalExamination).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n')
    : '';
  const out: ViewerSection[] = [
    { id: 'cc', label: labels.cc, text: (r.chiefComplaint || '').trim() },
    { id: 'hpi', label: labels.hpi, text: (r.historyOfPresentIllness || '').trim() },
    { id: 'exam', label: labels.exam, text: exam },
    {
      id: 'dx', label: labels.dx, text: '',
      diagnoses: (r.diagnoses || []).map(d => ({ name: d.name, code: d.icd11Code || d.icd10Code })),
    },
    { id: 'plan', label: labels.plan, text: (r.treatmentPlan || '').trim() },
    {
      id: 'follow', label: labels.follow,
      text: r.followUp ? [r.followUp.date, r.followUp.reason].filter(Boolean).join(' · ') : '',
    },
  ];
  return out.filter(s => s.text || (s.diagnoses && s.diagnoses.length > 0));
}

/**
 * A body made only of short "Label: value" lines (the vitals block) splits
 * into pairs so it can render as an aligned grid; anything else is null and
 * stays prose. Exported for tests.
 */
export function keyValueLines(text: string): { label: string; value: string }[] | null {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const pairs: { label: string; value: string }[] = [];
  for (const line of lines) {
    const m = /^([^:•]{1,24}):\s+(.+)$/.exec(line);
    if (!m) return null;
    pairs.push({ label: m[1].trim(), value: m[2].trim() });
  }
  return pairs;
}

function SectionText({ text }: { text: string }) {
  const pairs = keyValueLines(text);
  if (!pairs) return <p className="tamam-nv-text">{text}</p>;
  return (
    <dl className="tamam-nv-kv">
      {pairs.map((p, i) => <div key={`${p.label}-${i}`}><dt>{p.label}</dt><dd>{p.value}</dd></div>)}
    </dl>
  );
}

interface ViewModel {
  kind: 'clinical' | 'record';
  id: string;
  typeLabel: string;
  status: NoteStatus;
  date: string;
  time?: string;
  author: string;
  encounterId?: string;
  sections: ViewerSection[];
  addenda: ViewerAddendum[];
  signedByName?: string;
  signedAt?: string;
  cosignedByName?: string;
  cosignedAt?: string;
  patientName?: string;
}

export default function ClinicalNoteViewer({
  noteId, kind, onClose, onEdit,
}: {
  noteId: string;
  kind: 'clinical' | 'record';
  onClose: () => void;
  onEdit?: (noteId: string) => void;
}) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const scope = useDataScope();
  const [vm, setVm] = useState<ViewModel | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [adding, setAdding] = useState(false);
  const [addendumText, setAddendumText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      if (kind === 'clinical') {
        const n = await getClinicalNoteById(noteId, scope);
        if (!n) { setState('missing'); return; }
        setVm({
          kind, id: n._id,
          typeLabel: n.noteType === 'phone' ? t('notesList.phoneEncounter') : noteTypeLabel(t, n.noteType),
          status: n.status, date: n.serviceDate, time: n.serviceTime,
          author: n.assignedToName || n.authorName || '',
          encounterId: n.encounterId,
          sections: clinicalViewerSections(n, t),
          addenda: (n.addenda || []).map(a => ({ id: a.id, text: a.text, authorName: a.authorName, createdAt: a.createdAt })),
          signedByName: n.signedByName, signedAt: n.signedAt,
          cosignedByName: n.cosignedByName, cosignedAt: n.cosignedAt,
          patientName: n.patientName,
        });
      } else {
        const { getMedicalRecordById } = await import('@/lib/services/medical-record-service');
        const r = await getMedicalRecordById(noteId);
        if (!r) { setState('missing'); return; }
        const stamp = r.consultedAt || r.startedAt || '';
        setVm({
          kind, id: r._id,
          typeLabel: t('notesList.recordConsultation'),
          status: r.documentStatus ?? 'draft',
          date: r.visitDate || stamp.slice(0, 10),
          time: stamp.length >= 16 ? stamp.slice(11, 16) : undefined,
          author: r.providerName || '',
          encounterId: r.encounterId,
          sections: recordViewerSections(r, {
            cc: t('noteViewer.chiefComplaint'), hpi: t('noteViewer.hpi'), exam: t('noteViewer.exam'),
            dx: t('noteViewer.diagnoses'), plan: t('noteViewer.treatmentPlan'), follow: t('noteViewer.followUp'),
          }),
          addenda: (r.addenda || []).map((a, i) => ({ id: `${i}`, text: a.text, authorName: a.authorName, createdAt: a.createdAt })),
          signedByName: r.signedByName, signedAt: r.signedAt,
          cosignedByName: r.cosignedByName, cosignedAt: r.cosignedAt,
        });
      }
      setState('ready');
    } catch {
      setState('missing');
    }
  }, [noteId, kind, scope, t]);

  useEffect(() => { setState('loading'); void load(); }, [load]);

  const locked = vm?.status === 'signed' || vm?.status === 'amended' || vm?.status === 'awaiting_cosign';
  const printId = useMemo(() => `clinical-note-print-${noteId}`, [noteId]);

  async function saveAddendum() {
    if (!vm || !addendumText.trim() || !currentUser) return;
    setBusy(true);
    setError(null);
    try {
      await addNoteAddendum(vm.id, addendumText, currentUser._id, currentUser.name || currentUser.username || '');
      setAddendumText('');
      setAdding(false);
      await load();
    } catch (e) {
      setError(describeError(e, t('noteViewer.addendumFailed')));
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading') return <div className="tamam-note-viewer modal-no-headband"><p className="tamam-nv-muted">{t('noteViewer.loading')}</p></div>;
  if (state === 'missing' || !vm) {
    return (
      <div className="tamam-note-viewer modal-no-headband">
        <p className="tamam-nv-muted">{t('noteViewer.notFound')}</p>
        <button type="button" className="tamam-nv-btn" onClick={onClose}>{t('noteViewer.close')}</button>
      </div>
    );
  }

  const status = STATUS_KEY[vm.status] ?? STATUS_KEY.draft;
  const canAddAddendum = vm.kind === 'clinical' && (vm.status === 'signed' || vm.status === 'amended');
  const canEdit = vm.kind === 'clinical' && vm.status === 'draft' && Boolean(onEdit);

  return (
    <div className="tamam-note-viewer modal-no-headband">
      <div id={printId} className="tamam-nv-doc modal-no-headband">
        <header className="tamam-nv-head">
          <div>
            <h3 className="tamam-nv-title">{vm.typeLabel}</h3>
            {vm.patientName && <p className="tamam-nv-patient">{vm.patientName}</p>}
          </div>
          <span className={`cn-badge ${status.cls}`}>{t(status.key)}</span>
        </header>

        <dl className="tamam-nv-meta">
          <div><dt>{t('noteViewer.serviceDate')}</dt><dd>{vm.date}{vm.time ? ` ${vm.time}` : ''}</dd></div>
          <div><dt>{t('noteViewer.author')}</dt><dd>{vm.author || '—'}</dd></div>
          {vm.encounterId && <div><dt>{t('noteViewer.encounter')}</dt><dd>{vm.encounterId}</dd></div>}
        </dl>

        {vm.kind === 'record' && <p className="tamam-nv-muted">{t('noteViewer.recordNotice')}</p>}

        {vm.sections.length === 0 && <p className="tamam-nv-muted">{t('noteViewer.noContent')}</p>}
        {vm.sections.map(s => (
          <section key={s.id} className="tamam-nv-section">
            <h4>{s.label}</h4>
            <div className="tamam-nv-body">
              {s.diagnoses && s.diagnoses.length > 0 && (
                <ul className="tamam-nv-dx">
                  {s.diagnoses.map((d, i) => (
                    <li key={`${d.name}-${i}`}>{d.name}{d.code ? <span className="tamam-nv-code"> {d.code}</span> : null}</li>
                  ))}
                </ul>
              )}
              {s.text && <SectionText text={s.text} />}
            </div>
          </section>
        ))}

        {vm.addenda.length > 0 && (
          <section className="tamam-nv-section">
            <h4>{t('noteViewer.addenda')}</h4>
            <div className="tamam-nv-body">
              {vm.addenda.map(a => (
                <div key={a.id} className="tamam-nv-addendum">
                  <p className="tamam-nv-text">{a.text}</p>
                  <small className="tamam-nv-muted">{a.authorName} · {formatDateTime(a.createdAt)}</small>
                </div>
              ))}
            </div>
          </section>
        )}

        <footer className="tamam-nv-sign">
          {vm.signedByName
            ? <p>{t('noteViewer.signedBy', { name: vm.signedByName })}{vm.signedAt ? ` · ${formatDateTime(vm.signedAt)}` : ''}</p>
            : <p className="tamam-nv-muted">{t('noteViewer.notSigned')}</p>}
          {vm.cosignedByName && (
            <p>{t('noteViewer.cosignedBy', { name: vm.cosignedByName })}{vm.cosignedAt ? ` · ${formatDateTime(vm.cosignedAt)}` : ''}</p>
          )}
          {vm.status === 'awaiting_cosign' && !vm.cosignedByName && <p className="tamam-nv-muted">{t('noteViewer.awaitingCosign')}</p>}
        </footer>
      </div>

      {adding && (
        <div className="tamam-nv-addendum-form">
          <textarea
            value={addendumText}
            onChange={e => setAddendumText(e.target.value)}
            rows={3}
            placeholder={t('noteViewer.addendumPlaceholder')}
            aria-label={t('noteViewer.addAddendum')}
          />
          {error && <p className="tamam-nv-error" role="alert">{error}</p>}
          <div className="tamam-nv-actions">
            <button type="button" className="tamam-nv-btn tamam-nv-btn--primary" disabled={busy || !addendumText.trim()} onClick={() => void saveAddendum()}>
              {t('noteViewer.saveAddendum')}
            </button>
            <button type="button" className="tamam-nv-btn" disabled={busy} onClick={() => { setAdding(false); setAddendumText(''); setError(null); }}>
              {t('noteViewer.cancel')}
            </button>
          </div>
        </div>
      )}

      {!adding && (
        <div className="tamam-nv-actions">
          {canEdit && <button type="button" className="tamam-nv-btn tamam-nv-btn--primary" onClick={() => onEdit?.(vm.id)}>{t('noteViewer.edit')}</button>}
          {canAddAddendum && <button type="button" className="tamam-nv-btn" onClick={() => setAdding(true)}>{t('noteViewer.addAddendum')}</button>}
          {locked && vm.kind === 'clinical' && <button type="button" className="tamam-nv-btn" onClick={() => printElementById(printId)}>{t('noteViewer.print')}</button>}
          <button type="button" className="tamam-nv-btn" onClick={onClose}>{t('noteViewer.close')}</button>
        </div>
      )}
    </div>
  );
}
