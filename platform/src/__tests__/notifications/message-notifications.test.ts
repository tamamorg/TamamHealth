import type { ConversationDoc, MessageDoc } from '@/lib/db-types';
import {
  selectUnreadStaffMessages,
  type UnreadStaffMessageRow,
} from '@/modules/communication/services/conversation-service';
import { messageNotificationItems } from '@/modules/communication/notifications/message-items';

const conversation = (overrides: Partial<ConversationDoc> = {}): ConversationDoc => ({
  _id: 'conv-1',
  type: 'conversation',
  kind: 'dm',
  participantIds: ['user-me', 'user-sender'],
  participantNames: ['Nurse Adut', 'Dr. Chinonye Adaeze Eze'],
  createdByName: 'Nurse Adut',
  pinnedBy: [],
  createdAt: '2026-09-02T10:00:00.000Z',
  ...overrides,
  updatedAt: overrides.updatedAt || '2026-09-02T10:00:00.000Z',
});

const message = (overrides: Partial<MessageDoc> = {}): MessageDoc => ({
  _id: 'msg-1',
  type: 'message',
  recipientType: 'staff',
  direction: 'staff_to_staff',
  conversationId: 'conv-1',
  patientId: '',
  patientName: '',
  patientPhone: '',
  fromDoctorId: 'user-sender',
  fromDoctorName: 'Dr. Chinonye Adaeze Eze',
  fromHospitalName: 'Juba Teaching Hospital',
  subject: '',
  body: 'Please review the new result.',
  channel: 'app',
  status: 'sent',
  sentAt: '2026-09-02T12:00:00.000Z',
  createdAt: '2026-09-02T12:00:00.000Z',
  ...overrides,
  updatedAt: overrides.updatedAt || '2026-09-02T12:00:00.000Z',
});

describe('message notifications', () => {
  it('keeps only unread incoming messages from unmuted conversations', () => {
    const conversations = [conversation(), conversation({ _id: 'conv-muted', mutedBy: ['user-me'] })];
    const rows = selectUnreadStaffMessages(conversations, [
      message(),
      message({ _id: 'msg-read', readBy: ['user-me'] }),
      message({ _id: 'msg-mine', fromDoctorId: 'user-me' }),
      message({ _id: 'msg-deleted', deleted: true }),
      message({ _id: 'msg-muted', conversationId: 'conv-muted' }),
      message({ _id: 'msg-patient', direction: 'patient_to_staff' }),
    ], 'user-me');

    expect(rows.map(row => row.message._id)).toEqual(['msg-1']);
  });

  it('creates a name-first bell row and deep-links to the conversation', () => {
    const rows: UnreadStaffMessageRow[] = [{ conversation: conversation(), message: message() }];

    expect(messageNotificationItems(rows, 10)).toEqual([expect.objectContaining({
      id: 'message-msg-1',
      type: 'message',
      title: 'Dr. Chinonye Eze · Message',
      subtitle: 'Please review the new result.',
      href: '/messages?conversation=conv-1',
    })]);
  });

  it('includes the group name and respects the source limit', () => {
    const group = conversation({ kind: 'group', name: 'Ward A Team' });
    const rows: UnreadStaffMessageRow[] = [
      { conversation: group, message: message({ _id: 'msg-new', sentAt: '2026-09-02T13:00:00.000Z' }) },
      { conversation: group, message: message({ _id: 'msg-old' }) },
    ];

    const items = messageNotificationItems(rows, 1);
    expect(items).toHaveLength(1);
    expect(items[0].subtitle).toBe('Ward A Team · Please review the new result.');
  });
});
