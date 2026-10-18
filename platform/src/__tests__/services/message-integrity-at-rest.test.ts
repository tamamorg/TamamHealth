/**
 * Encrypted messages must still pass the sync gateway's message-integrity rule
 * (lib/sync/message-integrity.ts), which compares STORED values exactly.
 *
 * Two writes broke once text was sealed at rest, because each one re-sealed
 * text it had not changed and fresh envelopes never match the stored ones:
 *   - a non-author's status update (front desk triaging an enquiry, an admin
 *     triaging an issue report) read as rewriting the message;
 *   - an author's edit read as rewriting the message's history.
 * Both are checked here against what actually reaches storage.
 */
import { createDBMock, rawTestDB, teardownTestDBs } from '../helpers/test-db';

jest.mock('@/lib/db', () => createDBMock());
jest.mock('@/lib/services/sync-event-service', () => ({ emitSyncEvent: jest.fn() }));

import type { ConversationDoc } from '@/lib/db-types';
import { messageIntegrityViolation } from '@/lib/sync/message-integrity';
import { isOrgEncrypted } from '@/lib/org-data-cipher';
import { createMessage, updateMessage } from '@/modules/communication/services/message-service';
import { editMessage, getOrCreateDM, sendConversationMessage } from '@/modules/communication/services/conversation-service';
import { setEnquiryStatus } from '@/lib/services/enquiry-service';

const raw = async (id: string) => await rawTestDB('tamamhealth_messages').get(id) as unknown as Record<string, unknown>;

afterEach(async () => { await teardownTestDBs(); });

test("a non-author's status update keeps the sealed text byte-for-byte", async () => {
  const msg = await createMessage({
    recipientType: 'staff', direction: 'patient_to_staff', patientId: 'pat-1', patientName: 'Achol Deng',
    patientPhone: '', fromDoctorId: 'patient', fromDoctorName: 'Achol Deng', fromHospitalName: 'Juba',
    subject: 'Refill', body: 'I need my blood pressure tablets', channel: 'app', sentAt: new Date().toISOString(), orgId: 'org-a',
  });
  const before = await raw(msg._id);
  expect(isOrgEncrypted(before.body)).toBe(true);

  await setEnquiryStatus(msg._id, 'contacted');
  const after = await raw(msg._id);

  expect(after.body).toBe(before.body);
  expect(after.subject).toBe(before.subject);
  expect(after.enquiryStatus).toBe('contacted');
  expect(messageIntegrityViolation(after, before, 'user-front-desk')).toBeNull();
});

test("an author's edit keeps the earlier wording byte-for-byte in its history", async () => {
  const ana = { id: 'user-ana', name: 'Dr. Ana' };
  const ben = { id: 'user-ben', name: 'Nurse Ben' };
  const conv = await getOrCreateDM(ana, ben, { orgId: 'org-a' }) as ConversationDoc;
  const msg = await sendConversationMessage({
    conversationId: conv._id, conversationName: 'chat', fromId: ana.id, fromName: ana.name, body: 'Give 5 mg', orgId: 'org-a',
  });
  const before = await raw(msg._id);

  expect(await editMessage(msg._id, ana.id, 'Give 2.5 mg')).toBe(true);
  const after = await raw(msg._id);

  expect((after.editHistory as Array<{ body: string }>)[0].body).toBe(before.body);
  expect(after.body).not.toBe(before.body);
  expect(isOrgEncrypted(after.body)).toBe(true);
  expect(messageIntegrityViolation(after, before, ana.id)).toBeNull();
});

test('a status update on text this device cannot read keeps the stored envelope', async () => {
  const msg = await createMessage({
    recipientType: 'staff', direction: 'patient_to_staff', patientId: 'pat-1', patientName: 'X',
    patientPhone: '', fromDoctorId: 'patient', fromDoctorName: 'X', fromHospitalName: 'Juba',
    subject: 'S', body: 'B', channel: 'app', sentAt: new Date().toISOString(), orgId: 'org-a',
  });
  const before = await raw(msg._id);
  await updateMessage(msg._id, { body: '[Encrypted — sign in online once on this device to read it.]', enquiryStatus: 'closed' });
  expect((await raw(msg._id)).body).toBe(before.body);
});
