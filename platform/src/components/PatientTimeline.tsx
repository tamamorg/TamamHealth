'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import type {
  MedicalRecordDoc, LabResultDoc, PrescriptionDoc, ImmunizationDoc,
  ReferralDoc, ANCVisitDoc, AppointmentDoc, TriageDoc,
} from '@/lib/db-types';
import type { ClinicalNoteDoc } from '@/lib/clinical-notes/types';
import { getNoteType } from '@/lib/clinical-notes/note-catalog';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { formatRxSig, humanizeStatus } from '@/lib/format-utils';
import { priorityBadge, priorityLabelKey } from '@/lib/clinical/triage-display';
import ChartSection, { OmrsEmptyState } from '@/components/ehr/chart/ChartSection';
import { clickable, stopsClickPropagation } from '@/lib/a11y';
import { toIsoDate } from '@/lib/date-utils';
import { ChevronDown, ChevronRight } from '@/components/icons/lucide';

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
   * Opens a document row (consultation or note) in the chart's sidebar, which
   * carries all of its detail. The timeline itself stays free of any signing
   * knowledge.
   */
  onOpenEvent?: (event: TimelineEvent) => void;
  /** The Actions cell for an event; a visit row passes its lead event. */
  renderEventActions?: (event: TimelineEvent) => ReactNode;
  /**
   * Deep-link target — the `_id` of a record/note the dashboard's "documents to
   * sign" list sent the user here to act on. That row is opened in the sidebar,
   * scrolled to and highlighted on arrival.
   */
  focusId?: string;
  /**
   * Remembers where a row's Open left from (the visits that were open and the
   * row itself), so coming Back lands on that row instead of a collapsed list.
   * Usually the patient's id; without it nothing is remembered.
   */
  returnKey?: string;
}

/** What the timeline looked like when a row's Open navigated away. */
interface TimelineReturn { open: string[]; /** DOM id of the row. */ row: string }

const returnStorageKey = (key: string) => `tm-timeline-return:${key}`;

/** Read only: a state initializer runs twice in development, so the note is
 *  forgotten by the arrival effect, not here. */
function readTimelineReturn(key: string | undefined): TimelineReturn | null {
  if (!key) return null;
  try {
    const raw = window.sessionStorage.getItem(returnStorageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TimelineReturn>;
    return Array.isArray(parsed.open) && typeof parsed.row === 'string'
      ? { open: parsed.open.filter((id): id is string => typeof id === 'string'), row: parsed.row }
      : null;
  } catch {
    return null;
  }
}

export type TimelineCategory = 'triage' | 'consultation' | 'note' | 'lab' | 'prescription' | 'immunization' | 'referral' | 'anc' | 'appointment';

export interface TimelineEvent {
  id: string;
  /** The visit this event belongs to, when the source record carries one. */
  encounterId?: string;
  date: string;            // ISO or YYYY-MM-DD
  category: TimelineCategory;
  title: string;
  subtitle?: string;
  meta?: string;
  badge?: { label?: string; bg: string; color: string; dot?: boolean };
  /** Underlying document id, when this row IS a document (vs a derived event).
   *  Drives both opening it in the sidebar and deep-link focus. */
  docId?: string;
  /** Source id of a derived event, for linking to it on its own tab. */
  sourceId?: string;
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
    // Chart snapshot first, then the clinician's text — a section can hold both.
    const body = [section.snapshot || '', section.text || ''].filter(Boolean).join('\n')
      .replace(/<!--\/?template-->/g, '')
      .trim();
    if (body) return body.split('\n')[0].slice(0, 90);
  }
  return undefined;
}

export function buildEvents(props: PatientTimelineProps, t: TFunc): TimelineEvent[] {
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
      sourceId: tr._id,
      encounterId: tr.encounterId || undefined,
      date: tr.triagedAt || tr.createdAt,
      category: 'triage',
      title: tr.chiefComplaint || t('timeline.titleTriage', { priority: t(priorityLabelKey(tr.priority)) }),
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
      encounterId: r.encounterId || undefined,
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
      encounterId: n.encounterId || undefined,
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
      sourceId: lr._id,
      encounterId: lr.encounterId || undefined,
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
      sourceId: rx._id,
      encounterId: rx.encounterId || undefined,
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
      sourceId: im._id,
      encounterId: im.encounterId || undefined,
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
      sourceId: ref._id,
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
      sourceId: a._id,
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
      sourceId: ap._id,
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

/** Calendar day an event belongs to, in the clinic's local time. */
function dayKeyOf(date: string): string {
  if (date.length <= 10) return date;
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? date.slice(0, 10) : toIsoDate(d);
}

/** One visit (or, for events with no encounter, one calendar day). */
export interface TimelineGroup {
  id: string;
  /** Set when the group is a real encounter; absent for calendar-day groups. */
  encounterId?: string;
  /** Latest event date in the group, used to order groups newest-first. */
  date: string;
  events: TimelineEvent[];
}

/**
 * Group events by encounter; events with no encounter fall back to one group
 * per calendar day. Groups and the events inside them are newest-first.
 */
export function groupTimelineEvents(events: TimelineEvent[]): TimelineGroup[] {
  const byId = new Map<string, TimelineGroup>();
  for (const e of events) {
    const id = e.encounterId ? `enc-${e.encounterId}` : `day-${dayKeyOf(e.date)}`;
    let g = byId.get(id);
    if (!g) {
      g = { id, encounterId: e.encounterId, date: e.date, events: [] };
      byId.set(id, g);
    }
    g.events.push(e);
    if (e.date.localeCompare(g.date) > 0) g.date = e.date;
  }
  const groups = [...byId.values()];
  for (const g of groups) g.events.sort((a, b) => b.date.localeCompare(a.date));
  return groups.sort((a, b) => b.date.localeCompare(a.date));
}

export interface TimelineGroupSummary {
  title: string;
  detail?: string;
  counts: string;
  badge?: TimelineEvent['badge'];
}

/** Header content for a group: reason, who/where, and what the visit produced. */
export function summarizeGroup(group: TimelineGroup, t: TFunc): TimelineGroupSummary {
  const by = (c: TimelineCategory) => group.events.filter(e => e.category === c);
  const consult = by('consultation')[0];
  const triage = by('triage')[0];
  const note = by('note')[0];
  const lead = consult || triage || note || group.events[0];
  const title = group.encounterId
    ? (consult?.title || triage?.title || t('timeline.visit'))
    : t('timeline.dayActivity');
  const detail = group.encounterId ? (consult?.meta || lead?.meta) : undefined;

  const plural = (n: number, one: string, many: string) => t(n === 1 ? one : many, { count: n });
  const parts: string[] = [];
  const meds = by('prescription').length;
  const labs = by('lab').length;
  const vaccines = by('immunization').length;
  const referrals = by('referral').length;
  const other = by('appointment').length + by('anc').length;
  if (meds) parts.push(plural(meds, 'timeline.groupMed', 'timeline.groupMeds'));
  if (labs) parts.push(plural(labs, 'timeline.groupLab', 'timeline.groupLabs'));
  if (vaccines) parts.push(plural(vaccines, 'timeline.groupVaccine', 'timeline.groupVaccines'));
  if (referrals) parts.push(plural(referrals, 'timeline.groupReferral', 'timeline.groupReferrals'));
  if (other) parts.push(t('timeline.groupOther', { count: other }));
  const signingDoc = note || consult;
  if (signingDoc) {
    const signed = signingDoc.badge?.label === 'Signed' || signingDoc.badge?.label === 'Amended';
    parts.push(t(signed ? 'timeline.groupNoteSigned' : 'timeline.groupNoteUnsigned'));
  }
  if (triage) parts.push(t('timeline.groupTriaged'));

  return { title, detail, counts: parts.join(' · '), badge: (consult || note)?.badge };
}

/** The event a visit row's actions act on: its document, else its newest item. */
export function groupLeadEvent(group: TimelineGroup): TimelineEvent {
  const of = (category: TimelineCategory) => group.events.find(e => e.category === category);
  return of('consultation') || of('note') || group.events[0];
}

function formatEventDate(date: string): string {
  try {
    return new Date(date).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      ...(date.includes('T') ? { hour: '2-digit', minute: '2-digit' } : {}),
    });
  } catch { return date; }
}

export default function PatientTimeline(props: PatientTimelineProps) {
  const { t } = useTranslation();
  const events = buildEvents(props, t);
  const allGroups = groupTimelineEvents(events);
  const [filter, setFilter] = useState<'all' | TimelineEvent['category']>('all');
  const [search, setSearch] = useState('');
  const { returnKey } = props;
  // Coming back from a row's Open: the visits that were open, and the row.
  // A deep link to one of this timeline's own documents wins. A focus id that
  // names no row here (the chart keeps the Lab tab's ?focus= across tabs) is
  // not one, and Back from that result still lands where it was opened.
  const deepLinked = !!props.focusId && events.some(e => e.docId === props.focusId);
  const [arrival] = useState(() => (deepLinked ? null : readTimelineReturn(returnKey)));
  const [returnedRowId, setReturnedRowId] = useState<string | undefined>(arrival?.row);
  // Visit groups opened to their item-level rows.
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(arrival?.open));
  const toggleGroup = (id: string) => setOpenGroups(prev => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  // Deep-link arrival: the visit opens to the row the caller asked for and the
  // row opens in the sidebar, so the signature controls the user was sent here
  // to use are on screen rather than one more click away.
  const { focusId, onOpenEvent, renderEventActions } = props;
  const hasActions = !!renderEventActions;
  const columnCount = hasActions ? 5 : 4;
  const openEventRef = useRef(onOpenEvent);
  useEffect(() => { openEventRef.current = onOpenEvent; });
  const focusedEventRef = useRef<TimelineEvent | undefined>(undefined);
  const focusedEvent = focusId ? events.find(e => e.docId === focusId) : undefined;
  const focusedRowId = focusedEvent?.id;
  useEffect(() => { focusedEventRef.current = focusedEvent; });
  const focusedGroupId = focusedRowId ? allGroups.find(g => g.events.some(e => e.id === focusedRowId))?.id : undefined;
  useEffect(() => {
    if (!focusedRowId) return;
    if (focusedEventRef.current) openEventRef.current?.(focusedEventRef.current);
    if (focusedGroupId) setOpenGroups(prev => (prev.has(focusedGroupId) ? prev : new Set(prev).add(focusedGroupId)));
    // The row mounts with the expansion, so the scroll waits a frame for it.
    const raf = requestAnimationFrame(() => {
      document.getElementById(`timeline-row-${focusedRowId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => cancelAnimationFrame(raf);
  }, [focusedRowId, focusedGroupId]);

  // Back from a record: the row it was opened from, in view and marked for a
  // moment so the eye finds it.
  useEffect(() => {
    if (!arrival) return;
    // One-shot: a later, unrelated visit to this tab starts collapsed.
    try { if (returnKey) window.sessionStorage.removeItem(returnStorageKey(returnKey)); } catch { /* already gone */ }
    const raf = requestAnimationFrame(() => {
      document.getElementById(arrival.row)?.scrollIntoView({ block: 'center' });
    });
    const clear = window.setTimeout(() => setReturnedRowId(undefined), 2400);
    return () => { cancelAnimationFrame(raf); window.clearTimeout(clear); };
  }, [arrival, returnKey]);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  /**
   * A row's Actions may navigate away (Open → the Lab tab); note where from.
   * An action that stays here (View opens the sidebar) leaves the timeline
   * mounted, and the note is dropped so it cannot surface on a later visit.
   */
  const rememberReturn = (rowDomId: string) => {
    if (!returnKey) return;
    const key = returnStorageKey(returnKey);
    try {
      const memo: TimelineReturn = { open: [...openGroups], row: rowDomId };
      window.sessionStorage.setItem(key, JSON.stringify(memo));
    } catch {
      // Private mode or a full store: Back still works, it just lands collapsed.
      return;
    }
    window.setTimeout(() => {
      if (!mountedRef.current) return;
      try { window.sessionStorage.removeItem(key); } catch { /* nothing to drop */ }
    }, 3000);
  };

  const searchQuery = search.trim().toLowerCase();
  const matches = (event: TimelineEvent) =>
    (filter === 'all' || event.category === filter)
    && (!searchQuery || `${event.title} ${event.subtitle || ''} ${event.meta || ''} ${event.badge?.label || ''}`.toLowerCase().includes(searchQuery));
  // Filters apply to the items inside each group; groups left empty disappear.
  const visibleGroups = allGroups
    .map(group => ({ group, items: group.events.filter(matches) }))
    .filter(entry => entry.items.length > 0);
  const visibleCount = visibleGroups.reduce((n, entry) => n + entry.items.length, 0);
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

  const renderEvent = (e: TimelineEvent, nested: boolean, lastInGroup = false) => {
    const cfg = CATEGORY_CONFIG[e.category];
    const dateLabel = formatEventDate(e.date);
    // An event counts as "alarming" when its badge text reads as a
    // clinical emergency (critical lab, high-risk triage, etc.).
    // Color-sniffing is fragile (hexes vary), so we match the label.
    const badgeLabel = (e.badge?.label || '').toLowerCase();
    const badgeIsAlarm = /critical|emergency|red|severe|abnormal|high risk|overdue|hypo|hyper/.test(badgeLabel);
    // A document opens in the sidebar, which carries all of its detail. Any
    // other row has nowhere to open, so its one line of detail stays in the row.
    const opens = !!onOpenEvent && !!e.docId;
    const detail = opens ? '' : [e.subtitle, e.meta].filter(Boolean).join(' · ');
    const isFocused = !!e.docId && e.docId === focusId;
    return (
      <tr
        key={e.id}
        id={`timeline-row-${e.id}`}
        className={`tamam-activity-tr${badgeIsAlarm ? ' is-alarm' : ''}${opens ? ' has-detail' : ''}${nested ? ' is-nested' : ''}${nested && lastInGroup ? ' is-nested-last' : ''}${`timeline-row-${e.id}` === returnedRowId ? ' is-returned' : ''}`}
        style={isFocused ? { background: 'var(--accent-light)', boxShadow: 'inset 3px 0 0 var(--accent-primary)' } : undefined}
        {...(opens ? clickable(() => onOpenEvent?.(e), { label: t('timeline.openEvent', { title: e.title }) }) : {})}
      >
        <td className="tamam-activity-date"><time dateTime={e.date}>{dateLabel}</time></td>
        <td>
          <span className="tamam-activity-type">
            {t(cfg.labelKey)}
          </span>
        </td>
        <td className="tamam-activity-title">
          {e.title}
          {detail && <div className="tamam-cell-sub">{detail}</div>}
        </td>
        <td>
          {e.badge?.dot
            ? <i className="tamam-activity-severity" style={{ background: e.badge.color }} title="Priority indicator" />
            : e.badge?.label
              ? <em className="tamam-activity-badge clinical-status-pill" style={{ background: e.badge.bg, color: e.badge.color, borderColor: `${e.badge.color}30` }}>{e.badge.label}</em>
              : <span className="tamam-activity-dash">—</span>}
        </td>
        {hasActions && <td {...stopsClickPropagation} onClickCapture={() => rememberReturn(`timeline-row-${e.id}`)}>{renderEventActions?.(e)}</td>}
      </tr>
    );
  };

  return (
    <ChartSection
      title={t('timeline.pageTitle')}
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
        <span><strong>{visibleCount}</strong> {filter === 'all' ? 'events' : 'matching events'}</span>
        <span>Most recent first</span>
      </div>
      {/* One line per VISIT (encounter), or per calendar day for events that
         belong to no encounter. A visit opens onto its item-level rows, which
         are the original event rows. A lone event with no encounter has
         nothing to group, so it renders as a plain row. */}
      <table className="tamam-table tamam-table--fixed tamam-activity-table">
        <colgroup>
          <col /><col /><col /><col />
          {hasActions && <col style={{ width: 72 }} />}
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Type</th>
            <th scope="col">Event</th>
            <th scope="col">Status</th>
            {hasActions && <th scope="col" aria-label={t('timeline.actions')} />}
          </tr>
        </thead>
        <tbody>
          {visibleGroups.length === 0 && (
            <tr>
              <td colSpan={columnCount} style={{ cursor: 'default', background: 'transparent' }}>
                <OmrsEmptyState itemLabel={events.length === 0 ? 'activity' : 'matching activity'} />
              </td>
            </tr>
          )}
          {visibleGroups.map(({ group, items }) => {
            if (!group.encounterId && group.events.length === 1) return renderEvent(items[0], false);
            const summary = summarizeGroup(group, t);
            // While searching, groups open so a match is never hidden behind a collapsed visit.
            const isOpen = openGroups.has(group.id) || searchQuery !== '';
            const Chevron = isOpen ? ChevronDown : ChevronRight;
            return (
              <Fragment key={group.id}>
                <tr
                  id={`timeline-group-${group.id}`}
                  className={`tamam-activity-tr tamam-activity-group has-detail${isOpen ? ' is-open' : ''}${`timeline-group-${group.id}` === returnedRowId ? ' is-returned' : ''}`}
                  {...clickable(() => toggleGroup(group.id), { label: `${isOpen ? 'Hide' : 'Show'} items for ${summary.title}` })}
                  aria-expanded={isOpen}
                >
                  <td className="tamam-activity-date"><time dateTime={group.date}>{formatEventDate(group.date)}</time></td>
                  <td>
                    <span className="tamam-activity-type">
                      <Chevron className="w-3.5 h-3.5" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 4 }} />
                      {group.encounterId ? t('timeline.visit') : t('timeline.dayType')}
                    </span>
                  </td>
                  <td className="tamam-activity-title">
                    <strong>{summary.title}</strong>
                    {summary.detail && <div className="tamam-cell-sub">{summary.detail}</div>}
                    {summary.counts && <div className="tamam-cell-sub">{summary.counts}</div>}
                  </td>
                  <td>
                    {summary.badge?.label
                      ? <em className="tamam-activity-badge clinical-status-pill" style={{ background: summary.badge.bg, color: summary.badge.color, borderColor: `${summary.badge.color}30` }}>{summary.badge.label}</em>
                      : <span className="tamam-activity-dash">—</span>}
                  </td>
                  {hasActions && <td {...stopsClickPropagation} onClickCapture={() => rememberReturn(`timeline-group-${group.id}`)}>{renderEventActions?.(groupLeadEvent(group))}</td>}
                </tr>
                {isOpen && items.map((e, index) => renderEvent(e, true, index === items.length - 1))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </ChartSection>
  );
}
