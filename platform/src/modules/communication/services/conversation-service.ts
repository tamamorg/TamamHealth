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
import { UNREADABLE_MESSAGE_TEXT, createMessage, decryptMessage, encryptMessageText, retractMessage } from '@/modules/communication/services/message-service';
import { logAuditSafe } from '@/lib/services/audit-service';
import { EDIT_WINDOW_MS, REMOVED_MESSAGE_PREVIEW, isMessageEditable } from '@/modules/communication/message-rules';

export { EDIT_WINDOW_MS, REMOVED_MESSAGE_PREVIEW, isMessageEditable };

function previewFor(message: MessageDoc): string {
  if (message.deleted) return REMOVED_MESSAGE_PREVIEW;
  const text = message.body.trim();
  if (text) return text.slice(0, 120);
  return message.attachments?.length ? 'Attachment' : '';
}

/** All conversations a user participates in, pinned-first then most-recent. */
export async function getConversationsForUser(
  userId: string,
  scope: DataScope,
): Promise<ConversationDoc[]> {
  const db = conversationsDB();
  // Indexed on type; the participant test stays in JS because Mango's
  // $elemMatch on an array of scalars cannot use a plain index here, and the
  // per-user conversation count is small once the type filter has run.
  let all = (await findByType<ConversationDoc>(db, 'conversation'))
    .filter(d => Array.isArray(d.participantIds) && d.participantIds.includes(userId))
    // Archived is per-user: the conversation is kept, just out of this list.
    .filter(d => !d.archivedBy?.includes(userId));
  all = filterByScope(all, scope);
  // The server has said this user was removed, but the update that removed
  // them is exactly the one it no longer sends — see conversation-sync.ts.
  const { getLeftConversationIds } = await import('@/modules/communication/services/conversation-sync');
  const left = await getLeftConversationIds(userId);
  if (left.size > 0) all = all.filter(d => !left.has(d._id));
  return all.sort((a, b) => {
    const ap = a.pinnedBy?.includes(userId) ? 1 : 0;
    const bp = b.pinnedBy?.includes(userId) ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return new Date(b.lastMessageAt || b.createdAt || '').getTime() - new Date(a.lastMessageAt || a.createdAt || '').getTime();
  });
}

/**
 * Whether a user is a participant of a conversation. Every read and write in
 * this service goes through it: a conversation id is not a capability, and the
 * local database holds threads this user was never part of.
 */
async function participantConversation(conversationId: string, userId: string): Promise<ConversationDoc | null> {
  if (!conversationId || !userId) return null;
  try {
    const conv = (await conversationsDB().get(conversationId)) as ConversationDoc;
    return conv.type === 'conversation' && conv.participantIds?.includes(userId) ? conv : null;
  } catch {
    return null;
  }
}

/** Messages in one conversation, oldest-first — for a participant only. */
export async function getConversationMessages(conversationId: string, userId: string): Promise<MessageDoc[]> {
  if (!(await participantConversation(conversationId, userId))) return [];
  return readConversationMessages(conversationId);
}

/**
 * Record that a user opened a conversation. Reading messages is access to
 * PHI, and the audit trail has to be able to answer who looked at a thread,
 * not only who wrote in it. Identifiers only — never message text.
 */
export async function recordConversationAccess(conversationId: string, userId: string, username?: string): Promise<void> {
  if (!(await participantConversation(conversationId, userId))) return;
  await logAuditSafe('VIEW_CONVERSATION', userId, username, `Opened conversation ${conversationId}`);
}

/** Unchecked read for this service's own bookkeeping; callers have already authorised. */
async function readConversationMessages(conversationId: string): Promise<MessageDoc[]> {
  const rows = await findByType<MessageDoc>(
    messagesDB(),
    'message',
    { conversationId },
    { indexFields: ['type', 'conversationId'] },
  );
  return rows
    .map(decryptMessage)
    .sort((a, b) => new Date(a.sentAt || '').getTime() - new Date(b.sentAt || '').getTime());
}

/**
 * Re-derive the list preview from the newest message. Called after an edit or
 * a removal, so the list never keeps showing wording the thread no longer does.
 */
async function refreshConversationPreview(conversationId: string): Promise<void> {
  try {
    const messages = await readConversationMessages(conversationId);
    const latest = messages[messages.length - 1];
    if (!latest) return;
    const db = conversationsDB();
    const conv = (await db.get(conversationId)) as ConversationDoc;
    const preview = previewFor(latest);
    if (conv.lastMessagePreview === preview) return;
    conv.lastMessagePreview = preview;
    conv.updatedAt = new Date().toISOString();
    await db.put(conv);
  } catch {
    /* preview is a convenience; the thread itself is already correct */
  }
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

/**
 * Conversations holding at least one message the viewer has not read. Unlike
 * the bell this keeps muted conversations — muting silences the alert, it does
 * not mark anything read.
 */
export async function getUnreadConversationIds(userId: string, scope: DataScope): Promise<string[]> {
  const conversations = await getConversationsForUser(userId, scope);
  if (conversations.length === 0) return [];
  const mine = new Set(conversations.map(conversation => conversation._id));
  const messages = filterByScope(await findByType<MessageDoc>(messagesDB(), 'message'), scope);
  const unread = new Set<string>();
  for (const message of messages) {
    if (
      message.conversationId
      && mine.has(message.conversationId)
      && message.fromDoctorId !== userId
      && !message.deleted
      && !message.readBy?.includes(userId)
    ) unread.add(message.conversationId);
  }
  return Array.from(unread);
}

/** Unread staff messages for the bell, already tenant- and participant-scoped. */
export async function getUnreadStaffMessagesForUser(
  userId: string,
  scope: DataScope,
): Promise<UnreadStaffMessageRow[]> {
  const conversations = await getConversationsForUser(userId, scope);
  if (conversations.length === 0) return [];

  let messages = await findByType<MessageDoc>(messagesDB(), 'message');
  messages = filterByScope(messages, scope);
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
  if (existing) {
    // Starting a chat with someone again is how an archived DM comes back.
    if (existing.archivedBy?.includes(me.id)) {
      existing.archivedBy = existing.archivedBy.filter(id => id !== me.id);
      existing.updatedAt = new Date().toISOString();
      try {
        const resp = await db.put(existing);
        existing._rev = resp.rev;
      } catch {
        /* still usable; it will resurface on the next message */
      }
    }
    return existing;
  }

  const now = new Date().toISOString();
  const doc: ConversationDoc = {
    _id: `conv-${uuidv4()}`,
    type: 'conversation',
    kind: 'dm',
    participantIds: [me.id, other.id],
    participantNames: [me.name, other.name],
    createdById: me.id,
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
    createdById: data.createdBy.id,
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
  if (!(await participantConversation(data.conversationId, data.fromId))) {
    throw new Error('You are not a participant in this conversation.');
  }
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
    conv.lastMessagePreview = previewFor(msg);
    conv.lastMessageFromName = data.fromName;
    // New activity un-archives the conversation for everyone, or a participant
    // who archived it would never learn a colleague had written to them.
    if (conv.archivedBy?.length) conv.archivedBy = [];
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
  const msgs = await getConversationMessages(conversationId, userId);
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
  return messages.filter(m => m.fromDoctorId !== userId && !m.deleted && !m.readBy?.includes(userId)).length;
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
    if (!conv.participantIds?.includes(userId)) return;
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

/**
 * Edit a message's body — author only, within the edit window.
 *
 * The earlier wording is appended to `editHistory` rather than overwritten:
 * a colleague may have read and acted on it, so the record keeps every version.
 * An edit cannot blank a message — that would be a removal without the trail.
 */
export async function editMessage(messageId: string, userId: string, body: string): Promise<boolean> {
  const db = messagesDB();
  const next = body.trim();
  if (!next) return false;
  try {
    const m = (await db.get(messageId)) as MessageDoc;
    if (!isMessageEditable(m, userId)) return false;
    const current = decryptMessage(m).body;
    if (next === current) return true;
    // Text this device cannot decrypt cannot be edited from it: the save would
    // be judged against a placeholder, not against what the message says.
    if (current === UNREADABLE_MESSAGE_TEXT) return false;
    const now = new Date().toISOString();
    m.editHistory = [...(m.editHistory || []), { body: m.body, at: m.editedAt || m.sentAt || m.createdAt }];
    m.body = encryptMessageText(next);
    m.editedAt = now;
    m.updatedAt = now;
    await db.put(m);
    await logAuditSafe(
      'EDIT_MESSAGE', userId, m.fromDoctorName,
      `Edited staff message ${m._id}; ${m.editHistory.length} earlier version${m.editHistory.length === 1 ? '' : 's'} retained`,
    );
    if (m.conversationId) await refreshConversationPreview(m.conversationId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove a message from the thread — author only. The text, attachments and
 * reactions stay on the record (see `retractMessage`); the thread shows who
 * removed it and when, and lets a participant open the original.
 */
export async function deleteMessage(messageId: string, userId: string): Promise<boolean> {
  let actorName: string | undefined;
  let conversationId: string | undefined;
  try {
    const m = (await messagesDB().get(messageId)) as MessageDoc;
    actorName = m.fromDoctorName;
    conversationId = m.conversationId;
  } catch {
    return false;
  }
  const result = await retractMessage(messageId, { id: userId, name: actorName });
  if (result !== 'retracted') return false;
  if (conversationId) await refreshConversationPreview(conversationId);
  return true;
}

/** Toggle a single emoji reaction by a user on a message. */
export async function toggleReaction(messageId: string, emoji: string, userId: string): Promise<void> {
  const db = messagesDB();
  try {
    const m = (await db.get(messageId)) as MessageDoc;
    // A removed message is closed: what it carried when removed is the record.
    if (m.deleted) return;
    if (!m.conversationId || !(await participantConversation(m.conversationId, userId))) return;
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

/**
 * Who may remove another member. A group that records its creator is managed
 * by them; one created before `createdById` existed has no owner to defer to,
 * so any participant may, as before. Leaving is always your own decision.
 */
export function canRemoveMember(conv: ConversationDoc, actorId: string, targetId: string): boolean {
  if (conv.kind !== 'group' || !conv.participantIds?.includes(actorId)) return false;
  if (actorId === targetId) return true;
  return !conv.createdById || conv.createdById === actorId;
}

/** Rename a group conversation — participants only. */
export async function renameGroup(conversationId: string, name: string, actorId: string): Promise<boolean> {
  const db = conversationsDB();
  try {
    const conv = (await db.get(conversationId)) as ConversationDoc;
    const next = name.trim();
    if (conv.kind !== 'group' || !conv.participantIds?.includes(actorId) || !next) return false;
    conv.name = next;
    conv.updatedAt = new Date().toISOString();
    await db.put(conv);
    await logAuditSafe('RENAME_CONVERSATION', actorId, undefined, `Renamed conversation ${conversationId}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Add members to a group conversation (deduped) — participants only.
 *
 * A new member can read the whole thread, so adding one is a disclosure of
 * everything already said in it. The audit row names who was given access and
 * by whom.
 */
export async function addMembers(conversationId: string, members: Member[], actorId: string): Promise<boolean> {
  const db = conversationsDB();
  try {
    const conv = (await db.get(conversationId)) as ConversationDoc;
    if (conv.kind !== 'group' || !conv.participantIds?.includes(actorId)) return false;
    const ids = conv.participantIds || [];
    const names = conv.participantNames || [];
    const added: string[] = [];
    for (const m of members) {
      if (!ids.includes(m.id)) { ids.push(m.id); names.push(m.name); added.push(m.id); }
    }
    if (added.length === 0) return true;
    conv.participantIds = ids;
    conv.participantNames = names;
    conv.updatedAt = new Date().toISOString();
    await db.put(conv);
    await logAuditSafe(
      'ADD_CONVERSATION_MEMBER', actorId, undefined,
      `Gave ${added.join(', ')} access to conversation ${conversationId}`,
    );
    return true;
  } catch {
    return false;
  }
}

/** Remove a member, or leave, a group conversation. See `canRemoveMember`. */
export async function removeMember(conversationId: string, userId: string, actorId: string): Promise<boolean> {
  const db = conversationsDB();
  try {
    const conv = (await db.get(conversationId)) as ConversationDoc;
    if (!canRemoveMember(conv, actorId, userId)) return false;
    const idx = conv.participantIds.indexOf(userId);
    if (idx < 0) return false;
    conv.participantIds.splice(idx, 1);
    if (conv.participantNames) conv.participantNames.splice(idx, 1);
    conv.updatedAt = new Date().toISOString();
    await db.put(conv);
    await logAuditSafe(
      'REMOVE_CONVERSATION_MEMBER', actorId, undefined,
      userId === actorId
        ? `Left conversation ${conversationId}`
        : `Removed ${userId} from conversation ${conversationId}`,
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Take a conversation out of one user's list.
 *
 * This replaced "delete conversation", which removed the conversation and
 * every message in it — for every participant, on the say-so of any one of
 * them. Nothing is destroyed now: the conversation and its messages are kept,
 * the other participants are unaffected, and it returns to this user's list
 * on the next message (or when they start the chat again).
 */
export async function archiveConversation(conversationId: string, userId: string): Promise<boolean> {
  const db = conversationsDB();
  try {
    const conv = (await db.get(conversationId)) as ConversationDoc;
    if (!conv.participantIds?.includes(userId)) return false;
    if (conv.archivedBy?.includes(userId)) return true;
    conv.archivedBy = [...(conv.archivedBy || []), userId];
    conv.updatedAt = new Date().toISOString();
    await db.put(conv);
    await logAuditSafe('ARCHIVE_CONVERSATION', userId, undefined, `Archived conversation ${conversationId} from own list; messages retained`);
    return true;
  } catch {
    return false;
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
