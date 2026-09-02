import type { NotificationItem } from './types';
import type { UnreadStaffMessageRow } from '../services/conversation-service';
import { abbreviateProviderName } from '@/lib/patient-utils';

function conversationTitle(row: UnreadStaffMessageRow): string {
  const { conversation, message } = row;
  if (conversation.kind === 'group') return conversation.name || 'Group conversation';
  return abbreviateProviderName(message.fromDoctorName) || 'Staff member';
}

/** Turn unread staff messages into the same rows used by the notification bell. */
export function messageNotificationItems(
  rows: UnreadStaffMessageRow[],
  limit: number,
): NotificationItem[] {
  return rows.slice(0, limit).map(({ conversation, message }) => {
    const sender = abbreviateProviderName(message.fromDoctorName) || 'Staff member';
    const preview = message.body.trim()
      || (message.attachments?.length ? `${message.attachments.length} attachment${message.attachments.length === 1 ? '' : 's'}` : 'New message');
    return {
      id: `message-${message._id}`,
      type: 'message',
      severity: 'info',
      title: `${sender} · Message`,
      subtitle: conversation.kind === 'group'
        ? `${conversationTitle({ conversation, message })} · ${preview}`
        : preview,
      time: message.sentAt || message.createdAt,
      href: `/messages?conversation=${encodeURIComponent(conversation._id)}`,
    };
  });
}
