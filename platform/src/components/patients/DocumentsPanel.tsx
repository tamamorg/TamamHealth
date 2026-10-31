'use client';

/**
 * Chart documents section — three views over everything filed on or sent to
 * the patient, switched by the chart's standard segmented sub-tabs:
 *
 *   Documents         general filed documents (scans, films, IDs, consents)
 *   Referrals         the patient's referrals + any referral letters filed
 *   Patient education handouts filed, and education already sent to the patient
 *
 * Each view files uploads under its own category, so a document only ever
 * appears in one place: `referral_letter` → Referrals, `patient_education` →
 * Patient education, everything else → Documents.
 *
 * Referrals are read-only here (the record is owned by the referrals module,
 * which this links out to); the education view can send a new message through
 * the chart's existing patient-education action.
 */
import { canRetractDocument, canSeeRetractedDocuments } from '@/lib/clinical/document-retraction';
import { useState, useMemo, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { useAuth } from '@/lib/context';
import { useConfirmPrompt } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/user-facing-error';
import FileUpload from '@/components/FileUpload';
import { usePatientDocuments } from '@/lib/hooks/usePatientDocuments';
import ClinicalImageViewer, { type ClinicalImageItem } from '@/components/clinical-images/ClinicalImageViewer';
import { usePouchLiveReload } from '@/lib/hooks/usePouchLiveReload';
import { messagesDB } from '@/lib/db';
import { formatDate } from '@/lib/format-utils';
import ChartSection from '@/components/ehr/chart/ChartSection';
import FormSlider from '@/components/overlay/FormSlider';
import type { Attachment } from '@/data/mock';
import type { PatientDoc, PatientDocumentCategory, PatientDocumentDoc, ReferralDoc, MessageDoc } from '@/lib/db-types';
import { FileText, X, ArrowRightLeft, ChevronRight, Send, AlertTriangle } from '@/components/icons/lucide';
import Select from '@/components/Select';
import RowActionsMenu from '@/components/RowActionsMenu';
import { FOCUSED_ROW_STYLE } from '@/components/ehr/chart/sections/rowFocus';
import { stopsClickPropagation, dismissBackdrop } from '@/lib/a11y';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useReferralActions } from '@/components/referrals/useReferralActions';
import { useUrlView } from '@/lib/navigation/use-url-view';

const CATEGORY_LABELS: Record<PatientDocumentCategory, string> = {
  radiology: 'Radiology',
  lab_report: 'Lab Report',
  referral_letter: 'Referral Letter',
  discharge_summary: 'Discharge Summary',
  consent: 'Consent Form',
  advance_directive: 'Advance Directive',
  legal_document: 'Legal Document',
  treatment_agreement: 'Treatment Agreement',
  insurance: 'Insurance',
  id_document: 'ID Document',
  prescription: 'Prescription',
  scanned_record: 'Scanned Record',
  external_medical_record: 'External Medical Record',
  patient_education: 'Patient Education',
  other: 'Other',
};

/** The two categories that belong to their own view, not the general list. */
const REFERRAL_CATEGORY: PatientDocumentCategory = 'referral_letter';
const EDUCATION_CATEGORY: PatientDocumentCategory = 'patient_education';

/** Categories offered in the general Documents view's "File under" picker. */
const GENERAL_CATEGORY_OPTIONS = (Object.keys(CATEGORY_LABELS) as PatientDocumentCategory[])
  .filter(c => c !== REFERRAL_CATEGORY && c !== EDUCATION_CATEGORY);

type DocView = 'documents' | 'referrals' | 'education';

const VIEW_LABELS: Record<DocView, string> = {
  documents: 'Documents',
  referrals: 'Referrals',
  education: 'Patient education',
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The shared formatter returns an em dash for a missing date; rows omit it. */
function docDate(iso?: string): string {
  return iso ? formatDate(iso) : '';
}

/**
 * What became of the message. `status` alone reads "sent" for a text still
 * waiting for a connection, so where the text service recorded what actually
 * happened to the SMS, that is what the list shows.
 */
function deliveryLabel(m: MessageDoc): string {
  switch (m.smsDelivery?.state) {
    case 'queued': return 'text waiting to send';
    case 'not_connected': return 'text not sent (no SMS gateway)';
    case 'failed': return 'text not sent';
    default: return m.status;
  }
}

const REFERRAL_BADGE: Record<string, string> = {
  sent: 'tamam-panel-badge tamam-panel-badge--pending',
  received: 'tamam-panel-badge tamam-panel-badge--active',
  seen: 'tamam-panel-badge tamam-panel-badge--active',
  completed: 'tamam-panel-badge tamam-panel-badge--done',
  cancelled: 'tamam-panel-badge tamam-panel-badge--muted',
};

const CHANNEL_LABELS: Record<MessageDoc['channel'], string> = {
  app: 'in-app',
  sms: 'SMS',
  both: 'in-app + SMS',
};

export default function DocumentsPanel({
  patient,
  referrals = [],
  canViewClinical = true,
  onSendEducation,
  onOpenAllReferrals,
  onReferralsChanged,
  onNewReferral,
  focusId,
}: {
  patient: PatientDoc;
  /** This patient's referrals, already filtered by the chart. */
  referrals?: ReferralDoc[];
  /** Referral reasons and education bodies are clinical content. */
  canViewClinical?: boolean;
  /** Opens the chart's message composer pre-labelled as patient education. */
  onSendEducation?: () => void;
  /** Jumps to the referrals module filtered to this patient. */
  onOpenAllReferrals?: () => void;
  /** Re-read the referrals after a row action writes. */
  onReferralsChanged?: () => void;
  /** Opens the chart's refer modal. Omitted for roles that cannot refer. */
  onNewReferral?: () => void;
  /** When set (e.g. deep-linked from elsewhere in the chart), the sub-view
   *  holding this document `_id` is switched to, then the row is scrolled
   *  into view and highlighted. */
  focusId?: string;
}) {
  const { t } = useTranslation();
  const { actionsFor: referralActions, slider: referralSlider } = useReferralActions({ canViewClinical, onChanged: onReferralsChanged, onOpenAll: onOpenAllReferrals });
  const { currentUser } = useAuth();
  const scope = useDataScope();
  const confirmPrompt = useConfirmPrompt();
  const { showToast } = useToast();
  const { documents, retracted, add, remove, addAnnotation, updateAnnotation, deleteAnnotation } = usePatientDocuments(patient._id);
  // In the URL so Back returns to the tab the user was on.
  const [view, setView] = useUrlView<DocView>(['documents', 'referrals', 'education'], 'documents');
  const [category, setCategory] = useState<PatientDocumentCategory>('radiology');
  const [note, setNote] = useState('');
  const [filter, setFilter] = useState<PatientDocumentCategory | 'all'>('all');
  // A preview holds a blob: URL for the decoded payload rather than inlining a
  // `data:` URL: an uploaded file may be up to 5 MB, which is ~6.7 MB of base64
  // in a src attribute for the browser to parse on every render, and the same
  // URL backs the Download link. Minted on open, revoked on close.
  const [preview, setPreview] = useState<
    | { kind: 'images'; images: ClinicalImageItem[]; initialImageId: string }
    | { kind: 'file'; url: string; mimeType: string; title: string; fileName: string }
    | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [sentEducation, setSentEducation] = useState<MessageDoc[]>([]);
  // The list is what a clinician came for; filing a new document is an action
  // taken deliberately, so the dropzone opens from the section's Upload button
  // instead of sitting above every list permanently.
  const [uploadOpen, setUploadOpen] = useState(false);

  // Education already sent to the patient. Loaded on mount, not on first visit
  // to the view: the sub-tab shows a count, and a count that only becomes
  // right after you click the tab is worse than one cheap patient-scoped read.
  const loadSentEducation = useCallback(async () => {
    if (!scope) {
      setSentEducation([]);
      return;
    }
    try {
      const { getMessagesByPatient } = await import('@/modules/communication/services/message-service');
      const all = await getMessagesByPatient(patient._id, scope);
      setSentEducation(all.filter(m => m.patientEducation && m.direction !== 'patient_to_staff'));
    } catch {
      setSentEducation([]);
    }
  }, [patient._id, scope]);

  // The composer that sends education lives in the chart, not here, so the list
  // follows the messages database rather than waiting for a prop to change.
  usePouchLiveReload({ load: loadSentEducation, database: messagesDB });

  // Mirrors the open preview's URL for the unmount cleanup below, which cannot
  // read state from its own teardown.
  const previewUrlRef = useRef<string[]>([]);

  const objectUrlFor = (d: PatientDocumentDoc): string => {
    const binary = atob(d.base64Data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: d.mimeType }));
  };

  const openPreview = (d: PatientDocumentDoc) => {
    if (d.mimeType.startsWith('image/')) {
      const imageDocs = documents.filter(document => document.mimeType.startsWith('image/'));
      const images = imageDocs.map((document): ClinicalImageItem => {
        const src = objectUrlFor(document);
        previewUrlRef.current.push(src);
        return { id: document._id, title: document.title, fileName: document.fileName, src, annotations: document.imageAnnotations };
      });
      setPreview({ kind: 'images', images, initialImageId: d._id });
      return;
    }
    const url = objectUrlFor(d);
    previewUrlRef.current.push(url);
    setPreview({ kind: 'file', url, mimeType: d.mimeType, title: d.title, fileName: d.fileName });
  };

  const closePreview = () => setPreview(null);

  // Revoke after every path that closes the preview (button, backdrop, or
  // Escape), rather than coupling cleanup to one button handler. This also
  // keeps `closePreview` a plain setState — handing a ref-reading function to
  // backdrop props during render is what the refs rule warns about.
  useEffect(() => {
    if (preview) return;
    previewUrlRef.current.forEach(url => URL.revokeObjectURL(url));
    previewUrlRef.current = [];
  }, [preview]);

  // Closing the chart with a preview still open would otherwise leak the blob.
  useEffect(() => () => { previewUrlRef.current.forEach(url => URL.revokeObjectURL(url)); }, []);

  // Which category an upload in this view is filed under. Only the general
  // view lets the uploader choose; the other two are the category.
  const uploadCategory: PatientDocumentCategory =
    view === 'referrals' ? REFERRAL_CATEGORY : view === 'education' ? EDUCATION_CATEGORY : category;

  const onAdd = async (att: Attachment) => {
    setBusy(true);
    try {
      await add({
        patientId: patient._id,
        title: att.name,
        category: uploadCategory,
        fileName: att.name,
        mimeType: att.mimeType,
        base64Data: att.base64Data,
        sizeBytes: att.sizeBytes,
        note: note || undefined,
        uploadedById: currentUser?._id,
        uploadedByName: currentUser?.name || currentUser?.username,
        hospitalId: currentUser?.hospitalId,
        orgId: currentUser?.orgId,
      });
      setNote('');
    } finally {
      setBusy(false);
    }
  };

  // One bucket per view, so nothing is listed twice.
  const referralDocs = useMemo(() => documents.filter(d => d.category === REFERRAL_CATEGORY), [documents]);
  const educationDocs = useMemo(() => documents.filter(d => d.category === EDUCATION_CATEGORY), [documents]);
  const generalDocs = useMemo(
    () => documents.filter(d => d.category !== REFERRAL_CATEGORY && d.category !== EDUCATION_CATEGORY),
    [documents],
  );

  // Filter chips only cover the general view's own categories.
  const presentCategories = useMemo(() => {
    const set = new Set(generalDocs.map(d => d.category));
    return GENERAL_CATEGORY_OPTIONS.filter(c => set.has(c));
  }, [generalDocs]);

  // Deep-link focus: switch to whichever sub-view holds the focused document
  // once it loads, then scroll it into view and let the highlight draw
  // attention — same pattern as ResultsSection, adapted for the three-view
  // split here (a doc can only be found once its own view's bucket is known).
  useEffect(() => {
    if (!focusId) return;
    if (generalDocs.some(d => d._id === focusId)) setView('documents');
    else if (referralDocs.some(d => d._id === focusId)) setView('referrals');
    else if (educationDocs.some(d => d._id === focusId)) setView('education');
  }, [focusId, generalDocs, referralDocs, educationDocs, setView]);

  useEffect(() => {
    if (!focusId) return;
    const el = document.getElementById(`doc-row-${focusId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusId, view]);

  const shownGeneral = filter === 'all' ? generalDocs : generalDocs.filter(d => d.category === filter);

  const counts: Record<DocView, number> = {
    documents: generalDocs.length,
    referrals: referrals.length + referralDocs.length,
    education: educationDocs.length + sentEducation.length,
  };

  // Removed with a reason and kept in the record history, like every other
  // clinical entry: never erased. The prompt names the file, so the answer is
  // about a document rather than a dialog.
  const removeDoc = async (d: PatientDocumentDoc) => {
    const reason = await confirmPrompt({
      title: t('msg.deleteThisDocument'),
      message: t('chart.documentRemoveMessage', { name: d.title || d.fileName }),
      inputLabel: t('chart.vitalsDeleteReason'),
      confirmLabel: t('action.delete'),
      tone: 'danger',
    });
    if (!reason?.trim()) return;
    try {
      if (!(await remove(d._id, reason, { id: currentUser?._id, name: currentUser?.name, role: currentUser?.role }))) throw new Error('Change not saved. Try again.');
      showToast(t('chart.documentRemoved', { name: d.title || d.fileName }), 'success');
    } catch (err) {
      showToast(describeError(err, t('msg.changeNotSavedTryAgain')), 'error');
    }
  };

  const downloadDoc = (d: PatientDocumentDoc) => {
    const a = document.createElement('a');
    a.href = `data:${d.mimeType};base64,${d.base64Data}`;
    a.download = d.fileName || d.title;
    a.click();
  };

  const docRow = (d: PatientDocumentDoc) => (
    <tr key={d._id} id={`doc-row-${d._id}`} style={d._id === focusId ? FOCUSED_ROW_STYLE : undefined}>
      <td className="tamam-cell-strong">{d.title}</td>
      <td>{CATEGORY_LABELS[d.category]}</td>
      <td className="tamam-num">{docDate(d.createdAt) || '—'}</td>
      <td>
        {formatSize(d.sizeBytes)}{d.uploadedByName ? ` · ${d.uploadedByName}` : ''}
        {d.note && <div className="tamam-cell-sub tamam-cell-clamp" title={d.note}>{d.note}</div>}
      </td>
      <td><span className="tamam-panel-badge tamam-panel-badge--done">{t('documents.statusFiled')}</span></td>
      <td>
        <RowActionsMenu
          ariaLabel={t('documents.rowActions', { name: d.title })}
          actions={[
            { key: 'preview', label: t('documents.preview'), onClick: () => openPreview(d) },
            { key: 'download', label: t('documents.download'), onClick: () => downloadDoc(d) },
            ...(canRetractDocument({ id: currentUser?._id, role: currentUser?.role }, d)
              ? [{ key: 'remove', label: t('action.delete'), tone: 'danger' as const, onClick: () => void removeDoc(d) }]
              : []),
          ]}
        />
      </td>
    </tr>
  );

  /** One table shape for all three views: Name · Type · Date · Details · Status · ⋮. */
  const listTable = (rows: ReactNode[], empty: string) => (
    <table className="tamam-table tamam-table--fixed tamam-table--documents">
      <thead>
        <tr>
          <th>{t('documents.col.name')}</th>
          <th>{t('documents.col.type')}</th>
          <th>{t('documents.col.date')}</th>
          <th>{t('documents.col.details')}</th>
          <th>{t('documents.col.status')}</th>
          <th className="tamam-col-actions">{t('chart.actions')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr><td colSpan={6} style={{ cursor: 'default', background: 'transparent', color: 'var(--text-muted)' }}>{empty}</td></tr>
        )}
        {rows}
      </tbody>
    </table>
  );

  const uploader = (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
        {view === 'documents' ? (
          <label className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            File under
            <Select value={category} onChange={e => setCategory(e.target.value as PatientDocumentCategory)}
              className="w-full p-2 rounded-md text-[12px] mt-0.5" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
              {GENERAL_CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </Select>
          </label>
        ) : (
          <p className="text-[11px] self-end pb-2" style={{ color: 'var(--text-muted)' }}>
            Filed under <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>{CATEGORY_LABELS[uploadCategory]}</span>
          </p>
        )}
        <label className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          Note (optional)
          <input value={note} onChange={e => setNote(e.target.value)} placeholder={view === 'education' ? 'e.g. Went through it with the mother' : 'e.g. Contacted patient, all well'}
            className="w-full p-2 rounded-md text-[12px] mt-0.5" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
        </label>
      </div>
      <FileUpload attachments={[]} onAdd={onAdd} onRemove={() => {}} uploaderName={currentUser?.name || 'Staff'} />
      {busy && <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>Saving…</p>}
    </>
  );

  const subTabs = (
    <div className="ehr-chart-subtabs" role="tablist" aria-label="Documents view">
      {(['documents', 'referrals', 'education'] as DocView[]).map(v => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={view === v}
          className={view === v ? 'is-active' : ''}
          onClick={() => setView(v)}
        >
          {VIEW_LABELS[v]}{counts[v] > 0 ? ` (${counts[v]})` : ''}
        </button>
      ))}
    </div>
  );

  return (
    <ChartSection
      title={VIEW_LABELS[view]}
      toggleSlot={subTabs}
      addLabel="Upload"
      onAdd={() => setUploadOpen(true)}
    >
      {view === 'documents' && (
        <>
          <p className="text-[11px] mb-2" style={{ color: 'var(--text-muted)' }}>Scans, films, letters &amp; IDs</p>

          {generalDocs.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-4 mb-2">
              {(['all', ...presentCategories] as const).map(c => {
                const active = filter === c;
                const label = c === 'all' ? `All (${generalDocs.length})` : `${CATEGORY_LABELS[c]} (${generalDocs.filter(d => d.category === c).length})`;
                return (
                  <button key={c} type="button" onClick={() => setFilter(c)}
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors"
                    style={{ background: active ? 'var(--accent-primary)' : 'var(--overlay-subtle)', color: active ? '#fff' : 'var(--text-secondary)', border: '1px solid var(--border-light)' }}>
                    {label}
                  </button>
                );
              })}
            </div>
          )}

          {listTable(shownGeneral.map(docRow), 'No documents filed yet.')}
        </>
      )}

      {view === 'referrals' && (
        <>
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Referrals sent and received, and any referral letters filed</p>
            <div className="flex items-center gap-3 flex-shrink-0">
              {onNewReferral && (
                <button type="button" onClick={onNewReferral} className="text-[11px] font-semibold flex items-center gap-1" style={{ color: 'var(--accent-primary)' }}>
                  <ArrowRightLeft className="w-3.5 h-3.5" /> New referral
                </button>
              )}
              {onOpenAllReferrals && (
                <button type="button" onClick={onOpenAllReferrals} className="text-[11px] font-semibold flex items-center gap-0.5" style={{ color: 'var(--accent-primary)' }}>
                  All referrals <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {listTable([
            ...referrals.map(ref => (
              <tr key={ref._id}>
                <td className="tamam-cell-strong">{ref.fromHospital} → {ref.toHospital}</td>
                <td>
                  {ref.department || 'Referral'}
                  <div className="tamam-cell-sub">
                    <span className={`badge urgency-${ref.urgency} text-[9px]`}>
                      {ref.urgency === 'emergency' && <AlertTriangle className="w-3 h-3" />}
                      {ref.urgency.charAt(0).toUpperCase() + ref.urgency.slice(1)}
                    </span>
                  </div>
                </td>
                <td className="tamam-num">{docDate(ref.referralDate) || ref.referralDate}</td>
                <td>
                  {canViewClinical ? (
                    ref.reason && <div className="tamam-cell-clamp" title={ref.reason}>{ref.reason}</div>
                  ) : (
                    <span className="italic" style={{ color: 'var(--text-muted)' }}>Clinical reason restricted</span>
                  )}
                  {/* referringDoctor is stored with its own title ("Dr. …"), so no prefix here. */}
                  {ref.referringDoctor && <div className="tamam-cell-sub">{ref.referringDoctor}</div>}
                </td>
                <td><span className={REFERRAL_BADGE[ref.status] || 'tamam-panel-badge tamam-panel-badge--active'}>{t(`referral.${ref.status}`)}</span></td>
                <td>
                  <RowActionsMenu
                    ariaLabel={t('chart.referralRowActions', { name: ref.toHospital })}
                    actions={referralActions(ref)}
                  />
                </td>
              </tr>
            )),
            ...referralDocs.map(docRow),
          ], 'No referrals or referral letters on this chart.')}
          {referralSlider}
        </>
      )}

      {view === 'education' && (
        <>
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Handouts filed on the chart, and education sent to the patient</p>
            {onSendEducation && (
              <button type="button" onClick={onSendEducation} className="text-[11px] font-semibold flex items-center gap-1 flex-shrink-0" style={{ color: 'var(--accent-primary)' }}>
                <Send className="w-3.5 h-3.5" /> Send education
              </button>
            )}
          </div>

          {listTable([
            ...educationDocs.map(docRow),
            ...sentEducation.map(m => (
              <tr key={m._id}>
                <td className="tamam-cell-strong">{m.subject || 'Patient education'}</td>
                <td>{t('documents.sentToPatient')}</td>
                <td className="tamam-num">{docDate(m.sentAt) || '—'}</td>
                <td>
                  {CHANNEL_LABELS[m.channel]}{m.fromDoctorName ? ` · ${m.fromDoctorName}` : ''}
                  {canViewClinical && m.body && <div className="tamam-cell-sub tamam-cell-clamp" title={m.body}>{m.body}</div>}
                </td>
                <td><span className={m.smsDelivery && m.smsDelivery.state !== 'sent' ? 'tamam-panel-badge tamam-panel-badge--pending' : 'tamam-panel-badge tamam-panel-badge--done'}>{deliveryLabel(m)}</span></td>
                <td>
                  <RowActionsMenu
                    ariaLabel={t('documents.rowActions', { name: m.subject || 'Patient education' })}
                    actions={onSendEducation ? [{ key: 'resend', label: t('documents.sendAgain'), onClick: onSendEducation }] : []}
                  />
                </td>
              </tr>
            )),
          ], 'Nothing yet. File a handout, or send education to the patient.')}
        </>
      )}

      {/* A retraction hides the document, not the fact of it: clinical staff
          see what was removed, by whom and why, and can ask for the original. */}
      {retracted.length > 0 && canSeeRetractedDocuments(currentUser?.role) && (
        <div className="tamam-doc-retracted">
          <p className="tamam-cell-strong">{t('documents.retractedHeading', { count: retracted.length })}</p>
          <ul>
            {retracted.map(d => (
              <li key={d._id}>
                {t('documents.retractedLine', {
                  title: d.title || d.fileName,
                  name: d.removedByName || '—',
                  date: docDate(d.removedAt) || '—',
                  reason: d.removalReason || '—',
                })}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Preview modal */}
      {preview && (
        <div className="viewport-popup fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.82)' }} {...dismissBackdrop(closePreview)}>
          {preview.kind === 'images' ? (
            <div className="viewport-popup__content" {...stopsClickPropagation}>
              <ClinicalImageViewer
                images={preview.images.map(item => ({
                  ...item,
                  annotations: documents.find(document => document._id === item.id)?.imageAnnotations,
                }))}
                initialImageId={preview.initialImageId}
                onClose={closePreview}
                onCreateAnnotation={(documentId, input) => addAnnotation(documentId, input, { id: currentUser?._id, name: currentUser?.name || currentUser?.username })}
                onUpdateAnnotation={(documentId, annotationId, label) => updateAnnotation(documentId, annotationId, label, { id: currentUser?._id, name: currentUser?.name || currentUser?.username })}
                onDeleteAnnotation={(documentId, annotationId) => deleteAnnotation(documentId, annotationId, { id: currentUser?._id, name: currentUser?.name || currentUser?.username })}
              />
            </div>
          ) : (
          <div className="relative max-w-4xl max-h-[90vh] rounded-xl overflow-hidden" style={{ background: 'var(--bg-card)' }} {...stopsClickPropagation}>
            <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--border-light)' }}>
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4" style={{ color: 'var(--color-danger)' }} />
                <span className="text-sm font-semibold">{preview.title}</span>
              </div>
              <div className="flex items-center gap-2">
                {/* Always reachable, whatever the type previews as. */}
                <a href={preview.url} download={preview.fileName} className="text-[11px] font-semibold px-2 py-1 rounded" style={{ background: 'var(--accent-light)', color: 'var(--accent-primary)' }}>
                  Download
                </a>
                <button onClick={closePreview} className="p-1 rounded" style={{ background: 'var(--overlay-subtle)' }}><X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} /></button>
              </div>
            </div>
            <div className="p-4 overflow-auto" style={{ maxHeight: 'calc(90vh - 60px)' }}>
              {preview.mimeType === 'application/pdf' ? (
                <iframe src={preview.url} className="w-full rounded" style={{ height: '70vh' }} title={preview.title} />
              ) : (
                <div className="text-center py-12"><FileText className="w-16 h-16 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} /><p className="text-sm" style={{ color: 'var(--text-muted)' }}>Preview not available.</p></div>
              )}
            </div>
          </div>
          )}
        </div>
      )}
      {uploadOpen && (
        <FormSlider
          title={t('documents.uploadTitle')}
          className="tamam-dialog"
          onClose={() => setUploadOpen(false)}
          busy={busy}
          footer={<button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setUploadOpen(false)}>{t('action.close')}</button>}
        >
          {uploader}
        </FormSlider>
      )}
    </ChartSection>
  );
}
