/**
 * Staff-chat message rules that the service and the thread UI must agree on.
 *
 * Pure and store-free, so a client component can import them without pulling
 * the data layer behind it — the service enforces these, the UI only uses them
 * to decide which controls to offer.
 */
import type { MessageDoc } from '@/lib/db-types';

/** A staff member may edit their own message within this window. */
export const EDIT_WINDOW_MS = 15 * 60 * 1000;

/** What the conversation list shows in place of a removed message's text. */
export const REMOVED_MESSAGE_PREVIEW = 'Message removed';

/** Whether the author can still edit this message. */
export function isMessageEditable(
  message: Pick<MessageDoc, 'fromDoctorId' | 'deleted' | 'sentAt' | 'createdAt'>,
  userId: string,
  now: number = Date.now(),
): boolean {
  return message.fromDoctorId === userId
    && !message.deleted
    && now - new Date(message.sentAt || message.createdAt).getTime() <= EDIT_WINDOW_MS;
}
