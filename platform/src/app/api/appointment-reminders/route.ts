/**
 * API: /api/appointment-reminders
 * GET — Get upcoming reminders, overdue appointments, no-show stats, missed follow-ups
 *       Supports: ?view=upcoming|overdue|no-show-stats|missed-follow-ups
 * POST — Generate reminder messages for upcoming appointments
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';
const READ_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'nurse',
  'medical_superintendent', 'hrio', 'front_desk',
];
const WRITE_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'hrio', 'front_desk', 'nurse',
];
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, READ_ROLES)) return forbidden();
    const {
      getUpcomingReminders, getOverdueAppointments, getNoShowStats, getMissedFollowUps,
    } = await import('@/lib/services/appointment-reminder-service');
    const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
    const url = new URL(request.url);
    const view = url.searchParams.get('view') || 'upcoming';
    const facilityId = url.searchParams.get('facilityId') || undefined;
    const daysAhead = parseInt(url.searchParams.get('daysAhead') || '1', 10);
    switch (view) {
      case 'overdue': {
        const overdue = await getOverdueAppointments(facilityId);
        return NextResponse.json({ appointments: overdue, total: overdue.length });
      }
      case 'no-show-stats': {
        const start = url.searchParams.get('start') || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
        const end = url.searchParams.get('end') || new Date().toISOString().slice(0, 10);
        const stats = await getNoShowStats({ start, end }, facilityId);
        return NextResponse.json(stats);
      }
      case 'missed-follow-ups': {
        const missed = await getMissedFollowUps(facilityId);
        return NextResponse.json({ appointments: missed, total: missed.length });
      }
      default: {
        const scope = buildScopeFromAuth(auth);
        const reminders = await getUpcomingReminders(daysAhead, facilityId, scope);
        return NextResponse.json({ appointments: reminders, total: reminders.length });
      }
    }
  } catch (err) {
    logApiError('[API /appointment-reminders GET]', err);
    return serverError();
  }
}
async function postHandler(request: NextRequest) {
  try {
    const { checkRateLimit } = await import('@/lib/api-security');
    const rateLimitResponse = await checkRateLimit(request, 'appointment-reminders:generate', 10);
    if (rateLimitResponse) return rateLimitResponse;
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, WRITE_ROLES)) return forbidden();
    const { getUpcomingReminders, generateReminderMessages } = await import('@/lib/services/appointment-reminder-service');
    const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
    const url = new URL(request.url);
    const facilityId = url.searchParams.get('facilityId') || undefined;
    const daysAhead = parseInt(url.searchParams.get('daysAhead') || '1', 10);
    const scope = buildScopeFromAuth(auth);
    const upcoming = await getUpcomingReminders(daysAhead, facilityId, scope);
    const messages = await generateReminderMessages(upcoming);
    return NextResponse.json({
      generated: messages.length,
      messages,
    }, { status: 201 });
  } catch (err) {
    logApiError('[API /appointment-reminders POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'appointment.reminder.create' });
