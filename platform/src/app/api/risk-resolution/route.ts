/**
 * API: /api/risk-resolution
 * POST — Resolve, bulk-resolve, or reopen a Risk Center signal.
 *
 * Risk resolutions are PLATFORM-GLOBAL governance records (no orgId): they live
 * in the pull-only `tamamhealth_platform_config` database, which the server owns
 * and replicates down to every device. The Risk Center UI used to write them to
 * the LOCAL copy of that pull-only DB, so a resolution never travelled up and a
 * second super-admin kept seeing the risk as open (security/data audit
 * 2026-11-05, §2.1 #11). Writing through here puts the canonical doc on the
 * server, exactly as /api/platform-config does for config.
 *
 * super_admin only — the Risk Center is reachable by no other role.
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, logApiError, serverError } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import { authorizeJson } from '@/lib/api-json-guard';
import type { UserRole } from '@/lib/db-types';

const WRITE_ROLES: UserRole[] = ['super_admin'];

async function postHandler(request: NextRequest) {
  try {
    const guarded = await authorizeJson(request, WRITE_ROLES);
    if (guarded.response) return guarded.response;
    const { auth, body } = guarded;
    if (auth.role !== 'super_admin') return forbidden();

    // Attribution is stamped from the verified auth claim, never trusted from
    // the client (cf. /api/births et al.).
    const actor = { _id: auth.sub, username: auth.username, name: auth.name };

    const { resolveRisk, resolveRisks, reopenRisk } = await import('@/lib/services/risk-resolution-service');

    switch (body.action) {
      case 'resolve': {
        if (!body.input || typeof body.input !== 'object') {
          return NextResponse.json({ error: 'input is required' }, { status: 400 });
        }
        const doc = await resolveRisk(body.input as Parameters<typeof resolveRisk>[0], actor);
        return NextResponse.json({ resolution: doc });
      }
      case 'resolve-batch': {
        if (!Array.isArray(body.inputs)) {
          return NextResponse.json({ error: 'inputs must be an array' }, { status: 400 });
        }
        const result = await resolveRisks(body.inputs as Parameters<typeof resolveRisks>[0], actor);
        return NextResponse.json(result);
      }
      case 'reopen': {
        if (!body.riskId || typeof body.riskId !== 'string') {
          return NextResponse.json({ error: 'riskId is required' }, { status: 400 });
        }
        await reopenRisk(body.riskId, actor);
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: 'unknown action' }, { status: 400 });
    }
  } catch (err) {
    logApiError('[API /risk-resolution POST]', err);
    return serverError();
  }
}

export const POST = withAuditLog(postHandler, { action: 'risk.resolution.write' });
