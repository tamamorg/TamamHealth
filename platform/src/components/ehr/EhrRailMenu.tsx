'use client';

/**
 * Labeled dropdown menu — the accessible primitive behind the dashboard's
 * "Add" menu and the billing workspace's "Actions" menu.
 *
 * A short list of verbs and nothing else: one line per item, no icons, no
 * per-item clarifiers, no section headings, no panel title, and the panel
 * hangs flush off the bottom of its trigger. Those decorations were all here
 * once. They doubled the panel's height and width around labels like "Create
 * shift" that already say exactly what they do, and the title just repeated
 * the button that opened it.
 *
 * Why this exists: the repo had no menu primitive. `EhrModuleMenu` is a
 * fixed-shape mega-panel, `RowActionsMenu` is a kebab with no keyboard model,
 * and every other dropdown re-implements outside-click by hand. Both features
 * asked for here need the same contract, so it lives in one place:
 *
 *   - opens on click (never on hover — a hover menu between a trigger and a
 *     panel is the classic "closes while the pointer crosses the gap" bug)
 *   - roving focus with ↓ ↑ Home End, Enter/Space to activate
 *   - Escape closes and returns focus to the trigger; Tab closes and lets
 *     focus continue naturally
 *   - closes on outside pointerdown, on scroll, and on resize
 *   - `aria-haspopup="menu"` + `aria-expanded` on the trigger,
 *     `role="menu"`/`role="menuitem"` in the panel, `aria-current="page"` on
 *     the active destination
 *
 * The panel is PORTALLED to <body> with fixed coordinates measured from the
 * trigger. That is deliberate: the Add menu opens inside a dashboard card with
 * `overflow: hidden`, so an absolutely-positioned panel would be clipped. A
 * portal solves that without escalating z-index across the app — the panel
 * sits at 1250, the same layer the existing module menu already uses.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from '@/components/icons/lucide';
import type { NavIcon } from '@/lib/permissions';

export interface RailMenuItem {
  key: string;
  label: string;
  /** Marks the current destination — renders the active well + aria-current. */
  active?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

interface EhrRailMenuProps {
  /** Visible trigger text. Always present — an icon alone is not a label. */
  label: string;
  icon?: NavIcon;
  items: RailMenuItem[];
  /** Tooltip + accessible name. Defaults to `label`. */
  ariaLabel?: string;
  /** Which trigger edge the panel lines up with. */
  align?: 'left' | 'right';
  /** 'rail' = white-on-blue top bar; 'primary' = filled brand button. */
  variant?: 'rail' | 'primary';
  /** True when the current route lives inside this menu. */
  active?: boolean;
  /** Hides the trailing chevron. For a trigger whose leading icon already
   *  says what it does (an Add "+"), the caret is a second, weaker cue for
   *  the same thing. `aria-haspopup`/`aria-expanded` still announce the menu. */
  hideChevron?: boolean;
  menuWidth?: number;
  emptyMessage?: string;
  children?: ReactNode;
}

export default function EhrRailMenu({
  label,
  icon: TriggerIcon,
  items,
  ariaLabel,
  align = 'left',
  variant = 'rail',
  active = false,
  hideChevron = false,
  menuWidth = 208,
  emptyMessage = 'Nothing available here for your role.',
}: EhrRailMenuProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const [focusIndex, setFocusIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  const enabledIndexes = items.map((item, i) => (item.disabled ? -1 : i)).filter(i => i >= 0);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    setFocusIndex(-1);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  const place = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(menuWidth, window.innerWidth - 16);
    const rawLeft = align === 'right' ? rect.right - width : rect.left;
    setCoords({
      // Flush against the trigger, no gap: the two then read as one control
      // rather than a panel that happens to be floating nearby.
      top: rect.bottom,
      // Never let the panel run off either edge on a narrow viewport.
      left: Math.max(8, Math.min(rawLeft, window.innerWidth - width - 8)),
    });
  }, [align, menuWidth]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  // Outside pointerdown, Escape, and viewport changes all dismiss. Scroll and
  // resize close rather than reposition: the trigger can leave the viewport
  // entirely, and a panel chasing it reads as a glitch.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(true);
      }
    };
    const onViewportChange = () => close(false);
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [open, close]);

  useEffect(() => {
    if (open && focusIndex >= 0) itemRefs.current[focusIndex]?.focus();
  }, [open, focusIndex]);

  const openWith = (index: number) => {
    setOpen(true);
    setFocusIndex(index);
  };

  const step = (delta: number) => {
    if (enabledIndexes.length === 0) return;
    const position = enabledIndexes.indexOf(focusIndex);
    const next = position === -1
      ? (delta > 0 ? 0 : enabledIndexes.length - 1)
      : (position + delta + enabledIndexes.length) % enabledIndexes.length;
    setFocusIndex(enabledIndexes[next]);
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openWith(enabledIndexes[0] ?? -1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      openWith(enabledIndexes[enabledIndexes.length - 1] ?? -1);
    }
  };

  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); step(1); break;
      case 'ArrowUp': e.preventDefault(); step(-1); break;
      case 'Home': e.preventDefault(); setFocusIndex(enabledIndexes[0] ?? -1); break;
      case 'End': e.preventDefault(); setFocusIndex(enabledIndexes[enabledIndexes.length - 1] ?? -1); break;
      case 'Tab': close(false); break;
      default: break;
    }
  };

  const select = (item: RailMenuItem) => {
    if (item.disabled) return;
    close(false);
    item.onSelect();
  };

  const triggerClass = variant === 'primary'
    ? `ehr-rail-menu-trigger ehr-rail-menu-trigger-primary${open ? ' open' : ''}`
    : `ehr-rail-menu-trigger${open ? ' open' : ''}${active ? ' is-active' : ''}`;

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={triggerClass}
        onClick={() => (open ? close(false) : openWith(-1))}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel || label}
        title={ariaLabel || label}
      >
        {TriggerIcon && <TriggerIcon className="w-4 h-4" color="currentColor" />}
        <span className="ehr-rail-menu-label">{label}</span>
        {!hideChevron && <ChevronDown className="ehr-rail-menu-chevron" color="currentColor" aria-hidden />}
      </button>

      {open && coords && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          id={menuId}
          role="menu"
          aria-label={ariaLabel || label}
          className="ehr-rail-menu-panel"
          style={{ top: coords.top, left: coords.left, width: Math.min(menuWidth, window.innerWidth - 16) }}
          onKeyDown={onPanelKeyDown}
        >
          <div className="ehr-rail-menu-scroll">
            {items.length === 0 && <p className="ehr-rail-menu-empty">{emptyMessage}</p>}
            {items.map((item, index) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                ref={el => { itemRefs.current[index] = el; }}
                className={`ehr-rail-menu-item${item.active ? ' active' : ''}`}
                // Roving tabindex: only the focused row is tabbable, so the
                // menu is one Tab stop rather than one per destination.
                tabIndex={index === focusIndex ? 0 : -1}
                aria-current={item.active ? 'page' : undefined}
                disabled={item.disabled}
                onClick={() => select(item)}
                onMouseEnter={() => !item.disabled && setFocusIndex(index)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
