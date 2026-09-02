/**
 * Internal staff messaging — conversation service.
 *
 * Staff chat is modelled as `ConversationDoc` (a DM or group) plus a stream of
 * `MessageDoc`s tagged with `conversationId`. Patient communication is left
 * untouched (it keeps using flat patient-scoped MessageDocs), keeping the two
 * environments separate as required by the spec.
 */
import { v4 as uuidv4 } from 'uuid';
import { conversationsDB, messagesDB, usersDB } from '@/lib/db';
import type { ConversationDoc, MessageDoc, StaffPresence, UserDoc } from '@/lib/db-types';
import type { DataScope } from '@/lib/services/data-scope';
import { filterByScope } from '@/lib/services/data-scope';
import { findByType } from '@/lib/services/db-query';
import { createMessage } from '@/modules/communication/services/message-service';
import { logAuditSafe } from '@/lib/services/audit-service';

/** A staff member may edit/delete their own message within this window. */
export const EDIT_WINDOW_MS = 15 * 60 * 1000;

/** All conversations a user participates in, pinned-first then most-recent. */
export async function getConversationsForUser(
  userId: string,
  scope?: DataScope,
): Promise<ConversationDoc[]> {
  const db = conversationsDB();
  // Indexed on type; the participant test stays in JS because Mango's
  // $elemMatch on an array of scalars cannot use a plain index here, and the
  // per-user conversation count is small once the type filter has run.
  let all = (await findByType<ConversationDoc>(db, 'conversation'))
    .filter(d => Array.isArray(d.participantIds) && d.participantIds.includes(userId));
  if (scope) all = filterByScope(all, scope);
  return all.sort((a, b) => {
    const ap = a.pinnedBy?.includes(userId) ? 1 : 0;
    const bp = b.pinnedBy?.includes(userId) ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return new Date(b.lastMessageAt || b.createdAt || '').getTime() - new Date(a.lastMessageAt || a.createdAt || '').getTime();
  });
}

/** Messages in one conversation, oldest-first (chat order). */
export async function getConversationMessages(conversationId: string): Promise<MessageDoc[]> {
  const rows = await findByType<MessageDoc>(
    messagesDB(),
    'message',
    { conversationId },
    { indexFields: ['type', 'conversationId'] },
  );
  return rows.sort((a, b) => new Date(a.sentAt || '').getTime() - new Date(b.sentAt || '').getTime());
}

interface Participant { id: string; name: string }

export interface UnreadStaffMessageRow {
  conversation: ConversationDoc;
  message: MessageDoc;
}

/**
 * Select unread incoming staff messages from conversations the viewer belongs
 * to. Kept pure so notification behavior can be tested without a database.
 */
export function selectUnreadStaffMessages(
  conversations: ConversationDoc[],
  messages: MessageDoc[],
  userId: string,
): UnreadStaffMessageRow[] {
  const conversationById = new Map(
    conversations
      .filter(conversation => !conversation.mutedBy?.includes(userId))
      .map(conversation => [conversation._id, conversation] as const),
  );

  return messages
    .filter(message =>
      message.direction === 'staff_to_staff'
      && !!message.conversationId
      && conversationById.has(message.conversationId)
      && message.fromDoctorId !== userId
      && !message.readBy?.includes(userId)
      && !message.deleted,
    )
    .map(message => ({
      conversation: conversationById.get(message.conversationId!)!,
      message,
    }))
    .sort((a, b) => (b.message.sentAt || b.message.createdAt || '')
      .localeCompare(a.message.sentAt || a.message.createdAt || ''));
}

/** Unread staff messages for the bell, already tenant- and participant-scoped. */
export async function getUnreadStaffMessagesForUser(
  userId: string,
  scope?: DataScope,
): Promise<UnreadStaffMessageRow[]> {
  const conversations = await getConversationsForUser(userId, scope);
  if (conversations.length === 0) return [];

  let messages = await findByType<MessageDoc>(messagesDB(), 'message');
  if (scope) messages = filterByScope(messages, scope);
  return selectUnreadStaffMessages(conversations, messages, userId);
}

/** Find an existing 1:1 conversation between two users, or create one. */
export async function getOrCreateDM(
  me: Participant,
  other: Participant,
  ctx: { hospitalId?: string; hospitalName?: string; orgId?: string } = {},
): Promise<ConversationDoc> {
  const db = conversationsDB();
  const existing = (await findByType<ConversationDoc>(db, 'conversation', { kind: 'dm' }, { indexFields: ['type', 'kind'] }))
    .find(d =>
      d &&
      d.participantIds.length === 2 &&
      d.participantIds.includes(me.id) && d.participantIds.includes(other.id),
    );
  if (existing) return existing;

  const now = new Date().toISOString();
  const doc: ConversationDoc = {
    _id: `conv-${uuidv4()}`,
    type: 'conversation',
    kind: 'dm',
    participantIds: [me.id, other.id],
    participantNames: [me.name, other.name],
    createdByName: me.name,
    pinnedBy: [],
    hospitalId: ctx.hospitalId,
    hospitalName: ctx.hospitalName,
    orgId: ctx.orgId,
    createdAt: now,
    updatedAt: now,
  };
  await db.put(doc);
  return doc;
}

/** Create a named group conversation. */
export async function createGroup(
  data: {
    name: string;
    participants: Participant[];
    createdBy: Participant;
    hospitalId?: string;
    hospitalName?: string;
    orgId?: string;
  },
): Promise<ConversationDoc> {
  const db = conversationsDB();
  const now = new Date().toISOString();
  // Always include the creator.
  const everyone = [data.createdBy, ...data.participants].filter(
    (p, i, arr) => arr.findIndex(x => x.id === p.id) === i,
  );
  const doc: ConversationDoc = {
    _id: `conv-${uuidv4()}`,
    type: 'conversation',
    kind: 'group',
    name: data.name,
    participantIds: everyone.map(p => p.id),
    participantNames: everyone.map(p => p.name),
    createdByName: data.createdBy.name,
    pinnedBy: [],
    hospitalId: data.hospitalId,
    hospitalName: data.hospitalName,
    orgId: data.orgId,
    createdAt: now,
    updatedAt: now,
  };
  await db.put(doc);
  return doc;
}

/** Post a message to a conversation and refresh the conversation preview. */
export async function sendConversationMessage(data: {
  conversationId: string;
  conversationName: string;
  fromId: string;
  fromName: string;
  body: string;
  replyToId?: string;
  hospitalId?: string;
  hospitalName?: string;
  orgId?: string;
  attachments?: Array<{ name: string; mimeType: string; base64Data: string; sizeBytes: number; phiWarningAcknowledged?: boolean }>;
  phiAcknowledged?: boolean;
}): Promise<MessageDoc> {
  const now = new Date().toISOString();
  const msg = await createMessage({
    recipientType: 'staff',
    direction: 'staff_to_staff',
    conversationId: data.conversationId,
    patientId: '',
    patientName: '',
    patientPhone: '',
    fromDoctorId: data.fromId,
    fromDoctorName: data.fromName,
    fromHospitalName: data.hospitalName || '',
    fromHospitalId: data.hospitalId,
    recipientHospitalId: data.hospitalId,
    recipientHospitalName: data.hospitalName,
    subject: '',
    body: data.body,
    channel: 'app',
    sentAt: now,
    readBy: [data.fromId],
    ...(data.replyToId ? { replyToId: data.replyToId } : {}),
    ...(data.attachments?.length ? { attachments: data.attachments } : {}),
    ...(data.phiAcknowledged ? { phiAcknowledged: true } : {}),
    orgId: data.orgId,
  });

  // Update the conversation's preview/last-activity metadata.
  try {
    const db = conversationsDB();
    const conv = (await db.get(data.conversationId)) as ConversationDoc;
    conv.lastMessageAt = now;
    conv.lastMessagePreview = data.body.slice(0, 120);
    conv.lastMessageFromName = data.fromName;
    conv.updatedAt = now;
    await db.put(conv);
  } catch {
    /* conversation may have been removed — message still persists */
  }
  return msg;
}

/** Mark every message in a conversation as read by the given user. */
export async function markConversationRead(conversationId: string, userId: string): Promise<void> {
  const db = messagesDB();
  const msgs = await getConversationMessages(conversationId);
  for (const m of msgs) {
    if (!m.readBy?.includes(userId)) {
      try {
        const fresh = (await db.get(m._id)) as MessageDoc;
        fresh.readBy = Array.from(new Set([...(fresh.readBy || []), userId]));
        fresh.updatedAt = new Date().toISOString();
        await db.put(fresh);
      } catch {
        /* skip on conflict */
      }
    }
  }
}

/** Count messages in a conversation the user hasn't read (and didn't send). */
export function unreadCount(messages: MessageDoc[], userId: string): number {
  return messages.filter(m => m.fromDoctorId !== userId && !m.readBy?.includes(userId)).length;
}

/** Toggle whether a user has pinned a conversation to the top of their list. */
export async function togglePinConversation(conversationId: string, userId: string): Promise<void> {
  await toggleMembership(conversationId, 'pinnedBy', userId);
}

/** Toggle whether a user has muted notifications for a conversation. */
export async function toggleMuteConversation(conversationId: string, userId: string): Promise<void> {
  await toggleMembership(conversationId, 'mutedBy', userId);
}

async function toggleMembership(conversationId: string, field: 'pinnedBy' | 'mutedBy', userId: string): Promise<void> {
  const db = conversationsDB();
  try {
    const conv = (await db.get(conversationId)) as ConversationDoc;
    const set = new Set(conv[field] || []);
    if (set.has(userId)) set.delete(userId); else set.add(userId);
    conv[field] = Array.from(set);
    conv.updatedAt = new Date().toISOString();
    await db.put(conv);
  } catch {
    /* noop */
  }
}

/* ─────────────────────────── message CRUD ─────────────────────────── */

/** Edit a message's body — author only, within the edit window. */
export async function editMessage(messageId: string, userId: string, body: string): Promise<boolean> {
  const db = messagesDB();
  try {
    const m = (await db.get(messageId)) as MessageDoc;
    if (m.fromDoctorId !== userId) return false;
    if (Date.now() - new Date(m.sentAt || m.createdAt).getTime() > EDIT_WINDOW_MS) return false;
    m.body = body.trim();
    m.editedAt = new Date().toISOString();
    m.updatedAt = m.editedAt;
    await db.put(m);
    await logAuditSafe('EDIT_MESSAGE', undefined, m.fromDoctorName, `Edited staff message ${m._id}`);
    return true;
  } catch {
    return false;
  }
}

/** Soft-delete a message — author only. Leaves a tombstone in the thread. */
export async function deleteMessage(messageId: string, userId: string): Promise<boolean> {
  const db = messagesDB();
  try {
    const m = (await db.get(messageId)) as MessageDoc;
    if (m.fromDoctorId !== userId) return false;
    m.deleted = true;
    m.body = '';
    m.reactions = [];
    m.updatedAt = new Date().toISOString();
    await db.put(m);
    await logAuditSafe('DELETE_MESSAGE', undefined, m.fromDoctorName, `Deleted staff message ${m._id}`);
    return true;
  } catch {
    return false;
  }
}

/** Toggle a single emoji reaction by a user on a message. */
export async function toggleReaction(messageId: string, emoji: string, userId: string): Promise<void> {
  const db = messagesDB();
  try {
    const m = (await db.get(messageId)) as MessageDoc;
    const list = m.reactions || [];
    const idx = list.findIndex(r => r.emoji === emoji && r.userId === userId);
    if (idx >= 0) list.splice(idx, 1); else list.push({ emoji, userId });
    m.reactions = list;
    m.updatedAt = new Date().toISOString();
    await db.put(m);
  } catch {
    /* noop */
  }
}

/* ─────────────────────────── group CRUD ─────────────────────────── */

interface Member { id: string; name: string }

/** Rename a group conversation. */
export async function renameGroup(conversationId: string, name: string): Promise<void> {
  const db = conversationsDB();
  try {
    const conv = (await db.get(conversationId)) as ConversationDoc;
    conv.name = name.trim() || conv.name;
    conv.updatedAt = new Date().toISOString();
    await db.put(conv);
  } catch {
    /* noop */
  }
}

/** Add members to a group conversation (deduped). */
export async function addMembers(conversationId: string, members: Member[]): Promise<void> {
  const db = conversationsDB();
  try {
    const conv = (await db.get(conversationId)) as ConversationDoc;
    const ids = conv.participantIds || [];
    const names = conv.participantNames || [];
    for (const m of members) {
      if (!ids.includes(m.id)) { ids.push(m.id); names.push(m.name); }
    }
    conv.participantIds = ids;
    conv.participantNames = names;
    conv.updatedAt = new Date().toISOString();
    await db.put(conv);
  } catch {
    /* noop */
  }
}

/** Remove a member (or let a user leave) a group conversation. */
export async function removeMember(conversationId: string, userId: string): Promise<void> {
  const db = conversationsDB();
  try {
    const conv = (await db.get(conversationId)) as ConversationDoc;
    const idx = conv.participantIds.indexOf(userId);
    if (idx >= 0) {
      conv.participantIds.splice(idx, 1);
      if (conv.participantNames) conv.participantNames.splice(idx, 1);
      conv.updatedAt = new Date().toISOString();
      await db.put(conv);
    }
  } catch {
    /* noop */
  }
}

/** Delete a conversation and all of its messages. */
export async function deleteConversation(conversationId: string): Promise<void> {
  const cdb = conversationsDB();
  const mdb = messagesDB();
  try {
    const msgs = await getConversationMessages(conversationId);
    for (const m of msgs) {
      try { if (m._rev) await mdb.remove(m._id, m._rev); } catch { /* skip */ }
    }
    const conv = (await cdb.get(conversationId)) as ConversationDoc;
    if (conv._rev) await cdb.remove(conv._id, conv._rev);
    await logAuditSafe('DELETE_CONVERSATION', undefined, undefined, `Deleted conversation ${conversationId}`);
  } catch {
    /* noop */
  }
}

/* ─────────────────────────── presence ─────────────────────────── */

/** Persist a staff member's messaging presence/status. */
export async function setPresence(userId: string, presence: StaffPresence): Promise<void> {
  const db = usersDB();
  try {
    const u = (await db.get(userId)) as UserDoc;
    u.presence = presence;
    u.updatedAt = new Date().toISOString();
    await db.put(u);
  } catch {
    /* noop */
  }
}
