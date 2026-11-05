'use client';

import { useEffect } from 'react';

/**
 * Global textarea auto-resize: listens for input events on all textareas
 * and adjusts their height to fit content. Also allows manual resize via drag.
 * This is a fallback for browsers that don't support CSS `field-sizing: content`.
 */
export default function TextareaAutoResize() {
  useEffect(() => {
    function handleInput(e: Event) {
      const target = e.target;
      if (target instanceof HTMLTextAreaElement) {
        // Skip if the textarea explicitly opts out
        if (target.dataset.noAutoresize) return;
        target.style.height = 'auto';
        target.style.height = target.scrollHeight + 'px';
      }
    }

    // `data-single-line`: a field that is one line of a fixed format (a
    // death certificate's cause lines) grows to show long text but never
    // takes a line break — Enter does nothing and a pasted break becomes a
    // space — so the printed certificate and the DHIS2 export keep one cause
    // per line.
    const singleLine = (target: EventTarget | null): target is HTMLTextAreaElement =>
      target instanceof HTMLTextAreaElement && target.dataset.singleLine !== undefined;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Enter' && singleLine(e.target)) e.preventDefault();
    }
    function handlePaste(e: ClipboardEvent) {
      if (!singleLine(e.target)) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (!/[\r\n]/.test(text)) return;
      e.preventDefault();
      // insertText keeps the browser's undo stack and fires the input event
      // React listens to.
      document.execCommand('insertText', false, text.replace(/\s*[\r\n]+\s*/g, ' ').trim());
    }

    document.addEventListener('input', handleInput, { passive: true });
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('paste', handlePaste);
    return () => {
      document.removeEventListener('input', handleInput);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('paste', handlePaste);
    };
  }, []);

  return null;
}
