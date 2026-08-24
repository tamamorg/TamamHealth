'use client';

import { useCallback, useEffect, useRef } from 'react';

const DEFAULT_MESSAGE = 'This clinical entry still has unsaved changes. Leave this page?';

/**
 * Protect an active form from browser reloads and ordinary in-app links.
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
  dirtyRef.current = isDirty;
  messageRef.current = message;

  const hasUnsavedChanges = useCallback(() => {
    const value = dirtyRef.current;
    return typeof value === 'function' ? value() : value;
  }, []);

  const confirmNavigation = useCallback(() => (
    !hasUnsavedChanges() || window.confirm(messageRef.current)
  ), [hasUnsavedChanges]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges()) return;
      event.preventDefault();
      // Required by older browsers; modern browsers deliberately show their
      // own localized text rather than exposing clinical content here.
      event.returnValue = '';
    };

    const onDocumentClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0
        || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
        || !hasUnsavedChanges()) return;

      const target = event.target;
      const link = target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;

      const destination = new URL(link.href, window.location.href);
      const current = new URL(window.location.href);
      if (destination.href === current.href
        || (destination.origin === current.origin
          && destination.pathname === current.pathname
          && destination.search === current.search)) return;

      if (!window.confirm(messageRef.current)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onDocumentClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onDocumentClick, true);
    };
  }, [hasUnsavedChanges]);

  return { confirmNavigation, hasUnsavedChanges };
}

