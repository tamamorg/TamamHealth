'use client';

import { Fragment, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import type {
  MedicalRecordDoc, LabResultDoc, PrescriptionDoc, ImmunizationDoc,
  ReferralDoc, ANCVisitDoc, AppointmentDoc, TriageDoc,
} from '@/lib/db-types';
import type { ClinicalNoteDoc } from '@/lib/clinical-notes/types';
import { getNoteType } from '@/lib/clinical-notes/note-catalog';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { formatRxSig, humanizeStatus } from '@/lib/format-utils';
import { priorityBadge } from '@/lib/clinical/triage-display';
import ChartSection, { OmrsEmptyState } from '@/components/ehr/chart/ChartSection';
import { clickable, stopsClickPropagation } from '@/lib/a11y';

type TFunc = (key: string, vars?: Record<string, string | number>) => string;

/**
 * Patient 360 timeline — merges every encounter type into a single
 * chronological feed so a clinician can see the patient's full journey
 * without flipping between tabs.
 *
 * Each input list is optional: pass only what you have. The component
 * normalises every record into a TimelineEvent and renders them sorted
 * newest-first.
 */
export interface PatientTimelineProps {
  medicalRecords?: MedicalRecordDoc[];
  /** Clinical notes — the encounter record since the consultation wizard was
   *  retired, so the history is incomplete without them. */
  clinicalNotes?: ClinicalNoteDoc[];
  labResults?: LabResultDoc[];
  prescriptions?: PrescriptionDoc[];
  immunizations?: ImmunizationDoc[];
  referrals?: ReferralDoc[];
  ancVisits?: ANCVisitDoc[];
  appointments?: AppointmentDoc[];
  triages?: TriageDoc[];
  /**
   * Rendered inside an expanded consultation row. The chart passes the visit's
   * signature/lock controls here, so a consult record is attested where it is
   * read — the timeline itself stays free of any signing knowledge.
   */
  renderRecordSignature?: (recordId: string) => ReactNode;
  /**
   * Deep-link target — the `_id` of a record/note the dashboard's "documents to
   * sign" list sent the user here to act on. That row is expanded, scrolled to
   * and highlighted on arrival.
   */
  focusId?: string;
}

interface TimelineEvent {
  id: string;
  date: string;            // ISO or YYYY-MM-DD
  category: 'triage' | 'consultation' | 'note' | 'lab' | 'prescription' | 'immunization' | 'referral' | 'anc' | 'appointment';
  title: string;
  subtitle?: string;
  meta?: string;
  badge?: { label?: string; bg: string; color: string; dot?: boolean };
  /** Underlying document id, when this row IS a document (vs a derived event).
   *  Drives both the signature slot and deep-link focus. */
  docId?: string;
}

// Category is a word, not a colour. The dot that used to sit before the label
// carried no information the label didn't already give, and down a full table
// it turned the column into a stripe of unrelated hues competing with the
// badges — which DO mean something (unsigned, critical, overdue).
const CATEGORY_CONFIG: Record<TimelineEvent['category'], { labelKey: string }> = {
  triage:        { labelKey: 'timeline.categoryTriage' },
  consultation:  { labelKey: 'timeline.categoryConsultation' },
  note:          { labelKey: 'timeline.categoryNote' },
  lab:           { labelKey: 'timeline.categoryLab' },
  prescription:  { labelKey: 'timeline.categoryRx' },
  immunization:  { labelKey: 'timeline.categoryVaccine' },
  referral:      { labelKey: 'timeline.categoryReferral' },
  anc:           { labelKey: 'timeline.categoryAnc' },
  appointment:   { labelKey: 'timeline.categoryAppointment' },
};

/** First line of real text in a note, for the timeline's subtitle. */
function notePreviewLine(note: ClinicalNoteDoc): string | undefined {
  for (const section of note.sections) {
    const body = (section.text || section.snapshot || '')
      .replace(/<!--\/?template-->/g, '')
      .trim();
    if (body) return body.split('\n')[0].slice(0, 90);
  }
  return undefined;
}

function buildEvents(props: PatientTimelineProps, t: TFunc): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const tr of props.triages || []) {
    const vitals: string[] = [];
    if (tr.temperature) vitals.push(`T ${tr.temperature}°C`);
    if (tr.pulse) vitals.push(`HR ${tr.pulse}`);
    if (tr.respiratoryRate) vitals.push(`RR ${tr.respiratoryRate}`);
    if (tr.oxygenSaturation) vitals.push(`SpO₂ ${tr.oxygenSaturation}%`);
    if (tr.systolic && tr.diastolic) vitals.push(`BP ${tr.systolic}/${tr.diastolic}`);
    events.push({
      id: `triage-${tr._id}`,
      date: tr.triagedAt || tr.createdAt,
      category: 'triage',
      title: tr.chiefComplaint || t('timeline.titleTriage'),
      subtitle: tr.assessmentSource === 'clerical_checkin' || tr.airway === 'not_assessed'
        ? t('timeline.triageNotAssessed')
        : `A: ${tr.airway} · B: ${tr.breathing} · C: ${tr.circulation} · AVPU-${tr.consciousness.toUpperCase()[0]}`,
      meta: `${tr.triagedByName}${vitals.length ? ' · ' + vitals.join(' · ') : ''}`,
      // Colours from the shared acuity table, not three hand-mixed rgba values
      // that had drifted a shade off the tokens every other acuity badge uses.
      badge: { dot: true, ...priorityBadge(tr.priority) },
    });
  }

  for (const r of props.medicalRecords || []) {
    const dx = (r.diagnoses || []).slice(0, 2).map(d => d.name).join(', ');
    // A consult record's signature state is the one thing about it a clinician
    // scanning the history has to be able to see — an unsigned visit is an
    // unattested one — so it outranks the visit type for the badge slot.
    const recStatus = r.documentStatus ?? 'draft';
    const recBadge = recStatus === 'signed' || recStatus === 'amended'
      ? { label: recStatus === 'amended' ? 'Amended' : 'Signed', bg: 'rgba(15, 160, 106,0.12)', color: 'var(--color-success)' }
      : recStatus === 'awaiting_cosign'
        ? { label: 'Awaiting co-sign', bg: 'rgba(253, 217, 95,0.16)', color: 'var(--color-warning)' }
        : { label: 'Unsigned', bg: 'rgba(253, 217, 95,0.16)', color: 'var(--color-warning)' };
    events.push({
      id: `mr-${r._id}`,
      docId: r._id,
      date: r.consultedAt || r.visitDate || r.createdAt,
      category: 'consultation',
      title: r.chiefComplaint || t('timeline.titleConsultation'),
      subtitle: dx || r.providerName || undefined,
      meta: [
        r.providerName ? `${r.providerName}${r.department ? ` · ${r.department}` : ''}` : r.department,
        r.visitType ? humanizeStatus(r.visitType) : '',
      ].filter(Boolean).join(' · '),
      badge: recBadge,
    });
  }

  // Clinical notes. Unsigned drafts are shown and labelled as such rather than
  // hidden: a draft is work in progress on this patient's record, and a
  // history that silently omits it reads as "nothing happened that day".
  for (const n of props.clinicalNotes || []) {
    const diagnoses = n.sections
      .flatMap(s => s.diagnoses || [])
      .map(d => `${d.name}${d.icd11Code ? ` (${d.icd11Code})` : ''}`);
    const signed = n.status === 'signed' || n.status === 'amended';
    events.push({
      id: `cn-${n._id}`,
      docId: n._id,
      date: n.serviceTime ? `${n.serviceDate}T${n.serviceTime}` : n.serviceDate,
      category: 'note',
      title: getNoteType(n.noteType).label,
      subtitle: diagnoses.length ? diagnoses.join(', ') : notePreviewLine(n),
      meta: [n.signedByName || n.assignedToName || n.authorName, n.hospitalName]
        .filter(Boolean).join(' · ') || undefined,
      badge: signed
        ? { label: n.status === 'amended' ? 'Amended' : 'Signed', bg: 'rgba(15, 160, 106,0.12)', color: 'var(--color-success)' }
        : { label: n.status === 'awaiting_cosign' ? 'Awaiting co-sign' : 'Unsigned', bg: 'rgba(253, 217, 95,0.16)', color: 'var(--color-warning)' },
    });
  }

  for (const lr of props.labResults || []) {
    const status = lr.status === 'completed' ? lr.result || t('timeline.statusCompleted') : lr.status.replace('_', ' ');
    events.push({
      id: `lab-${lr._id}`,
      date: lr.completedAt || lr.orderedAt || lr.createdAt,
      category: 'lab',
      title: lr.testName,
      subtitle: status,
      meta: lr.specimen ? t('timeline.metaSpecimen', { specimen: lr.specimen }) : undefined,
      badge: lr.critical
        ? { label: t('timeline.badgeCritical'), bg: 'rgba(224, 49, 39,0.14)', color: 'var(--color-danger)' }
        : lr.abnormal
        ? { label: t('timeline.badgeAbnormal'), bg: 'rgba(253, 217, 95,0.14)', color: 'var(--color-warning)' }
        : undefined,
    });
  }

  for (const rx of props.prescriptions || []) {
    events.push({
      id: `rx-${rx._id}`,
      date: rx.createdAt,
      category: 'prescription',
      title: rx.medication,
      subtitle: formatRxSig(rx),
      meta: rx.prescribedBy,
      badge: rx.status === 'dispensed'
        ? { label: t('timeline.badgeDispensed'), bg: 'rgba(15, 160, 106,0.14)', color: 'var(--color-success)' }
        : { label: t('timeline.badgePending'), bg: 'rgba(253, 217, 95,0.14)', color: 'var(--color-warning)' },
    });
  }

  for (const im of props.immunizations || []) {
    events.push({
      id: `imm-${im._id}`,
      date: im.dateGiven || im.createdAt,
      category: 'immunization',
      title: `${im.vaccine} ${im.doseNumber > 0 ? t('timeline.doseNumber', { number: im.doseNumber }) : ''}`.trim(),
      subtitle: im.batchNumber ? t('timeline.batchNumber', { batch: im.batchNumber }) : undefined,
      meta: im.facilityName,
    });
  }

  for (const ref of props.referrals || []) {
    events.push({
      id: `ref-${ref._id}`,
      date: ref.referralDate || ref.createdAt,
      category: 'referral',
      title: t('timeline.titleReferral', { facility: ref.toHospital || t('timeline.facilityFallback') }),
      subtitle: ref.reason || ref.department,
      meta: ref.referringDoctor,
      badge: { label: humanizeStatus(ref.status), bg: 'rgba(255, 127, 0,0.10)', color: 'var(--color-warning)' },
    });
  }

  for (const a of props.ancVisits || []) {
    events.push({
      id: `anc-${a._id}`,
      date: a.visitDate || a.createdAt,
      category: 'anc',
      title: t('timeline.titleAncVisit', { number: a.visitNumber }),
      subtitle: t('timeline.subtitleAnc', { weeks: a.gestationalAge || '—', risk: a.riskLevel }),
      meta: a.facilityName,
      badge: a.riskLevel === 'high'
        ? { label: t('timeline.badgeHighRisk'), bg: 'rgba(224, 49, 39,0.14)', color: 'var(--color-danger)' }
        : a.riskLevel === 'moderate'
        ? { label: t('timeline.badgeModerate'), bg: 'rgba(253, 217, 95,0.14)', color: 'var(--color-warning)' }
        : undefined,
    });
  }

  for (const ap of props.appointments || []) {
    events.push({
      id: `apt-${ap._id}`,
      date: `${ap.appointmentDate}T${ap.appointmentTime || '00:00'}`,
      category: 'appointment',
      title: ap.reason || (ap.appointmentType ? `${humanizeStatus(ap.appointmentType)} appointment` : t('timeline.titleAppointment')),
      subtitle: ap.department,
      meta: ap.providerName,
      badge: { label: humanizeStatus(ap.status), bg: 'rgba(17, 116, 180,0.10)', color: '#1174B4' },
    });
  }

  return events
    .filter(e => !!e.date)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export default function PatientTimeline(props: PatientTimelineProps) {
  const { t } = useTranslation();
  const events = buildEvents(props, t);
  const [filter, setFilter] = useState<'all' | TimelineEvent['category']>('all');
  const [search, setSearch] = useState('');
  // Rows expanded to show their subtitle/meta. Kept as a set so several can be
  // open at once — comparing two events is the common reason to expand.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleDetail = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  // Deep-link arrival: the row the caller asked for opens itself, so the
  // signature controls the user was sent here to use are on screen rather than
  // one more click away behind a disclosure they have to find first.
  const { focusId } = props;
  const focusedEvent = focusId ? events.find(e => e.docId === focusId) : undefined;
  const focusedRowId = focusedEvent?.id;
  useEffect(() => {
    if (!focusedRowId) return;
    setExpanded(prev => (prev.has(focusedRowId) ? prev : new Set(prev).add(focusedRowId)));
    // The row mounts with the expansion, so the scroll waits a frame for it.
    const raf = requestAnimationFrame(() => {
      document.getElementById(`timeline-row-${focusedRowId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => cancelAnimationFrame(raf);
  }, [focusedRowId]);

  const categoryEvents = filter === 'all' ? events : events.filter(event => event.category === filter);
  const searchQuery = search.trim().toLowerCase();
  const visibleEvents = searchQuery
    ? categoryEvents.filter(event => `${event.title} ${event.subtitle || ''} ${event.meta || ''} ${event.badge?.label || ''}`.toLowerCase().includes(searchQuery))
    : categoryEvents;
  const categoryOptions: Array<{ id: 'all' | TimelineEvent['category']; label: string }> = [
    { id: 'all', label: 'All activity' },
    { id: 'consultation', label: 'Consultations' },
    { id: 'lab', label: 'Results' },
    { id: 'prescription', label: 'Medications' },
    { id: 'appointment', label: 'Appointments' },
    { id: 'referral', label: 'Coordination' },
    { id: 'triage', label: 'Triage' },
    { id: 'immunization', label: 'Immunizations' },
    { id: 'anc', label: 'ANC' },
  ];

  if (events.length === 0) {
    return (
      <ChartSection title="Activity">
        <OmrsEmptyState itemLabel="activity" />
      </ChartSection>
    );
  }

  return (
    <ChartSection
      title="Activity"
      filterSlot={(
        <div className="tamam-activity-filters" role="tablist" aria-label="Filter patient activity">
          {categoryOptions.map(option => (
            <button
              key={option.id}
              type="button"
              className={filter === option.id ? 'is-active' : ''}
              onClick={() => setFilter(option.id)}
              role="tab"
              aria-selected={filter === option.id}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
      searchValue={search}
      onSearchChange={setSearch}
    >
      <div className="tamam-activity-summary">
        <span><strong>{visibleEvents.length}</strong> {filter === 'all' ? 'events' : 'matching events'}</span>
        <span>Most recent first</span>
      </div>
      {visibleEvents.length === 0 ? (
        <OmrsEmptyState itemLabel="matching activity" />
      ) : (
      /* One line per event. The timeline rail (dot + connector) is gone: it
         cost a 30px column and ~34px of height per row to say only "these are
         in order", which the date column already says. Detail that used to
         sit under every title now lives behind a per-row disclosure, so the
         table stays scannable and only the row you ask about expands. */
      <table className="omrs-table omrs-table--fixed tamam-activity-table">
        <colgroup>
          <col /><col /><col /><col />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Type</th>
            <th scope="col">Event</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {visibleEvents.map(e => {
            const cfg = CATEGORY_CONFIG[e.category];
            const dateLabel = (() => {
              try {
                return new Date(e.date).toLocaleDateString(undefined, {
                  year: 'numeric', month: 'short', day: 'numeric',
                  ...(e.date.includes('T') ? { hour: '2-digit', minute: '2-digit' } : {}),
                });
              } catch { return e.date; }
            })();
            // An event counts as "alarming" when its badge text reads as a
            // clinical emergency (critical lab, high-risk triage, etc.).
            // Color-sniffing is fragile (hexes vary), so we match the label.
            const badgeLabel = (e.badge?.label || '').toLowerCase();
            const badgeIsAlarm = /critical|emergency|red|severe|abnormal|high risk|overdue|hypo|hyper/.test(badgeLabel);
            // Only rows that actually carry more than the four columns show
            // get a disclosure — an expander that opens onto nothing is worse
            // than no expander.
            // A consultation row always has detail once the signature slot is
            // available, even when the record itself carries no subtitle/meta.
            const signatureSlot = e.category === 'consultation' && e.docId
              ? props.renderRecordSignature?.(e.docId)
              : undefined;
            const hasDetail = Boolean(e.subtitle || e.meta || signatureSlot);
            const isOpen = hasDetail && expanded.has(e.id);
            const isFocused = !!e.docId && e.docId === focusId;
            return (
              <Fragment key={e.id}>
                <tr
                  id={`timeline-row-${e.id}`}
                  className={`tamam-activity-tr${badgeIsAlarm ? ' is-alarm' : ''}${hasDetail ? ' has-detail' : ''}${isOpen ? ' is-open' : ''}`}
                  style={isFocused ? { background: 'var(--accent-light)', boxShadow: 'inset 3px 0 0 var(--accent-primary)' } : undefined}
                  {...(hasDetail ? clickable(() => toggleDetail(e.id), { label: `${isOpen ? 'Hide' : 'Show'} details for ${e.title}` }) : {})}
                  aria-expanded={hasDetail ? isOpen : undefined}
                >
                  <td className="tamam-activity-date"><time dateTime={e.date}>{dateLabel}</time></td>
                  <td>
                    <span className="tamam-activity-type">
                      {t(cfg.labelKey)}
                    </span>
                  </td>
                  <td className="tamam-activity-title">{e.title}</td>
                  <td>
                    {e.badge?.dot
                      ? <i className="tamam-activity-severity" style={{ background: e.badge.color }} title="Priority indicator" />
                      : e.badge?.label
                        ? <em className="tamam-activity-badge clinical-status-pill" style={{ background: e.badge.bg, color: e.badge.color, borderColor: `${e.badge.color}30` }}>{e.badge.label}</em>
                        : <span className="tamam-activity-dash">—</span>}
                  </td>
                </tr>
                {isOpen && (
                  <tr className="tamam-activity-detail">
                    {/* The detail cell stops click propagation: the parent row
                        toggles the disclosure, and a click on Sign inside it
                        would otherwise collapse the panel it was aimed at. */}
                    <td colSpan={4} {...stopsClickPropagation}>
                      {e.subtitle && <p>{e.subtitle}</p>}
                      {e.meta && <small>{e.meta}</small>}
                      {signatureSlot && <div style={{ marginTop: 10 }}>{signatureSlot}</div>}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      )}
    </ChartSection>
  );
}
