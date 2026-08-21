'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  onClose: () => void;
  children: React.ReactNode;
  /** Max width of the dialog in px. Default 600. */
  width?: number;
  /** Vertical alignment of the dialog. Default 'center'. */
  align?: 'center' | 'top';
  /**
   * Layout variant. 'dialog' (default) is the centered popup; 'drawer' slides
   * in as a full-height panel anchored to the right edge of the screen.
   */
  variant?: 'dialog' | 'drawer';
  /** When true, clicking the backdrop does not close the modal. Default false. */
  disableBackdropClose?: boolean;
  /** id of the element labelling the dialog (for a11y). */
  labelledBy?: string;
  /**
   * Keeps the panel this far clear of the top of the viewport — a number of px
   * or any CSS length, e.g. `var(--app-overlay-top-inset)` to start it below
   * the app's top rail on the shells that have one. The backdrop still covers
   * the whole screen, so the modal
   * stays modal; only the panel moves down, and it centres in what is left.
   * Default 0 (the panel uses the full viewport height).
   */
  topOffset?: number | string;
}

/**
 * Centered, portal-rendered modal.
 *
 * Renders into <body> so its backdrop sits above the entire app — including the
 * sidebar — instead of being trapped inside the dashboard content area's
 * stacking context (which previously left the sidebar "popping" above the dim).
 * Use this for every popup so behaviour is consistent everywhere.
 *
 * Handles: Esc-to-close, backdrop-click-to-close, body scroll lock, a trapped
 * keyboard focus cycle, trigger-focus restoration, and the shared fade/slide
 * animations defined in globals.css.
 */
export default function Modal({
  onClose,
  children,
  width = 600,
  align = 'center',
  variant = 'dialog',
  disableBackdropClose = false,
  labelledBy,
  topOffset = 0,
}: ModalProps) {
  const isDrawer = variant === 'drawer';
  // A drawer is flush to the screen edges, so an offset never applies to one.
  const offset = isDrawer ? '0px' : typeof topOffset === 'number' ? `${topOffset}px` : topOffset;
  const [mounted, setMounted] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // Portals require the DOM — only render after mount (also keeps SSR happy).
  useEffect(() => { setMounted(true); }, []);

  // Lock background scroll while the modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Esc closes and Tab stays inside the active dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter(element => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true');

      if (focusable.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Move focus into the dialog, then return it to the control that opened the
  // popup. This preserves a user's place in dense clinical worklists.
  useEffect(() => {
    if (!mounted) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const dialog = dialogRef.current;
    const initialFocus = dialog?.querySelector<HTMLElement>('[autofocus], [data-modal-initial-focus]');
    (initialFocus ?? dialog)?.focus();

    return () => {
      const returnTarget = returnFocusRef.current;
      if (returnTarget?.isConnected) returnTarget.focus();
    };
  }, [mounted]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="modal-portal-backdrop"
      onClick={disableBackdropClose ? undefined : onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        display: 'flex',
        alignItems: isDrawer ? 'stretch' : align === 'top' ? 'flex-start' : 'center',
        justifyContent: isDrawer ? 'flex-end' : 'center',
        padding: isDrawer ? 0 : `calc(16px + ${offset}) 16px 16px`,
        background: 'rgba(8, 87, 58, 0.70)',
        animation: 'modalFadeIn 0.2s ease-out',
        overflowY: isDrawer ? 'hidden' : 'auto',
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: width,
          maxHeight: isDrawer ? '100vh' : `calc(100vh - 32px - ${offset})`,
          height: isDrawer ? '100vh' : undefined,
          display: 'flex',
          flexDirection: 'column',
          outline: 'none',
          // Opaque panel, supplied HERE rather than trusted to every caller.
          //
          // This component previously styled only the backdrop and left the
          // dialog surface to whatever the caller passed as children. 33 of 50
          // call sites supplied one (`modal-panel` / `card-elevated`); the
          // other 17 did not, and rendered fully transparent — the dimmed page
          // showed straight through the form. The transfer dialog was the
          // reported case; allergies, photo capture, and several chart
          // sections had the same defect.
          //
          // Callers that already provide their own surface are unaffected:
          // `--bg-card-solid` is the same token their classes resolve to, so
          // it sits invisibly behind them. The 6px radius matches the
          // `.modal-portal-backdrop > div > *` rule in globals.css that forces
          // every child to 6px, so the two edges align exactly instead of
          // leaving square corners poking out behind a rounded child.
          background: 'var(--bg-card-solid)',
          // A drawer is flush to the screen edge, so it stays square.
          borderRadius: isDrawer ? 0 : 6,
          margin: isDrawer ? 0 : align === 'top' ? '24px 0' : 0,
          animation: isDrawer ? 'modalSlideInRight 0.28s ease-out' : 'modalSlideUp 0.25s ease-out',
        }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
