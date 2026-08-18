'use client';

/**
 * Notifications — the full feed behind the bell.
 *
 * The bell panel and the dashboard side cards (e.g. "Results awaiting your
 * review") are glance surfaces that show the first few rows; this page is
 * where "view all" lands. It reads the same useNotifications feed, but with a
 * much higher per-source cap, plus source/urgency filters, search, recency
 * grouping, and read-state — the things a long queue needs and a popover
 * cannot carry.
 */

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import EhrListHeader, { LIST_STAT_COLORS, EhrListFilters, EhrListHeaderButton } from '@/components/ehr/EhrListHeader';
import EmptyState from '@/components/EmptyState';
import { Bell, BellOff, Check, ChevronRight, RefreshCw } from '@/components/icons/lucide';
import {
  useNotifications,
  getNotificationAlertPref,
  setNotificationAlertPref,
  type NotificationItem,
  type NotificationSeverity,
  type NotificationType,
} from '@/lib/hooks/useNotifications';
import {
  NOTIFICATION_META,
  NOTIFICATION_TYPE_ORDER,
  SEVERITY_META,
  notificationBucket,
  relativeNotificationTime,
} from '@/lib/notification-meta';
import Select from '@/components/Select';

/** Rows rendered before "Show more" — long feeds stay responsive. */
const PAGE_SIZE = 60;

/** Shared control styling inside the header's Filters popover. */
const filterFieldStyle = { background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)', borderRadius: 8, minWidth: 0 } as const;

type SourceFilter = 'all' | NotificationType;
type StatusFilter = 'all' | 'unread' | NotificationSeverity;

const BUCKET_LABELS: Record<ReturnType<typeof notificationBucket>, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'Earlier this week',
  older: 'Older',
};

function NotificationsPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { items, count, unreadCount, loading, reload, markRead, markAllRead } = useNotifications();

  // Deep links carry the caller's context: the dashboard's lab card opens
  // ?source=lab, the bell's "unread" affordance opens ?status=unread.
  const [source, setSource] = useState<SourceFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [alertPref, setAlertPref] = useState<'sound' | 'muted'>('sound');

  // Read after mount — localStorage is not available during SSR.
  useEffect(() => { setAlertPref(getNotificationAlertPref()); }, []);

  useEffect(() => {
    const s = params.get('source');
    if (s && (s === 'all' || NOTIFICATION_TYPE_ORDER.includes(s as NotificationType))) setSource(s as SourceFilter);
    const st = params.get('status');
    if (st === 'unread' || st === 'critical' || st === 'warning' || st === 'info') setStatus(st);
  }, [params]);

  // Every filter change starts the page back at the first batch — paging past
  // 60 rows and then narrowing the filter would otherwise strand the reader.
  const applySource = (next: SourceFilter) => { setSource(next); setVisibleCount(PAGE_SIZE); };
  const applyStatus = (next: StatusFilter) => { setStatus(next); setVisibleCount(PAGE_SIZE); };
  const applyQuery = (next: string) => { setQuery(next); setVisibleCount(PAGE_SIZE); };

  const toggleAlertPref = () => {
    const next = alertPref === 'sound' ? 'muted' : 'sound';
    setAlertPref(next);
    setNotificationAlertPref(next);
  };

  const sourceCounts = useMemo(() => {
    const counts = new Map<NotificationType, number>();
    for (const n of items) counts.set(n.type, (counts.get(n.type) || 0) + 1);
    return counts;
  }, [items]);

  const severityCounts = useMemo(() => ({
    critical: items.filter(n => n.severity === 'critical').length,
    warning: items.filter(n => n.severity === 'warning').length,
    info: items.filter(n => n.severity === 'info').length,
  }), [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(n => {
      if (source !== 'all' && n.type !== source) return false;
      if (status === 'unread' && n.read) return false;
      if (status !== 'all' && status !== 'unread' && n.severity !== status) return false;
      if (q && !`${n.title} ${n.subtitle}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, source, status, query]);

  const visible = filtered.slice(0, visibleCount);

  const grouped = useMemo(() => {
    const groups: { key: string; label: string; rows: NotificationItem[] }[] = [];
    for (const n of visible) {
      const bucket = notificationBucket(n.time);
      const last = groups[groups.length - 1];
      if (last && last.key === bucket) last.rows.push(n);
      else groups.push({ key: bucket, label: BUCKET_LABELS[bucket], rows: [n] });
    }
    return groups;
  }, [visible]);

  const open = (n: NotificationItem) => { markRead(n.id); router.push(n.href); };

  return (
    <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div className="card-elevated overflow-hidden flex flex-col" style={{ flex: 1, minHeight: 0 }}>
        <EhrListHeader
          title="Notifications"
          stats={[
            { label: 'Total', value: count, color: LIST_STAT_COLORS.muted },
            { label: 'Unread', value: unreadCount, color: LIST_STAT_COLORS.blue },
            { label: 'Critical', value: severityCounts.critical, color: 'var(--color-danger)' },
            { label: 'Needs action', value: severityCounts.warning, color: LIST_STAT_COLORS.bronze },
          ]}
          search={{
            value: query,
            onChange: applyQuery,
            placeholder: 'Search notifications by patient, test, or subject',
            ariaLabel: 'Search notifications',
          }}
          actions={
            <>
              {/* State and source were two rows of counted chips across the top
                  of the feed — nineteen of them, a whole band of chrome above
                  the thing being read. They are the same two choices in the
                  header's shared Filters popover now, counts and all, and the
                  pill's badge says when the list is narrowed. */}
              <EhrListFilters
                activeCount={(status !== 'all' ? 1 : 0) + (source !== 'all' ? 1 : 0)}
                onClear={() => { applyStatus('all'); applySource('all'); }}
                panelWidth={280}
              >
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>State</span>
                  <Select
                    value={status}
                    onChange={e => applyStatus(e.target.value as StatusFilter)}
                    className="w-full text-sm py-2 px-3"
                    style={filterFieldStyle}
                  >
                    <option value="all">Everything ({count})</option>
                    <option value="unread">Unread ({unreadCount})</option>
                    <option value="critical">Critical ({severityCounts.critical})</option>
                    <option value="warning">Needs action ({severityCounts.warning})</option>
                    <option value="info">For information ({severityCounts.info})</option>
                  </Select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>Source</span>
                  <Select
                    value={source}
                    onChange={e => applySource(e.target.value as SourceFilter)}
                    className="w-full text-sm py-2 px-3"
                    style={filterFieldStyle}
                  >
                    <option value="all">All sources ({count})</option>
                    {NOTIFICATION_TYPE_ORDER
                      .filter(type => (sourceCounts.get(type) || 0) > 0)
                      .map(type => (
                        <option key={type} value={type}>
                          {NOTIFICATION_META[type].label} ({sourceCounts.get(type)})
                        </option>
                      ))}
                  </Select>
                </label>
              </EhrListFilters>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="flex items-center gap-1.5 px-3 h-[38px] rounded-lg text-[12px] font-semibold flex-shrink-0"
                  style={{ border: '1px solid var(--border-light)', background: 'var(--bg-card-solid)', color: 'var(--text-secondary)' }}
                >
                  <Check className="w-4 h-4" style={{ stroke: 'currentColor' }} />
                  Mark all read
                </button>
              )}
              <EhrListHeaderButton
                onClick={toggleAlertPref}
                active={alertPref === 'sound'}
                ariaLabel={alertPref === 'sound' ? 'Sound on — click to mute new-notification chimes' : 'Muted — click to chime on new notifications'}
              >
                {alertPref === 'sound'
                  ? <Bell className="w-4 h-4" style={{ stroke: 'currentColor' }} />
                  : <BellOff className="w-4 h-4" style={{ stroke: 'currentColor' }} />}
              </EhrListHeaderButton>
              <EhrListHeaderButton onClick={reload} ariaLabel="Refresh notifications">
                <RefreshCw className="w-4 h-4" style={{ stroke: 'currentColor' }} />
              </EhrListHeaderButton>
            </>
          }
        />

        <div style={{ overflowY: 'auto', flex: 1, minHeight: 0, padding: 16 }}>
          {loading ? (
            <div className="p-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Loading notifications…</div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Bell}
              title={count === 0 ? 'You are all caught up' : 'Nothing matches this filter'}
              message={count === 0
                ? 'Referrals, transfers, results, appointments, and pharmacy work all land here the moment they need you.'
                : 'Try a different source, state, or search term.'}
              action={count === 0 ? undefined : {
                label: 'Clear filters',
                onClick: () => { applySource('all'); applyStatus('all'); applyQuery(''); },
              }}
            />
          ) : (
            <>
              {grouped.map(group => (
                <section key={`${group.key}-${group.rows[0].id}`} className="mb-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{group.label}</h3>
                    <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{group.rows.length}</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {group.rows.map(n => {
                      const meta = NOTIFICATION_META[n.type];
                      const sev = SEVERITY_META[n.severity];
                      const Icon = meta.icon;
                      return (
                        <button
                          key={n.id}
                          onClick={() => open(n)}
                          className="w-full text-start rounded-xl transition-colors hover:bg-[var(--overlay-subtle)]"
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 12,
                            padding: '13px 15px',
                            background: n.read ? 'transparent' : 'var(--bg-card-solid)',
                            border: `1px solid ${n.severity === 'critical' && !n.read ? 'rgba(196, 69, 54, 0.28)' : 'var(--border-light)'}`,
                            opacity: n.read ? 0.7 : 1,
                          }}
                        >
                          <span className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: meta.bg }}>
                            {/* The icon set hardcodes a stroke attribute, so the
                                colour must be forced via the stroke property. */}
                            <Icon className="w-4 h-4" style={{ stroke: meta.color, color: meta.color }} />
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: meta.bg, color: meta.color }}>{meta.label}</span>
                              {n.severity !== 'info' && (
                                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: sev.bg, color: sev.color }}>{sev.label}</span>
                              )}
                              {!n.read && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold" style={{ color: 'var(--accent-primary)' }}>
                                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent-primary)' }} />
                                  New
                                </span>
                              )}
                              <span className="text-[11px] ms-auto" style={{ color: 'var(--text-muted)' }}>{relativeNotificationTime(n.time)}</span>
                            </div>
                            <p className="text-sm truncate" style={{ color: 'var(--text-primary)', fontWeight: n.read ? 500 : 700 }}>{n.title}</p>
                            <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{n.subtitle}</p>
                          </div>
                          <ChevronRight className="w-4 h-4 flex-shrink-0 mt-1" style={{ stroke: 'var(--text-muted)' }} />
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
              {filtered.length > visible.length && (
                <button
                  type="button"
                  onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
                  className="w-full py-3 rounded-xl text-[12px] font-bold"
                  style={{ border: '1px solid var(--border-light)', color: 'var(--accent-primary)', background: 'var(--bg-card-solid)' }}
                >
                  {`Show more · ${filtered.length - visible.length} remaining`}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

export default function NotificationsPage() {
  // useSearchParams needs a Suspense boundary under the App Router.
  return (
    <Suspense fallback={<main className="page-container" />}>
      <NotificationsPageInner />
    </Suspense>
  );
}
