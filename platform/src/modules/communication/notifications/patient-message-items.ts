import type { NotificationItem } from './types';
import type { MessageDoc } from '@/lib/db-types';
import { shortenPersonName } from '@/lib/patient-utils';

/**
 * A patient's unanswered portal message, as a row in the notification bell.
 * One row per patient — three messages from the same person are one thing to
 * do, and the row opens the conversation on their chart, where all three are.
 */
export function patientMessageNotificationItems(
  unanswered: readonly MessageDoc[],
  limit: number,
): NotificationItem[] {
  const seen = new Set<string>();
  const out: NotificationItem[] = [];
  for (const message of unanswered) {
    if (seen.has(message.patientId)) continue;
    seen.add(message.patientId);
    out.push({
      id: `patient-message-${message._id}`,
      type: 'message',
      severity: 'info',
      title: `${displayName(message.patientName)} · Patient message`,
      subtitle: preview(message.body),
      time: message.sentAt || message.createdAt,
      href: `/patients/${encodeURIComponent(message.patientId)}?tab=messages`,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** A patient can write a long message; the bell shows where it starts. */
const PREVIEW_LENGTH = 120;
function preview(body?: string): string {
  const text = (body || '').replace(/\s+/g, ' ').trim();
  if (!text) return 'New message';
  return text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH - 1)}…` : text;
}

function displayName(name?: string): string {
  return (name ? shortenPersonName(name) : '') || 'Patient';
}
