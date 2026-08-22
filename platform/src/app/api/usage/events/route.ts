/**
 * API: /api/usage/events
 * POST — ingest a batch of sanitized product-usage events
 * GET  — list recent events (super_admin / org_admin)
 */
import { ADMIN } from '@/lib/sync/write-permissions';
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/api-security';
import {
  getAuthPayload, unauthorized, forbidden, hasRole, logApiError } from '@/lib/api-auth';
import { sanitizeUsageEvent } from '@/lib/usage/sanitize';
import {
  logUsageEvents,
  queryUsageEvents } from '@/lib/services/usage-event-service';

const READ_ROLES = ADMIN;

const MAX_BATCH = 50;

export async function POST(request: NextRequest) {
  try {
    // Telemetry, so a bug in a client loop costs the analytics database
    // rather than anything clinical — but it is still an authenticated
    // write with no ceiling, and a retry storm writes a row each time.
    const limited = await checkRateLimit(request, 'usage:events', 120);
    if (limited) return limited;
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    // Any authenticated staff session may emit usage events.

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ accepted: 0 }, { status: 202 });
    }

    const eventsRaw =
      body && typeof body === 'object' && Array.isArray((body as { events?: unknown }).events)
        ? (body as { events: unknown[] }).events
        : [];

    if (eventsRaw.length === 0) {
      return NextResponse.json({ accepted: 0 }, { status: 202 });
    }
    if (eventsRaw.length > MAX_BATCH) {
      return NextResponse.json(
        { error: `Batch too large (max ${MAX_BATCH})`, accepted: 0 },
        { status: 400 },
      );
    }

    const sanitized = eventsRaw
      .map((e) => sanitizeUsageEvent(e))
      .filter((e): e is NonNullable<typeof e> => e !== null);

    if (sanitized.length === 0) {
      return NextResponse.json({ accepted: 0 }, { status: 202 });
    }

    // Stamp identity from JWT — never trust client-supplied userId/orgId.
    const written = await logUsageEvents(sanitized, {
      userId: auth.sub,
      username: auth.username,
      role: auth.role,
      orgId: auth.orgId,
      hospitalId: auth.hospitalId,
    });

    return NextResponse.json({ accepted: written }, { status: 202 });
  } catch (err) {
    logApiError('usage/events POST', err);
    // Fail soft — telemetry must not break the UX path
    return NextResponse.json({ accepted: 0 }, { status: 202 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, READ_ROLES)) return forbidden();

    const url = new URL(request.url);
    const requestedOrg = url.searchParams.get('orgId') || undefined;
    const since = url.searchParams.get('since') || undefined;
    const until = url.searchParams.get('until') || undefined;
    const limit = Math.min(Number(url.searchParams.get('limit') || 100) || 100, 500);

    let orgId: string | undefined;
    if (auth.role === 'org_admin') {
      orgId = auth.orgId;
      if (!orgId) return forbidden();
      if (requestedOrg && requestedOrg !== orgId) return forbidden();
    } else if (requestedOrg) {
      orgId = requestedOrg;
    }

    const events = await queryUsageEvents({ orgId, since, until, limit });
    return NextResponse.json({ events, total: events.length });
  } catch (err) {
    logApiError('usage/events GET', err);
    return NextResponse.json({ error: 'Failed to load usage events' }, { status: 500 });
  }
}
