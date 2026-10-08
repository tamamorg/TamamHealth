/**
 * Messaging — retention.
 *
 * A clinical message is part of the communication record. These tests pin the
 * rule the service used to break in three places: "delete" blanked the text,
 * "delete conversation" removed every message for every participant, and an
 * edit overwrote the wording a colleague had already read. None of them may
 * destroy content now — the thread changes, the record does not.
 */
import { createDBMock, teardownTestDBs } from '../helpers/test-db';

jest.mock('@/lib/db', () => createDBMock());
jest.mock('@/lib/services/sync-event-service', () => ({ emitSyncEvent: jest.fn() }));

import { messagesDB, conversationsDB, auditLogDB } from '@/lib/db';
import type { AuditLogDoc, ConversationDoc, MessageDoc } from '@/lib/db-types';
import type { DataScope } from '@/lib/services/data-scope';
import { UNREADABLE_MESSAGE_TEXT, createMessage, getAllMessages, retractMessage } from '@/modules/communication/services/message-service';
import { leftConversationIds } from '@/modules/communication/services/conversation-sync';
import {
  REMOVED_MESSAGE_PREVIEW,
  addMembers,
  archiveConversation,
  canRemoveMember,
  createGroup,
  deleteMessage,
  editMessage,
  getConversationMessages,
  getConversationsForUser,
  getOrCreateDM,
  getUnreadConversationIds,
  markConversationRead,
  recordConversationAccess,
  removeMember,
  renameGroup,
  sendConversationMessage,
  toggleReaction,
  unreadCount,
} from '@/modules/communication/services/conversation-service';

const ana = { id: 'user-ana', name: 'Dr. Ana Deng' };
const ben = { id: 'user-ben', name: 'Nurse Ben Lado' };
const ctx = { hospitalId: 'hosp-1', hospitalName: 'Juba Teaching', orgId: 'org-a' };
const scope: DataScope = { role: 'doctor', orgId: 'org-a', hospitalId: 'hosp-1' };

async function say(conv: ConversationDoc, from: typeof ana, body: string): Promise<MessageDoc> {
  return sendConversationMessage({
    conversationId: conv._id, conversationName: 'chat', fromId: from.id, fromName: from.name, body, ...ctx,
  });
}

async function stored(id: string): Promise<MessageDoc> {
  return await messagesDB().get(id) as MessageDoc;
}

async function auditActions(): Promise<string[]> {
  const rows = await auditLogDB().allDocs({ include_docs: true });
  return rows.rows.map(row => (row.doc as unknown as AuditLogDoc).action);
}

afterEach(async () => { await teardownTestDBs(); });

describe('removing a message', () => {
  test('keeps the document, the text and the reactions, and stamps who removed it', async () => {
    const conv = await getOrCreateDM(ana, ben, ctx);
    const msg = await say(conv, ana, 'Give 5 mg morphine IV now');
    await toggleReaction(msg._id, '👍', ben.id);

    expect(await deleteMessage(msg._id, ana.id)).toBe(true);

    const doc = await stored(msg._id);
    expect(doc.deleted).toBe(true);
    expect(doc.body).toBe('Give 5 mg morphine IV now');
    expect(doc.reactions).toEqual([{ emoji: '👍', userId: ben.id }]);
    expect(doc.deletedById).toBe(ana.id);
    expect(doc.deletedByName).toBe(ana.name);
    expect(doc.deletedAt).toEqual(expect.any(String));
    expect(await auditActions()).toContain('DELETE_MESSAGE');
  });

  test('still appears in the thread, in order, with its original text readable', async () => {
    const conv = await getOrCreateDM(ana, ben, ctx);
    const first = await say(conv, ana, 'first');
    // Thread order is by send time; two sends inside one millisecond tie.
    await new Promise(resolve => setTimeout(resolve, 5));
    await say(conv, ben, 'second');
    await deleteMessage(first._id, ana.id);

    const thread = await getConversationMessages(conv._id, ben.id);
    expect(thread.map(m => m.body)).toEqual(['first', 'second']);
    expect(thread[0].deleted).toBe(true);
  });

  test('only the author can remove it', async () => {
    const conv = await getOrCreateDM(ana, ben, ctx);
    const msg = await say(conv, ana, 'mine');

    expect(await deleteMessage(msg._id, ben.id)).toBe(false);
    expect(await retractMessage(msg._id, ben)).toBe('not_author');
    expect((await stored(msg._id)).deleted).toBeUndefined();
  });

  test('a second removal does not rewrite the first stamp', async () => {
    const conv = await getOrCreateDM(ana, ben, ctx);
    const msg = await say(conv, ana, 'once');
    await deleteMessage(msg._id, ana.id);
    const stamp = (await stored(msg._id)).deletedAt;

    expect(await retractMessage(msg._id, ana)).toBe('already_retracted');
    expect((await stored(msg._id)).deletedAt).toBe(stamp);
  });

  test('the list preview stops showing the removed text', async () => {
    const conv = await getOrCreateDM(ana, ben, ctx);
    const msg = await say(conv, ana, 'sent to the wrong chat');
    await deleteMessage(msg._id, ana.id);

    const fresh = await conversationsDB().get(conv._id) as ConversationDoc;
    expect(fresh.lastMessagePreview).toBe(REMOVED_MESSAGE_PREVIEW);
  });

  test('a removed message is closed to edits and reactions, and is not unread', async () => {
    const conv = await getOrCreateDM(ana, ben, ctx);
    const msg = await say(conv, ana, 'closed');
    await deleteMessage(msg._id, ana.id);

    expect(await editMessage(msg._id, ana.id, 'rewritten')).toBe(false);
    await toggleReaction(msg._id, '👍', ben.id);
    const doc = await stored(msg._id);
    expect(doc.body).toBe('closed');
    expect(doc.reactions || []).toEqual([]);
    expect(unreadCount([doc], ben.id)).toBe(0);
    expect(await getUnreadConversationIds(ben.id, scope)).toEqual([]);
  });
});

describe('editing a message', () => {
  test('keeps every earlier wording, oldest first', async () => {
    const conv = await getOrCreateDM(ana, ben, ctx);
    const msg = await say(conv, ana, 'Paracetamol 500 mg');

    expect(await editMessage(msg._id, ana.id, 'Paracetamol 1 g')).toBe(true);
    expect(await editMessage(msg._id, ana.id, 'Paracetamol 1 g QID')).toBe(true);

    const doc = await stored(msg._id);
    expect(doc.body).toBe('Paracetamol 1 g QID');
    expect(doc.editHistory?.map(v => v.body)).toEqual(['Paracetamol 500 mg', 'Paracetamol 1 g']);
    expect(doc.editHistory?.[0].at).toBe(msg.sentAt);
    expect(doc.editedAt).toEqual(expect.any(String));
  });

  test('cannot be used to blank a message', async () => {
    const conv = await getOrCreateDM(ana, ben, ctx);
    const msg = await say(conv, ana, 'keep me');

    expect(await editMessage(msg._id, ana.id, '   ')).toBe(false);
    const doc = await stored(msg._id);
    expect(doc.body).toBe('keep me');
    expect(doc.editHistory).toBeUndefined();
  });

  test('saving the same text records no edit', async () => {
    const conv = await getOrCreateDM(ana, ben, ctx);
    const msg = await say(conv, ana, 'unchanged');

    expect(await editMessage(msg._id, ana.id, 'unchanged')).toBe(true);
    const doc = await stored(msg._id);
    expect(doc.editedAt).toBeUndefined();
    expect(doc.editHistory).toBeUndefined();
  });

  test('is refused for another user and after the edit window', async () => {
    const conv = await getOrCreateDM(ana, ben, ctx);
    const msg = await say(conv, ana, 'original');
    expect(await editMessage(msg._id, ben.id, 'hijacked')).toBe(false);

    const doc = await stored(msg._id);
    await messagesDB().put({ ...doc, sentAt: new Date(Date.now() - 16 * 60 * 1000).toISOString() });
    expect(await editMessage(msg._id, ana.id, 'too late')).toBe(false);
    expect((await stored(msg._id)).body).toBe('original');
  });

  test('refreshes the list preview when the newest message is edited', async () => {
    const conv = await getOrCreateDM(ana, ben, ctx);
    const msg = await say(conv, ana, 'tpyo');
    await editMessage(msg._id, ana.id, 'typo');

    const fresh = await conversationsDB().get(conv._id) as ConversationDoc;
    expect(fresh.lastMessagePreview).toBe('typo');
  });
});

describe('archiving a conversation', () => {
  test('hides it from that user only and destroys nothing', async () => {
    const conv = await getOrCreateDM(ana, ben, ctx);
    const msg = await say(conv, ana, 'still here');

    expect(await archiveConversation(conv._id, ana.id)).toBe(true);

    expect(await getConversationsForUser(ana.id, scope)).toHaveLength(0);
    expect(await getConversationsForUser(ben.id, scope)).toHaveLength(1);
    expect((await stored(msg._id)).body).toBe('still here');
    expect(await getConversationMessages(conv._id, ben.id)).toHaveLength(1);
    expect(await auditActions()).toContain('ARCHIVE_CONVERSATION');
  });

  test('a non-participant cannot archive it', async () => {
    const conv = await getOrCreateDM(ana, ben, ctx);
    expect(await archiveConversation(conv._id, 'user-eve')).toBe(false);
  });

  test('a new message brings it back', async () => {
    const conv = await getOrCreateDM(ana, ben, ctx);
    await say(conv, ana, 'one');
    await archiveConversation(conv._id, ana.id);

    await say(conv, ben, 'are you there?');
    expect(await getConversationsForUser(ana.id, scope)).toHaveLength(1);
  });

  test('starting the DM again brings it back instead of forking a second one', async () => {
    const conv = await getOrCreateDM(ana, ben, ctx);
    await archiveConversation(conv._id, ana.id);

    const again = await getOrCreateDM(ana, ben, ctx);
    expect(again._id).toBe(conv._id);
    expect(await getConversationsForUser(ana.id, scope)).toHaveLength(1);
  });
});

describe('unread conversations', () => {
  test('follow read receipts, not who spoke last', async () => {
    const dm = await getOrCreateDM(ana, ben, ctx);
    const group = await createGroup({ name: 'Ward 3', participants: [ben], createdBy: ana, ...ctx });
    await say(dm, ben, 'ping');
    await say(group, ana, 'my own message');

    expect(await getUnreadConversationIds(ana.id, scope)).toEqual([dm._id]);

    await markConversationRead(dm._id, ana.id);
    expect(await getUnreadConversationIds(ana.id, scope)).toEqual([]);
    // Ben has not opened the group yet.
    expect(await getUnreadConversationIds(ben.id, scope)).toEqual([group._id]);
  });
});

describe('access is limited to participants', () => {
  const eve = { id: 'user-eve', name: 'Eve Outsider' };

  test('a non-participant cannot read, send, react or mark a thread read', async () => {
    const conv = await getOrCreateDM(ana, ben, ctx);
    const msg = await say(conv, ana, 'Patient in bed 4 is HIV positive');

    expect(await getConversationMessages(conv._id, eve.id)).toEqual([]);
    await expect(say(conv, eve, 'let me in')).rejects.toThrow(/not a participant/);
    await toggleReaction(msg._id, '👀', eve.id);
    await markConversationRead(conv._id, eve.id);

    const doc = await stored(msg._id);
    expect(doc.reactions || []).toEqual([]);
    expect(doc.readBy).toEqual([ana.id]);
    expect(await getConversationMessages(conv._id, ben.id)).toHaveLength(1);
  });

  test('opening a thread is audited for participants, with no message text', async () => {
    const conv = await getOrCreateDM(ana, ben, ctx);
    await say(conv, ana, 'confidential detail');

    await recordConversationAccess(conv._id, ben.id, 'nurse.ben');
    await recordConversationAccess(conv._id, eve.id, 'eve');

    const rows = (await auditLogDB().allDocs({ include_docs: true })).rows
      .map(row => row.doc as unknown as AuditLogDoc)
      .filter(doc => doc.action === 'VIEW_CONVERSATION');
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(ben.id);
    expect(JSON.stringify(rows)).not.toContain('confidential detail');
  });

  test('only a participant can add members, and the grant is audited', async () => {
    const group = await createGroup({ name: 'Ward 3', participants: [ben], createdBy: ana, ...ctx });

    expect(await addMembers(group._id, [eve], eve.id)).toBe(false);
    expect(await getConversationsForUser(eve.id, scope)).toHaveLength(0);

    expect(await addMembers(group._id, [eve], ben.id)).toBe(true);
    expect(await getConversationsForUser(eve.id, scope)).toHaveLength(1);
    expect(await auditActions()).toContain('ADD_CONVERSATION_MEMBER');
  });

  test('only the creator removes someone else; anyone may leave', async () => {
    const group = await createGroup({ name: 'Ward 3', participants: [ben, eve], createdBy: ana, ...ctx });

    expect(await removeMember(group._id, eve.id, ben.id)).toBe(false);
    expect(await removeMember(group._id, eve.id, ana.id)).toBe(true);
    expect(await removeMember(group._id, ben.id, ben.id)).toBe(true);

    const fresh = await conversationsDB().get(group._id) as ConversationDoc;
    expect(fresh.participantIds).toEqual([ana.id]);
    expect(await auditActions()).toContain('REMOVE_CONVERSATION_MEMBER');
  });

  test('a group with no recorded creator keeps the old any-participant rule', () => {
    const legacy = { kind: 'group', participantIds: [ana.id, ben.id] } as ConversationDoc;
    expect(canRemoveMember(legacy, ben.id, ana.id)).toBe(true);
    expect(canRemoveMember(legacy, eve.id, ana.id)).toBe(false);
    expect(canRemoveMember({ ...legacy, kind: 'dm' }, ana.id, ben.id)).toBe(false);
  });

  test('an outsider cannot rename a group', async () => {
    const group = await createGroup({ name: 'Ward 3', participants: [ben], createdBy: ana, ...ctx });
    expect(await renameGroup(group._id, 'Hijacked', eve.id)).toBe(false);
    expect(await renameGroup(group._id, 'Ward 3 nights', ben.id)).toBe(true);
    expect((await conversationsDB().get(group._id) as ConversationDoc).name).toBe('Ward 3 nights');
  });
});

describe('staff chat is not an organisation-wide read', () => {
  test('org-scoped message reads never return conversation messages', async () => {
    const conv = await getOrCreateDM(ana, ben, ctx);
    await say(conv, ana, 'between the two of us');

    expect(await getAllMessages(scope)).toEqual([]);
  });

  test('only an explicit refusal from the server hides a conversation', () => {
    const rows = [
      { key: 'conv-in', doc: { participantIds: [ana.id, ben.id] } },
      { key: 'conv-removed', error: 'forbidden' },
      { key: 'conv-offline-only', error: 'not_found' },
      { key: 'conv-dropped', doc: { participantIds: [ben.id] } },
    ];
    expect(leftConversationIds(rows, ana.id)).toEqual({ left: ['conv-removed', 'conv-dropped'], member: ['conv-in'] });
  });
});

describe('server field-encryption and synced devices', () => {
  const KEY = Buffer.alloc(32, 7).toString('base64');
  const patientMessage = {
    patientId: 'pat-1', patientName: 'Mary', patientPhone: '', recipientType: 'patient' as const,
    fromDoctorId: ana.id, fromDoctorName: ana.name, fromHospitalName: 'Juba Teaching',
    subject: 'Results', body: 'Your results are ready', channel: 'app' as const,
    sentAt: '2026-10-08T09:00:00.000Z', orgId: 'org-a', fromHospitalId: 'hosp-1',
  };
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  test('with sync on, message text is stored as written even when field encryption is enabled', async () => {
    process.env.PHI_ENCRYPTION_ENABLED = 'true';
    process.env.PHI_ENCRYPTION_KEY = KEY;
    delete process.env.NEXT_PUBLIC_SYNC_ENABLED; // sync is on by default

    const msg = await createMessage(patientMessage);
    expect((await stored(msg._id)).body).toBe('Your results are ready');
  });

  test('a server-only deployment still encrypts it', async () => {
    process.env.PHI_ENCRYPTION_ENABLED = 'true';
    process.env.PHI_ENCRYPTION_KEY = KEY;
    process.env.NEXT_PUBLIC_SYNC_ENABLED = 'false';

    const msg = await createMessage(patientMessage);
    expect((await stored(msg._id)).body).toMatch(/^enc:v1:/);
    expect(msg.body).toBe('Your results are ready');
  });

  test('one message this device cannot decrypt does not empty the inbox', async () => {
    process.env.PHI_ENCRYPTION_ENABLED = 'true';
    process.env.PHI_ENCRYPTION_KEY = KEY;
    process.env.NEXT_PUBLIC_SYNC_ENABLED = 'false';
    await createMessage(patientMessage); // encrypted by a server
    process.env = { ...saved };          // …and now read on a device with no key
    delete process.env.PHI_ENCRYPTION_KEY;
    await createMessage({ ...patientMessage, body: 'readable' });

    const inbox = await getAllMessages(scope);
    expect(inbox.map(m => m.body).sort()).toEqual([UNREADABLE_MESSAGE_TEXT, 'readable'].sort());
  });
});
