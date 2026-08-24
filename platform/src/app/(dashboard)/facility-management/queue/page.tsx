'use client';

/**
 * Work Queue — the facility's three inbound queues, on their own page.
 *
 * These three tabs (Inquiries / Pending Leave / Active Staff) were the last
 * card on the Facility Management dashboard until 2026-08-24. A dashboard
 * card is a digest — five rows and a "View all" — but this is the surface a
 * manager actually WORKS, and as a card it spent a screenful of whitespace
 * saying "No recent inquiries". So it moved here and grew into the shape the
 * super-admin console uses for the same job: figures across the top, the
 * sections as a rail, and one panel that owns the rest of the height.
 *
 * What is the same as the dashboard's card: the rows (shared builders in
 * lib/facility-work-queue.ts, so a queue row cannot say two different things
 * on two screens), the shared search across all three queues, and the triage
 * dialogs — the inquiry status ladder, and approve/reject on a pending leave
 * request. What is different: no five-row cap (this is the queue, not a
 * digest), and the rail replaces the tab pills.
 *
 * Data is loaded here rather than handed down: the dashboard needs the same
 * four sources for its counts, and passing them across a route boundary would
 * mean holding one page's state for the other. Each load is tracked
 * independently so one failure degrades one queue, not the page.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle, ClipboardList, Loader2, MessageSquare, RefreshCw, Users,
} from '@/components/icons/lucide';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useUsers } from '@/lib/hooks/useUsers';
import { useToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import Select from '@/components/Select';
import {
  SadbPage, SadbCard, SadbShell, useSadbTab, SadbSearch, SadbKpiTile, SadbKvRow,
  SadbQueueRow, SadbHeadLink,
} from '@/components/admin/sadb-ui';
import { titleCase } from '@/lib/format-utils';
import { jubaDate, jubaTime } from '@/lib/time-juba';
import { usersHrefForRole } from '@/lib/people-nav';
import {
  ENQUIRY_STATUS_LABELS, ENQUIRY_STATUSES, getPatientEnquiries, summariseEnquiries,
  enquiryAssignee, type EnquiryStatus,
} from '@/lib/services/enquiry-service';
import {
  activeStaffOf, buildInquiryRows, buildPendingLeaveRows, buildStaffRows, enquiryChipTone,
} from '@/lib/facility-work-queue';
import type { MessageDoc, StaffScheduleDoc } from '@/lib/db-types';
import type { LeaveRequestDoc } from '@/lib/db-types-hr';

type QueueKey = 'inquiries' | 'leave' | 'staff';

const QUEUE_TITLE_KEYS: Record<QueueKey, string> = {
  inquiries: 'facilityQueue.titleInquiries',
  leave: 'facilityQueue.titleLeave',
  staff: 'facilityQueue.titleStaff',
};

const QUEUE_NOTE_KEYS: Record<QueueKey, string> = {
  inquiries: 'facilityQueue.noteInquiries',
  leave: 'facilityQueue.noteLeave',
  staff: 'facilityQueue.noteStaff',
};

const SEARCH_PLACEHOLDER_KEYS: Record<QueueKey, string> = {
  inquiries: 'facilityQueue.searchInquiries',
  leave: 'facilityQueue.searchLeave',
  staff: 'facilityQueue.searchStaff',
};

/** Which source feeds each queue — so a failed load names the right one. */
type SourceKey = 'enquiries' | 'availability' | 'leave' | 'schedule';
const SOURCE_LABEL_KEYS: Record<SourceKey, string> = {
  enquiries: 'facilityQueue.srcInquiries', availability: 'facilityQueue.srcAvailability',
  leave: 'facilityQueue.srcLeave', schedule: 'facilityQueue.srcSchedule',
};

// Same approver role list as the full HR page's leave tab (src/app/(dashboard)/hr/page.tsx)
// and its own landing dashboard (dashboard/hr/page.tsx) — who can decide a
// pending leave request from a queue.
const LEAVE_APPROVER_ROLES = new Set(['org_admin', 'medical_superintendent', 'hospital_manager', 'super_admin']);

/** Which row is open in the detail dialog. */
type QueueDetail =
  | { kind: 'inquiry'; id: string }
  | { kind: 'leave'; id: string }
  | { kind: 'staff'; id: string };

function withFocus(href: string, key: string, value: string): string {
  const [path, query = ''] = href.split('?');
  const params = new URLSearchParams(query);
  params.set(key, value);
  return `${path}?${params.toString()}`;
}

export default function FacilityWorkQueuePage() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const router = useRouter();
  const scope = useDataScope();
  const { showToast } = useToast();
  const { users, loading: usersLoading, error: usersError, reload: reloadUsers } = useUsers();

  const [enquiries, setEnquiries] = useState<MessageDoc[]>([]);
  const [leave, setLeave] = useState<LeaveRequestDoc[]>([]);
  const [schedules, setSchedules] = useState<StaffScheduleDoc[]>([]);
  const [availableProviderIds, setAvailableProviderIds] = useState<Set<string>>(new Set());
  const [loadErrors, setLoadErrors] = useState<Set<SourceKey>>(new Set());
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  /** One search box over all three queues: switching queues never leaves a
   *  stale, unrelated filter behind, because each one filters its own data by
   *  the same text. */
  const [search, setSearch] = useState('');
  const [queue, setQueue] = useSadbTab('inquiries', 'queue');
  const activeQueue = (['inquiries', 'leave', 'staff'] as const).includes(queue as QueueKey)
    ? (queue as QueueKey)
    : 'inquiries';
  const [detail, setDetail] = useState<QueueDetail | null>(null);

  const today = jubaDate();
  const facilityId = currentUser?.hospitalId;

  useEffect(() => {
    let cancelled = false;

    const loadAvailability = async () => {
      // Recurrence-aware: a clinic that runs every Monday has no row dated
      // today, so matching on `a.date === today` would show every provider as
      // unavailable the moment availability became a weekly pattern.
      const { getAllAvailability, appliesOnDate } = await import('@/lib/services/availability-service');
      const av = await getAllAvailability(scope);
      const now = jubaTime();
      return new Set(
        av.filter(a => appliesOnDate(a, today) && a.startTime <= now && a.endTime >= now).map(a => a.providerId),
      );
    };
    const loadLeave = async () => {
      const { getAllLeaveRequests } = await import('@/lib/services/leave-service');
      return getAllLeaveRequests(scope);
    };
    const loadSchedules = async () => {
      const { getSchedulesByDate } = await import('@/lib/services/staff-scheduling-service');
      return getSchedulesByDate(today, facilityId);
    };

    const runAll = () => Promise.allSettled([
      getPatientEnquiries(scope),
      loadAvailability(),
      loadLeave(),
      loadSchedules(),
    ]);

    (async () => {
      const failed = new Set<SourceKey>();
      let results = await runAll();
      if (cancelled) return;

      // One automatic second attempt before showing anyone a red banner: each
      // loader begins with a dynamic `import()`, so a single chunk that fails
      // to arrive rejects all four at once. That is one transient network
      // fault, not four broken subsystems, and on the connections this app is
      // built for it is routine.
      if (results.some(r => r.status === 'rejected')) {
        await new Promise(resolve => setTimeout(resolve, 700));
        if (cancelled) return;
        results = await runAll();
        if (cancelled) return;
      }
      const [enquiriesRes, availRes, leaveRes, schedRes] = results;
      if (enquiriesRes.status === 'fulfilled') setEnquiries(enquiriesRes.value); else failed.add('enquiries');
      if (availRes.status === 'fulfilled') setAvailableProviderIds(availRes.value); else failed.add('availability');
      if (leaveRes.status === 'fulfilled') setLeave(leaveRes.value); else failed.add('leave');
      if (schedRes.status === 'fulfilled') setSchedules(schedRes.value); else failed.add('schedule');

      // `allSettled` swallows the reason, and the banner names several
      // subsystems at once whenever something shared underneath them breaks.
      // Log what actually rejected.
      for (const [key, res] of [
        ['enquiries', enquiriesRes], ['availability', availRes],
        ['leave', leaveRes], ['schedule', schedRes],
      ] as [SourceKey, PromiseSettledResult<unknown>][]) {
        if (res.status === 'rejected') console.error(`[facility-queue] ${key} failed to load:`, res.reason);
      }
      setLoadErrors(failed);
      setLoading(false);
      setRetrying(false);
    })();

    return () => { cancelled = true; };
  }, [scope, today, facilityId, reloadToken]);

  const retry = useCallback(() => {
    setRetrying(true);
    reloadUsers();
    setReloadToken(t => t + 1);
  }, [reloadUsers]);

  const usersUnavailable = !!usersError && users.length === 0;

  /* Every staff figure here links to the one staff list this role has. The
     roles that reach this page all resolve to one; the fallback only guards
     the type. */
  const staffListHref = usersHrefForRole(currentUser?.role || '') || '/facility-management';

  const inquiries = useMemo(
    // No cap: the dashboard shows a digest, this page IS the queue.
    () => buildInquiryRows(enquiries, search, null),
    [enquiries, search],
  );
  const leaveRows = useMemo(() => buildPendingLeaveRows(leave, search), [leave, search]);
  const activeStaff = useMemo(
    () => activeStaffOf(users, availableProviderIds),
    [users, availableProviderIds],
  );
  const staffRows = useMemo(
    () => buildStaffRows(activeStaff, schedules, search),
    [activeStaff, schedules, search],
  );

  /* Headline figures, all read off the same records the rows below come from:
     what is open, what nobody owns, what is waiting on a decision, and who is
     actually on hand to work it. */
  const kpis = useMemo(() => {
    const summary = summariseEnquiries(enquiries);
    const unassigned = enquiries.filter(m => !enquiryAssignee(m)).length;
    const pending = leave.filter(l => l.status === 'pending');
    const days = pending.reduce((sum, l) => sum + (l.days || 0), 0);
    return {
      open: summary.open,
      total: enquiries.length,
      unassigned,
      pending: pending.length,
      days,
      available: usersUnavailable ? '—' : activeStaff.length,
      accounts: usersUnavailable ? '—' : users.length,
    };
  }, [enquiries, leave, activeStaff, users, usersUnavailable]);

  const failedLabels = Array.from(loadErrors).map(k => t(SOURCE_LABEL_KEYS[k]));
  if (usersUnavailable) failedLabels.push(t('facilityQueue.srcStaffAccounts'));
  const hasErrors = failedLabels.length > 0;

  const hasQuery = search.trim().length > 0;
  const inquiriesFailed = loadErrors.has('enquiries');
  const leaveFailed = loadErrors.has('leave');
  const staffFailed = usersUnavailable || loadErrors.has('availability');

  const counts: Record<QueueKey, number> = {
    inquiries: inquiries.rows.length,
    leave: leaveRows.length,
    staff: staffRows.length,
  };

  const meta = activeQueue === 'inquiries'
    ? t('facilityQueue.metaInquiries', { shown: inquiries.rows.length, total: enquiries.length })
    : activeQueue === 'leave'
      ? t('facilityQueue.metaLeave', { count: leaveRows.length })
      : t('facilityQueue.metaStaff', { count: staffRows.length });

  /* Empty state, its action, and the search placeholder all follow the active
     queue — each reads its own data source and its own failure mode. */
  const emptyTitle = activeQueue === 'staff'
    ? t(staffFailed ? 'facilityQueue.emptyStaffFailed' : hasQuery ? 'facilityQueue.emptyStaffSearch' : 'facilityQueue.emptyStaff')
    : activeQueue === 'inquiries'
      ? t(inquiriesFailed ? 'facilityQueue.emptyInquiriesFailed' : hasQuery ? 'facilityQueue.emptyInquiriesSearch' : 'facilityQueue.emptyInquiries')
      : t(leaveFailed ? 'facilityQueue.emptyLeaveFailed' : hasQuery ? 'facilityQueue.emptyLeaveSearch' : 'facilityQueue.emptyLeave');
  const emptyActionLabel = (activeQueue === 'staff' ? staffFailed : activeQueue === 'inquiries' ? inquiriesFailed : leaveFailed)
    ? t('facilityQueue.retry')
    : t(activeQueue === 'staff' ? 'facilityQueue.viewRoster' : 'facilityQueue.openFullPage');
  const onEmptyAction = activeQueue === 'staff'
    ? (staffFailed ? retry : () => router.push(staffListHref))
    : activeQueue === 'inquiries'
      ? (inquiriesFailed ? retry : () => router.push('/inquiries'))
      : (leaveFailed ? retry : () => router.push('/hr/leave'));

  /* The head link opens the page that OWNS this queue — full triage on
     /inquiries, the leave register on /hr/leave, the roster for staff. */
  const fullPageHref = activeQueue === 'inquiries' ? '/inquiries'
    : activeQueue === 'leave' ? '/hr/leave'
      : staffListHref;

  const detailInquiry = detail?.kind === 'inquiry' ? inquiries.rows.find(r => r.id === detail.id) ?? null : null;
  const detailLeave = detail?.kind === 'leave' ? leaveRows.find(r => r.id === detail.id) ?? null : null;
  const detailStaff = detail?.kind === 'staff' ? staffRows.find(r => r.id === detail.id) ?? null : null;

  const updateEnquiryStatusLocally = (id: string, status: EnquiryStatus) => {
    setEnquiries(prev => prev.map(m => (m._id === id ? { ...m, enquiryStatus: status } : m)));
  };

  /* Quick triage: the detail dialog's status picker puts any rung of the
     inquiry ladder one pick away; full triage (reassignment, notes) stays on
     /inquiries, which owns that surface. */
  const setEnquiryStatusAction = async (id: string, status: EnquiryStatus) => {
    try {
      const { setEnquiryStatus } = await import('@/lib/services/enquiry-service');
      await setEnquiryStatus(id, status);
      updateEnquiryStatusLocally(id, status);
      showToast(t('facilityQueue.toastInquiry', { status: ENQUIRY_STATUS_LABELS[status].toLowerCase() }), 'success');
    } catch (err) {
      console.error('Failed to update inquiry status', err);
      showToast(t('facilityQueue.toastInquiryFailed'), 'error');
    }
  };

  const isLeaveApprover = !!currentUser && LEAVE_APPROVER_ROLES.has(currentUser.role);

  /* Approve/reject mirrors dashboard/hr/page.tsx's `decideLeaveAction`.
     `decideLeave` catches its own "cannot approve your own leave" invariant
     internally and resolves to `null` rather than rejecting, so both that case
     and a hard failure surface as a toast, never an unhandled rejection. */
  const decideLeaveAction = async (id: string, status: 'approved' | 'rejected') => {
    if (!currentUser) return;
    try {
      const { decideLeave } = await import('@/lib/services/leave-service');
      const updated = await decideLeave(id, {
        status,
        decidedBy: currentUser._id,
        decidedByName: currentUser.name,
      });
      if (!updated) {
        showToast(t('facilityQueue.toastOwnLeave'), 'error');
        return;
      }
      setLeave(prev => prev.map(l => (l._id === id ? updated : l)));
      setDetail(null);
      showToast(t(status === 'approved' ? 'facilityQueue.toastLeaveApproved' : 'facilityQueue.toastLeaveRejected'), 'success');
    } catch (err) {
      console.error('Failed to decide leave request', err);
      showToast(t('facilityQueue.toastLeaveFailed'), 'error');
    }
  };

  if (!currentUser) return null;

  if (loading || usersLoading) {
    return (
      <SadbPage roles={['org_admin', 'hospital_manager', 'super_admin']}>
        <p className="sadb-empty" aria-live="polite">
          <Loader2 className="w-4 h-4 inline-block me-2 animate-spin" style={{ verticalAlign: -3 }} />
          {t('facilityQueue.loading')}
        </p>
      </SadbPage>
    );
  }

  return (
    <SadbPage roles={['org_admin', 'hospital_manager', 'super_admin']}>
      {/* While a retry is in flight the strip reports THAT, not the stale
          failure: pressing Retry and seeing the same red banner sit there is
          indistinguishable from the button being broken. */}
      {(hasErrors || retrying) && (
        <div
          className="sadb-card"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: '10px 14px', borderColor: retrying ? undefined : 'rgba(158, 27, 20, 0.35)' }}
          aria-live="polite"
        >
          {retrying ? (
            <Loader2 className="w-4 h-4 flex-shrink-0 animate-spin" style={{ color: 'var(--accent-primary)' }} />
          ) : (
            <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--color-danger-800)' }} />
          )}
          <span className="text-[12.5px] flex-1" style={{ color: 'var(--text-primary)' }}>
            {t(retrying ? 'facilityQueue.reloading' : 'facilityQueue.loadFailed', {
              targets: failedLabels.length > 0 ? failedLabels.join(', ') : t('facilityQueue.thisPage'),
            })}
          </span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={retry} disabled={retrying}>
            <RefreshCw className={`w-3.5 h-3.5${retrying ? ' animate-spin' : ''}`} />
            {t(retrying ? 'facilityQueue.retrying' : 'facilityQueue.retry')}
          </button>
        </div>
      )}

      {/* ═══ What is waiting — each tile opens the queue it counts ═══ */}
      <div className="sadb-kpi-row">
        <SadbKpiTile
          label={t('facilityQueue.kpiOpen')}
          value={kpis.open}
          delta={t('facilityQueue.kpiOpenNote', { count: kpis.total })}
          deltaTone={kpis.open > 0 ? 'warn' : 'up'}
          onClick={() => setQueue('inquiries')}
        />
        <SadbKpiTile
          label={t('facilityQueue.kpiUnassigned')}
          value={kpis.unassigned}
          delta={t(kpis.unassigned > 0 ? 'facilityQueue.kpiUnassignedNote' : 'facilityQueue.kpiUnassignedNone')}
          deltaTone={kpis.unassigned > 0 ? 'warn' : 'up'}
          onClick={() => setQueue('inquiries')}
        />
        <SadbKpiTile
          label={t('facilityQueue.kpiPending')}
          value={kpis.pending}
          delta={kpis.pending > 0
            ? t(kpis.days === 1 ? 'facilityQueue.kpiPendingNote' : 'facilityQueue.kpiPendingNotePlural', { count: kpis.days })
            : t('facilityQueue.kpiPendingNone')}
          deltaTone={kpis.pending > 0 ? 'warn' : 'up'}
          onClick={() => setQueue('leave')}
        />
        <SadbKpiTile
          label={t('facilityQueue.kpiAvailable')}
          value={kpis.available}
          delta={t('facilityQueue.kpiAvailableNote', { count: kpis.accounts })}
          deltaTone={usersUnavailable ? 'warn' : 'up'}
          onClick={() => setQueue('staff')}
        />
      </div>

      {/* ═══ The queues: rail on the left, one panel owning the height ═══ */}
      <div className="fmq-shell">
        <SadbShell
          groups={[{
            title: t('facilityQueue.railTitle'),
            items: [
              { id: 'inquiries', label: t('facilityQueue.tabInquiries'), icon: MessageSquare, count: counts.inquiries },
              { id: 'leave', label: t('facilityQueue.tabLeave'), icon: ClipboardList, count: counts.leave },
              { id: 'staff', label: t('facilityQueue.tabStaff'), icon: Users, count: counts.staff },
            ],
          }]}
          active={activeQueue}
          onSelect={id => { setQueue(id); setDetail(null); }}
        >
          <SadbCard
            className="fmq-panel"
            title={t(QUEUE_TITLE_KEYS[activeQueue])}
            meta={meta}
            action={<SadbHeadLink onClick={() => router.push(fullPageHref)}>{t('facilityQueue.openFullPage')}</SadbHeadLink>}
          >
            <div className="sadb-search-row" style={{ paddingBottom: 12 }}>
              <SadbSearch value={search} onChange={setSearch} placeholder={t(SEARCH_PLACEHOLDER_KEYS[activeQueue])} />
            </div>
            <p className="fmq-note">{t(QUEUE_NOTE_KEYS[activeQueue])}</p>

            <div className="sadb-card-scroll">
              {counts[activeQueue] === 0 ? (
                <div className="fmq-empty">
                  <span>{emptyTitle}</span>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={onEmptyAction}>{emptyActionLabel}</button>
                </div>
              ) : activeQueue === 'inquiries' ? (
                inquiries.rows.map(r => (
                  <SadbQueueRow
                    key={r.id}
                    chip={r.statusLabel}
                    chipTone={enquiryChipTone(r.status)}
                    title={r.name}
                    sub={`${r.type} · ${r.channel} · ${r.assignee || t('facilityQueue.unassigned')}`}
                    when={r.time ? `${r.date} ${r.time}` : r.date}
                    onClick={() => setDetail({ kind: 'inquiry', id: r.id })}
                  />
                ))
              ) : activeQueue === 'leave' ? (
                leaveRows.map(r => (
                  <SadbQueueRow
                    key={r.id}
                    chip={titleCase(r.leaveType)}
                    chipTone="yellow"
                    title={r.requesterName}
                    sub={`${t(r.days === 1 ? 'facilityQueue.dayCount' : 'facilityQueue.dayCountPlural', { count: r.days })} · ${r.startDate} → ${r.endDate} · ${r.facility}`}
                    when={r.requestedAt.slice(0, 10)}
                    onClick={() => setDetail({ kind: 'leave', id: r.id })}
                  />
                ))
              ) : (
                staffRows.map(r => (
                  <SadbQueueRow
                    key={r.id}
                    chip={t(r.shift ? 'facilityQueue.chipOnShift' : 'facilityQueue.chipAvailable')}
                    chipTone={r.shift ? 'green' : 'blue'}
                    title={r.name}
                    sub={`${r.role} · ${r.department}`}
                    when={r.shift || undefined}
                    onClick={() => setDetail({ kind: 'staff', id: r.id })}
                  />
                ))
              )}
            </div>
          </SadbCard>
        </SadbShell>
      </div>

      {/* ═══ Detail dialogs — a row's quick actions ═══ */}
      {detailInquiry && (
        <Modal onClose={() => setDetail(null)} width={440} labelledBy="fmq-inquiry-title">
          <div className="sadb-modal">
            <div className="sadb-modal-copy">
              <h2 id="fmq-inquiry-title" className="sadb-modal-title">{detailInquiry.name}</h2>
              <p className="sadb-modal-sub">{detailInquiry.type} · {detailInquiry.channel}</p>
            </div>
            <div className="rounded-lg overflow-hidden mb-3" style={{ border: '1px solid var(--border-light)' }}>
              <SadbKvRow label={t('facilityQueue.detailStatus')} chip={detailInquiry.statusLabel} chipTone={enquiryChipTone(detailInquiry.status)} />
              <SadbKvRow label={t('facilityQueue.detailAssignee')} value={detailInquiry.assignee || t('facilityQueue.unassigned')} />
              <SadbKvRow label={t('facilityQueue.detailReceived')} value={detailInquiry.time ? `${detailInquiry.date} ${detailInquiry.time}` : detailInquiry.date} />
            </div>
            {/* The picker is the control: every rung of the inquiry ladder is
                one pick away, mirroring the ladder /inquiries owns. */}
            <label className="text-xs font-semibold block mb-1.5" style={{ color: 'var(--text-muted)' }}>{t('facilityQueue.setStatus')}</label>
            <Select
              value={detailInquiry.status}
              onChange={e => setEnquiryStatusAction(detailInquiry.id, e.target.value as EnquiryStatus)}
              style={{ width: '100%' }}
            >
              {ENQUIRY_STATUSES.map(value => (
                <option key={value} value={value}>{ENQUIRY_STATUS_LABELS[value]}</option>
              ))}
            </Select>
            <div className="sadb-modal-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDetail(null)}>{t('action.close')}</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => router.push(`/inquiries?inquiry=${encodeURIComponent(detailInquiry.id)}`)}>
                {t('facilityQueue.openFullPage')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {detailLeave && (
        <Modal onClose={() => setDetail(null)} width={440} labelledBy="fmq-leave-title">
          <div className="sadb-modal">
            <div className="sadb-modal-copy">
              <h2 id="fmq-leave-title" className="sadb-modal-title">{detailLeave.requesterName}</h2>
              <p className="sadb-modal-sub">
                {titleCase(detailLeave.leaveType)} · {t(detailLeave.days === 1 ? 'facilityQueue.dayCount' : 'facilityQueue.dayCountPlural', { count: detailLeave.days })}
              </p>
            </div>
            <div className="rounded-lg overflow-hidden mb-3" style={{ border: '1px solid var(--border-light)' }}>
              <SadbKvRow label={t('facilityQueue.detailDates')} value={`${detailLeave.startDate} → ${detailLeave.endDate}`} />
              <SadbKvRow label={t('facilityQueue.detailRole')} value={detailLeave.role ? titleCase(detailLeave.role) : '—'} />
              <SadbKvRow label={t('common.facility')} value={detailLeave.facility} />
              <SadbKvRow label={t('facilityQueue.detailReason')} value={detailLeave.reason || t('facilityQueue.noReason')} />
            </div>
            <div className="sadb-modal-actions" style={isLeaveApprover && detailLeave.status === 'pending' ? { justifyContent: 'space-between' } : undefined}>
              {isLeaveApprover && detailLeave.status === 'pending' && (
                <span className="flex gap-2">
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => decideLeaveAction(detailLeave.id, 'approved')}>
                    {t('hr.approve')}
                  </button>
                  <button type="button" className="sadb-action-btn is-danger" onClick={() => decideLeaveAction(detailLeave.id, 'rejected')}>
                    {t('hr.reject')}
                  </button>
                </span>
              )}
              <span className="flex gap-2">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDetail(null)}>{t('action.close')}</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => router.push(`/hr/leave?request=${encodeURIComponent(detailLeave.id)}`)}>
                  {t('facilityQueue.openFullPage')}
                </button>
              </span>
            </div>
          </div>
        </Modal>
      )}

      {detailStaff && (
        <Modal onClose={() => setDetail(null)} width={420} labelledBy="fmq-staff-title">
          <div className="sadb-modal">
            <div className="sadb-modal-copy">
              <h2 id="fmq-staff-title" className="sadb-modal-title">{detailStaff.name}</h2>
              <p className="sadb-modal-sub">{detailStaff.role} · {detailStaff.department}</p>
            </div>
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-light)' }}>
              <SadbKvRow label={t('facilityQueue.detailAvailability')} value={detailStaff.shift || t('facilityQueue.availableNoShift')} />
            </div>
            <div className="sadb-modal-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDetail(null)}>{t('action.close')}</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => router.push(withFocus(staffListHref, 'user', detailStaff.id))}>
                {t('facilityQueue.openFullPage')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </SadbPage>
  );
}
