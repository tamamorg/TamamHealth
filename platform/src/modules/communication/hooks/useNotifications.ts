'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/lib/context';
import { makeCoalescer } from '@/lib/hooks/live-reload';
import { referralsDB, appointmentsDB, labResultsDB, prescriptionsDB, consultationProgressDB, patientTransfersDB, triageDB, encountersDB } from '@/lib/db';
import { isForViewer, isKindRelevantToRole } from '@/modules/communication/notifications/notification-scope';
import type { NotificationKind } from '@/modules/communication/notifications/notification-scope';
// The shapes moved to `notifications/types.ts` so a server module can name a
// notification without importing a React hook. Re-exported so existing
// consumers of this file keep working.
export type {
  NotificationType, NotificationSeverity, NotificationItem,
} from '@/modules/communication/notifications/types';
import type { NotificationItem } from '@/modules/communication/notifications/types';
import { todayIso as isoToday } from '@/lib/date-utils';
import {
  NOTIFICATION_READS_EVENT,
  getReadNotificationIds,
  markNotificationsRead,
} from '@/modules/communication/notifications/notification-reads';
import { getRoleSettings, subscribeRoleSettings } from '@/lib/settings/role-settings-store';
import { filterNotifications } from '@/lib/settings/notification-preferences';

/**
 * Aggregates every facility-level event a user should be notified about into
 * one list for the TopBar notification bell:
 *   - incoming/updated referrals
 *   - internal patient transfers awaiting this user's acceptance, and
 *     decisions on transfers this user sent
 *   - active disease-outbreak alerts
 *   - triaged patients still waiting to be seen (acuity drives severity)
 *   - lab results (critical + newly ready to review)
 *   - appointments awaiting approval + patients checked in and waiting
 *   - prescriptions awaiting dispensing
 * Messaging is intentionally excluded — chat has its own unread indicator.
 * Loads per scope; the panel can call reload(), and referral/appointment
 * writes live-refresh the badge.
 */
/** User preference: play a sound when new notifications arrive, or stay
 *  silent. Persisted per device; read at chime time so no re-render needed. */
const ALERT_PREF_KEY = 'tamamhealth-notification-alerts';
export type NotificationAlertPref = 'sound' | 'muted';

export function getNotificationAlertPref(): NotificationAlertPref {
  if (typeof window === 'undefined') return 'sound';
  return window.localStorage.getItem(ALERT_PREF_KEY) === 'muted' ? 'muted' : 'sound';
}

export function setNotificationAlertPref(pref: NotificationAlertPref) {
  try { window.localStorage.setItem(ALERT_PREF_KEY, pref); } catch { /* private mode */ }
}

/** Short two-tone chime via WebAudio — no asset needed, works offline. */
function playAlertChime() {
  try {
    type AudioCtor = typeof AudioContext;
    const Ctx: AudioCtor | undefined = window.AudioContext
      || (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    // Autoplay policy: a context created without a recent user gesture starts
    // suspended and plays nothing — try to resume, and bail quietly if the
    // browser refuses (the badge still updates visually).
    if (ctx.state === 'suspended') { void ctx.resume(); }
    const play = (freq: number, at: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.28);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.3);
    };
    play(880, 0);
    play(1174.66, 0.16);
    setTimeout(() => { void ctx.close(); }, 800);
  } catch { /* audio blocked — stay silent */ }
}

/**
 * Maximum items kept per source. High enough that the badge, the bell panel,
 * and /notifications all report the same total — a bell reading "105" over a
 * page listing 480 is just a lying badge — and bounded so a pathological
 * dataset can't build an unbounded array. Every source already reads its full
 * document set to decide what qualifies, so the cap only trims the output.
 */
const DEFAULT_PER_SOURCE_LIMIT = 500;

export interface UseNotificationsOptions {
  /** Override the per-source cap. Callers that only render a handful of rows
   *  can lower it; nothing that shows a count should. */
  perSourceLimit?: number;
}

export function useNotifications(options: UseNotificationsOptions = {}) {
  const perSourceLimit = options.perSourceLimit ?? DEFAULT_PER_SOURCE_LIMIT;
  const { currentUser } = useAuth();
  const [allItems, setAllItems] = useState<NotificationItem[]>([]);
  // The user's own `notify.*` rows, live — turning one off empties those rows
  // from the bell immediately rather than at the next reload.
  const [notifyPrefs, setNotifyPrefs] = useState(getRoleSettings);
  useEffect(() => {
    setNotifyPrefs(getRoleSettings());
    return subscribeRoleSettings(setNotifyPrefs);
  }, []);
  const items = useMemo(
    () => filterNotifications(allItems, notifyPrefs),
    [allItems, notifyPrefs],
  );
  const [loading, setLoading] = useState(true);
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const userId = currentUser?._id ?? '';
  // Known notification ids — lets us chime only for genuinely new arrivals
  // (never on the first load of a session).
  const seenIds = useRef<Set<string> | null>(null);
  // Includes the user id + department: the transfer feed is per-user, so a
  // scope-only key would keep serving one user's inbox after a re-login in the
  // same tab.
  const scopeKey = `${currentUser?._id ?? ''}|${currentUser?.orgId ?? ''}|${currentUser?.hospitalId ?? ''}|${currentUser?.role ?? ''}|${currentUser?.department ?? ''}`;

  const load = useCallback(async () => {
    setLoading(true);
    const scope = currentUser
      ? { orgId: currentUser.orgId, hospitalId: currentUser.hospitalId, role: currentUser.role }
      : undefined;
    const out: NotificationItem[] = [];
    // Whole sources that are not this role's job are skipped before their
    // database read — see KIND_RELEVANT_ROLES in lib/notification-scope.ts.
    const relevant = (kind: NotificationKind) => isKindRelevantToRole(kind, currentUser?.role);

    if (relevant('referral')) try {
      const { getAllReferrals } = await import('@/lib/services/referral-service');
      const refs = await getAllReferrals(scope);
      const myHospitalId = currentUser?.hospitalId;
      // Recent-acceptance window so a sender's "patient received" banner clears
      // itself once the episode is under way, instead of lingering forever
      // while the referral sits in the terminal-ish `seen` state.
      const ACK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
      const nowMs = Date.now();
      for (const x of refs) {
        const isIncoming = !!myHospitalId && x.toHospitalId === myHospitalId;
        const isOutgoing = !!myHospitalId && x.fromHospitalId === myHospitalId;
        // Incoming referral awaiting THIS facility's triage/acceptance. Admin
        // roles without a hospitalId keep the old behaviour (see everything).
        if ((isIncoming || !myHospitalId) && (x.status === 'sent' || x.status === 'received')) {
          out.push({ id: `ref-${x._id}`, type: 'referral', severity: 'warning', title: `Referral · ${x.patientName}`, subtitle: `${x.fromHospital} → ${x.toHospital}`, time: x.referralDate || x.createdAt, href: '/referrals' });
        }
        // Outgoing referral the receiving facility just accepted — close the
        // loop by telling the sender their patient was received on the other end.
        if (isOutgoing && x.status === 'seen') {
          const acceptedAt = x.updatedAt || x.referralDate || x.createdAt;
          const acceptedMs = Date.parse(acceptedAt || '');
          if (Number.isNaN(acceptedMs) || nowMs - acceptedMs <= ACK_WINDOW_MS) {
            out.push({ id: `ref-ack-${x._id}`, type: 'referral', severity: 'info', title: `Patient received · ${x.patientName}`, subtitle: `${x.toHospital} accepted the referral`, time: acceptedAt, href: '/referrals' });
          }
        }
        // Outgoing referral the receiving facility closed out with a structured
        // outcome — surface the disposition so the referrer learns what happened.
        if (isOutgoing && x.status === 'completed' && x.outcome) {
          const closedAt = x.outcome.recordedAt || x.updatedAt || x.referralDate;
          const closedMs = Date.parse(closedAt || '');
          if (Number.isNaN(closedMs) || nowMs - closedMs <= ACK_WINDOW_MS) {
            const disposition = x.outcome.disposition.replace(/_/g, ' ');
            out.push({ id: `ref-out-${x._id}`, type: 'referral', severity: 'info', title: `Referral outcome · ${x.patientName}`, subtitle: `${x.toHospital}: ${disposition}`, time: closedAt, href: '/referrals' });
          }
        }
      }
    } catch { /* offline */ }

    // Internal transfers of care ownership. Both directions matter: the
    // receiving clinician must know a patient is waiting on their decision, and
    // the sender must learn the answer — a transfer accepted or rejected in
    // silence leaves one of the two teams believing they own the patient.
    try {
      const svc = await import('@/lib/services/patient-transfer-service');
      const myId = currentUser?._id;
      if (myId) {
        // One read serves both directions. The decision feed needs `rejected` /
        // `completed`, which the open-transfer queries deliberately exclude.
        const all = await svc.getAllTransfers(scope, myId);
        const incoming = await svc.getIncomingTransfers({
          id: myId,
          department: currentUser?.department,
          hospitalId: currentUser?.hospitalId,
          role: currentUser?.role,
        }, scope);

        for (const t of incoming.slice(0, perSourceLimit)) {
          const overdue = svc.isTransferOverdue(t);
          out.push({
            id: `xfer-in-${t._id}`,
            type: 'transfer',
            severity: overdue ? 'critical' : 'warning',
            title: `${overdue ? 'OVERDUE · ' : ''}Transfer to accept · ${t.patientName || 'patient'}`,
            subtitle: `${svc.describeAssignment(t.from)} → you · ${t.reason}`,
            time: t.requestedAt || t.createdAt,
            href: `/patients/${t.patientId}?tab=referrals`,
          });
        }

        // Decisions on transfers this user sent. Bounded to a recent window so
        // a resolved hand-off stops nagging once it has been seen.
        const DECISION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
        for (const t of all) {
          if (t.requestedById !== myId) continue;
          if (t.status !== 'rejected' && t.status !== 'completed') continue;
          const at = t.decidedAt || t.completedAt || t.updatedAt;
          const ms = Date.parse(at || '');
          if (!Number.isNaN(ms) && Date.now() - ms > DECISION_WINDOW_MS) continue;
          out.push({
            id: `xfer-dec-${t._id}`,
            type: 'transfer',
            severity: t.status === 'rejected' ? 'warning' : 'info',
            title: t.status === 'rejected'
              ? `Transfer rejected · ${t.patientName || 'patient'}`
              : `Transfer completed · ${t.patientName || 'patient'}`,
            subtitle: t.status === 'rejected'
              ? `${t.decidedByName || 'Receiving team'}: ${t.decisionNotes || 'no reason given'}`
              : `Care moved to ${svc.describeAssignment(t.to)}`,
            time: at,
            href: `/patients/${t.patientId}?tab=referrals`,
          });
        }
      }
    } catch { /* offline */ }

    try {
      const { getActiveAlerts } = await import('@/lib/services/surveillance-service');
      // Scoped: an outbreak alert reaches every role, but only within the
      // viewer's own tenant — unscoped, every alert in the replicated DB
      // reached every user on the platform.
      const alerts = await getActiveAlerts(scope);
      for (const a of alerts.slice(0, perSourceLimit)) {
        out.push({ id: `alert-${a._id}`, type: 'alert', severity: 'critical', title: `${a.disease} outbreak alert`, subtitle: `${a.cases} cases · ${a.county}, ${a.state}`, time: a.reportDate || a.createdAt, href: '/surveillance' });
      }
    } catch { /* offline */ }

    // Triaged patients still waiting for a provider. Its own source (and its
    // own colour) rather than folding into `progress`: an ETAT RED patient
    // waiting is a different class of thing from a care-progress update, and
    // the acuity is what makes it actionable. `seen` triages are excluded —
    // someone already picked the patient up.
    //
    // Deliberately NOT narrowed to the viewer, unlike appointments and routine
    // results: a triage record names no provider, because the waiting room is
    // the shared pool clinicians pull the next patient from. Filtering it by
    // ownership would empty the queue for everyone — there is no owner yet.
    if (relevant('triage')) try {
      const { getActiveTriage } = await import('@/lib/services/triage-service');
      const triages = await getActiveTriage(scope);
      // Still actionable for a clinician: either not yet assessed at all
      // ('pending', the clerical check-in state), or assessed but not yet
      // in front of a provider. The triage form stamps a completed ETAT
      // straight to 'seen' (see TriageWorkflow.tsx) with a handoffStatus of
      // 'awaiting_provider'/'assigned' — filtering on 'pending' alone excluded
      // every real assessment, which is how a RED patient waiting for a
      // doctor stopped alerting anyone. Once the clinician has actually taken
      // the patient ('in_consultation') the alert has done its job and stops.
      const waiting = triages.filter(x =>
        x.status === 'pending' || (x.status === 'seen' && x.handoffStatus !== 'in_consultation'));
      // Most acute first, then longest-waiting, so the per-source cap drops
      // routine cases rather than an emergency.
      const acuityRank = { RED: 0, YELLOW: 1, GREEN: 2 } as const;
      waiting.sort((a, b) =>
        acuityRank[a.priority] - acuityRank[b.priority]
        || (a.triagedAt || '').localeCompare(b.triagedAt || ''));
      for (const x of waiting.slice(0, perSourceLimit)) {
        const acuity = x.priority === 'RED' ? 'Emergency'
          : x.priority === 'YELLOW' ? 'Urgent'
          : 'Routine';
        out.push({
          id: `triage-${x._id}`,
          type: 'triage',
          severity: x.priority === 'RED' ? 'critical' : x.priority === 'YELLOW' ? 'warning' : 'info',
          title: `${acuity} triage · ${x.patientName}`,
          subtitle: [x.chiefComplaint, x.assignedRoom || 'awaiting provider'].filter(Boolean).join(' · '),
          time: x.triagedAt || x.updatedAt || x.createdAt,
          href: `/patients/${encodeURIComponent(x.patientId)}`,
        });
      }
    } catch { /* offline */ }

    const todayIso = isoToday();
    const RECENT_MS = 3 * 24 * 60 * 60 * 1000;
    const nowMsLocal = Date.now();

    if (relevant('lab')) try {
      const { getAllLabResults, effectiveOrderStatus } = await import('@/lib/services/lab-service');
      const { getResultReviewSLA } = await import('@/lib/clinical-flow/order-lifecycles');
      const labs = await getAllLabResults(scope);

      // Results this clinician ordered that are back but still unreviewed past
      // their SLA (24h critical / 7d routine). This is the same feed the
      // clinical dashboard's "Awaiting review" card renders, so
      // its "View all" lands on a list that actually contains those rows.
      // Scoped by ordering clinician — LabResultDoc.orderedBy is a free-text
      // name, matched the same way the dashboard matches it.
      const sla = getResultReviewSLA();
      const overdueIds = new Set<string>();
      if (currentUser?.name) {
        const overdue = labs
          .filter(x => x.orderedBy === currentUser.name && effectiveOrderStatus(x) === 'resulted')
          .map(x => {
            const resultedAt = Date.parse(x.updatedAt || x.createdAt || '');
            return { doc: x, hoursOverdue: (nowMsLocal - resultedAt) / 3_600_000, resultedAt };
          })
          .filter(x => Number.isFinite(x.resultedAt) && x.hoursOverdue > (x.doc.critical ? sla.criticalHours : sla.routineHours))
          .sort((a, b) => b.hoursOverdue - a.hoursOverdue)
          .slice(0, perSourceLimit);
        for (const { doc, hoursOverdue } of overdue) {
          overdueIds.add(doc._id);
          const age = hoursOverdue >= 48
            ? `${Math.floor(hoursOverdue / 24)}d overdue`
            : `${Math.round(hoursOverdue)}h overdue`;
          out.push({
            id: `lab-overdue-${doc._id}`,
            type: 'lab',
            severity: doc.critical ? 'critical' : 'warning',
            title: `${doc.critical ? 'Critical result unreviewed' : 'Result awaiting review'} · ${doc.testName}`,
            subtitle: `${doc.patientName} · ${age}`,
            time: doc.updatedAt || doc.completedAt || doc.createdAt,
            href: `/patients/${doc.patientId}?tab=labs&focus=${encodeURIComponent(doc._id)}`,
          });
        }
      }

      // Critical results, then non-critical results that just came back (ready
      // for the clinician to review) within a recent window. Anything already
      // raised above as overdue is skipped — the overdue row says strictly
      // more about the same result.
      for (const l of labs.filter(x => x.critical && x.status === 'completed' && !overdueIds.has(x._id))) {
        out.push({ id: `lab-${l._id}`, type: 'lab', severity: 'critical', title: `Critical result · ${l.testName}`, subtitle: l.patientName, time: l.completedAt || l.orderedAt || l.createdAt, href: l.patientName ? `/lab?patient=${encodeURIComponent(l.patientName)}` : '/lab' });
      }
      const readyLabs = labs
        .filter(x => !x.critical && x.status === 'completed' && !overdueIds.has(x._id))
        // Routine results go to the clinician who ordered them. (The critical
        // loop above is deliberately left unfiltered — see notification-scope.)
        .filter(x => isForViewer({ ownerName: x.orderedBy }, currentUser))
        .filter(x => {
          const ms = Date.parse(x.completedAt || x.updatedAt || x.createdAt || '');
          return Number.isNaN(ms) || nowMsLocal - ms <= RECENT_MS;
        })
        .slice(0, perSourceLimit);
      for (const l of readyLabs) {
        out.push({ id: `lab-ready-${l._id}`, type: 'lab', severity: 'info', title: `Result ready · ${l.testName}`, subtitle: `${l.patientName} · ready to review`, time: l.completedAt || l.updatedAt || l.createdAt, href: l.patientName ? `/lab?patient=${encodeURIComponent(l.patientName)}` : '/lab' });
      }
    } catch { /* offline */ }

    // Appointments — approvals needed + patients checked in and waiting.
    if (relevant('appointment')) try {
      const { getAllAppointments } = await import('@/lib/services/appointment-service');
      const appts = await getAllAppointments(scope);
      // Awaiting approval: explicitly requested, or today's scheduled slots that
      // still need confirmation.
      const pending = appts
        .filter(a => a.status === 'requested' || (a.status === 'scheduled' && a.appointmentDate >= todayIso))
        // A clinician is shown the slots booked with THEM. Unfiltered, this one
        // source alone put every future appointment in the hospital on every
        // doctor's bell — the bulk of a ~500-row feed.
        .filter(a => isForViewer({ ownerId: a.providerId, ownerName: a.providerName }, currentUser))
        .sort((a, b) => (a.appointmentDate + (a.appointmentTime || '')).localeCompare(b.appointmentDate + (b.appointmentTime || '')))
        .slice(0, perSourceLimit);
      for (const a of pending) {
        out.push({ id: `appt-appr-${a._id}`, type: 'appointment', severity: 'info', title: `Appointment to confirm · ${a.patientName}`, subtitle: `${a.appointmentDate}${a.appointmentTime ? ` ${a.appointmentTime}` : ''} · ${a.providerName || a.department || 'awaiting approval'}`, time: a.updatedAt || a.createdAt || a.appointmentDate, href: '/appointments' });
      }
      // Checked in today, waiting to be seen.
      const checkedIn = appts
        .filter(a => a.status === 'checked_in' && a.appointmentDate === todayIso)
        .filter(a => isForViewer({ ownerId: a.providerId, ownerName: a.providerName }, currentUser))
        .slice(0, perSourceLimit);
      for (const a of checkedIn) {
        out.push({ id: `appt-ci-${a._id}`, type: 'appointment', severity: 'warning', title: `Checked in · ${a.patientName}`, subtitle: `${a.appointmentTime ? `${a.appointmentTime} · ` : ''}${a.department || a.reason || 'waiting to be seen'}`, time: a.checkedInAt || a.updatedAt || a.appointmentDate, href: '/appointments' });
      }
    } catch { /* offline */ }

    // Shared consultation progress. Only actionable items are raised here:
    // work assigned to the signed-in user, unassigned urgent work, blocked
    // tasks, and patients waiting for the next team member.
    try {
      const { getAllConsultationProgress } = await import('@/lib/services/consultation-progress-service');
      const progress = await getAllConsultationProgress(scope);
      // Pool items (blocked / unassigned urgent / waiting for provider) are
      // gated by role relevance; work assigned to THIS user always surfaces,
      // whatever their role — a task handed to a cashier must still reach them.
      const poolRelevant = relevant('progress');
      const progressItems: NotificationItem[] = [];
      for (const p of progress) {
        const href = `/patients/${encodeURIComponent(p.patientId)}`;
        const assignedToMe = !!currentUser?._id && p.ownerId === currentUser._id;
        const openTasks = p.tasks.filter(t => t.status !== 'completed');
        const relevantTasks = openTasks.filter(t =>
          t.ownerId === currentUser?._id
          || (poolRelevant && (t.status === 'blocked' || t.priority === 'urgent' || (!t.ownerId && t.priority === 'high'))),
        );
        if (assignedToMe || relevantTasks.length > 0 || (poolRelevant && p.currentStage === 'waiting_for_provider')) {
          const task = relevantTasks[0];
          progressItems.push({
            id: `progress-${p._id}-${task?.id || p.currentStage}`,
            type: 'progress',
            severity: task?.status === 'blocked' || task?.priority === 'urgent' ? 'warning' : 'info',
            title: task?.status === 'blocked' ? `Blocked task · ${p.patientName}` : `Patient progress · ${p.patientName}`,
            subtitle: task?.title || `${p.currentStage.replace(/_/g, ' ')} · ${p.nextAction || 'review next step'}`,
            time: p.updatedAt || p.createdAt,
            href,
          });
        }
      }
      // Every other source caps at perSourceLimit before pushing; this one
      // didn't, so a busy facility's full progress backlog bypassed the cap
      // that keeps the badge, the bell panel and /notifications reporting the
      // same total.
      out.push(...progressItems.slice(0, perSourceLimit));
    } catch { /* offline */ }

    // Visit-status updates for the patients this user is on the care team of —
    // one item per active visit, re-minted at every rung of the encounter
    // ladder (triaged → ready to call in → pharmacy → checkout), plus the
    // dispensed loop-closer on their own prescriptions. Derivation lives in
    // notifications/visit-updates.ts; ownership comes from the encounter's own
    // assignment fields, so unclaimed patients stay with the triage pool above.
    if (relevant('visit')) try {
      const { getAllEncounters } = await import('@/lib/services/encounter-service');
      const { visitUpdateItems, dispensedItems } = await import('@/modules/communication/notifications/visit-updates');
      const encounters = await getAllEncounters(scope);
      out.push(...visitUpdateItems(encounters, currentUser, nowMsLocal, perSourceLimit));
      const { getAllPrescriptions } = await import('@/lib/services/prescription-service');
      const rxs = await getAllPrescriptions(scope);
      out.push(...dispensedItems(rxs, currentUser, nowMsLocal, perSourceLimit));
    } catch { /* offline */ }

    // Prescriptions awaiting dispensing (pharmacy queue).
    if (relevant('prescription')) try {
      const { getAllPrescriptions } = await import('@/lib/services/prescription-service');
      const rxs = await getAllPrescriptions(scope);
      for (const rx of rxs.filter(x => x.status === 'pending').slice(0, perSourceLimit)) {
        out.push({ id: `rx-${rx._id}`, type: 'prescription', severity: 'info', title: `Prescription · ${rx.patientName}`, subtitle: `${rx.medication} · awaiting dispensing`, time: rx.updatedAt || rx.createdAt, href: '/pharmacy' });
      }
    } catch { /* offline */ }

    out.sort((a, b) => (b.time || '').localeCompare(a.time || ''));
    if (seenIds.current === null) {
      seenIds.current = new Set(out.map(n => n.id));
    } else {
      const fresh = out.filter(n => !seenIds.current!.has(n.id));
      if (fresh.length > 0 && getNotificationAlertPref() === 'sound') playAlertChime();
      for (const n of out) seenIds.current.add(n.id);
    }
    // Everything the facility produced; the user's Notifications settings
    // decide what actually reaches them. Stored unfiltered so toggling a
    // setting re-filters without re-querying seven databases.
    setAllItems(out);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, perSourceLimit]);

  useEffect(() => { load(); }, [load]);

  // Read-state lives in localStorage, so a mark made in the bell panel has to
  // reach the page (and vice versa) — both mount their own copy of this hook.
  useEffect(() => {
    setReadIds(getReadNotificationIds(userId));
    const sync = () => setReadIds(getReadNotificationIds(userId));
    window.addEventListener(NOTIFICATION_READS_EVENT, sync);
    // Another tab writing the same key.
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(NOTIFICATION_READS_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, [userId]);

  // Live-refresh on referral writes so the bell badge reflects acceptance the
  // moment the receiving facility's `seen` update replicates in — otherwise the
  // sender's "patient received" notification only surfaces on a manual reopen.
  // Coalesced to avoid re-render churn on bursty replication.
  useEffect(() => {
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) load(); });
    // Only the databases whose source this role actually receives — a write to
    // the pharmacy queue should not wake a session that will skip that source
    // anyway. Transfers and progress stay unconditional: both can address any
    // user directly. Labs and prescriptions matter here because without their
    // feeds a new critical result never chimes (or badges) until reopen.
    const role = currentUser?.role;
    const feeds = [
      isKindRelevantToRole('referral', role) ? referralsDB() : null,
      isKindRelevantToRole('appointment', role) ? appointmentsDB() : null,
      isKindRelevantToRole('lab', role) ? labResultsDB() : null,
      // The visit kind's dispensed loop-closer also reads prescriptions, so a
      // doctor's bell must wake on a dispense even though they skip the
      // pharmacy-queue source itself.
      isKindRelevantToRole('prescription', role) || isKindRelevantToRole('visit', role) ? prescriptionsDB() : null,
      patientTransfersDB(),
      consultationProgressDB(),
      // A patient triaged RED must badge the bell now, not on the next reopen.
      isKindRelevantToRole('triage', role) ? triageDB() : null,
      // Every encounter transition re-mints a visit item; without this feed the
      // "ready — call them in" rung only surfaces on the next manual reload.
      isKindRelevantToRole('visit', role) ? encountersDB() : null,
    ].filter((db): db is NonNullable<typeof db> => db !== null)
      .map(db => db.changes({ since: 'now', live: true, include_docs: false })
        .on('change', () => reload.trigger())
        .on('error', () => { /* swallow — offline */ }));
    return () => {
      cancelled = true;
      reload.cancel();
      for (const feed of feeds) {
        try { feed.cancel(); } catch { /* noop */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const decorated = useMemo(
    () => items.map(n => (readIds.has(n.id) ? { ...n, read: true } : n)),
    [items, readIds],
  );
  const unreadCount = useMemo(
    () => decorated.reduce((n, item) => (item.read ? n : n + 1), 0),
    [decorated],
  );

  const markRead = useCallback((ids: string | string[]) => {
    setReadIds(markNotificationsRead(userId, Array.isArray(ids) ? ids : [ids]));
  }, [userId]);
  const markAllRead = useCallback(() => {
    setReadIds(markNotificationsRead(userId, items.map(n => n.id)));
  }, [userId, items]);

  return {
    items: decorated,
    /** Everything in the feed. */
    count: decorated.length,
    /** What the bell badge counts — items the user has not opened yet. */
    unreadCount,
    loading,
    reload: load,
    markRead,
    markAllRead,
  };
}
