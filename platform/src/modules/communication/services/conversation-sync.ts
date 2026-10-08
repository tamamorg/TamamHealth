/**
 * Staff chat — keeping a device in step with per-user read isolation.
 *
 * The server only sends a device the conversations its user is in. That
 * leaves two things replication alone cannot do, both handled here:
 *
 *   1. History. A pull moves forward from its checkpoint, so someone added to
 *      a group never receives what was said before they joined.
 *      `backfillConversation` fetches it once, on opening the thread.
 *   2. Removal. Once a user is taken out of a conversation the server stops
 *      sending them its updates — including the update that removed them. The
 *      device would go on showing a thread it can no longer post to.
 *      `reconcileMembership` asks the server and hides what it says is gone.
 *
 * Both are best-effort and silent offline: the server is the authority on
 * membership, and nothing here can widen what it will send.
 */
import { conversationsDB } from '@/lib/db';
import type { ConversationDoc } from '@/lib/db-types';
import { findByType } from '@/lib/services/db-query';

/** Device-only (never replicated): conversations the server says each user has left. */
const LEFT_DOC_ID = '_local/left-conversations';
interface LeftDoc { _id: string; _rev?: string; byUser?: Record<string, string[]> }

async function readLeftDoc(): Promise<LeftDoc> {
  try {
    return await conversationsDB().get(LEFT_DOC_ID) as unknown as LeftDoc;
  } catch {
    return { _id: LEFT_DOC_ID };
  }
}

/** Conversations this device knows the user is no longer part of. */
export async function getLeftConversationIds(userId: string): Promise<Set<string>> {
  return new Set((await readLeftDoc()).byUser?.[userId] || []);
}

async function messagingService(localName: string) {
  const { getSyncManager } = await import('@/lib/sync/sync-manager');
  return getSyncManager()?.getService(localName) ?? null;
}

/**
 * What the server's answer means for each local conversation. Pure, so the
 * three-way distinction is testable: only an explicit refusal hides a thread —
 * "not found" is a conversation created offline that has not synced yet.
 */
export function leftConversationIds(
  rows: ReadonlyArray<{ key: string; error?: string; doc?: Record<string, unknown> | null }>,
  userId: string,
): { left: string[]; member: string[] } {
  const left: string[] = [];
  const member: string[] = [];
  for (const row of rows) {
    if (row.error === 'forbidden') { left.push(row.key); continue; }
    const participants = row.doc?.participantIds;
    if (!Array.isArray(participants)) continue;
    (participants.includes(userId) ? member : left).push(row.key);
  }
  return { left, member };
}

/**
 * Check this user's local conversations against the server. Returns true when
 * the hidden set changed, so the caller knows to reload its list.
 */
export async function reconcileMembership(userId: string): Promise<boolean> {
  try {
    const service = await messagingService('tamamhealth_conversations');
    if (!service) return false;
    const local = (await findByType<ConversationDoc>(conversationsDB(), 'conversation'))
      .filter(conversation => conversation.participantIds?.includes(userId));
    if (local.length === 0) return false;
    const { left, member } = leftConversationIds(await service.remoteDocs(local.map(c => c._id)), userId);

    const doc = await readLeftDoc();
    const before = new Set(doc.byUser?.[userId] || []);
    const after = new Set(before);
    for (const id of left) after.add(id);
    // Re-added to a group: the server answers with the document again.
    for (const id of member) after.delete(id);
    if (after.size === before.size && [...after].every(id => before.has(id))) return false;
    await conversationsDB().put({ ...doc, byUser: { ...(doc.byUser || {}), [userId]: [...after] } } as never);
    return true;
  } catch {
    return false;
  }
}

/** Fetch a conversation's earlier messages. Cheap to repeat; see `pullMatching`. */
export async function backfillConversation(conversationId: string): Promise<number> {
  try {
    const service = await messagingService('tamamhealth_messages');
    if (!service) return 0;
    return await service.pullMatching({ conversationId });
  } catch {
    return 0;
  }
}
