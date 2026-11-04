'use client';

/**
 * The title/detail split every notification uses. Kept out of Toast.tsx so a
 * test that mocks the toast module whole does not take it with it.
 *
 * This file also held the registry that routed a form's errors into the form
 * (FormNotices). Every notification now shows in the bottom-left stack, so
 * that registry is gone.
 */

/** Titles that end in these are not a sentence break ("Dr. Igga…"). */
const NOT_A_SENTENCE_END = /\b(?:Dr|Mr|Mrs|Ms|St|No|vs|e\.g|i\.e|approx)$/i;

/**
 * The bold first line and the detail under it. A caller's `title` wins;
 * otherwise a message written to the house style — "Condition not deleted.
 * Try again." — splits at its first sentence, so the outcome reads as the
 * title and the next step as the detail. A one-sentence message stays whole.
 */
export function splitNotice(message: string, title?: string): { title?: string; message: string } {
  if (title) return { title, message };
  const match = /^(.{8,140}?)\.\s+(\S[\s\S]*)$/.exec(message.trim());
  if (!match || NOT_A_SENTENCE_END.test(match[1])) return { message };
  return { title: match[1], message: match[2] };
}
