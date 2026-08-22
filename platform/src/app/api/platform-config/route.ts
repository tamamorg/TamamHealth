/**
 * API: /api/platform-config
 * GET  — Get platform configuration
 * POST — Update platform configuration (super_admin only)
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';
const READ_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'nurse',
  'pharmacist', 'medical_superintendent',
];
const WRITE_ROLES: UserRole[] = [
  'super_admin',
];
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, READ_ROLES)) return forbidden();
    const { getPlatformConfig } = await import('@/lib/services/platform-config-service');
    const config = await getPlatformConfig();
    return NextResponse.json({ config });
  } catch (err) {
    logApiError('[API /platform-config GET]', err);
    return serverError();
  }
}
async function postHandler(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, WRITE_ROLES)) return forbidden();
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { sanitizePayload } = await import('@/lib/validation');
    body = sanitizePayload(body);
    // Validate that only super_admin can update
    if (auth.role !== 'super_admin') {
      return forbidden();
    }
    const { updatePlatformConfig } = await import('@/lib/services/platform-config-service');
    const updated = await updatePlatformConfig(body as Parameters<typeof updatePlatformConfig>[0], auth.sub, auth.username);
    return NextResponse.json({ config: updated });
  } catch (err) {
    logApiError('[API /platform-config POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'platform.config.update' });
