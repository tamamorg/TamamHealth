/**
 * API: /api/usage/summary
 * GET — aggregated DAU/WAU, top paths/actions (super_admin / org_admin)
 */
import { ADMIN } from '@/lib/sync/write-permissions';
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, unauthorized } from '@/modules/identity';
import {
  aggregateUsageSummary,
  queryUsageEvents } from '@/lib/services/usage-event-service';

const READ_ROLES = ADMIN;

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, READ_ROLES)) return forbidden();

    const url = new URL(request.url);
    const requestedOrg = url.searchParams.get('orgId') || undefined;
    const days = Math.min(Math.max(Number(url.searchParams.get('days') || 30) || 30, 1), 90);

    let orgId: string | undefined;
    const includePerOrg = auth.role === 'super_admin' && !requestedOrg;

    if (auth.role === 'org_admin') {
      orgId = auth.orgId;
      if (!orgId) return forbidden();
      if (requestedOrg && requestedOrg !== orgId) return forbidden();
    } else if (requestedOrg) {
      orgId = requestedOrg;
    }

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const events = await queryUsageEvents({ orgId, since, limit: 50_000 });
    const summary = aggregateUsageSummary(events, {
      includePerOrg,
      trendDays: Math.min(days, 30),
    });

    return NextResponse.json(summary);
  } catch (err) {
    logApiError('usage/summary GET', err);
    return NextResponse.json({ error: 'Failed to load usage summary' }, { status: 500 });
  }
}
