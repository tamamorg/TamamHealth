import { handoffsDB } from '../db';
import type { ShiftHandoffDoc } from '../db-types';
import { v4 as uuidv4 } from 'uuid';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { findByType } from './db-query';

/**
 * Shift handoff persistence.
 *
 * A handoff is signed by the outgoing nurse (status 'signed') and later
 * acknowledged by the oncoming nurse (status 'acknowledged'), closing the loop.
 * Records are typed `ShiftHandoffDoc`, stored in `tamamhealth_handoffs`, and
 * scoped/synced the same way as triage.
 */

export async function listHandoffs(scope?: DataScope): Promise<ShiftHandoffDoc[]> {
  const db = handoffsDB();
  const all = await findByType<ShiftHandoffDoc>(db, 'shift_handoff');
  // Most recent first by signedAt (fall back to createdAt).
  all.sort((a, b) =>
    (b.signedAt || b.createdAt || '').localeCompare(a.signedAt || a.createdAt || ''),
  );
  return scope ? filterByScope(all, scope) : all;
}

/**
 * The latest handoff for a facility that the oncoming nurse should read —
 * the most recent signed record (acknowledged or not). Returns null when none.
 */
export async function getLatestHandoff(facilityId?: string): Promise<ShiftHandoffDoc | null> {
  const all = await listHandoffs();
  const scoped = facilityId ? all.filter(h => h.facilityId === facilityId) : all;
  return scoped[0] ?? null;
}

export async function createHandoff(
  data: Omit<ShiftHandoffDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt' | 'signedAt' | 'status'>,
): Promise<ShiftHandoffDoc> {
  const db = handoffsDB();
  const now = new Date().toISOString();
  const doc: ShiftHandoffDoc = {
    _id: `handoff-${uuidv4()}`,
    type: 'shift_handoff',
    ...data,
    signedAt: now,
    status: 'signed',
    createdAt: now,
    updatedAt: now,
  };
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  await logAuditSafe(
    'SHIFT_HANDOFF_SIGNED',
    data.outgoingNurseId,
    data.outgoingNurseName,
    `Signed ${data.shift} shift handoff (${data.shiftDate})${data.incomingNurseName ? ` to ${data.incomingNurseName}` : ''} — ${data.patients.length} patient(s) handed over`,
  );
  emitSyncEvent({
    resourceType: 'shift_handoff',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });
  return doc;
}

/**
 * Acknowledge a handoff: the oncoming nurse confirms receipt. Idempotent — an
 * already-acknowledged record is returned unchanged.
 */
export async function acknowledgeHandoff(
  id: string,
  userId: string,
  userName: string,
): Promise<ShiftHandoffDoc> {
  const db = handoffsDB();
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = (await db.get(id)) as ShiftHandoffDoc;
    if (existing.status === 'acknowledged') return existing;
    const now = new Date().toISOString();
    const updated: ShiftHandoffDoc = {
      ...existing,
      status: 'acknowledged',
      acknowledgedBy: userId,
      acknowledgedByName: userName,
      acknowledgedAt: now,
      updatedAt: now,
    };
    let resp: Awaited<ReturnType<typeof db.put>>;
    try {
      resp = await db.put(updated);
    } catch (error) {
      const candidate = error as { name?: string; status?: number } | undefined;
      if ((candidate?.name === 'conflict' || candidate?.status === 409) && attempt < 2) continue;
      throw error;
    }
    updated._rev = resp.rev;
    await logAuditSafe(
      'SHIFT_HANDOFF_ACKNOWLEDGED',
      userId,
      userName,
      `Acknowledged ${existing.shift} shift handoff (${existing.shiftDate}) from ${existing.outgoingNurseName}`,
    );
    emitSyncEvent({
      resourceType: 'shift_handoff',
      resourceId: updated._id,
      operation: 'update',
      resourceVersion: updated._rev,
      orgId: updated.orgId,
      hospitalId: updated.facilityId,
    });
    return updated;
  }
  throw new Error('The handoff changed on another workstation. Refresh and acknowledge it again.');
}

/**
 * Reverse an accidental acknowledgement: set status back to 'signed' and clear
 * the acknowledgement fields, returning the handoff to the oncoming nurse's
 * unread state. Idempotent — an already-signed record is returned unchanged.
 * Mirrors acknowledgeHandoff.
 */
export async function unacknowledgeHandoff(
  id: string,
  byUserId: string,
  byUserName: string,
): Promise<ShiftHandoffDoc> {
  const db = handoffsDB();
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = (await db.get(id)) as ShiftHandoffDoc;
    if (existing.status !== 'acknowledged') return existing;
    if (!existing.acknowledgedBy || existing.acknowledgedBy !== byUserId) {
      throw new Error('Only the staff member who acknowledged this handoff can reverse their acknowledgement.');
    }
    const now = new Date().toISOString();
    const updated: ShiftHandoffDoc = {
      ...existing,
      status: 'signed',
      acknowledgedBy: undefined,
      acknowledgedByName: undefined,
      acknowledgedAt: undefined,
      updatedAt: now,
    };
    let resp: Awaited<ReturnType<typeof db.put>>;
    try {
      resp = await db.put(updated);
    } catch (error) {
      const candidate = error as { name?: string; status?: number } | undefined;
      if ((candidate?.name === 'conflict' || candidate?.status === 409) && attempt < 2) continue;
      throw error;
    }
    updated._rev = resp.rev;
    await logAuditSafe(
      'SHIFT_HANDOFF_UNACKNOWLEDGED',
      byUserId,
      byUserName,
      `Reversed acknowledgement of ${existing.shift} shift handoff (${existing.shiftDate}) from ${existing.outgoingNurseName}`,
    );
    emitSyncEvent({
      resourceType: 'shift_handoff',
      resourceId: updated._id,
      operation: 'update',
      resourceVersion: updated._rev,
      orgId: updated.orgId,
      hospitalId: updated.facilityId,
    });
    return updated;
  }
  throw new Error('The handoff changed on another workstation. Refresh before reversing the acknowledgement.');
}
