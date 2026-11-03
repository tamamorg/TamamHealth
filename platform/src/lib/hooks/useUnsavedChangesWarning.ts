'use client';

import { useCallback, useEffect, useRef } from 'react';
import { registerUnsavedSource } from '@/lib/unsaved/unsaved-registry';

const DEFAULT_MESSAGE = 'This clinical entry still has unsaved changes. Leave this page?';

/**
 * Protect an active form from browser reloads and in-app links to another
 * page. The prompts themselves live in lib/unsaved/unsaved-registry, shared
 * with every form's draft keeper, so the app asks once however many forms
 * hold work.
 *
 * `isDirty` may be a function so debounce queues held in refs can be checked
 * at navigation time without forcing a render for every keystroke.
 */
export function useUnsavedChangesWarning(
  isDirty: boolean | (() => boolean),
  message = DEFAULT_MESSAGE,
) {
  const dirtyRef = useRef(isDirty);
  const messageRef = useRef(message);
  // Refreshed after each render rather than during it. The registry reads
  // these when the browser asks — on a user gesture, long after the commit.
  useEffect(() => {
    dirtyRef.current = isDirty;
    messageRef.current = message;
  });

  const hasUnsavedChanges = useCallback(() => {
    const value = dirtyRef.current;
    return typeof value === 'function' ? value() : value;
  }, []);

  /** For a navigation the form starts itself (router.push). */
  const confirmNavigation = useCallback(() => (
    !hasUnsavedChanges() || window.confirm(messageRef.current)
  ), [hasUnsavedChanges]);

  useEffect(() => registerUnsavedSource(hasUnsavedChanges), [hasUnsavedChanges]);

  return { confirmNavigation, hasUnsavedChanges };
}
