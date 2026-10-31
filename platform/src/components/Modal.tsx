'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { stopsClickPropagation } from '@/lib/a11y';
import { useHistoryLayer } from '@/lib/navigation/history-layer';

/**
 * Named widths, so two dialogs holding the same kind of content are the same
 * width. `sm` asks a question (440); `md` edits one record (560); `lg` holds
 * a short form with a list (720); `xl` is a two-pane editor (960); `2xl` is a
 * clinical workspace (1180); `full` takes the viewport less its gutter.
 * The pixel values live in globals.css as `--dialog-w-*`.
 */
export type DialogSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';

const SIZE_WIDTH: Record<DialogSize, string> = {
  sm: 'var(--dialog-w-sm)',
  md: 'var(--dialog-w-md)',
  lg: 'var(--dialog-w-lg)',
  xl: 'var(--dialog-w-xl)',
  '2xl': 'var(--dialog-w-2xl)',
  full: 'min(1400px, 100%)',
};

interface ModalProps {
  onClose: () => void;
  children: React.ReactNode;
  /** Max width of the dialog in px. Default 600. Prefer `size`. */
  width?: number;
  /** Named width preset; wins over `width` when both are given. */
  size?: DialogSize;
  /**
   * Layout variant. 'dialog' (default) is the centered popup; 'drawer' slides
   * in as a full-height panel anchored to the right edge of the screen.
   * 'slider' is the OpenMRS O3 workspace the patient chart uses: docked to the
   * right edge under the top rail, no dimming, the page beside it still
   * readable and scrollable — for record-entry forms (admit, register a
   * birth, record a vaccination). Escape and the form's own close dismiss it.
   */
  variant?: 'dialog' | 'drawer' | 'slider';
  /** When true, clicking the backdrop does not close the modal. Default false. */
  disableBackdropClose?: boolean;
  /** id of the element labelling the dialog (for a11y). */
  labelledBy?: string;
  /** id of the element describing the dialog — its lead paragraph. */
  describedBy?: string;
  /** Extra class on the dialog surface, so a host surface (the patient chart,
   *  say) can restyle the controls inside a portal that renders outside it. */
  className?: string;
}

/**
 * Which open modal is on top.
 *
 * Every modal listens for Escape on the window, and each used to answer it —
 * so a dialog opened from a dialog (a confirm over an editor, the
 * text-to-patient composer over the prescription handover over the prescribing
 * dialog) closed the whole stack on one keypress, and the Tab trap of the one
 * underneath fought the one on top. Only the newest modal handles keys now.
 *
 * The order is taken at first render, not in an effect: effects run
 * child-first, so a modal mounted in the same commit as its parent would
 * otherwise register below it.
 */
let modalSequence = 0;
const openModals = new Set<number>();
/** How many open modals hold the body scroll lock, and what it replaces. */
/** Sliders open right now, oldest first: the newest sets the page's squeeze. */
let openSliders: number[] = [];
let scrollLocks = 0;
let overflowBeforeLock = '';
/** True while any modal is open — lets a docked workspace underneath leave
 *  Escape to the dialog, so one keypress closes only the top layer. */
export function isAnyModalOpen(): boolean {
  return openModals.size > 0;
}

function isTopModal(sequence: number): boolean {
  for (const other of openModals) if (other > sequence) return false;
  return true;
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
  size,
  variant = 'dialog',
  disableBackdropClose = false,
  labelledBy,
  describedBy,
  className,
}: ModalProps) {
  const isSlider = variant === 'slider';
  // Back (phone, tablet, browser) closes this dialog or slider: it holds one
  // history entry while open, removed again when it closes by its own
  // controls (lib/navigation/history-layer.ts).
  useHistoryLayer(true, onClose);
  const isDrawer = variant === 'drawer' || isSlider;
  const [mounted, setMounted] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const backdropArmedRef = useRef(false);
  // Taken in the first render (a lazy initialiser), so a parent is always
  // numbered before a modal it renders — see `isTopModal`.
  const [sequence] = useState(() => ++modalSequence);

  useEffect(() => {
    openModals.add(sequence);
    return () => { openModals.delete(sequence); };
  }, [sequence]);

  // Portals require the DOM — only render after mount (also keeps SSR happy).
  useEffect(() => { setMounted(true); }, []);

  // Lock background scroll while any modal is open. Counted rather than
  // saved-and-restored: with two modals stacked, the lower one closing first
  // restored '' and the upper one then "restored" the 'hidden' it had seen on
  // mount — leaving the page unscrollable with nothing open.
  // A slider sits beside the page rather than over it, so the page stays
  // scrollable.
  useEffect(() => {
    if (isSlider) return;
    if (scrollLocks === 0) overflowBeforeLock = document.body.style.overflow;
    scrollLocks += 1;
    document.body.style.overflow = 'hidden';
    return () => {
      scrollLocks -= 1;
      if (scrollLocks === 0) document.body.style.overflow = overflowBeforeLock;
    };
  }, [isSlider]);

  // A slider docks beside the page and the page makes room for it — the
  // squeeze the patient chart's Record vitals workspace does — instead of
  // covering the right-hand part of the page. The open slider's width is
  // published on <html> (`--slider-open-w` + `tm-slider-open`), and
  // globals.css narrows #main-content by it. Measured live, so a slider that
  // widens (the lab wizard's second step) pushes the page with it. With
  // sliders stacked, the newest one sets the width.
  useEffect(() => {
    if (!isSlider || !mounted) return;
    const el = dialogRef.current;
    if (!el) return;
    const root = document.documentElement;
    const publish = () => {
      if (openSliders[openSliders.length - 1] !== sequence) return;
      root.style.setProperty('--slider-open-w', `${Math.round(el.getBoundingClientRect().width)}px`);
    };
    openSliders.push(sequence);
    root.classList.add('tm-slider-open');
    publish();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(publish) : null;
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      openSliders = openSliders.filter(id => id !== sequence);
      if (openSliders.length === 0) {
        root.classList.remove('tm-slider-open');
        root.style.removeProperty('--slider-open-w');
      }
    };
  }, [isSlider, mounted, sequence]);

  // Esc closes and Tab stays inside the active dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A modal with another open above it leaves the keyboard to that one.
      if (!isTopModal(sequence)) return;
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
  }, [onClose, sequence]);

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
    // The backdrop's click-to-dismiss is a pointer shortcut for a keyboard
    // path that already exists: Escape closes the dialog (see the keydown
    // listener above). There is nothing here for a key handler to add.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events
    <div
      className={isSlider ? 'modal-portal-backdrop modal-portal-backdrop--slider' : 'modal-portal-backdrop tm-motion tm-motion--backdrop'}
      onMouseDown={disableBackdropClose ? undefined : e => {
        // Arm only when the press STARTS on the backdrop. A drag that begins
        // inside the dialog (selecting text in a field) and releases over the
        // backdrop used to fire the backdrop's onClick and close the form.
        backdropArmedRef.current = e.target === e.currentTarget;
      }}
      onClick={disableBackdropClose ? undefined : e => {
        if (e.target !== e.currentTarget) return;
        if (!backdropArmedRef.current) return;
        backdropArmedRef.current = false;
        // A form the user has typed into does not vanish on a stray click.
        // `value !== defaultValue` is exactly "modified since first render"
        // for the text-like controls where the loss actually hurts; Esc and
        // the form's own Cancel still close unconditionally, so this blocks
        // nothing deliberate. Verified the hard way: a half-filled facility
        // registration closed on a click that missed the submit button by a
        // few pixels, silently, with every field lost.
        const dialog = dialogRef.current;
        if (dialog) {
          const dirty = Array.from(
            dialog.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'),
          ).some(el => {
            if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
              return el.checked !== el.defaultChecked;
            }
            return el.value !== el.defaultValue;
          });
          if (dirty) return;
        }
        onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        display: 'flex',
        alignItems: isDrawer ? 'stretch' : 'center',
        justifyContent: isDrawer ? 'flex-end' : 'center',
        padding: isDrawer
          ? 0
          : 'calc(16px + env(safe-area-inset-top, 0px) + var(--app-overlay-top-inset, 0px)) calc(16px + env(safe-area-inset-right, 0px)) calc(16px + env(safe-area-inset-bottom, 0px)) calc(16px + env(safe-area-inset-left, 0px))',
        background: isSlider ? 'transparent' : 'rgba(15, 31, 29, 0.70)',
        // A slider leaves the page usable: only the panel takes pointer input.
        pointerEvents: isSlider ? 'none' : undefined,
        // Always set: an undefined `top` after `inset` clears inset's top, the
        // backdrop falls back to `top: auto`, and on the chart page that left
        // the patient banner undimmed above a centred dialog.
        top: isSlider ? 'var(--app-slider-top)' : 0,
        overflowY: isDrawer ? 'hidden' : 'auto',
      }}
    >
      <div
        ref={dialogRef}
        // `tm-elevated` lets the dialog keep its shadow through the flat
        // baseline; `tm-motion--*` is its entrance, on the motion tokens.
        className={[
          'modal-portal-dialog',
          'tm-elevated',
          'tm-motion',
          isDrawer ? 'tm-motion--drawer modal-portal-dialog--drawer' : 'tm-motion--dialog',
          isSlider && 'tm-slider',
          // A form wider than a side panel (triage, ANC, the lab wizard). On a
          // dashboard a slider docks over the right panel; one this wide keeps
          // its width there rather than being crushed to the panel's.
          isSlider && ((width ?? 0) > 560 || size === 'lg' || size === 'xl' || size === '2xl' || size === 'full') && 'tm-slider--wide',
          className,
        ].filter(Boolean).join(' ')}
        // Spread first: this element is a real dialog, so its own role and tab
        // behaviour must win over the helper's presentational defaults. All it
        // borrows is the refusal to forward a click to the backdrop.
        {...stopsClickPropagation}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        style={{
          // A slider is as wide as the form asked for (a wide booking grid or
          // the lab wizard needs it); globals.css caps it at the screen.
          ...(isSlider && (size || width) ? { ['--slider-w' as string]: size ? SIZE_WIDTH[size] : `${width}px` } : {}),
          width: '100%',
          maxWidth: size ? SIZE_WIDTH[size] : width,
          maxHeight: isSlider
            ? 'calc(100dvh - var(--app-slider-top))'
            : isDrawer
              ? '100dvh'
              : 'calc(100dvh - 32px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - var(--app-overlay-top-inset, 0px))',
          height: isSlider ? 'calc(100dvh - var(--app-slider-top))' : isDrawer ? '100dvh' : undefined,
          pointerEvents: isSlider ? 'auto' : undefined,
          display: 'flex',
          flexDirection: 'column',
          overflowY: isDrawer ? 'hidden' : 'auto',
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
          // it sits invisibly behind them. The radius is `--radius-overlay`,
          // the same token the `.modal-portal-backdrop > div > *` rule in
          // globals.css forces on every child, so the two edges align exactly
          // instead of leaving square corners poking out behind a rounded
          // child.
          background: 'var(--bg-card-solid)',
          // A drawer is flush to the screen edge, so it stays square.
          borderRadius: isDrawer ? 0 : 'var(--radius-overlay)',
          margin: 0,
        }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
