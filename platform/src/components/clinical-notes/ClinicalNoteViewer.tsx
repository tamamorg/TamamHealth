'use client';

/**
 * Read-only view of one note: header, every section that has content,
 * diagnoses with their ICD-11 codes, addenda, and the signature lines.
 *
 * Renders a ClinicalNoteDoc (`kind="clinical"`) or a consultation
 * MedicalRecordDoc (`kind="record"`, always read only). Inline, the caller
 * owns the container (a mobile sheet) and `onClose`; with
 * `presentation="slider"` it brings the chart's own slider shell — title bar,
 * body, and its actions in the shared action bar — like every chart form.
 *
 * Print goes through printElementById on this component's own root, so only
 * the note reaches paper, never the chart around it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useAuth } from '@/lib/context';
import InlineBanner from '@/components/overlay/InlineBanner';
import { canEditDraft } from '@/lib/clinical-notes/draft-access';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { printElementById } from '@/lib/safe-html';
import {
  getClinicalNoteById, addNoteAddendum, missingRequiredSections, sectionBody, signClinicalNote,
} from '@/lib/clinical-notes/note-service';
import {
  assessmentsForViewer, measuresForNote, signNoteOutcomeMeasures, syncOutcomeMeasures, withOutcomeMeasures,
} from '@/lib/clinical-notes/note-outcome-measures';
import { recordSignRights } from '@/lib/clinical-roles';
import { useConfirm } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { noteTypeLabel, sectionLabel } from '@/lib/clinical-notes/note-labels';
import type { ClinicalNoteDoc, NoteStatus } from '@/lib/clinical-notes/types';
import type { MedicalRecordDoc } from '@/lib/db-types';
import { formatDateTime } from '@/lib/format-utils';
import { describeError } from '@/lib/user-facing-error';
import FormSlider from '@/components/overlay/FormSlider';
import type { ReactNode } from 'react';
import './clinical-notes.css';
import './note-viewer.css';
import { localClockOf, localDayOf } from '@/lib/date-utils';
import { FormError } from '@/components/overlay/FormNotices';

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
  /** Required sections still blank, and held assessments it would sign. */
  missing?: string[];
  heldMeasures?: number;
  kind: 'clinical' | 'record';
  authorId?: string;
  assignedToId?: string;
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
  noteId, kind, onClose, onEdit, presentation = 'inline',
}: {
  noteId: string;
  kind: 'clinical' | 'record';
  onClose: () => void;
  onEdit?: (noteId: string) => void;
  presentation?: 'inline' | 'slider';
}) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const scope = useDataScope();
  const confirm = useConfirm();
  const { showToast } = useToast();
  const [vm, setVm] = useState<ViewModel | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [adding, setAdding] = useState(false);
  const [addendumText, setAddendumText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      if (kind === 'clinical') {
        const stored = await getClinicalNoteById(noteId, scope);
        if (!stored) { setState('missing'); return; }
        // A draft shows the assessments of its visit, even those entered after
        // it was opened. In memory only: this reader may not be able to edit it.
        const assessments = stored.status === 'draft' && scope ? await assessmentsForViewer(stored.patientId, scope) : [];
        const n = withOutcomeMeasures(stored, assessments);
        setVm({
          kind, id: n._id,
          typeLabel: n.noteType === 'phone' ? t('notesList.phoneEncounter') : noteTypeLabel(t, n.noteType),
          status: n.status, date: n.serviceDate, time: n.serviceTime,
          author: n.assignedToName || n.authorName || '',
          authorId: n.authorId, assignedToId: n.assignedToId,
          encounterId: n.encounterId,
          sections: clinicalViewerSections(n, t),
          missing: missingRequiredSections(n),
          heldMeasures: measuresForNote(n, assessments).filter(a => a.documentStatus === 'held').length,
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
          date: r.visitDate || localDayOf(stamp),
          time: localClockOf(stamp),
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
  const print = () => {
    if (!vm) return;
    printElementById(printId, {
      label: vm.typeLabel,
      date: vm.date,
      fieldsTitle: t('print.patientInformation'),
      fields: [
        { label: t('print.patientName'), value: vm.patientName },
        // The status badge goes with the screen header the sheet's heading replaces.
        { label: t('print.status'), value: t((STATUS_KEY[vm.status] ?? STATUS_KEY.draft).key) },
      ],
    });
  };

  async function signNote() {
    if (!vm || !currentUser || !scope) return;
    const ok = await confirm({
      title: t('noteEditor.signTitle'),
      message: vm.heldMeasures ? `${t('noteEditor.signBody')} ${t('noteViewer.signsMeasures', { count: vm.heldMeasures })}` : t('noteEditor.signBody'),
      confirmLabel: t('noteEditor.signNote'),
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const userName = currentUser.name || currentUser.username || 'Clinician';
      await syncOutcomeMeasures(vm.id, scope);
      const signed = await signClinicalNote(vm.id, { signedBy: currentUser._id, signedByName: userName, signerRole: currentUser.role });
      if (signed) await signNoteOutcomeMeasures(signed, { userId: currentUser._id, userName, userRole: currentUser.role }, scope);
      showToast(t('noteEditor.signed'), 'success');
      await load();
    } catch (e) {
      setError(describeError(e, t('noteEditor.signFailed')));
    } finally {
      setBusy(false);
    }
  }

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

  const inSlider = presentation === 'slider';
  // Anyone who may write this draft or attest clinical notes signs it from here.
  const draftClinical = vm?.kind === 'clinical' && vm.status === 'draft';
  const canSign = draftClinical && !!vm && recordSignRights(currentUser?.role).canAuthor
    && canEditDraft({ authorId: vm.authorId ?? '', assignedToId: vm.assignedToId }, currentUser);
  const missing = canSign ? (vm?.missing ?? []) : [];
  /** Inline the content stands alone; in the slider it takes the shell. */
  const shell = (content: ReactNode, opts: { title?: ReactNode; subtitle?: ReactNode; footer?: ReactNode } = {}) => (
    inSlider ? (
      <FormSlider
        title={opts.title ?? t('notesList.colNote')}
        subtitle={opts.subtitle}
        className="tamam-dialog"
        width={720}
        // The note's paper carries its own margins; a body gutter around it
        // boxed the document inside the slider.
        flush
        onClose={onClose}
        busy={busy}
        footer={opts.footer ?? <button type="button" className="btn btn-secondary" onClick={onClose}>{t('noteViewer.close')}</button>}
      >
        {content}
      </FormSlider>
    ) : content
  );

  if (state === 'loading') return shell(<div className="tamam-note-viewer modal-no-headband"><p className="tamam-nv-muted">{t('noteViewer.loading')}</p></div>);
  if (state === 'missing' || !vm) {
    return shell(
      <div className="tamam-note-viewer modal-no-headband">
        <p className="tamam-nv-muted">{t('noteViewer.notFound')}</p>
        {!inSlider && <button type="button" className="tamam-nv-btn" onClick={onClose}>{t('noteViewer.close')}</button>}
      </div>,
    );
  }

  const status = STATUS_KEY[vm.status] ?? STATUS_KEY.draft;
  const canAddAddendum = vm.kind === 'clinical' && (vm.status === 'signed' || vm.status === 'amended');
  const canEdit = vm.kind === 'clinical' && vm.status === 'draft' && Boolean(onEdit)
    && canEditDraft({ authorId: vm.authorId ?? '', assignedToId: vm.assignedToId }, currentUser);

  const cancelAddendum = () => { setAdding(false); setAddendumText(''); setError(null); };
  // Secondary choices first, the one that moves the note forward last.
  const sliderFooter = adding ? (
    <>
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={cancelAddendum}>{t('noteViewer.cancel')}</button>
      <button type="button" className="btn btn-primary" disabled={busy || !addendumText.trim()} onClick={() => void saveAddendum()}>{t('noteViewer.saveAddendum')}</button>
    </>
  ) : (
    <>
      <button type="button" className="btn btn-secondary" onClick={onClose}>{t('noteViewer.close')}</button>
      {locked && vm.kind === 'clinical' && <button type="button" className="btn btn-secondary" onClick={print}>{t('noteViewer.print')}</button>}
      {canAddAddendum && <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>{t('noteViewer.addAddendum')}</button>}
      {canEdit && <button type="button" className={canSign ? 'btn btn-secondary' : 'btn btn-primary'} onClick={() => onEdit?.(vm.id)}>{t('noteViewer.edit')}</button>}
      {canSign && <button type="button" className="btn btn-primary" disabled={busy || missing.length > 0} onClick={() => void signNote()}>{t('noteEditor.sign')}</button>}
    </>
  );

  return shell(
    <div className={`tamam-note-viewer modal-no-headband${inSlider ? ' tamam-note-viewer--slider' : ''}`}>
      {vm.kind === 'clinical' && vm.status === 'draft' && (
        <InlineBanner compact className="no-print" title={t('chart.locked')}>
          {canEdit ? t('noteViewer.lockedHint') : null}
        </InlineBanner>
      )}
      {missing.length > 0 && (
        <InlineBanner compact className="no-print" title={t('noteEditor.missingTitle')}>
          {missing.map(id => sectionLabel(t, id)).join(', ')}
        </InlineBanner>
      )}
      {error && !adding && <FormError message={error} />}
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
          {error && <FormError message={error} />}
          {!inSlider && (
            <div className="tamam-nv-actions">
              <button type="button" className="tamam-nv-btn tamam-nv-btn--primary" disabled={busy || !addendumText.trim()} onClick={() => void saveAddendum()}>
                {t('noteViewer.saveAddendum')}
              </button>
              <button type="button" className="tamam-nv-btn" disabled={busy} onClick={cancelAddendum}>
                {t('noteViewer.cancel')}
              </button>
            </div>
          )}
        </div>
      )}

      {!adding && !inSlider && (
        <div className="tamam-nv-actions">
          {canSign && <button type="button" className="tamam-nv-btn tamam-nv-btn--primary" disabled={busy || missing.length > 0} onClick={() => void signNote()}>{t('noteEditor.sign')}</button>}
          {canEdit && <button type="button" className="tamam-nv-btn tamam-nv-btn--primary" onClick={() => onEdit?.(vm.id)}>{t('noteViewer.edit')}</button>}
          {canAddAddendum && <button type="button" className="tamam-nv-btn" onClick={() => setAdding(true)}>{t('noteViewer.addAddendum')}</button>}
          {locked && vm.kind === 'clinical' && <button type="button" className="tamam-nv-btn" onClick={print}>{t('noteViewer.print')}</button>}
          <button type="button" className="tamam-nv-btn" onClick={onClose}>{t('noteViewer.close')}</button>
        </div>
      )}
    </div>,
    {
      title: vm.typeLabel,
      subtitle: (
        <>
          {vm.patientName ? `${vm.patientName} · ` : ''}
          <span className={`cn-badge ${status.cls}`}>{t(status.key)}</span>
        </>
      ),
      footer: sliderFooter,
    },
  );
}
