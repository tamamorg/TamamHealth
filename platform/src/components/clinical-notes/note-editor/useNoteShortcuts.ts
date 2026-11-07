import { useEffect, useRef } from 'react';

/**
 * Keyboard: Ctrl/Cmd+S saves the draft, Ctrl/Cmd+Enter opens the sign
 * confirm. Ignored while any other dialog is up — the shortcut belongs to
 * the note, not to whatever popup is in front of it.
 *
 * The ref-refresh effect (no deps, every render) and the one-time listener
 * effect keep their original order.
 */
export function useNoteShortcuts(opts: {
  save: () => Promise<void>;
  sign: () => void;
  blocked: boolean;
  signBlocked: boolean;
}) {
  const keyActions = useRef({ save: opts.save, sign: opts.sign, blocked: false, signBlocked: false });
  useEffect(() => {
    keyActions.current = {
      save: opts.save,
      sign: opts.sign,
      blocked: opts.blocked,
      signBlocked: opts.signBlocked,
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const k = keyActions.current;
      if (k.blocked) return;
      // A dialog that is not the one hosting this editor (a chart popup over a
      // drawer, say) owns the keyboard while focus is inside it.
      const dialog = (document.activeElement as HTMLElement | null)?.closest('[role="dialog"],[aria-modal="true"]');
      if (dialog && !dialog.querySelector('.cn-editor')) return;
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        void k.save();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (!k.signBlocked) k.sign();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
