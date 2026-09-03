'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Modal from '@/components/Modal';
import Link from 'next/link';
import PatientAvatar from '@/components/patients/PatientAvatar';
import { patientAgeLabel } from '@/lib/patient-utils';
import EmptyState from '@/components/EmptyState';
import Badge, { toneForStatus } from '@/components/Badge';
import {
  ArrowRightLeft, Plus, CheckCircle2,
  AlertTriangle, ChevronDown, ChevronUp, X,
  Stethoscope, Package, FileText, Image as ImageIcon,
  User, Activity, FlaskConical, Paperclip, XCircle, MessageSquarePlus,
  ClipboardCheck, RotateCcw,
  ExternalLink,
} from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useReferrals } from '@/lib/hooks/useReferrals';
import { usePatients } from '@/lib/hooks/usePatients';
import { useAuth } from '@/lib/context';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { useToast } from '@/components/Toast';
import EhrListHeader, { EhrListHeaderButton, LIST_STAT_COLORS } from '@/components/ehr/EhrListHeader';
import ReferralFilterFields, { referralFilterCount, type ReferralFilterState } from '@/components/referrals/ReferralFilters';
import RowActionsPopup, { rowActionsAt, rowActionsFromElement, isRowActivationKey, type RowActionsPopupState } from '@/components/RowActionsPopup';
import type { RowAction } from '@/components/referrals/RowActionsMenu';
import ReferralFormModal from '@/components/referrals/ReferralFormModal';
import type { Attachment, TransferPackage, ReferralDisposition } from '@/data/mock';
import { formatPhoneShared } from '@/lib/field-formats';
import { formatAppointmentTimeUntil } from '@/lib/format-utils';
import Select from '@/components/Select';
import { todayIso } from '@/lib/date-utils';
import { stopsClickPropagation, dismissBackdrop } from '@/lib/a11y';

const isImage = (mimeType: string) => mimeType.startsWith('image/');

/** Initials plate for a row whose patient doc is outside this device's scope
 *  (PatientAvatar needs the doc) — same fallback the transfers queue draws. */
const INITIALS_PLATE_STYLE = {
  width: 40, height: 40, borderRadius: 12, flexShrink: 0,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--overlay-subtle)', color: 'var(--text-secondary)',
  fontSize: 12, fontWeight: 700, letterSpacing: '0.02em',
} as const;

function nameInitials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

/**
 * The route cell's age line: elapsed time ("2h 15m ago") while the referral is
 * same-day, the full date once it is older — the point where "38h ago" stops
 * meaning anything. `createdAt` supplies the clock time, but only when it
 * falls on the referral's own date: a seeded or imported old referral carries
 * a fresh `createdAt`, which read as "16s ago" on February rows. Date-only
 * values are parsed as LOCAL midnight — a bare "2026-02-09" parses as UTC and
 * renders a day early anywhere west of Greenwich.
 */
function referralAgeLabel(ref: { createdAt?: string; referralDate?: string }): string {
  const raw = ref.createdAt && ref.createdAt.slice(0, 10) === (ref.referralDate || '').slice(0, 10)
    ? ref.createdAt
    : ref.referralDate;
  if (!raw) return '';
  return formatAppointmentTimeUntil(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const DISPOSITION_OPTIONS: ReferralDisposition[] = [
  'treated_discharged', 'admitted', 'referred_onward', 'did_not_arrive', 'deceased',
];

/* The registry/appointments pill vocabulary, mapped onto the referral ladder:
   sent = booked-and-waiting blue, received = active, seen = in progress,
   completed/cancelled keep their semantic tones. */
const STATUS_PILL_CLASS: Record<string, string> = {
  sent: 'status-scheduled',
  received: 'status-checked-in',
  seen: 'status-in-progress',
  completed: 'status-completed',
  cancelled: 'status-cancelled',
};

/**
 * The transfer package a referral carries, rendered read-only in the detail
 * pane.
 *
 * Module scope, not declared inside ReferralsPage: a component created
 * during render is a new type every render, so React threw away and rebuilt
 * this whole 260-line subtree — including any scroll position in it —
 * every time the page re-rendered underneath it.
 */
function TransferPackageViewer({ pkg, refAttachments, reason, notes, onPreview }: {
  pkg: TransferPackage;
  refAttachments?: Attachment[];
  reason: string;
  notes: string;
  /** Opens the page's attachment lightbox — the one surface outside this
   *  component that the viewer drives. */
  onPreview: (attachment: Attachment) => void;
}) {
  const { t } = useTranslation();
  // Which clinical records are unfolded: the viewer's own business, and
  // nothing outside it ever read this.
  const [expandedRecords, setExpandedRecords] = useState<Set<string>>(new Set());
  const demo = pkg.patientDemographics;
  return (
    <div className="space-y-4 mt-4">
      {/* Reason & Notes */}
      <div className="grid grid-cols-2 gap-4">
        <div className="p-3 rounded-lg" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
          <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{t('referrals.reasonForReferral')}</p>
          <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{reason}</p>
        </div>
        <div className="p-3 rounded-lg" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
          <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{t('referral.notes')}</p>
          <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text-primary)' }}>{notes || t('referrals.none')}</p>
        </div>
      </div>

      <hr className="section-divider" />

      {/* Referral Attachments */}
      {refAttachments && refAttachments.length > 0 && (
        <div className="p-4 rounded-lg" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
          <div className="flex items-center gap-2 mb-3">
            <div className="icon-box-sm">
              <Paperclip className="w-4 h-4" style={{ color: 'var(--tamamhealth-blue)' }} />
            </div>
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t('referrals.referralAttachments', { count: refAttachments.length })}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {refAttachments.map(att => (
              <button key={att.id} onClick={() => onPreview(att)} className="flex items-center gap-2 p-2 rounded-lg text-start transition-colors" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
                {isImage(att.mimeType) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`data:${att.mimeType};base64,${att.base64Data}`} alt={att.name} className="w-8 h-8 rounded object-cover flex-shrink-0" />
                ) : (
                  <FileText className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--color-danger)' }} />
                )}
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate">{att.name}</p>
                  <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{formatFileSize(att.sizeBytes)}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <hr className="section-divider" />

      {/* Patient Demographics */}
      <div className="p-4 rounded-lg" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
        <div className="flex items-center gap-2 mb-3">
          <div className="icon-box-sm">
            <User className="w-4 h-4" style={{ color: 'var(--tamamhealth-blue)' }} />
          </div>
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t('referrals.patientDemographics')}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { l: t('referrals.demoName'), v: `${demo.firstName} ${demo.middleName || ''} ${demo.surname}`.replace(/\s+/g, ' ').trim() },
            { l: t('referrals.demoHospitalNo'), v: demo.hospitalNumber },
            { l: t('referrals.demoDob'), v: demo.dateOfBirth },
            { l: t('patient.gender'), v: demo.gender },
            { l: t('patient.phone'), v: formatPhoneShared(demo.phone) },
            { l: t('patient.location'), v: `${demo.county}, ${demo.state}` },
            { l: t('patient.tribe'), v: demo.tribe },
            { l: t('patient.bloodType'), v: demo.bloodType },
          ].map(item => (
            <div key={item.l}>
              <p className="text-[10px] font-semibold uppercase" style={{ color: 'var(--text-muted)' }}>{item.l}</p>
              <p className="text-sm font-semibold">{item.v}</p>
            </div>
          ))}
        </div>
        {demo.allergies?.length > 0 && demo.allergies[0] !== 'None known' && (
          <div className="mt-3 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5" style={{ color: 'var(--color-danger-text)' }} />
            <span className="text-xs font-bold" style={{ color: 'var(--color-danger-text)' }}>
              {t('referrals.allergiesLabel', { list: demo.allergies.join(', ') })}
            </span>
          </div>
        )}
        {demo.chronicConditions?.length > 0 && demo.chronicConditions[0] !== 'None' && (
          <div className="mt-1 flex items-center gap-2">
            <Activity className="w-3.5 h-3.5" style={{ color: 'var(--color-warning)' }} />
            <span className="text-xs font-bold" style={{ color: 'var(--color-warning-text)' }}>
              {t('referrals.chronicLabel', { list: demo.chronicConditions.join(', ') })}
            </span>
          </div>
        )}
        <div className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          {t('referrals.nokLabel', { name: demo.nokName, relationship: demo.nokRelationship, phone: demo.nokPhone })}
        </div>
      </div>

      <hr className="section-divider" />

      {/* Medical Records Timeline */}
      {pkg.medicalRecords.length > 0 && (
        <div className="p-4 rounded-lg" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
          <div className="flex items-center gap-2 mb-3">
            <div className="icon-box-sm">
              <Stethoscope className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
            </div>
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t('referrals.medicalRecords', { count: pkg.medicalRecords.length })}</span>
          </div>
          <div className="data-row-divider-sm">
            {pkg.medicalRecords.map(rec => {
              const isExpanded = expandedRecords.has(rec.id);
              return (
                <div key={rec.id} className="rounded-lg" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
                  <button
                    onClick={() => setExpandedRecords(prev => {
                      const next = new Set(prev);
                      if (next.has(rec.id)) next.delete(rec.id); else next.add(rec.id);
                      return next;
                    })}
                    className="w-full flex items-center justify-between p-3 text-start"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{rec.visitDate}</span>
                      <Badge tone={rec.visitType === 'emergency' ? 'danger' : rec.visitType === 'inpatient' ? 'warning' : 'neutral'}>
                        {rec.visitType}
                      </Badge>
                      <span className="text-sm font-semibold">{rec.department}</span>
                    </div>
                    {isExpanded ? <ChevronUp className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} /> : <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />}
                  </button>
                  {isExpanded && (
                    <div className="px-3 pb-3 space-y-2">
                      <p className="text-xs"><span className="font-semibold">{t('referrals.complaintLabel')}</span> {rec.chiefComplaint}</p>
                      <p className="text-xs"><span className="font-semibold">{t('referrals.providerLabel')}</span> {rec.providerName} ({rec.providerRole}) {t('referrals.atFacility')} {rec.hospitalName}</p>
                      {rec.diagnoses.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold uppercase mb-1" style={{ color: 'var(--text-muted)' }}>{t('referrals.diagnoses')}</p>
                          <div className="flex flex-wrap gap-1">
                            {rec.diagnoses.map((d, i) => (
                              <span key={i} className="text-[10px] px-2 py-0.5 rounded" style={{ background: 'var(--accent-light)', color: 'var(--tamamhealth-blue)' }}>
                                {d.icd10Code} {d.name}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {rec.vitalSigns && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                          <span>Temp: {rec.vitalSigns.temperature}°C</span>
                          <span>BP: {rec.vitalSigns.systolic}/{rec.vitalSigns.diastolic}</span>
                          <span>Pulse: {rec.vitalSigns.pulse}</span>
                          <span>SpO2: {rec.vitalSigns.oxygenSaturation}%</span>
                        </div>
                      )}
                      {rec.prescriptions.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold uppercase mb-1" style={{ color: 'var(--text-muted)' }}>{t('tab.prescriptions')}</p>
                          <div className="data-row-divider-sm">
                            {rec.prescriptions.map((rx, i) => (
                              <p key={i} className="text-xs">{rx.drugName} — {rx.dose} {rx.route} {rx.frequency} x {rx.duration}</p>
                            ))}
                          </div>
                        </div>
                      )}
                      {rec.treatmentPlan && (
                        <p className="text-xs"><span className="font-semibold">{t('referrals.planLabel')}</span> {rec.treatmentPlan}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <hr className="section-divider" />

      {/* Lab Results */}
      {pkg.labResults.length > 0 && (
        <div className="p-4 rounded-lg" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
          <div className="flex items-center gap-2 mb-3">
            <div className="icon-box-sm">
              <FlaskConical className="w-4 h-4" style={{ color: 'var(--tamamhealth-blue)' }} />
            </div>
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t('referrals.labResults', { count: pkg.labResults.length })}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs" style={{ minWidth: 600 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-light)' }}>
                  <th className="text-start py-1.5 pe-3 font-bold" style={{ color: 'var(--text-muted)' }}>{t('lab.testName')}</th>
                  <th className="text-start py-1.5 pe-3 font-bold" style={{ color: 'var(--text-muted)' }}>{t('lab.result')}</th>
                  <th className="text-start py-1.5 pe-3 font-bold" style={{ color: 'var(--text-muted)' }}>{t('lab.reference')}</th>
                  <th className="text-start py-1.5 pe-3 font-bold" style={{ color: 'var(--text-muted)' }}>{t('referrals.date')}</th>
                  <th className="text-start py-1.5 font-bold" style={{ color: 'var(--text-muted)' }}>{t('lab.status')}</th>
                </tr>
              </thead>
              <tbody>
                {pkg.labResults.map((lab, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <td className="py-1.5 pe-3 font-semibold">{lab.testName}</td>
                    <td className="py-1.5 pe-3" style={{ color: lab.abnormal ? (lab.critical ? 'var(--color-danger-text)' : 'var(--color-warning-text)') : 'inherit', fontWeight: lab.abnormal ? 600 : 400 }}>
                      {lab.result} {lab.unit}
                    </td>
                    <td className="py-1.5 pe-3" style={{ color: 'var(--text-muted)' }}>{lab.referenceRange}</td>
                    <td className="py-1.5 pe-3 font-mono" style={{ color: 'var(--text-muted)' }}>{lab.date}</td>
                    <td className="py-1.5">
                      {lab.abnormal ? (
                        <Badge tone={lab.critical ? 'danger' : 'warning'}>
                          {lab.critical ? t('referrals.labCritical') : t('lab.abnormal')}
                        </Badge>
                      ) : (
                        <Badge tone="success">{t('lab.normal')}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <hr className="section-divider" />

      {/* All Patient Attachments */}
      {pkg.attachments.length > 0 && (
        <div className="p-4 rounded-lg" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
          <div className="flex items-center gap-2 mb-3">
            <div className="icon-box-sm">
              <ImageIcon className="w-4 h-4" style={{ color: 'var(--tamamhealth-blue)' }} />
            </div>
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t('referrals.patientAttachments', { count: pkg.attachments.length })}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {pkg.attachments.map(att => (
              <button key={att.id} onClick={() => onPreview(att)} className="flex flex-col items-center gap-1 p-3 rounded-lg text-center transition-colors" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
                {isImage(att.mimeType) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`data:${att.mimeType};base64,${att.base64Data}`} alt={att.name} className="w-12 h-12 rounded object-cover" />
                ) : (
                  <FileText className="w-8 h-8" style={{ color: 'var(--color-danger)' }} />
                )}
                <p className="text-[10px] font-semibold truncate w-full">{att.name}</p>
                <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{formatFileSize(att.sizeBytes)}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      <hr className="section-divider" />

      {/* Package Metadata */}
      <div className="flex items-center gap-3 p-3 rounded-lg text-xs" style={{ background: 'rgba(33, 145, 208, 0.06)', border: '1px solid var(--accent-border)' }}>
        <div className="icon-box-sm flex-shrink-0">
          <Package className="w-4 h-4" style={{ color: 'var(--tamamhealth-blue)' }} />
        </div>
        <span style={{ color: 'var(--text-muted)' }}>
          {t('referrals.packagedByPrefix')} <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{pkg.packagedBy}</span> {t('referrals.packagedOnAt', { date: new Date(pkg.packagedAt).toLocaleDateString(), time: new Date(pkg.packagedAt).toLocaleTimeString() })}
        </span>
        <span style={{ color: 'var(--text-muted)' }}>
          {t('referrals.totalSize')} <span className="font-semibold">{formatFileSize(pkg.packageSizeBytes)}</span>
        </span>
        <span style={{ color: 'var(--text-muted)' }}>
          {t('referrals.packageCounts', { records: pkg.medicalRecords.length, labs: pkg.labResults.length, files: pkg.attachments.length })}
        </span>
      </div>
    </div>
  );
}

export default function ReferralsPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const { referrals, accept, updateStatus, updateNotes, completeWithOutcome } = useReferrals();
  const { showToast } = useToast();
  const { patients } = usePatients();
  const { currentUser } = useAuth();
  const [localSearch, setLocalSearch] = useState('');
  const { canManageReferrals } = usePermissions();
  const OUR_HOSPITAL_ID = currentUser?.hospitalId || '';

  const searchParams = useSearchParams();
  // Deep link from consultation (?tab=outgoing) after a referral is created,
  // so the clinician lands on the tab that actually shows what they just sent.
  const [activeTab, setActiveTab] = useState<'incoming' | 'outgoing'>(() => (
    searchParams?.get('tab') === 'outgoing' ? 'outgoing' : 'incoming'
  ));
  const [showNewReferral, setShowNewReferral] = useState(false);
  const [expandedReferral, setExpandedReferral] = useState<string | null>(null);
  // One popup for the table; the clicked row supplies its actions and position.
  const [rowMenu, setRowMenu] = useState<RowActionsPopupState | null>(null);
  // Structured filters — surfaced in a popover beside the platform search bar.
  const [colFilters, setColFilters] = useState<ReferralFilterState>({ patient: '', route: '', department: '', urgency: '', status: '' });
  // Deep link from a patient chart: /referrals?patient=<name> pre-filters.
  useEffect(() => {
    const patientParam = searchParams?.get('patient');
    if (patientParam) setColFilters(f => ({ ...f, patient: patientParam }));
  }, [searchParams]);
  const setColFilter = (k: keyof ReferralFilterState, v: string) => setColFilters(f => ({ ...f, [k]: v }));
  const clearColFilters = () => setColFilters({ patient: '', route: '', department: '', urgency: '', status: '' });

  // Modal state for decline, complete, and add note
  const [declineModalId, setDeclineModalId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const [completeModalId, setCompleteModalId] = useState<string | null>(null);
  const [completeOutcome, setCompleteOutcome] = useState('');
  const [completeDisposition, setCompleteDisposition] = useState<ReferralDisposition>('treated_discharged');
  const [completeFollowUp, setCompleteFollowUp] = useState('');
  const [noteModalId, setNoteModalId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [actionSubmitting, setActionSubmitting] = useState(false);

  // Reverse a referral status transition back to its prior state. Clinical
  // status changes are confirmed before they are undone. Backed by the existing
  // referral-service `updateReferralStatus`, which accepts any target status.
  const [reverseModal, setReverseModal] = useState<{ id: string; to: 'sent' | 'received'; name: string } | null>(null);

  const handleReverseStatus = async () => {
    if (!reverseModal) return;
    try {
      setActionSubmitting(true);
      await updateStatus(reverseModal.id, reverseModal.to);
      showToast(t('action.undo'), 'success');
      setReverseModal(null);
    } catch {
      showToast(t('error.title'), 'error');
    } finally {
      setActionSubmitting(false);
    }
  };

  // Track viewed referrals for notification badge
  const [viewedReferralIds, setViewedReferralIds] = useState<Set<string>>(new Set());

  // Transfer package viewer state
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);

  // Filter referrals
  const incomingReferrals = referrals.filter(r => r.toHospitalId === OUR_HOSPITAL_ID);
  const outgoingReferrals = referrals.filter(r => r.fromHospitalId === OUR_HOSPITAL_ID);
  const activeReferrals = activeTab === 'incoming' ? incomingReferrals : outgoingReferrals;

  // Referral network analytics: top destinations + acceptance rate.
  // For each receiving facility, count how many referrals we sent there
  // and what fraction were accepted (status sent → received → seen → completed).
  // New incoming referrals (status 'sent') for notification badge
  const newIncomingCount = incomingReferrals.filter(r => r.status === 'sent' && !viewedReferralIds.has(r._id)).length;

  // Auto-mark as 'received' when user expands an incoming referral with status 'sent'
  useEffect(() => {
    if (expandedReferral && activeTab === 'incoming') {
      const ref = incomingReferrals.find(r => r._id === expandedReferral && r.status === 'sent');
      if (ref) {
        setViewedReferralIds(prev => new Set(prev).add(ref._id));
        updateStatus(ref._id, 'received').catch(() => {});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedReferral]);

  // The referral open in the detail popup. Resolved against the unfiltered
  // list on purpose: a status change made from the popup (accept, complete)
  // can move the row out of the current filter, and the dialog should not
  // vanish mid-read because of it.
  const detailReferral = expandedReferral
    ? activeReferrals.find(r => r._id === expandedReferral)
    : undefined;
  const detailPackage = detailReferral?.transferPackage as TransferPackage | undefined;

  // Search filtering (+ status filter)
  const combinedSearch = localSearch.toLowerCase().trim();
  const filteredReferrals = activeReferrals.filter(r => {
    const f = colFilters;
    if (combinedSearch) {
      const haystack = `${r.patientName} ${r.fromHospital} ${r.toHospital} ${r.department} ${r.referringDoctor} ${r.notes} ${r.reason}`.toLowerCase();
      if (!combinedSearch.split(/\s+/).every(term => haystack.includes(term))) return false;
    }
    if (f.patient && !`${r.patientName} ${r.patientId}`.toLowerCase().includes(f.patient.toLowerCase())) return false;
    if (f.route && !`${r.fromHospital} ${r.toHospital}`.toLowerCase().includes(f.route.toLowerCase())) return false;
    if (f.department && !(r.department || '').toLowerCase().includes(f.department.toLowerCase())) return false;
    if (f.urgency && r.urgency !== f.urgency) return false;
    if (f.status && r.status !== f.status) return false;
    return true;
  });

  // Patient _id → hospital number, so the table can show the facility-facing ID
  // (e.g. JTH-00012) rather than the internal record id.
  const hospitalNoByPatient = new Map(patients.map(p => [p._id, p.hospitalNumber]));
  const hospitalNoFor = (pid: string) => hospitalNoByPatient.get(pid) || pid;
  // Backs the avatar + name identity cell (photo, gender tint) shared with the
  // lab queue and the patient registry.
  const patientById = new Map(patients.map(p => [p._id, p]));
  // Seeded demo referrals point at patients with no chart to open.
  const isRealPatient = (pid: string) => !!pid && !pid.startsWith('demo-') && !pid.includes('_demo');

  // Urgency / status option lists shared by the filter popover.
  const urgencyOptions = [
    { v: 'routine', l: t('referrals.urgency_routine') },
    { v: 'urgent', l: t('referrals.urgency_urgent') },
    { v: 'emergency', l: t('referrals.urgency_emergency') },
  ];

  const getStatusLabel = (status: string) => {
    const map: Record<string, string> = {
      sent: t('referral.sent'),
      received: t('referral.received'),
      seen: t('referral.seen'),
      completed: t('referral.completed'),
      cancelled: t('referral.cancelled'),
    };
    return map[status] || status;
  };

  // KPI counts for the header stat cards — scoped to the active tab so the
  // numbers update as the clinician switches between incoming and outgoing.
  const acceptedCount = activeReferrals.filter(r => r.status === 'seen' || r.status === 'completed').length;
  const declinedCount = activeReferrals.filter(r => r.status === 'cancelled').length;
  const pendingCount = activeReferrals.filter(r => r.status === 'sent' || r.status === 'received').length;
  const completedCount = activeReferrals.filter(r => r.status === 'completed').length;


  const handleDecline = async () => {
    if (!declineModalId || !declineReason.trim()) return;
    try {
      setActionSubmitting(true);
      const ref = referrals.find(r => r._id === declineModalId);
      const existingNotes = ref?.notes || '';
      const declineNote = `[${todayIso()} ${currentUser?.name || 'Unknown'}] DECLINED: ${declineReason.trim()}`;
      const updatedNotes = existingNotes ? `${existingNotes}\n\n${declineNote}` : declineNote;
      await updateStatus(declineModalId, 'cancelled');
      await updateNotes(declineModalId, updatedNotes);
      showToast(t('referrals.toastDeclined'), 'success');
      setDeclineModalId(null);
      setDeclineReason('');
    } catch {
      showToast(t('referrals.toastDeclineFailed'), 'error');
    } finally {
      setActionSubmitting(false);
    }
  };

  const handleComplete = async () => {
    if (!completeModalId || !completeOutcome.trim()) return;
    try {
      setActionSubmitting(true);
      await completeWithOutcome(completeModalId, {
        disposition: completeDisposition,
        summary: completeOutcome.trim(),
        followUp: completeFollowUp.trim() || undefined,
        recordedBy: currentUser?.name || 'Unknown',
        recordedAt: new Date().toISOString(),
      });
      showToast(t('referrals.toastCompleted'), 'success');
      setCompleteModalId(null);
      setCompleteOutcome('');
      setCompleteDisposition('treated_discharged');
      setCompleteFollowUp('');
    } catch {
      showToast(t('referrals.toastCompleteFailed'), 'error');
    } finally {
      setActionSubmitting(false);
    }
  };

  const handleAddNote = async () => {
    if (!noteModalId || !noteText.trim()) return;
    try {
      setActionSubmitting(true);
      const ref = referrals.find(r => r._id === noteModalId);
      const existingNotes = ref?.notes || '';
      const newNote = `[${todayIso()} ${currentUser?.name || 'Unknown'}] ${noteText.trim()}`;
      const updatedNotes = existingNotes ? `${existingNotes}\n\n${newNote}` : newNote;
      await updateNotes(noteModalId, updatedNotes);
      showToast(t('referrals.toastNoteAdded'), 'success');
      setNoteModalId(null);
      setNoteText('');
    } catch {
      showToast(t('referrals.toastNoteFailed'), 'error');
    } finally {
      setActionSubmitting(false);
    }
  };




  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* ═══ Table card ═══ */}
        <div className="card-elevated overflow-hidden flex flex-col" style={{ flex: 1, minHeight: 0 }}>
          <EhrListHeader
            title={t('referrals.pageTitle')}
            count={activeReferrals.length}
            stats={[
              { label: 'Accepted', value: acceptedCount, color: LIST_STAT_COLORS.blue },
              { label: 'Declined', value: declinedCount, color: LIST_STAT_COLORS.amber },
              { label: 'Pending / awaiting response', value: pendingCount, color: LIST_STAT_COLORS.green },
              { label: 'Completed', value: completedCount, color: LIST_STAT_COLORS.bronze },
            ]}
            search={{
              value: localSearch, onChange: setLocalSearch,
              placeholder: 'Search by patient, hospital, or department…', ariaLabel: 'Filter table',
              // The referral axes fold into the field beside them; free-text
              // match and structured narrowing are the same job.
              filters: {
                // The direction switch lives in this panel now; the outgoing
                // view — the non-default one — reads as one applied filter,
                // and Clear all brings the list back to incoming.
                activeCount: referralFilterCount(colFilters) + (activeTab === 'outgoing' ? 1 : 0),
                onClear: () => { clearColFilters(); setActiveTab('incoming'); },
                label: t('patients.filtersTitle'),
                children: (
                  <ReferralFilterFields
                    filters={colFilters}
                    setFilter={setColFilter}
                    direction={activeTab}
                    onDirectionChange={setActiveTab}
                    newIncomingCount={newIncomingCount}
                    urgencyOptions={urgencyOptions}
                    statusOptions={[
                      { v: 'sent', l: getStatusLabel('sent') },
                      { v: 'received', l: getStatusLabel('received') },
                      { v: 'seen', l: getStatusLabel('seen') },
                      { v: 'completed', l: getStatusLabel('completed') },
                      { v: 'cancelled', l: getStatusLabel('cancelled') },
                    ]}
                  />
                ),
              },
            }}
            actions={
              <>
                {/* The incoming/outgoing select moved into the filter panel
                    (ReferralFilterFields `direction`), where it counts as one
                    applied filter like every other axis. */}
                {canManageReferrals && (
                  <button type="button" className="btn btn-primary" style={{ gap: 8, flexShrink: 0 }} onClick={() => setShowNewReferral(true)}>
                    <Plus size={16} /> {t('referrals.newReferral')}
                  </button>
                )}
              </>
            }
          />

          {/* The registry's card grid (see patients/page.tsx) — identical
              head, row anatomy and trailing right-aligned Status column, so
              referrals read in the same list language as the registry. */}
          <div className="appointment-card-surface patients-list-surface referrals-list-surface">
            <div className="appointment-card-flow">
            {/* The column head is the list's frame, not a label for whichever
                rows happen to be loaded — it stays put when nothing matches. */}
            <div className="appointment-card-head" aria-hidden="true">
              <span>Patient</span>
              {/* One side of the route is always the viewer's own facility, so
                  the column names only the counterpart. */}
              <span>{activeTab === 'incoming' ? t('referrals.colReferredFrom') : t('referrals.colReferredTo')}</span>
              <span>Context</span>
              <span>Status</span>
            </div>
            {filteredReferrals.length === 0 ? (
              <div className="p-8">
                <EmptyState
                  icon={ArrowRightLeft}
                  title={activeTab === 'outgoing' ? t('referrals.emptyOutgoingTitle') : t('referrals.emptyIncomingTitle')}
                  message={activeTab === 'outgoing'
                    ? t('referrals.emptyOutgoingMsg')
                    : t('referrals.emptyIncomingMsg')}
                  action={activeTab === 'outgoing' && canManageReferrals ? { label: t('referrals.createReferral'), onClick: () => setShowNewReferral(true) } : undefined}
                />
              </div>
            ) : (
            <>
                {filteredReferrals.map(ref => {
                const tp = ref.transferPackage as TransferPackage | undefined;
                const hasPatientChart = isRealPatient(ref.patientId) && !!patientById.get(ref.patientId);
                // Status-driven actions, collapsed into a single kebab menu.
                const rowActions: RowAction[] = [
                  ...(hasPatientChart ? [{
                    key: 'chart',
                    label: t('referrals.openPatientChart'),
                    tone: 'default' as const,
                    icon: <ExternalLink className="w-4 h-4" />,
                    onClick: () => router.push(`/patients/${ref.patientId}?tab=referrals`),
                  }] : []),
                  {
                    key: 'view-details',
                    label: 'View referral details',
                    tone: 'default' as const,
                    icon: <FileText className="w-4 h-4" />,
                    onClick: () => setExpandedReferral(ref._id),
                  },
                  ...(canManageReferrals && activeTab === 'incoming' && (ref.status === 'sent' || ref.status === 'received') ? [
                    { key: 'accept', label: t('referrals.accept'), tone: 'success' as const, icon: <CheckCircle2 className="w-4 h-4" />, onClick: async () => {
                      try { await accept(ref._id); showToast(t('referrals.toastAccepted', { name: ref.patientName }), 'success'); }
                      catch { showToast(t('referrals.toastAcceptFailed'), 'error'); }
                    } },
                    { key: 'decline', label: t('referrals.decline'), tone: 'danger' as const, icon: <XCircle className="w-4 h-4" />, onClick: () => { setDeclineModalId(ref._id); setDeclineReason(''); } },
                  ] : []),
                  ...(canManageReferrals && activeTab === 'incoming' && ref.status === 'seen' ? [
                    { key: 'complete', label: t('referrals.markComplete'), tone: 'success' as const, icon: <ClipboardCheck className="w-4 h-4" />, onClick: () => { setCompleteModalId(ref._id); setCompleteOutcome(''); } },
                    { key: 'undo', label: t('action.undo'), tone: 'default' as const, icon: <RotateCcw className="w-4 h-4" />, onClick: () => setReverseModal({ id: ref._id, to: 'received', name: ref.patientName }) },
                  ] : []),
                  ...(canManageReferrals && activeTab === 'incoming' && ref.status === 'cancelled' ? [
                    { key: 'reopen', label: t('action.reopen'), tone: 'default' as const, icon: <RotateCcw className="w-4 h-4" />, onClick: () => setReverseModal({ id: ref._id, to: 'received', name: ref.patientName }) },
                  ] : []),
                  ...(canManageReferrals && ref.status !== 'cancelled' ? [
                    { key: 'note', label: t('action.addNote'), tone: 'default' as const, icon: <MessageSquarePlus className="w-4 h-4" />, onClick: () => { setNoteModalId(ref._id); setNoteText(''); } },
                  ] : []),
                ];
                return (
                  <div
                    key={ref._id}
                    className="ehr-appointment-row appointment-card-row"
                    role="button"
                    tabIndex={0}
                    onClick={e => setRowMenu(rowActionsAt(e, rowActions))}
                    onKeyDown={e => { if (isRowActivationKey(e.key)) { e.preventDefault(); setRowMenu(rowActionsFromElement(e.currentTarget, rowActions)); } }}
                  >
                    {/* The registry's identity cell: avatar plate, linked
                        name, ID · age · gender beneath. */}
                    <div className="ehr-appointment-identity">
                      {patientById.get(ref.patientId) ? (
                        <PatientAvatar patient={patientById.get(ref.patientId)!} size={40} />
                      ) : (
                        <span aria-hidden="true" style={INITIALS_PLATE_STYLE}>{nameInitials(ref.patientName)}</span>
                      )}
                      <div className="ehr-appointment-main appointment-card-patient">
                        {hasPatientChart ? (
                          <Link href={`/patients/${ref.patientId}?tab=referrals`} {...stopsClickPropagation}>{ref.patientName}</Link>
                        ) : (
                          <strong>{ref.patientName}</strong>
                        )}
                        <p>
                          {[hospitalNoFor(ref.patientId),
                            patientById.get(ref.patientId) && patientAgeLabel(patientById.get(ref.patientId)!),
                            patientById.get(ref.patientId)?.gender].filter(Boolean).join(' \u00b7 ')}
                        </p>
                      </div>
                    </div>
                    {/* Only the OTHER facility: our own side of the route is
                        the same on every row of the tab, so it says nothing.
                        The tooltip keeps the full A → B for anyone checking. */}
                    <div className="appointment-card-provider" title={`${ref.fromHospital} → ${ref.toHospital}`}>
                      <strong>{activeTab === 'incoming' ? ref.fromHospital : ref.toHospital}</strong>
                          {/* The referral's age rides under the facility — it
                              replaces the dedicated Date column. Fresh rows
                              read as elapsed time ("2h 15m ago"); once the
                              referral is a day or more old the label becomes
                              the full date, which is the point where "38h ago"
                              stops meaning anything. `createdAt` carries the
                              clock time, but only when it falls on the
                              referral's own date — a doc seeded or imported
                              later has a fresh createdAt on an old referral,
                              which read as "16s ago" on February rows. */}
                      <span title={ref.referralDate}>{referralAgeLabel(ref)}</span>
                    </div>
                    <div className="appointment-card-provider">
                      <strong>{ref.department || 'Department unassigned'}</strong>
                      <span>Referral service</span>
                    </div>
                    {/* The registry's trailing stack: status pill with the
                        urgency as the small operational cue beneath it. */}
                    <div className="appointment-card-status">
                      <span className={`appointment-status-pill ${STATUS_PILL_CLASS[ref.status] ?? ''}`}>
                        {getStatusLabel(ref.status)}
                      </span>
                      <small style={{ color: ref.urgency === 'emergency' ? '#D92B20' : ref.urgency === 'urgent' ? '#B35900' : '#0B8557' }}>
                        {t(`referrals.urgency_${ref.urgency}`)}
                      </small>
                      {tp && (
                        <span className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-full font-semibold" style={{ background: 'var(--accent-light)', color: 'var(--tamamhealth-blue)', border: '1px solid var(--accent-border)' }}>
                          <Package className="w-3 h-3" /> {t('referrals.dataPackage')}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
            )}
            <RowActionsPopup state={rowMenu} onClose={() => setRowMenu(null)} />
            </div>
          </div>
        </div>

        {showNewReferral && (
          <ReferralFormModal onClose={() => setShowNewReferral(false)} />
        )}

        {/* Referral detail — a popup rather than an inline expansion row: the
            package viewer is taller than a table row wants to be, and pushing
            every row below it down the page lost the reader's place. */}
        {detailReferral && (
          <Modal onClose={() => setExpandedReferral(null)} width={760} labelledBy="referral-detail-title">
            <div className="modal-panel" {...stopsClickPropagation} style={{ display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 80px)', overflow: 'hidden' }}>
              <div className="flex items-start justify-between gap-3 mb-4 flex-shrink-0">
                <div className="min-w-0">
                  <h3 id="referral-detail-title" className="text-base font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                    {detailReferral.patientName}
                  </h3>
                  <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>
                    {detailReferral.fromHospital} → {detailReferral.toHospital}
                    {detailReferral.department ? ` · ${detailReferral.department}` : ''}
                    {` · ${detailReferral.referralDate}`}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge tone={toneForStatus(detailReferral.status)}>{getStatusLabel(detailReferral.status)}</Badge>
                  <button onClick={() => setExpandedReferral(null)} aria-label={t('action.close')} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div style={{ overflowY: 'auto', minHeight: 0 }}>
                {detailReferral.outcome && (
                  <div className="mb-3 p-3 rounded-lg" style={{ background: 'rgba(79, 199, 155,0.08)', border: '1px solid rgba(79, 199, 155,0.25)' }}>
                    <div className="flex items-center gap-2 mb-2">
                      <ClipboardCheck className="w-4 h-4" style={{ color: 'var(--color-success-text)' }} />
                      <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--color-success-text)' }}>{t('referrals.outcomeReceived')}</p>
                      <Badge tone="success">{t(`referrals.disposition_${detailReferral.outcome.disposition}`)}</Badge>
                    </div>
                    <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text-primary)' }}>{detailReferral.outcome.summary}</p>
                    {detailReferral.outcome.followUp && (
                      <p className="text-xs mt-2" style={{ color: 'var(--text-secondary)' }}>
                        <span className="font-semibold">{t('referrals.outcomeFollowUp')}: </span>{detailReferral.outcome.followUp}
                      </p>
                    )}
                    <p className="text-[10px] mt-2" style={{ color: 'var(--text-muted)' }}>
                      {t('referrals.outcomeRecordedBy', { name: detailReferral.outcome.recordedBy, date: detailReferral.outcome.recordedAt.slice(0, 10) })}
                    </p>
                  </div>
                )}
                {detailPackage ? (
                  <TransferPackageViewer
                    pkg={detailPackage}
                    refAttachments={detailReferral.referralAttachments as Attachment[] | undefined}
                    reason={detailReferral.reason}
                    notes={detailReferral.notes}
                    onPreview={setPreviewAttachment}
                  />
                ) : (
                  <div className="space-y-3">
                    <div className="p-3 rounded-lg" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
                      <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{t('referral.reason')}</p>
                      <p className="text-sm">{detailReferral.reason}</p>
                    </div>
                    <div className="p-3 rounded-lg" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
                      <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{t('referral.notes')}</p>
                      <p className="text-sm whitespace-pre-wrap">{detailReferral.notes || t('referrals.none')}</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                      <div className="icon-box-sm">
                        <AlertTriangle className="w-3.5 h-3.5" style={{ color: 'var(--color-danger-text)' }} />
                      </div>
                      {t('referrals.noDataPackage')}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Modal>
        )}

        {/* Reverse status confirmation — undo an acceptance or reopen a
            declined referral. Clinical reversals are confirmed first. */}
        {reverseModal && (
          <Modal onClose={() => setReverseModal(null)}>
            <div className="modal-panel modal-panel--sm" {...stopsClickPropagation}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{t('action.reverse')}</h3>
                <button onClick={() => setReverseModal(null)} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
                {reverseModal.name} &middot; {getStatusLabel(reverseModal.to)}
              </p>
              <div className="flex gap-2">
                <button onClick={() => setReverseModal(null)} className="btn btn-secondary flex-1">{t('action.cancel')}</button>
                <button onClick={handleReverseStatus} disabled={actionSubmitting} className="btn btn-primary flex-1">
                  {actionSubmitting ? t('referrals.saving') : t('action.confirm')}
                </button>
              </div>
            </div>
          </Modal>
        )}

        {/* Add Note Modal */}
        {noteModalId && (
          <Modal onClose={() => setNoteModalId(null)}>
            <div className="modal-panel modal-panel--sm" {...stopsClickPropagation}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{t('action.addNote')}</h3>
                <button onClick={() => setNoteModalId(null)} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                {t('referrals.addNoteHint')}
              </p>
              <textarea
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                rows={4}
                placeholder={t('referrals.notePlaceholder')}
                className="w-full mb-4"
                style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-medium)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 13 }}
              />
              <div className="flex gap-2">
                <button onClick={() => setNoteModalId(null)} className="btn btn-secondary flex-1">{t('action.cancel')}</button>
                <button onClick={handleAddNote} disabled={!noteText.trim() || actionSubmitting} className="btn btn-primary flex-1" style={{ opacity: !noteText.trim() ? 0.5 : 1 }}>
                  {actionSubmitting ? t('referrals.saving') : t('action.addNote')}
                </button>
              </div>
            </div>
          </Modal>
        )}

        {/* Decline Modal */}
        {declineModalId && (
          <Modal onClose={() => setDeclineModalId(null)}>
            <div className="modal-panel modal-panel--sm" {...stopsClickPropagation}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{t('referrals.declineReferral')}</h3>
                <button onClick={() => setDeclineModalId(null)} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                {t('referrals.declineHint')}
              </p>
              <textarea
                value={declineReason}
                onChange={e => setDeclineReason(e.target.value)}
                rows={3}
                placeholder={t('referrals.declinePlaceholder')}
                className="w-full mb-4"
                style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-medium)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 13 }}
              />
              <div className="flex gap-2">
                <button onClick={() => setDeclineModalId(null)} className="btn btn-secondary flex-1">{t('action.cancel')}</button>
                <button onClick={handleDecline} disabled={!declineReason.trim() || actionSubmitting} className="btn btn-primary flex-1" style={{ opacity: !declineReason.trim() ? 0.5 : 1, background: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}>
                  {actionSubmitting ? t('referrals.declining') : t('referrals.confirmDecline')}
                </button>
              </div>
            </div>
          </Modal>
        )}

        {/* Complete Modal */}
        {completeModalId && (
          <Modal onClose={() => setCompleteModalId(null)}>
            <div className="modal-panel modal-panel--sm" {...stopsClickPropagation}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{t('referrals.completeReferral')}</h3>
                <button onClick={() => setCompleteModalId(null)} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                {t('referrals.completeHint')}
              </p>
              <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>{t('referrals.outcomeDisposition')}</label>
              <Select
                value={completeDisposition}
                onChange={e => setCompleteDisposition(e.target.value as ReferralDisposition)}
                className="w-full mb-3"
                style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-medium)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 13 }}
              >
                {DISPOSITION_OPTIONS.map(d => (
                  <option key={d} value={d}>{t(`referrals.disposition_${d}`)}</option>
                ))}
              </Select>
              <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>{t('referrals.outcomeSummary')}</label>
              <textarea
                value={completeOutcome}
                onChange={e => setCompleteOutcome(e.target.value)}
                rows={3}
                placeholder={t('referrals.completePlaceholder')}
                className="w-full mb-3"
                style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-medium)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 13 }}
              />
              <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>{t('referrals.outcomeFollowUp')}</label>
              <textarea
                value={completeFollowUp}
                onChange={e => setCompleteFollowUp(e.target.value)}
                rows={2}
                placeholder={t('referrals.outcomeFollowUpPlaceholder')}
                className="w-full mb-4"
                style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-medium)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 13 }}
              />
              <div className="flex gap-2">
                <button onClick={() => setCompleteModalId(null)} className="btn btn-secondary flex-1">{t('action.cancel')}</button>
                <button onClick={handleComplete} disabled={!completeOutcome.trim() || actionSubmitting} className="btn btn-primary flex-1" style={{ opacity: !completeOutcome.trim() ? 0.5 : 1, background: 'var(--color-success)', borderColor: 'var(--color-success)' }}>
                  {actionSubmitting ? t('referrals.completing') : t('referrals.markComplete')}
                </button>
              </div>
            </div>
          </Modal>
        )}

        {/* Preview Modal for attachments */}
        {previewAttachment && (
          <div
            className="viewport-popup fixed inset-0 z-50 flex items-center justify-center p-8"
            style={{ background: 'rgba(0,0,0,0.75)' }}
            {...dismissBackdrop(() => setPreviewAttachment(null))}
          >
            <div
              className="relative max-w-4xl max-h-[90vh] rounded-xl overflow-hidden"
              style={{ background: 'var(--bg-card)' }}
              {...stopsClickPropagation}
            >
              <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--border-light)' }}>
                <div className="flex items-center gap-2">
                  {isImage(previewAttachment.mimeType) ? <ImageIcon className="w-4 h-4" style={{ color: 'var(--tamamhealth-blue)' }} /> : <FileText className="w-4 h-4" style={{ color: 'var(--color-danger)' }} />}
                  <span className="text-sm font-semibold">{previewAttachment.name}</span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatFileSize(previewAttachment.sizeBytes)}</span>
                </div>
                <button onClick={() => setPreviewAttachment(null)} className="p-1 rounded" style={{ background: 'var(--overlay-subtle)' }}>
                  <X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                </button>
              </div>
              <div className="p-4 overflow-auto" style={{ maxHeight: 'calc(90vh - 60px)' }}>
                {isImage(previewAttachment.mimeType) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`data:${previewAttachment.mimeType};base64,${previewAttachment.base64Data}`}
                    alt={previewAttachment.name}
                    className="max-w-full h-auto rounded"
                  />
                ) : previewAttachment.mimeType === 'application/pdf' ? (
                  <iframe
                    src={`data:application/pdf;base64,${previewAttachment.base64Data}`}
                    className="w-full rounded"
                    style={{ height: '70vh' }}
                    title={previewAttachment.name}
                  />
                ) : (
                  <div className="text-center py-12">
                    <FileText className="w-16 h-16 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('referrals.previewNotAvailable')}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
