/**
 * API: /api/crypto/rekey
 * POST { db, id } — re-seal one record's encrypted fields for the
 *                   organisation(s) it now belongs to.
 *
 * A cross-organisation referral re-homes the patient on the RECEIVING device,
 * which holds only its own organisation's key — so the fields stay sealed
 * under the sending organisation's key, and the new organisation sees
 * placeholders. The server derives every key, so it can open the record and
 * seal it again (lib/encrypted-db.ts re-encrypts any field whose envelope is
 * not addressed to the record's current organisations).
 *
 * Only a member of an organisation the record is NOW addressed to may ask:
 * the record's own `orgId` (or `toOrgId` on a referral/transfer). Moving the
 * record there was the decision the sync rules already policed; this only
 * makes it readable where it has legitimately gone.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthPayload, logApiError, serverError, unauthorized } from '@/modules/identity';
import { logAuditSafe } from '@/lib/services/audit-service';
import type { UserRole } from '@/lib/db-types';

const CROSS_ORG_ROLES: UserRole[] = ['super_admin', 'government'];

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();

    let body: { db?: unknown; id?: unknown };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
    const dbName = typeof body.db === 'string' ? body.db : '';
    const id = typeof body.id === 'string' ? body.id : '';
    if (!dbName || !id || id.startsWith('_')) return NextResponse.json({ error: 'db and id are required' }, { status: 400 });

    const { LOCAL_DATABASE_NAMES, getDB, getRawDB } = await import('@/lib/db');
    if (!LOCAL_DATABASE_NAMES.includes(dbName)) return NextResponse.json({ error: 'Unknown database' }, { status: 400 });

    let raw: Record<string, unknown>;
    try {
      raw = await getRawDB(dbName).get(id) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const addressedTo = [raw.orgId, raw.toOrgId].filter((v): v is string => typeof v === 'string' && v.length > 0);
    const crossOrg = CROSS_ORG_ROLES.includes(auth.actualRole || auth.role);
    if (!crossOrg && !(auth.orgId && addressedTo.includes(auth.orgId))) {
      // Answered like a missing record: an id is not a capability.
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { envelopeOrgIds, isOrgEncrypted } = await import('@/lib/org-data-cipher');
    const stale = JSON.stringify(raw).match(/"(oencm?:v1:[^"]+)"/g)?.some(quoted => {
      const env = JSON.parse(quoted) as string;
      return isOrgEncrypted(env) && addressedTo.some(org => !envelopeOrgIds(env).includes(org));
    });
    if (!stale) return NextResponse.json({ rekeyed: false });

    // Read decrypted (the server holds every key), write back: the database
    // layer keeps each envelope already addressed to the right organisations
    // and seals the rest afresh.
    const db = getDB(dbName);
    const plain = await db.get(id);
    await db.put(plain);
    await logAuditSafe(
      'RECORD_REKEYED', auth.sub, auth.username,
      `Re-sealed ${dbName}/${id} for organisation(s) ${addressedTo.join(', ')}`,
    );
    return NextResponse.json({ rekeyed: true });
  } catch (err) {
    logApiError('[API /crypto/rekey POST]', err);
    return serverError();
  }
}
