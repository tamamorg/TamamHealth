/**
 * Messaging — the conversation list follows the newest message.
 *
 * The list's time, preview and order used to come only from the stamps on the
 * conversation document, which go stale (a dropped best-effort write, a
 * replication conflict, a message that arrived before its conversation
 * update). The newest message the device holds now decides.
 */
import { createDBMock, teardownTestDBs } from '../helpers/test-db';

jest.mock('@/lib/db', () => createDBMock());
jest.mock('@/lib/services/sync-event-service', () => ({ emitSyncEvent: jest.fn() }));

import { conversationsDB } from '@/lib/db';
import type { ConversationDoc } from '@/lib/db-types';
import type { DataScope } from '@/lib/services/data-scope';
import { createMessage } from '@/modules/communication/services/message-service';
import {
  createGroup,
  getConversationMessages,
  getConversationsForUser,
  getOrCreateDM,
  sendConversationMessage,
} from '@/modules/communication/services/conversation-service';

const ana = { id: 'user-ana', name: 'Dr. Ana Deng' };
const ben = { id: 'user-ben', name: 'Nurse Ben Lado' };
const cal = { id: 'user-cal', name: 'Dr. Cal Wani' };
const ctx = { hospitalId: 'hosp-1', hospitalName: 'Juba Teaching', orgId: 'org-a' };
const scope: DataScope = { role: 'doctor', orgId: 'org-a', hospitalId: 'hosp-1' };

function say(conv: ConversationDoc, from: typeof ana, body: string) {
  return sendConversationMessage({
    conversationId: conv._id, conversationName: 'chat', fromId: from.id, fromName: from.name, body, ...ctx,
  });
}

/** A message that replicated in without the conversation document's update. */
function arrive(conv: ConversationDoc, from: typeof ana, body: string, sentAt: string) {
  return createMessage({
    recipientType: 'staff', direction: 'staff_to_staff', conversationId: conv._id,
    patientId: '', patientName: '', patientPhone: '',
    fromDoctorId: from.id, fromDoctorName: from.name, fromHospitalName: ctx.hospitalName,
    subject: '', body, channel: 'app', sentAt, readBy: [from.id], orgId: ctx.orgId,
  });
}

afterEach(async () => { await teardownTestDBs(); });

test('a group with the newest message sits above an older direct message', async () => {
  const dm = await getOrCreateDM(ana, ben, ctx);
  const group = await createGroup({ name: 'Ward 3', participants: [ben, cal], createdBy: ana, ...ctx });
  await arrive(dm, ben, 'older', '2026-10-17T08:00:00.000Z');
  await arrive(group, cal, 'newer', '2026-10-17T09:00:00.000Z');

  const list = await getConversationsForUser(ana.id, scope);
  expect(list.map(c => c._id)).toEqual([group._id, dm._id]);
  expect(list[0].lastMessagePreview).toBe('newer');
  expect(list[0].lastMessageFromName).toBe(cal.name);
});

test('a message that arrived without its conversation update still moves the list', async () => {
  const dm = await getOrCreateDM(ana, ben, ctx);
  const dm2 = await getOrCreateDM(ana, cal, ctx);
  await say(dm, ben, 'first');
  await say(dm2, cal, 'second');
  // Ben writes again, but only the message reaches this device.
  await arrive(dm, ben, 'latest from Ben', new Date(Date.now() + 60_000).toISOString());

  const list = await getConversationsForUser(ana.id, scope);
  expect(list[0]._id).toBe(dm._id);
  expect(list[0].lastMessagePreview).toBe('latest from Ben');
});

describe('message text never sits on the conversation document', () => {
  test('sending stores the time and sender, not the text', async () => {
    const dm = await getOrCreateDM(ana, ben, ctx);
    await say(dm, ana, 'Patient in bed 4 is febrile');
    const stored = await conversationsDB().get(dm._id) as ConversationDoc;
    expect(stored.lastMessageAt).toEqual(expect.any(String));
    expect(stored.lastMessageFromName).toBe(ana.name);
    expect(JSON.stringify(stored)).not.toContain('febrile');
  });

  test('a plaintext copy left by an older version is ignored, then dropped on the next write', async () => {
    const dm = await getOrCreateDM(ana, ben, ctx);
    const legacy = await conversationsDB().get(dm._id) as ConversationDoc;
    await conversationsDB().put({ ...legacy, lastMessagePreview: 'old plaintext copy' });

    const [listed] = await getConversationsForUser(ana.id, scope);
    expect(listed.lastMessagePreview).toBeUndefined();

    await say(dm, ben, 'new');
    const stored = await conversationsDB().get(dm._id) as ConversationDoc;
    expect(stored.lastMessagePreview).toBeUndefined();
  });
});

test('a thread reads oldest-first however its messages arrived', async () => {
  const dm = await getOrCreateDM(ana, ben, ctx);
  await arrive(dm, ben, 'b', '2026-10-17T09:00:00.000Z');
  await arrive(dm, ana, 'a', '2026-10-17T08:00:00.000Z');
  const thread = await getConversationMessages(dm._id, ana.id);
  expect(thread.map(m => m.body)).toEqual(['a', 'b']);
});
