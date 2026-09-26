'use client';

/**
 * An accessible tooltip for icon-only controls.
 *
 * The rail carried its labels as `title` attributes, which the browser shows
 * after a second, in the OS typeface, never on a touch screen and never on
 * keyboard focus. A clinician tabbing along the rail got no label at all.
 *
 * This shows the same word on hover AND on focus, in the product's own
 * plate, after a short delay so it never flickers while the pointer crosses
 * the rail. It is described to assistive technology through
 * `aria-describedby` only while visible, so a control that already has an
 * `aria-label` is not announced twice with the same text. Escape hides it;
 * a press hides it (the press is the answer to the question it was asking).
 *
 * Wrap exactly one element that accepts mouse and focus handlers:
 *
 *   <Tooltip content={t('topbar.calendar')}>
 *     <button aria-label={t('topbar.calendar')}>…</button>
 *   </Tooltip>
 */

import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { createPortal } from 'react-dom';

const OPEN_DELAY_MS = 350;
const GAP = 8;

type Side = 'top' | 'bottom';

export default function Tooltip({ content, children, side = 'bottom', shortcut, disabled = false }: {
  content: ReactNode;
  children: ReactElement<Record<string, unknown>>;
  side?: Side;
  /** A displayed keyboard shortcut, e.g. "⌘K". */
  shortcut?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const [shown, setShown] = useState<{ top: number; left: number; side: Side; arrowLeft: number } | null>(null);
  const timer = useRef<number | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const bubble = useRef<HTMLDivElement | null>(null);

  const clear = () => {
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
  };
  const hide = useCallback(() => { clear(); setShown(null); }, []);

  const place = useCallback((el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const width = bubble.current?.offsetWidth ?? 120;
    const height = bubble.current?.offsetHeight ?? 30;
    let resolved: Side = side;
    if (side === 'bottom' && r.bottom + GAP + height > window.innerHeight - 8) resolved = 'top';
    if (side === 'top' && r.top - GAP - height < 8) resolved = 'bottom';
    const centre = r.left + r.width / 2;
    const left = Math.max(8, Math.min(centre - width / 2, window.innerWidth - width - 8));
    setShown({
      top: resolved === 'bottom' ? r.bottom + GAP : r.top - GAP - height,
      left,
      side: resolved,
      arrowLeft: Math.max(8, Math.min(centre - left - 4, width - 16)),
    });
  }, [side]);

  const show = (event: SyntheticEvent<HTMLElement>) => {
    if (disabled) return;
    anchor.current = event.currentTarget;
    clear();
    timer.current = window.setTimeout(() => { if (anchor.current) place(anchor.current); }, OPEN_DELAY_MS);
  };

  // Re-measure once the bubble exists, so a long label is centred on its
  // real width rather than the guess used for the first paint.
  useEffect(() => {
    if (shown && anchor.current) place(anchor.current);
    // The dependency is the visibility flip, not the position object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!shown, place]);

  useEffect(() => {
    if (!shown) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') hide(); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [shown, hide]);

  useEffect(() => clear, []);

  const childProps = children.props;
  const chain = <E extends SyntheticEvent<HTMLElement>>(theirs: unknown, ours: (event: E) => void) => (event: E) => {
    if (typeof theirs === 'function') (theirs as (event: E) => void)(event);
    ours(event);
  };

  const child = cloneElement(children, {
    onMouseEnter: chain(childProps.onMouseEnter, show),
    onMouseLeave: chain(childProps.onMouseLeave, hide),
    onFocus: chain(childProps.onFocus, show),
    onBlur: chain(childProps.onBlur, hide),
    onPointerDown: chain(childProps.onPointerDown, hide),
    'aria-describedby': shown
      ? [childProps['aria-describedby'], id].filter(Boolean).join(' ')
      : childProps['aria-describedby'],
  });

  return (
    <>
      {child}
      {shown && typeof document !== 'undefined' && createPortal(
        <div
          ref={bubble}
          id={id}
          role="tooltip"
          className="tm-tooltip tm-elevated tm-motion tm-motion--fade"
          data-side={shown.side}
          style={{ top: shown.top, left: shown.left }}
        >
          {content}
          {shortcut && <kbd className="tm-tooltip__kbd">{shortcut}</kbd>}
          <span className="tm-tooltip__arrow" style={{ left: shown.arrowLeft }} aria-hidden="true" />
        </div>,
        document.body,
      )}
    </>
  );
}
