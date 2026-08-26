'use client';

import { useMemo } from 'react';
import { useAuth } from '@/lib/context';
import { useAppointments } from '@/lib/hooks/useAppointments';
import { useSigningInbox } from '@/lib/hooks/useSigningInbox';
import { computeSignCount, type SigningInboxCounts } from '@/lib/hooks/signing-inbox-math';
import { usePhoneNotesInbox } from '@/lib/hooks/usePhoneNotesInbox';
import { useReferrals } from '@/lib/hooks/useReferrals';
import { useLabResults } from '@/lib/hooks/useLabResults';
import type { AppointmentDoc, LabResultDoc, PhoneNoteDoc, ReferralDoc } from '@/lib/db-types';
import type { MobileDashboardData, MobileLane, MobileOutstandingItem } from './dashboard-strategy';
import { appointmentStatusGroup, APPOINTMENT_STATUS_GROUP_LABELS } from '@/lib/appointment-status';

function todayIso(): string {
  // Local calendar date, not UTC — see identical helper + rationale in
  // use-mobile-shell-state.ts (must stay in sync with the calendar tab's
  // default day and the dashboard header's locale-based "today" heading).
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Today's appointments split into the shared three-lane vocabulary (Upcoming
 * / Checked In / Completed — `appointmentStatusGroup`), the same grouping the
 * desktop dashboards' lane tabs use, so mobile and desktop file the same
 * visit into the same lane — including closed slots (cancelled/no-show/
 * rescheduled), which used to fall out of every lane here while the desktop
 * board shows them under Completed.
 *
 * Pure and exported so the lane split is directly testable without rendering
 * the mobile shell.
 */
export function computeClinicalLanes(appointments: AppointmentDoc[], today: string): MobileLane<AppointmentDoc>[] {
  const todays = appointments.filter((a) => a.appointmentDate === today);
  const scheduled = todays.filter((a) => appointmentStatusGroup(a.status) === 'scheduled');
  const inOffice = todays.filter((a) => appointmentStatusGroup(a.status) === 'in_office');
  const finished = todays.filter((a) => appointmentStatusGroup(a.status) === 'finished');
  return [
    { key: 'scheduled', label: `${scheduled.length} ${APPOINTMENT_STATUS_GROUP_LABELS.scheduled}`, tone: 'info', items: scheduled },
    { key: 'in_office', label: `${inOffice.length} ${APPOINTMENT_STATUS_GROUP_LABELS.in_office}`, tone: 'warning', items: inOffice },
    { key: 'finished', label: `${finished.length} ${APPOINTMENT_STATUS_GROUP_LABELS.finished}`, tone: 'success', items: finished },
  ];
}

export interface ClinicalOutstandingInput extends SigningInboxCounts {
  currentUser: { _id?: string; name?: string } | null | undefined;
  phoneNotes: PhoneNoteDoc[];
  referrals: ReferralDoc[];
  labResults: LabResultDoc[];
  today: string;
}

/**
 * The mobile shell's outstanding-item tiles. Mirrors the desktop dashboard's
 * `assembleDoctorWorklist` counts (app/(dashboard)/dashboard/page.tsx) for
 * the items both surfaces show, sharing `computeSignCount` so "documents to
 * sign" can't drift between the two the way it once did (a field added to
 * `useSigningInbox()` while only one consumer's own arithmetic included it).
 *
 * Pure and exported so the counts are directly testable without rendering
 * the mobile shell or its half-dozen backing hooks.
 */
export function computeClinicalOutstanding(input: ClinicalOutstandingInput): MobileOutstandingItem[] {
  const { currentUser, phoneNotes, referrals, labResults } = input;
  const signCount = computeSignCount(input);
  const myReferralsCount = referrals.filter((r) => r.createdBy === currentUser?._id).length;
  const awaitingLabs = labResults.filter(
    (r) => (r.status === 'pending' || r.status === 'in_progress') && r.orderedBy === currentUser?.name
  ).length;

  const items: MobileOutstandingItem[] = [
    { key: 'documents', label: 'Documents to sign', count: signCount, href: '/dashboard' },
    { key: 'phone_notes', label: 'Phone notes', count: phoneNotes.length, href: '/dashboard' },
    { key: 'referrals', label: 'Open referrals', count: myReferralsCount, href: '/referrals' },
    { key: 'labs', label: 'Awaiting labs', count: awaitingLabs, href: '/lab' },
  ];

  return items;
}

/**
 * Clinical-archetype dashboard data (doctor/CO/nurse/clinician/midwife/
 * triage_nurse/rooming_nurse). Lane grouping and outstanding-item counts
 * deliberately mirror the exact computations in
 * app/(dashboard)/dashboard/page.tsx so the mobile numbers agree with the
 * desktop dashboard for the same user — see phase 3 verification in
 * plans/fancy-snacking-noodle.md.
 */
export function useClinicalDashboardData(): MobileDashboardData {
  const { currentUser } = useAuth();
  const { appointments, loading: apptLoading } = useAppointments();
  const { unsignedDrafts, awaitingCosign, heldAssessments, unsignedNotes, loading: signLoading } = useSigningInbox();
  const { notes: phoneNotes, loading: phoneLoading } = usePhoneNotesInbox();
  const { referrals, loading: referralsLoading } = useReferrals();
  const { results: labResults, loading: labLoading } = useLabResults();

  const today = todayIso();

  const lanes = useMemo<MobileLane<AppointmentDoc>[]>(
    () => computeClinicalLanes(appointments, today),
    [appointments, today],
  );

  const outstanding = useMemo<MobileOutstandingItem[]>(() => computeClinicalOutstanding({
    currentUser, unsignedDrafts, awaitingCosign, heldAssessments, unsignedNotes,
    phoneNotes, referrals, labResults, today,
  }), [unsignedDrafts, awaitingCosign, heldAssessments, unsignedNotes, referrals, labResults, currentUser, today, phoneNotes]);

  const loading = apptLoading || signLoading || phoneLoading || referralsLoading || labLoading;

  return { lanes, outstanding, loading };
}
