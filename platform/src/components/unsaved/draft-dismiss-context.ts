'use client';

import { createContext, useContext } from 'react';

/**
 * Lets a dialog's own close button (DialogHeader's X) tell the draft keeper of
 * the popup it sits in that the user dismissed it, rather than saved or
 * cancelled — so text typed there is kept for when the form is reopened.
 */
export const DraftDismissContext = createContext<(() => void) | null>(null);

export function useMarkDraftDismissed(): () => void {
  const mark = useContext(DraftDismissContext);
  return mark ?? noop;
}

function noop() { /* outside a draft region */ }
