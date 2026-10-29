'use client';

/**
 * The registry that lets a form take its own errors (FormNotices) and the
 * title/detail split every notification uses. Kept out of Toast.tsx so a
 * test that mocks the toast module whole does not take these with it.
 */

import { createContext, useContext } from 'react';

/** A notice handed to a form's inline slot instead of the corner. */
export interface RoutedNotice {
  id: number;
  type: 'error' | 'warning';
  title?: string;
  message: string;
}

export interface NoticeHost {
  el: HTMLElement;
  push: (notice: RoutedNotice) => void;
}

export const NoticeHostContext = createContext<{ register: (host: NoticeHost) => () => void } | null>(null);

/** For FormNotices: register a form surface that takes its own errors. */
export function useNoticeHosts() {
  return useContext(NoticeHostContext);
}

/** How recently the user must have acted inside a form for an error to be
 *  read as that form's — long enough for a slow offline save to come back. */
export const RELATED_WINDOW_MS = 20000;

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
