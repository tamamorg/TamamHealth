/**
 * API: /api/dhis2-sync-log
 * POST — Append to / update the shared DHIS2 sync log.
 *
 * The DHIS2 sync log is ONE platform-global doc (no orgId) in the pull-only
 * tamamhealth_platform_config database. The export UI wrote it to the LOCAL
 * copy, so each officer's device kept its own log and a second DHIS2 officer
 * saw "never synced" — risking a double or missed national submission
 * (security/data audit 2026-11-05, §2.1 #11). Writing through the server puts
 * the canonical log on the shared doc that replicates down to every device.
 *
 * Restricted to the roles that can run a DHIS2 export.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logApiError, serverError } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import { authorizeJson } from '@/lib/api-json-guard';
import type { UserRole } from '@/lib/db-types';
import type { Dhis2LogStatus } from '@/lib/services/dhis2-sync-log-service';
import type { DHIS2DataSet, DHIS2PushResult } from '@/lib/services/dhis2-export-service';

const WRITE_ROLES: UserRole[] = [
  'super_admin', 'government', 'hrio', 'records_hmis_officer',
  'county_health_director', 'hospital_manager',
];

async function postHandler(request: NextRequest) {
  try {
    const guarded = await authorizeJson(request, WRITE_ROLES);
    if (guarded.response) return guarded.response;
    const { body } = guarded;

    const {
      appendDhis2LogEntry, recordDhis2SyncFailure, recordDhis2SyncResult,
    } = await import('@/lib/services/dhis2-sync-log-service');

    switch (body.action) {
      case 'append': {
        if (typeof body.message !== 'string') {
          return NextResponse.json({ error: 'message is required' }, { status: 400 });
        }
        const log = await appendDhis2LogEntry(body.message, body.status as Dhis2LogStatus | undefined);
        return NextResponse.json({ log });
      }
      case 'failure': {
        if (typeof body.message !== 'string') {
          return NextResponse.json({ error: 'message is required' }, { status: 400 });
        }
        const log = await recordDhis2SyncFailure(body.message);
        return NextResponse.json({ log });
      }
      case 'result': {
        if (!body.dataset || !body.push) {
          return NextResponse.json({ error: 'dataset and push are required' }, { status: 400 });
        }
        const log = await recordDhis2SyncResult({
          dataset: body.dataset as DHIS2DataSet,
          push: body.push as DHIS2PushResult,
          message: body.message as string | undefined,
        });
        return NextResponse.json({ log });
      }
      default:
        return NextResponse.json({ error: 'unknown action' }, { status: 400 });
    }
  } catch (err) {
    logApiError('[API /dhis2-sync-log POST]', err);
    return serverError();
  }
}

export const POST = withAuditLog(postHandler, { action: 'dhis2.synclog.write' });
