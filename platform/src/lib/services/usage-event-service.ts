/**
 * First-party product usage events — separate from compliance audit_log.
 */
import { v4 as uuidv4 } from 'uuid';
import { usageEventsDB } from '../db';
import type { UsageEventDoc, UsageEventName } from '../db-types';
import { findByType } from './db-query';
import type { SanitizedUsageEventInput } from '../usage/sanitize';
import { toIsoDate } from '@/lib/date-utils';

export interface UsageIdentity {
  userId: string;
  username?: string;
  role?: string;
  orgId?: string;
  hospitalId?: string;
}

export async function logUsageEvents(
  events: SanitizedUsageEventInput[],
  identity: UsageIdentity,
): Promise<number> {
  if (!events.length) return 0;
  const db = usageEventsDB();
  const now = new Date().toISOString();
  let written = 0;

  for (const ev of events) {
    try {
      const doc: UsageEventDoc = {
        _id: `usage-${uuidv4()}`,
        type: 'usage_event',
        eventName: ev.eventName,
        path: ev.path,
        element: ev.element,
        userId: identity.userId,
        username: identity.username,
        role: identity.role,
        orgId: identity.orgId,
        hospitalId: identity.hospitalId,
        sessionId: ev.sessionId,
        ts: ev.ts,
        meta: ev.meta,
        createdAt: now,
        updatedAt: now,
      };
      await db.put(doc);
      written += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[USAGE LOST] ${ev.eventName}: ${msg}`);
    }
  }
  return written;
}

export interface QueryUsageOptions {
  orgId?: string;
  /** Inclusive ISO lower bound on `ts`. */
  since?: string;
  /** Inclusive ISO upper bound on `ts`. */
  until?: string;
  limit?: number;
  eventName?: UsageEventName;
}

export async function queryUsageEvents(
  options: QueryUsageOptions = {},
): Promise<UsageEventDoc[]> {
  const db = usageEventsDB();
  const extra: Record<string, unknown> = {};
  if (options.orgId) extra.orgId = options.orgId;
  if (options.eventName) extra.eventName = options.eventName;

  const docs = await findByType<UsageEventDoc>(db, 'usage_event', extra, {
    limit: options.limit ?? 50_000,
    indexFields: options.orgId ? ['type', 'orgId'] : ['type'],
  });

  let filtered = docs;
  if (options.since) {
    filtered = filtered.filter((d) => (d.ts || d.createdAt || '') >= options.since!);
  }
  if (options.until) {
    filtered = filtered.filter((d) => (d.ts || d.createdAt || '') <= options.until!);
  }

  filtered.sort((a, b) => (b.ts || b.createdAt || '').localeCompare(a.ts || a.createdAt || ''));
  if (options.limit && filtered.length > options.limit) {
    return filtered.slice(0, options.limit);
  }
  return filtered;
}

function dayKey(iso: string): string {
  return (iso || '').slice(0, 10);
}

export interface UsageSummary {
  dau: number;
  wau: number;
  sessionCount: number;
  eventCount: number;
  dauTrend: Array<{ date: string; users: number; events: number }>;
  topPaths: Array<{ path: string; count: number }>;
  topActions: Array<{ action: string; count: number }>;
  perOrg?: Array<{ orgId: string; users: number; events: number }>;
  perUser: Array<{ userId: string; username?: string; events: number }>;
}

export function aggregateUsageSummary(
  events: UsageEventDoc[],
  opts: { includePerOrg?: boolean; trendDays?: number } = {},
): UsageSummary {
  const trendDays = opts.trendDays ?? 14;
  const now = new Date();
  const today = toIsoDate(now);
  const weekAgo = toIsoDate(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
  const trendStart = new Date(now.getTime() - (trendDays - 1) * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const dauUsers = new Set<string>();
  const wauUsers = new Set<string>();
  const sessions = new Set<string>();
  const pathCounts = new Map<string, number>();
  const actionCounts = new Map<string, number>();
  const userCounts = new Map<string, { username?: string; events: number }>();
  const orgCounts = new Map<string, { users: Set<string>; events: number }>();
  const dayUsers = new Map<string, Set<string>>();
  const dayEvents = new Map<string, number>();

  for (const ev of events) {
    const day = dayKey(ev.ts || ev.createdAt || '');
    const uid = ev.userId || 'unknown';

    if (day === today && ev.userId) dauUsers.add(ev.userId);
    if (day >= weekAgo && ev.userId) wauUsers.add(ev.userId);
    if (ev.sessionId) sessions.add(ev.sessionId);

    if (day >= trendStart) {
      if (!dayUsers.has(day)) dayUsers.set(day, new Set());
      if (ev.userId) dayUsers.get(day)!.add(ev.userId);
      dayEvents.set(day, (dayEvents.get(day) || 0) + 1);
    }

    if (ev.path) {
      pathCounts.set(ev.path, (pathCounts.get(ev.path) || 0) + 1);
    }

    const actionKey =
      ev.element ||
      (ev.eventName === 'page_view' ? `page_view:${ev.path}` : ev.eventName);
    actionCounts.set(actionKey, (actionCounts.get(actionKey) || 0) + 1);

    const u = userCounts.get(uid) || { username: ev.username, events: 0 };
    u.events += 1;
    if (ev.username) u.username = ev.username;
    userCounts.set(uid, u);

    if (opts.includePerOrg) {
      const oid = ev.orgId || '(none)';
      let o = orgCounts.get(oid);
      if (!o) {
        o = { users: new Set(), events: 0 };
        orgCounts.set(oid, o);
      }
      o.events += 1;
      if (ev.userId) o.users.add(ev.userId);
    }
  }

  const dauTrend: UsageSummary['dauTrend'] = [];
  for (let i = trendDays - 1; i >= 0; i--) {
    const d = toIsoDate(new Date(now.getTime() - i * 24 * 60 * 60 * 1000));
    dauTrend.push({
      date: d,
      users: dayUsers.get(d)?.size || 0,
      events: dayEvents.get(d) || 0,
    });
  }

  const topN = <T extends string>(map: Map<T, number>, n: number) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([key, count]) => ({ key, count }));

  const summary: UsageSummary = {
    dau: dauUsers.size,
    wau: wauUsers.size,
    sessionCount: sessions.size,
    eventCount: events.length,
    dauTrend,
    topPaths: topN(pathCounts, 10).map(({ key, count }) => ({ path: key, count })),
    topActions: topN(actionCounts, 15).map(({ key, count }) => ({ action: key, count })),
    perUser: [...userCounts.entries()]
      .map(([userId, v]) => ({ userId, username: v.username, events: v.events }))
      .sort((a, b) => b.events - a.events)
      .slice(0, 25),
  };

  if (opts.includePerOrg) {
    summary.perOrg = [...orgCounts.entries()]
      .map(([orgId, v]) => ({ orgId, users: v.users.size, events: v.events }))
      .sort((a, b) => b.events - a.events);
  }

  return summary;
}
