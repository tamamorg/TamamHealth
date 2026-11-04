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
import { AlertTriangle, HelpCircle } from '@/components/icons/lucide';
import { DialogBody, DialogFooter, DialogFrame, DialogHeader } from '@/components/overlay/Dialog';
import FormField from '@/components/overlay/FormField';
import { useTranslation } from '@/lib/i18n/useTranslation';

export interface ConfirmOptions {
  /** The question, e.g. "Delete this document?" */
  title: string;
  /** What it means — name the record and say what cannot be undone. */
  message?: ReactNode;
  /** Verb for the action itself ("Delete", "Cancel appointment"). */
  confirmLabel?: string;
  cancelLabel?: string;
  /** A third answer beside Cancel and the action, for a question with two real
   *  ways forward ("Continue draft" / "Start a new note"). Pressing it runs
   *  `onAlternate`, and the dialog resolves false like Cancel. */
  alternateLabel?: string;
  onAlternate?: () => void;
  /** `danger` paints the action red; use it whenever data is destroyed.
   *  `warning` marks a one-way door that destroys nothing (closing a visit,
   *  resetting settings). */
  tone?: 'danger' | 'warning' | 'default';
  /**
   * For the rare action whose cost is a whole record: the user must type
   * this word (the record's name, say) before the action button enables.
   * A click can be a slip; a typed name cannot.
   */
  typeToConfirm?: string;
  /** `slider` opens the question from the right like the chart's other
   *  workspaces. Normally left unset: the patient chart sets it for every
   *  question asked inside it (`ConfirmLayoutProvider`). An exit guard that
   *  sits over a slider passes `dialog` to stay centred. */
  layout?: 'dialog' | 'slider';
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

const ConfirmLayoutContext = createContext<'dialog' | 'slider'>('dialog');

/** Every question asked below this opens with `layout` unless it names its own. */
export function ConfirmLayoutProvider({ layout, children }: { layout: 'dialog' | 'slider'; children: ReactNode }) {
  return <ConfirmLayoutContext.Provider value={layout}>{children}</ConfirmLayoutContext.Provider>;
}

/**
 * Mounted once by the app shell. Any component below it can call `useConfirm()`
 * — the dialog is rendered here so it is never trapped inside a panel's
 * stacking context or unmounted mid-question by the row it belongs to.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
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
    setTyped('');
    setPending(next);
  }), [cancelPending]);

  const confirmPrompt = useCallback((options: ConfirmPromptOptions) => new Promise<string | null>((resolve) => {
    cancelPending();
    const next: Pending = { ...options, kind: 'prompt', resolve };
    pendingRef.current = next;
    setReason('');
    setTyped('');
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
  const typedMismatch = !!pending?.typeToConfirm
    && typed.trim().toLowerCase() !== pending.typeToConfirm.trim().toLowerCase();
  const contextValue = useMemo(() => ({ confirm, confirmPrompt }), [confirm, confirmPrompt]);

  const tone = pending?.tone === 'danger' ? 'danger' : pending?.tone === 'warning' ? 'warning' : 'plain';
  const hasBody = !!pending && (!!pending.message || pending.kind === 'prompt' || !!pending.typeToConfirm);
  const asSlider = pending?.layout === 'slider';

  return (
    <ConfirmContext.Provider value={contextValue}>
      {children}
      {pending && (
        <Modal
          onClose={() => settle(false)}
          variant={asSlider ? 'slider' : 'dialog'}
          pinnedLayer
          keepDraft={false}
          width={asSlider ? 560 : 480}
          labelledBy="confirm-dialog-title"
          describedBy={pending.message ? 'confirm-dialog-desc' : undefined}
          className={asSlider ? 'confirm-dialog confirm-dialog--slider tamam-dialog' : 'confirm-dialog'}
        >
          <DialogFrame>
            <DialogHeader
              titleId="confirm-dialog-title"
              title={pending.title}
              tone={tone}
              icon={tone === 'plain' ? <HelpCircle /> : <AlertTriangle />}
              onClose={() => settle(false)}
            />
            {hasBody && (
              <DialogBody tight>
                {pending.message && (
                  <div id="confirm-dialog-desc" className="confirm-dialog-body">{pending.message}</div>
                )}
                {pending.kind === 'prompt' && (
                  <FormField
                    id="confirm-dialog-reason"
                    label={pending.inputLabel || t('confirm.reason')}
                    required={!!pending.inputRequired}
                    optional={!pending.inputRequired}
                    className="confirm-dialog-field"
                  >
                    {control => (
                      <textarea
                        {...control}
                        className="fs-input"
                        rows={asSlider ? 4 : 2}
                        value={reason}
                        onChange={e => setReason(e.target.value)}
                        placeholder={pending.inputPlaceholder}
                      />
                    )}
                  </FormField>
                )}
                {pending.typeToConfirm && (
                  <FormField
                    id="confirm-dialog-typed"
                    label={t('confirm.typeToConfirm', { word: pending.typeToConfirm })}
                    className="confirm-dialog-field"
                  >
                    {control => (
                      <input
                        {...control}
                        className="fs-input"
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        value={typed}
                        onChange={e => setTyped(e.target.value)}
                      />
                    )}
                  </FormField>
                )}
              </DialogBody>
            )}
            <DialogFooter>
              <button
                type="button"
                className="btn btn-secondary"
                ref={cancelRef}
                // Modal's own focus pass lands here, so Cancel holds focus
                // from the first paint. The timeout above is the fallback for
                // the render where the portal is not yet in the document:
                // in a real browser the portal's focus pass can run AFTER a
                // zero-delay timer and would otherwise take focus back to
                // the panel.
                data-modal-initial-focus
                onClick={() => settle(false)}
              >
                {pending.cancelLabel || t('common.cancel')}
              </button>
              {pending.alternateLabel && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => { const choose = pending.onAlternate; settle(false); choose?.(); }}
                >
                  {pending.alternateLabel}
                </button>
              )}
              <button
                type="button"
                className={pending.tone === 'danger' ? 'btn btn-danger-solid' : 'btn btn-primary'}
                disabled={reasonMissing || typedMismatch}
                onClick={() => settle(true, reason)}
              >
                {pending.confirmLabel || t('action.confirm')}
              </button>
            </DialogFooter>
          </DialogFrame>
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
  const confirm = useContext(ConfirmContext)?.confirm;
  const layout = useContext(ConfirmLayoutContext);
  return useCallback(
    (options: ConfirmOptions) => (confirm ? confirm({ layout, ...options }) : Promise.resolve(false)),
    [confirm, layout],
  );
}

/**
 * Confirm an audited action AND collect the reason for its trail. Resolves
 * with the trimmed reason on confirm, `null` on cancel — so `if (reason ===
 * null) return;` reads the same way the boolean confirm does. Outside a
 * provider it resolves null for the same fail-closed rationale as above.
 */
export function useConfirmPrompt(): (options: ConfirmPromptOptions) => Promise<string | null> {
  const confirmPrompt = useContext(ConfirmContext)?.confirmPrompt;
  const layout = useContext(ConfirmLayoutContext);
  return useCallback(
    (options: ConfirmPromptOptions) => (confirmPrompt ? confirmPrompt({ layout, ...options }) : Promise.resolve(null)),
    [confirmPrompt, layout],
  );
}
