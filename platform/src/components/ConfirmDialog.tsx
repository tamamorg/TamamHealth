'use client';

/**
 * "Are you sure?" as one shared, awaitable dialog.
 *
 * Two things were wrong with how the app asked. Some destructive actions did
 * not ask at all — a mis-tapped bin icon deleted an uploaded document outright
 * — and the ones that did asked with `window.confirm`, which renders as a bare
 * browser alert in the wrong typeface, cannot say which record it is about
 * without cramming it into one line, and is suppressible by the browser after
 * repeated use. In a clinic, on a shared machine, a stray tap should cost a
 * click to undo, not a record.
 *
 * Used as a promise so the calling code keeps reading top-to-bottom:
 *
 *     const confirm = useConfirm();
 *     if (!await confirm({ title: 'Delete this document?', tone: 'danger' })) return;
 *     await remove(doc._id);
 *
 * The dialog focuses CANCEL, not the destructive button. A clinician clearing a
 * dialog with the keyboard should land on the harmless answer by default; the
 * dangerous one is worth reaching for deliberately.
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import Modal from '@/components/Modal';
import { AlertTriangle } from '@/components/icons/lucide';

export interface ConfirmOptions {
  /** The question, e.g. "Delete this document?" */
  title: string;
  /** What it means — name the record and say what cannot be undone. */
  message?: ReactNode;
  /** Verb for the action itself ("Delete", "Cancel appointment"). */
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` paints the action red; use it whenever data is destroyed. */
  tone?: 'danger' | 'default';
}

/** `useConfirmPrompt` — a confirm that also collects WHY. For the audited
 *  actions whose trail is worthless without a stated reason (ending an
 *  assignment, sending a visit back). Same dialog, plus one field. */
export interface ConfirmPromptOptions extends ConfirmOptions {
  /** Label over the reason field. */
  inputLabel?: string;
  inputPlaceholder?: string;
  /** When true the action button stays disabled until a reason is typed —
   *  the caller has decided this trail entry is not optional. */
  inputRequired?: boolean;
}

type Pending =
  | (ConfirmOptions & { kind: 'confirm'; resolve: (ok: boolean) => void })
  | (ConfirmPromptOptions & { kind: 'prompt'; resolve: (reason: string | null) => void });

const ConfirmContext = createContext<{
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  confirmPrompt: (options: ConfirmPromptOptions) => Promise<string | null>;
} | null>(null);

/**
 * Mounted once by the app shell. Any component below it can call `useConfirm()`
 * — the dialog is rendered here so it is never trapped inside a panel's
 * stacking context or unmounted mid-question by the row it belongs to.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState('');
  // Held in a ref as well so a second request cannot strand the first caller's
  // promise unresolved — awaiting a promise that never settles hangs the
  // handler that was mid-save.
  const pendingRef = useRef<Pending | null>(null);

  const cancelPending = useCallback(() => {
    const held = pendingRef.current;
    if (!held) return;
    if (held.kind === 'confirm') held.resolve(false);
    else held.resolve(null);
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    cancelPending();
    const next: Pending = { ...options, kind: 'confirm', resolve };
    pendingRef.current = next;
    setPending(next);
  }), [cancelPending]);

  const confirmPrompt = useCallback((options: ConfirmPromptOptions) => new Promise<string | null>((resolve) => {
    cancelPending();
    const next: Pending = { ...options, kind: 'prompt', resolve };
    pendingRef.current = next;
    setReason('');
    setPending(next);
  }), [cancelPending]);

  // Modal moves focus to its own panel once mounted, which lands a render after
  // this content commits — so `autoFocus` here was silently overridden. Claim
  // the focus on the next tick instead, deliberately putting the keyboard on
  // the harmless answer rather than leaving it on the panel.
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => cancelRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [pending]);

  const settle = useCallback((accepted: boolean, reasonText = '') => {
    const held = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    if (!held) return;
    if (held.kind === 'confirm') held.resolve(accepted);
    else held.resolve(accepted ? reasonText.trim() : null);
  }, []);

  const reasonMissing = pending?.kind === 'prompt' && !!pending.inputRequired && reason.trim().length === 0;
  const contextValue = useMemo(() => ({ confirm, confirmPrompt }), [confirm, confirmPrompt]);

  return (
    <ConfirmContext.Provider value={contextValue}>
      {children}
      {pending && (
        <Modal onClose={() => settle(false)} width={440} labelledBy="confirm-dialog-title">
          <div className="confirm-dialog">
            <div className="confirm-dialog-head">
              {pending.tone === 'danger' && (
                <span className="confirm-dialog-icon" aria-hidden>
                  <AlertTriangle className="w-5 h-5" />
                </span>
              )}
              <h2 id="confirm-dialog-title">{pending.title}</h2>
            </div>
            {pending.message && <div className="confirm-dialog-body">{pending.message}</div>}
            {pending.kind === 'prompt' && (
              <div className="confirm-dialog-body" style={{ paddingTop: 0 }}>
                <label htmlFor="confirm-dialog-reason" style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                  {pending.inputLabel || 'Reason'}{pending.inputRequired ? '' : ' (optional)'}
                </label>
                <textarea
                  id="confirm-dialog-reason"
                  className="fs-input"
                  rows={2}
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder={pending.inputPlaceholder}
                  style={{ width: '100%', fontSize: 13 }}
                />
              </div>
            )}
            <div className="confirm-dialog-actions">
              <button
                type="button"
                className="btn btn-secondary"
                ref={cancelRef}
                onClick={() => settle(false)}
              >
                {pending.cancelLabel || 'Cancel'}
              </button>
              <button
                type="button"
                className={pending.tone === 'danger' ? 'btn btn-danger' : 'btn btn-primary'}
                disabled={reasonMissing}
                onClick={() => settle(true, reason)}
              >
                {pending.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

/**
 * Ask before doing something irreversible. Resolves true when the user agrees.
 *
 * Outside a provider it resolves FALSE rather than throwing or silently
 * proceeding: a missing provider must never be the reason a record is deleted
 * without being asked about.
 */
export function useConfirm(): (options: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  const fallback = useMemo(() => async () => false, []);
  return ctx?.confirm ?? fallback;
}

/**
 * Confirm an audited action AND collect the reason for its trail. Resolves
 * with the trimmed reason on confirm, `null` on cancel — so `if (reason ===
 * null) return;` reads the same way the boolean confirm does. Outside a
 * provider it resolves null for the same fail-closed rationale as above.
 */
export function useConfirmPrompt(): (options: ConfirmPromptOptions) => Promise<string | null> {
  const ctx = useContext(ConfirmContext);
  const fallback = useMemo(() => async () => null, []);
  return ctx?.confirmPrompt ?? fallback;
}
