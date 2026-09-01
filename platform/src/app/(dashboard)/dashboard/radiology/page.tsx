'use client';
import { useState, useMemo, useRef } from 'react';
import DemoModeBanner from '@/components/DemoModeBanner';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useLabResults } from '@/lib/hooks/useLabResults';
import { isImagingStudy } from '@/lib/clinical-flow/lab-catalog';
import { addPatientDocument } from '@/lib/services/patient-document-service';
import {
  Upload, CheckCircle2, FileText, BarChart3, TrendingUp, Play, RotateCcw,
} from '@/components/icons/lucide';
import EhrCareDashboard, { type EhrCareDashboardRow } from '@/components/ehr/EhrCareDashboard';
import { type DayStatsItem } from '@/components/ehr/EhrDayStatsChart';
import { appointmentPriorityLabel, appointmentTriage } from '@/lib/clinical/triage-display';
import { formatDateTitle } from '@/components/ehr/EhrMiniCalendar';
import { toIsoDate } from '@/lib/date-utils';
import { formatClockTime } from '@/lib/format-utils';

const ACCENT = 'var(--accent-primary)';

const MODALITIES = ['X-Ray', 'Ultrasound', 'CT Scan', 'MRI', 'Fluoroscopy', 'Mammography'];

function radiologyStatusLabel(status: string): string {
  if (status === 'completed') return 'Complete';
  if (status === 'in_progress') return 'In Progress';
  return 'Pending';
}

function radiologyPriorityLabel(priority: string): string {
  return priority.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Formats a turnaround-time average (in minutes) the way clinicians read it —
// minutes below an hour, otherwise hours and minutes.
function formatTurnaround(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

// Demo data — only shown when NEXT_PUBLIC_DEMO_MODE === 'true' AND no real
// studies exist yet. Production with the env var unset/false renders an
// empty-state instead so staff never mistake fake studies for real orders.
const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

const SAMPLE_STUDIES = [
  { id: 'img-001', patientName: 'Deng Mabior Garang', modality: 'X-Ray', bodyPart: 'Chest PA', status: 'pending', priority: 'urgent', orderedBy: 'Dr. James Wani', date: '2026-02-09', notes: 'Suspected pneumonia, persistent cough 3 weeks' },
  { id: 'img-002', patientName: 'Nyabol Gatdet Koang', modality: 'Ultrasound', bodyPart: 'Obstetric', status: 'completed', priority: 'routine', orderedBy: 'Dr. Achol Mayen', date: '2026-02-09', notes: 'ANC scan, 28 weeks gestation', findings: 'Single viable fetus, cephalic presentation, AFI normal, EFW 1.2kg' },
  { id: 'img-003', patientName: 'Achol Mayen Deng', modality: 'X-Ray', bodyPart: 'Left Femur', status: 'completed', priority: 'emergency', orderedBy: 'Dr. Wani', date: '2026-02-08', notes: 'Trauma, fall from height', findings: 'Transverse fracture mid-shaft left femur, displacement present, no dislocation' },
  { id: 'img-004', patientName: 'Gatluak Ruot Nyuon', modality: 'Ultrasound', bodyPart: 'Abdomen', status: 'pending', priority: 'routine', orderedBy: 'CO Deng Mabior', date: '2026-02-09', notes: 'Abdominal pain, rule out hepatosplenomegaly' },
  { id: 'img-005', patientName: 'Rose Tombura Gbudue', modality: 'X-Ray', bodyPart: 'Chest PA/Lateral', status: 'in_progress', priority: 'urgent', orderedBy: 'Dr. TamamHealth Ladu', date: '2026-02-09', notes: 'TB screening, weight loss, night sweats' },
  { id: 'img-006', patientName: 'Kuol Akot Ajith', modality: 'Ultrasound', bodyPart: 'Renal', status: 'completed', priority: 'routine', orderedBy: 'Dr. Achol Mayen', date: '2026-02-08', notes: 'Elevated creatinine', findings: 'Bilateral mild hydronephrosis, cortical thinning right kidney' },
  { id: 'img-007', patientName: 'Majok Chol Wol', modality: 'X-Ray', bodyPart: 'Right Hand', status: 'pending', priority: 'routine', orderedBy: 'CO Stella', date: '2026-02-09', notes: 'Injury, swelling right hand' },
  { id: 'img-008', patientName: 'Ayen Dut Malual', modality: 'Ultrasound', bodyPart: 'Thyroid', status: 'completed', priority: 'routine', orderedBy: 'Dr. Wani', date: '2026-02-07', notes: 'Palpable thyroid nodule', findings: 'Solitary 1.8cm hypoechoic nodule right lobe, no calcifications, TIRADS 3' },
];

export default function RadiologyDashboard() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { results: labResults, update: updateLabResult } = useLabResults();

  const realStudies = useMemo(
    () =>
      labResults
        .filter(r => isImagingStudy(r))
        .map(r => {
          const [modality, bodyPart] = r.testName.split(' — ');
          return {
            id: r._id,
            patientId: r.patientId,
            patientName: r.patientName,
            modality: (modality || r.testName).trim(),
            bodyPart: (bodyPart || r.testName).trim(),
            status: r.status,
            priority: r.critical ? 'urgent' : 'routine',
            orderedBy: r.orderedBy,
            date: (r.orderedAt || '').slice(0, 10),
            // Kept alongside `date` (which is truncated to a calendar day) so the
            // Day statistics rail can bucket real orders by time of day.
            orderedAt: r.orderedAt,
            completedAt: r.completedAt,
            notes: r.clinicalNotes || '',
            findings: r.result || undefined,
            isReal: true,
          };
        }),
    [labResults],
  );
  // Defaults to the Scheduled lane like every other role dashboard; the All
  // stat tile widens back to the whole worklist.
  const [filterStatus, setFilterStatus] = useState<string>('pending');
  // Which stat panel (header toggles) currently occupies the center instead
  // of the worklist; null = normal queue view.
  const [centerPanel, setCenterPanel] = useState<'modality' | 'regions' | 'performance' | null>(null);
  const togglePanel = (key: 'modality' | 'regions' | 'performance') =>
    setCenterPanel(prev => (prev === key ? null : key));
  const [queueSearch, setQueueSearch] = useState('');
  const [findings, setFindings] = useState('');
  // Local overrides so submitted demo findings persist for this session.
  // The radiology backend isn't wired yet, so we keep edits in memory
  // rather than letting the Submit button do nothing.
  const [submittedFindings, setSubmittedFindings] = useState<Record<string, string>>({});
  const [studyStatusOverrides, setStudyStatusOverrides] = useState<Record<string, 'in_progress'>>({});
  const [submitToast, setSubmitToast] = useState<string | null>(null);

  // Attached imaging files per study (session-scoped object URLs, same
  // in-memory pattern as findings until the PACS/storage backend lands).
  const [attachments, setAttachments] = useState<Record<string, { name: string; url: string }[]>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachTargetRef = useRef<string | null>(null);

  const openAttachDialog = (studyId: string) => {
    attachTargetRef.current = studyId;
    fileInputRef.current?.click();
  };

  const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5MB per file — PouchDB doc budget

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || '');
        resolve(dataUrl.slice(dataUrl.indexOf(',') + 1)); // strip data: prefix
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  const handleFilesChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const studyId = attachTargetRef.current;
    const files = e.target.files;
    if (!studyId || !files || files.length === 0) return;
    const chosen = Array.from(files);
    e.target.value = ''; // allow re-selecting the same file

    // Immediate thumbnails for this session.
    const added = chosen.map(f => ({ name: f.name, url: URL.createObjectURL(f) }));
    setAttachments(prev => ({ ...prev, [studyId]: [...(prev[studyId] || []), ...added] }));

    // Real studies: persist each file to the patient chart (synced
    // patient_documents store, category 'radiology') so the image survives
    // the session and reaches the ordering clinician.
    const study = realStudies.find(s => s.id === studyId);
    if (study) {
      const documentIds: string[] = [];
      for (const file of chosen) {
        if (file.size > MAX_ATTACHMENT_BYTES) continue; // skip oversized silently in toast below
        try {
          const base64Data = await fileToBase64(file);
          const document = await addPatientDocument({
            patientId: study.patientId,
            title: `${study.modality} — ${study.bodyPart}: ${file.name}`,
            category: 'radiology',
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
            base64Data,
            sizeBytes: file.size,
            note: `Attached from radiology work queue (order ${studyId})`,
            uploadedById: currentUser?._id,
            uploadedByName: currentUser?.name,
            hospitalId: currentUser?.hospitalId,
            orgId: currentUser?.orgId,
          });
          documentIds.push(document._id);
        } catch {
          // Persistence failure keeps the session thumbnail; staff can retry.
        }
      }
      if (documentIds.length) {
        const source = labResults.find(result => result._id === studyId);
        const linkedIds = [...new Set([...(source?.studyDocumentIds || []), ...documentIds])];
        await updateLabResult(studyId, { studyDocumentIds: linkedIds, imageCount: linkedIds.length });
      }
    }

    setSubmitToast(t('radiology.imageAttachedFor', { id: studyId }));
    window.setTimeout(() => setSubmitToast(null), 3000);
  };

  const removeAttachment = (studyId: string, url: string) => {
    URL.revokeObjectURL(url);
    setAttachments(prev => ({
      ...prev,
      [studyId]: (prev[studyId] || []).filter(a => a.url !== url),
    }));
  };

  // Real imaging orders flow in from consultation as lab_result docs with
  // specimen 'Imaging' (see clinical-flow/lab-catalog.ts). They are listed
  // first; demo studies fill the queue only in demo mode.

  const studies = useMemo(
    () => [
      ...realStudies,
      // Demo studies only ever carry a date, never a time of day — the Day
      // statistics rail leaves them unplotted rather than guessing an hour.
      ...(IS_DEMO ? SAMPLE_STUDIES : []).map(s => {
        const override = submittedFindings[s.id];
        const statusOverride = studyStatusOverrides[s.id];
        const base = { ...s, patientId: undefined as string | undefined, orderedAt: undefined as string | undefined, completedAt: undefined as string | undefined, isReal: false as const };
        return override
          ? { ...base, status: 'completed', findings: override }
          : { ...base, status: statusOverride || s.status };
      }),
    ],
    [realStudies, submittedFindings, studyStatusOverrides],
  );

  const filtered = useMemo(() => {
    const q = queueSearch.trim().toLowerCase();
    return studies.filter(s => {
      if (filterStatus !== 'all' && s.status !== filterStatus) return false;
      if (!q) return true;
      return [s.patientName, s.modality, s.bodyPart].some(v => (v || '').toLowerCase().includes(q));
    });
  }, [studies, filterStatus, queueSearch]);

  // Day-activity rail: `filtered` is the active status tab plus the search box,
  // so charting it redrew the week every time the reader changed lane. Built
  // from the whole worklist instead — a scheduled study plotted when it was
  // ordered, a reported one when it was read.
  const chartItems = useMemo<DayStatsItem[]>(() => studies.map(study => {
    const reported = study.status === 'completed';
    const at = (reported && study.completedAt) || study.orderedAt;
    return {
      // Demo studies carry a date but no instant; they still belong to a day.
      date: at ? at.slice(0, 10) : study.date,
      time: at ? formatClockTime(at) : undefined,
      series: (reported ? 1 : 0) as 0 | 1,
    };
  }), [studies]);

  const handleSubmitReport = async (studyId: string) => {
    if (!findings.trim()) return;
    const study = realStudies.find(s => s.id === studyId);
    if (study) {
      // Persist to the actual order doc so the findings reach the ordering
      // clinician's consultation view and the HMIS reports.
      await updateLabResult(studyId, {
        result: findings.trim(),
        status: 'completed',
        completedAt: new Date().toISOString(),
      });
      // Mirrors the lab bench's notifyClinician: a report otherwise only
      // surfaces if someone happens to reopen the chart, so page the ordering
      // clinician directly. Best-effort — the report is already durably
      // saved, so a notification failure must not undo that.
      try {
        const { createMessage } = await import('@/modules/communication/services/message-service');
        await createMessage({
          recipientType: 'staff',
          patientId: study.patientId,
          patientName: study.patientName,
          patientPhone: '',
          fromDoctorId: currentUser?._id || 'radiology',
          fromDoctorName: currentUser?.name || 'Radiology',
          fromHospitalName: currentUser?.hospitalName || '',
          subject: `Imaging report ready: ${study.modality} — ${study.bodyPart} for ${study.patientName}`,
          body: `${study.modality} — ${study.bodyPart} for ${study.patientName} has been reported: ${findings.trim()}`,
          channel: 'app',
          sentAt: new Date().toISOString(),
          orgId: currentUser?.orgId,
        });
      } catch (err) {
        console.error('[radiology] clinician notification failed; report was saved', err);
      }
    } else {
      setSubmittedFindings(prev => ({ ...prev, [studyId]: findings.trim() }));
    }
    setFindings('');
    setSubmitToast(t('radiology.reportSubmittedFor', { id: studyId }));
    window.setTimeout(() => setSubmitToast(null), 3000);
  };

  const handleStartStudy = async (studyId: string) => {
    const isReal = realStudies.some(s => s.id === studyId);
    if (isReal) {
      await updateLabResult(studyId, { status: 'in_progress' });
    } else {
      setStudyStatusOverrides(prev => ({ ...prev, [studyId]: 'in_progress' }));
    }
  };

  // Undo a report submitted in this session: drop the in-memory override so the
  // study reverts to its prior (pending / in-progress) status and the findings
  // box reappears. Only applies to findings entered here, not pre-existing ones.
  const handleUndoReport = (studyId: string) => {
    setSubmittedFindings(prev => {
      const next = { ...prev };
      delete next[studyId];
      return next;
    });
  };

  // Real turnaround (orderedAt -> completedAt) computed from actual completed
  // studies only — demo studies never carry timestamps. Null when there's
  // nothing to average yet, so the Performance panel can drop the tile
  // instead of showing a fabricated number.
  const avgTurnaroundMinutes = useMemo(() => {
    const timed = realStudies.filter(s => s.status === 'completed' && s.orderedAt && s.completedAt);
    if (timed.length === 0) return null;
    const totalMinutes = timed.reduce((sum, s) => sum + (new Date(s.completedAt as string).getTime() - new Date(s.orderedAt as string).getTime()) / 60000, 0);
    return Math.round(totalMinutes / timed.length);
  }, [realStudies]);

  const stats = useMemo(() => ({
    total: studies.length,
    pending: studies.filter(s => s.status === 'pending').length,
    inProgress: studies.filter(s => s.status === 'in_progress').length,
    completed: studies.filter(s => s.status === 'completed').length,
    urgent: studies.filter(s => s.priority === 'urgent' || s.priority === 'emergency').length,
    xray: studies.filter(s => s.modality === 'X-Ray').length,
    ultrasound: studies.filter(s => s.modality === 'Ultrasound').length,
  }), [studies]);

  const dateLabel = formatDateTitle(toIsoDate(new Date()));

  const renderRadiologyWorkflowPopup = (study: (typeof filtered)[number]) => {
    const isPending = study.status === 'pending';
    const isProcessing = study.status === 'in_progress';
    const isComplete = study.status === 'completed';
    const attachmentCount = (attachments[study.id] || []).length;
    const canUndo = !!submittedFindings[study.id];
    // Replaces the old 7-step checklist strip: one line of plain-language
    // progress instead of a receipt of every stage the order has moved through.
    const reportState = isComplete
      ? 'Findings recorded — report complete.'
      : isProcessing
        ? (attachmentCount > 0 ? `${attachmentCount} image(s) attached — awaiting interpretation.` : 'Acquisition in progress.')
        : 'Awaiting image acquisition.';

    return (
    <div className="space-y-3">
      {/* First line: the study itself, with the actions this radiographer can
          actually take right now as icon buttons. */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="block font-semibold uppercase tracking-wider text-[10px]" style={{ color: 'var(--text-muted)' }}>Study</span>
          <strong className="text-sm" style={{ color: 'var(--text-primary)' }}>{study.modality} — {study.bodyPart}</strong>
          {study.orderedBy && (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('radiology.orderedBy')}: {study.orderedBy}</p>
          )}
        </div>
        <div className="ehr-visit-pop-actions">
          {isPending && (
            <button
              type="button"
              className="ehr-visit-pop-icon is-primary"
              onClick={() => handleStartStudy(study.id)}
              aria-label="Start study"
              title="Start study"
            >
              <Play className="w-4 h-4" aria-hidden />
            </button>
          )}
          {!isComplete && (
            <button
              type="button"
              className="ehr-visit-pop-icon"
              onClick={(e) => { e.stopPropagation(); openAttachDialog(study.id); }}
              aria-label={t('radiology.attachImage')}
              title={t('radiology.attachImageTitle')}
            >
              <Upload className="w-4 h-4" aria-hidden />
            </button>
          )}
          {canUndo && (
            <button
              type="button"
              className="ehr-visit-pop-icon"
              onClick={(e) => { e.stopPropagation(); handleUndoReport(study.id); }}
              aria-label={t('action.undo')}
              title={t('action.undo')}
            >
              <RotateCcw className="w-4 h-4" aria-hidden />
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-xl p-3" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
          <span className="block font-semibold uppercase tracking-wider text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>Priority</span>
          <strong style={{ color: 'var(--text-primary)' }}>{radiologyPriorityLabel(study.priority)}</strong>
        </div>
        <div className="rounded-xl p-3" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
          <span className="block font-semibold uppercase tracking-wider text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>Report state</span>
          <p style={{ color: 'var(--text-primary)' }}>{reportState}</p>
        </div>
      </div>

      {study.notes && (
        <div className="rounded-xl p-3" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
          <span className="block font-semibold uppercase tracking-wider text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>{t('radiology.clinicalNotes')}</span>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{study.notes}</p>
        </div>
      )}

      {study.findings && (
        <div className="p-3 rounded-lg" style={{ background: '#0E946314', border: '1px solid #0E946333' }}>
          <span className="text-[9px] font-bold uppercase" style={{ color: 'var(--color-success-text)' }}>{t('radiology.findings')}</span>
          <p className="text-xs mt-1" style={{ color: 'var(--text-primary)' }}>{study.findings}</p>
        </div>
      )}

      {study.status !== 'completed' && (
        <div>
          <label className="text-[10px] font-bold uppercase block mb-1" style={{ color: 'var(--text-muted)' }}>{t('radiology.enterFindings')}</label>
          <textarea rows={3} value={findings} onChange={e => setFindings(e.target.value)}
            placeholder={t('radiology.findingsPlaceholder')}
            className="w-full p-3 rounded-lg text-xs" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)', resize: 'vertical' }}
          />
          <button
            onClick={() => handleSubmitReport(study.id)}
            disabled={!findings.trim()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold mt-2"
            style={{
              background: findings.trim() ? ACCENT : 'var(--overlay-subtle)',
              color: findings.trim() ? '#fff' : 'var(--text-muted)',
              border: 'none',
              cursor: findings.trim() ? 'pointer' : 'not-allowed',
              opacity: findings.trim() ? 1 : 0.7,
            }}
          >
            <CheckCircle2 className="w-3 h-3" /> {t('radiology.submitReport')}
          </button>
        </div>
      )}

      {/* Attached imaging files */}
      {attachmentCount > 0 && (
        <div>
          <span className="text-[9px] font-bold uppercase block mb-1.5" style={{ color: 'var(--text-muted)' }}>
            {t('radiology.attachedImages')}
          </span>
          <div className="flex flex-wrap gap-2">
            {(attachments[study.id] || []).map(att => (
              <div key={att.url} className="relative rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-medium)', width: 96 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={att.url} alt={att.name} style={{ width: 96, height: 72, objectFit: 'cover', display: 'block', background: 'var(--overlay-subtle)' }} />
                <button
                  onClick={(e) => { e.stopPropagation(); removeAttachment(study.id, att.url); }}
                  title={t('radiology.removeImage')}
                  className="absolute top-1 end-1 flex items-center justify-center rounded-full"
                  style={{ width: 18, height: 18, background: 'rgba(0, 29, 63,0.65)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 11, lineHeight: 1 }}
                >
                  ×
                </button>
                <span className="block px-1.5 py-1 text-[9px] truncate" style={{ color: 'var(--text-muted)', background: 'var(--bg-card-solid)' }}>{att.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
    );
  };

  if (!currentUser) return null;

  return (
    <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Hidden picker for study image attachments (JPEG/PNG/DICOM exports) */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.dcm"
        multiple
        onChange={handleFilesChosen}
        style={{ display: 'none' }}
      />

      {IS_DEMO && <DemoModeBanner />}

      {submitToast && (
        <div
          role="status"
          className="mb-3 flex items-center gap-2 px-3 py-2 rounded-md text-xs font-semibold"
          style={{ background: 'rgba(14, 148, 99,0.10)', border: '1px solid rgba(14, 148, 99,0.25)', color: 'var(--color-success-text)' }}
        >
          <CheckCircle2 className="w-3.5 h-3.5" /> {submitToast}
        </div>
      )}

      <EhrCareDashboard
        title={t('radiology.title')}
        greetingName={currentUser?.name}
        dateLabel={dateLabel}
        // Station work-queue tabs, keyed by the study's own status values:
        // Queued = ordered/pending, In Progress = being imaged, Completed =
        // reported. The stat tiles below keep an All escape hatch.
        tabs={[
          { key: 'pending', label: t('workQueue.queued'), count: stats.pending },
          { key: 'in_progress', label: t('workQueue.inProgress'), count: stats.inProgress },
          { key: 'completed', label: t('workQueue.completed'), count: stats.completed },
        ]}
        activeTab={filterStatus}
        onTabChange={setFilterStatus}
        searchValue={queueSearch}
        searchPlaceholder={t('radiology.imagingWorklist')}
        onSearchChange={setQueueSearch}
        // A study stays on the worklist until it's reported, regardless of
        // which calendar day is selected — an un-reported scan from
        // yesterday must not disappear while the tab counts still include it.
        filterRowsByDate={false}
        filters={[
          { label: t('radiology.filter_all'), value: stats.total, active: filterStatus === 'all', onClick: () => setFilterStatus('all') },
          { label: t('workQueue.queued'), value: stats.pending, active: filterStatus === 'pending', onClick: () => setFilterStatus(filterStatus === 'pending' ? 'all' : 'pending') },
          { label: t('workQueue.inProgress'), value: stats.inProgress, active: filterStatus === 'in_progress', onClick: () => setFilterStatus(filterStatus === 'in_progress' ? 'all' : 'in_progress') },
          { label: t('workQueue.completed'), value: stats.completed, active: filterStatus === 'completed', onClick: () => setFilterStatus(filterStatus === 'completed' ? 'all' : 'completed') },
        ]}
        actions={[
          // tourTarget: the guided tour opens this panel via preClickSelector
          // before spotlighting station-body, which otherwise isn't in the DOM
          // until a panel is open (see journeys/radiology.ts's 'panels' step).
          { label: t('radiology.byModality'), icon: BarChart3, onClick: () => togglePanel('modality'), active: centerPanel === 'modality', tone: centerPanel === 'modality' ? 'primary' : 'neutral', tourTarget: 'radiology-modality-toggle' },
          { label: t('radiology.bodyRegions'), icon: FileText, onClick: () => togglePanel('regions'), active: centerPanel === 'regions', tone: centerPanel === 'regions' ? 'primary' : 'neutral' },
          { label: t('radiology.performance'), icon: TrendingUp, onClick: () => togglePanel('performance'), active: centerPanel === 'performance', tone: centerPanel === 'performance' ? 'primary' : 'neutral' },
        ]}
        hideRowList={centerPanel !== null}
        // Real studies carry a time (orderedAt/completedAt); demo studies never
        // do, so they surface as "without a recorded time" instead of guessing.
        // done→series1 lines up exactly with completed vs everything else.
        chartSeriesNames={['Scheduled', 'Reported']}
        chartItems={chartItems}
        rows={filtered.map((study): EhrCareDashboardRow => {
          const time = study.status === 'completed'
            ? (study.completedAt ? formatClockTime(study.completedAt) : undefined)
            : (study.orderedAt ? formatClockTime(study.orderedAt) : undefined);
          return {
            id: study.id,
            title: study.patientName,
            patientId: study.patientId,
            subtitle: `${study.modality} · ${study.bodyPart}`,
            compactMeta: study.date,
            date: study.date,
            time,
            timeSecondary: study.date,
            careTeam: study.orderedBy,
            careTeamLabel: 'Ordered by',
            location: study.modality,
            locationSecondary: study.bodyPart,
            status: study.status,
            statusLabel: radiologyStatusLabel(study.status),
            statusSecondary: appointmentPriorityLabel(study.priority),
            statusTone: study.status === 'completed' ? 'done'
              : study.status === 'in_progress' ? 'active'
              : study.priority === 'emergency' ? 'danger'
              : study.priority === 'urgent' ? 'warning'
              : 'scheduled',
            // study.priority is a real urgency, not free text — it maps onto the
            // same acuity codes, and the same words, every other worklist uses.
            priority: appointmentTriage(study.priority),
            detailHref: study.patientId
              ? `/patients/${encodeURIComponent(study.patientId)}?tab=labs&focus=${encodeURIComponent(study.id)}&returnTo=${encodeURIComponent('/dashboard/radiology')}`
              : undefined,
            detailLabel: study.patientId ? t('dashboard.viewPatientRecord') : undefined,
            // Pending/In Progress/Complete IS the imaging worklist — a same-day
            // visit must not paint over it with the appointment ladder. The
            // shared shell still surfaces the visit status on the line under
            // the pill when one exists.
            lockStatus: true,
            popupDetail: renderRadiologyWorkflowPopup(study),
          };
        })}
        metrics={[
          { label: t('radiology.kpiUrgentEmergency'), value: stats.urgent, tone: 'danger' },
          { label: t('radiology.kpiXrays'), value: stats.xray },
          { label: t('radiology.kpiUltrasounds'), value: stats.ultrasound },
        ]}
        metricsTitle={t('radiology.title')}
        emptyTitle={t('radiology.noStudies')}
      >
        {/* Stat panels — opened from the header toggles; the active one
            replaces the worklist and occupies the whole center. */}
        {centerPanel === 'modality' && (
          <div className="dash-card">
            <div className="flex items-center gap-2 mb-4 pb-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
              <BarChart3 className="w-4 h-4" style={{ color: ACCENT }} />
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('radiology.byModality')}</span>
            </div>
            <div className="p-4 space-y-3">
              {MODALITIES.map(mod => {
                const count = studies.filter(s => s.modality === mod).length;
                const pct = studies.length > 0 ? Math.round((count / studies.length) * 100) : 0;
                return (
                  <div key={mod}>
                    <div className="flex justify-between mb-1">
                      <span className="text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>{mod}</span>
                      <span className="text-[11px] font-bold" style={{ color: count > 0 ? ACCENT : 'var(--text-muted)' }}>{count}</span>
                    </div>
                    <div className="w-full h-2 rounded-full" style={{ background: 'var(--overlay-medium)' }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: ACCENT }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {centerPanel === 'regions' && (
          <div className="dash-card">
            <div className="flex items-center gap-2 mb-4 pb-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
              <FileText className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('radiology.bodyRegions')}</span>
            </div>
            <div className="p-4 space-y-1">
              {[...new Set(studies.map(s => s.bodyPart))].map(part => (
                <div key={part} className="flex items-center justify-between py-1.5" style={{ borderBottom: '1px solid var(--border-light)' }}>
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{part}</span>
                  <span className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{studies.filter(s => s.bodyPart === part).length}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {centerPanel === 'performance' && (
          <div className="dash-card">
            <div className="flex items-center gap-2 mb-4 pb-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
              <TrendingUp className="w-4 h-4" style={{ color: 'var(--color-success)' }} />
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('radiology.performance')}</span>
            </div>
            <div className="p-4 grid grid-cols-2 gap-3">
              {[
                { label: t('radiology.completionRate'), value: `${studies.length > 0 ? Math.round((stats.completed / stats.total) * 100) : 0}%` },
                // Only shown once there's a real completed study to average —
                // no fabricated placeholder turnaround.
                ...(avgTurnaroundMinutes !== null ? [{ label: t('radiology.kpiAvgTat'), value: formatTurnaround(avgTurnaroundMinutes) }] : []),
              ].map(s => (
                <div key={s.label} className="p-2.5 rounded-md text-center" style={{ background: 'var(--overlay-subtle)' }}>
                  <div className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{s.value}</div>
                  <div className="text-[9px] font-semibold" style={{ color: 'var(--text-muted)' }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </EhrCareDashboard>
    </main>
  );
}
