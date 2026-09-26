'use client';

/**
 * The dropdown menu primitive, and the keyboard model every menu in the app
 * shares.
 *
 * The repo had four menus with four keyboard models: `EhrRailMenu` (full
 * roving focus), `EhrVisitMoreMenu` (arrows, no Home/End), `RowActionsMenu`
 * (mouse only) and the rail's account menu (mouse only). This is the one
 * surface — `tm-menu` — and the one contract:
 *
 *   - opens on click, never on hover
 *   - ↓ ↑ Home End move between enabled items; Enter/Space activates
 *   - Escape closes and returns focus to the trigger; Tab closes and lets
 *     focus continue naturally
 *   - closes on outside pointerdown, scroll and resize
 *   - `aria-haspopup="menu"` + `aria-expanded` on the trigger,
 *     `role="menu"` / `role="menuitem"` on the panel, `aria-current="page"`
 *     on a destination you are already on
 *   - portalled to <body>, fixed-positioned from the trigger, flipping
 *     above it when the space below cannot hold it, and raised above a
 *     dialog's scrim when the trigger lives inside one
 *
 * `useMenuKeyboard` is the same model as a hook, for the two rail menus that
 * keep their own markup (the module directory and the account menu).
 */

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, MoreVertical } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';

export type MenuTone = 'default' | 'danger' | 'success';

export interface MenuItem {
  key: string;
  label: ReactNode;
  /** One line under the label on what pressing it does. */
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: MenuTone;
  disabled?: boolean;
  /** Marks a chosen option (a check appears). */
  selected?: boolean;
  /** Marks the destination you are already on. */
  current?: boolean;
  /** Displayed keyboard shortcut, e.g. "⌘K". Display only. */
  shortcut?: string;
  /** Items sharing a group sit together; a hairline separates groups. */
  group?: string;
  onSelect: () => void;
}

export interface MenuTriggerProps {
  ref: (el: HTMLButtonElement | null) => void;
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  'aria-controls': string | undefined;
  onClick: () => void;
  onKeyDown: (event: ReactKeyboardEvent) => void;
}

const ITEM_SELECTOR = '[role="menuitem"]:not(:disabled)';

/**
 * Roving keyboard focus for a container of `[role="menuitem"]` buttons.
 * Attach the returned handler to the container's `onKeyDown`; call
 * `focusFirst`/`focusLast` when the menu opens from the keyboard.
 */
export function useMenuKeyboard(containerRef: RefObject<HTMLElement | null>, close: (returnFocus: boolean) => void) {
  const items = useCallback(
    () => Array.from(containerRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []),
    [containerRef],
  );
  const focusAt = useCallback((index: number) => {
    const list = items();
    if (list.length === 0) return;
    list[((index % list.length) + list.length) % list.length].focus();
  }, [items]);
  const onKeyDown = useCallback((event: ReactKeyboardEvent | KeyboardEvent) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    // A search box inside the menu keeps Home/End for its own caret.
    const inField = (event.target as HTMLElement | null)?.matches?.('input, textarea') ?? false;
    if (inField && (event.key === 'Home' || event.key === 'End')) return;
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); focusAt(at + 1); break;
      case 'ArrowUp': event.preventDefault(); focusAt(at - 1); break;
      case 'Home': event.preventDefault(); focusAt(0); break;
      case 'End': event.preventDefault(); focusAt(list.length - 1); break;
      case 'Escape': event.preventDefault(); event.stopPropagation(); close(true); break;
      case 'Tab': close(false); break;
      default: break;
    }
  }, [items, focusAt, close]);
  return { onKeyDown, focusFirst: () => focusAt(0), focusLast: () => focusAt(-1) };
}

export default function Menu({
  items,
  label,
  trigger,
  icon,
  align = 'end',
  width = 224,
  emptyMessage,
  groupLabels,
  triggerClassName,
  onOpenChange,
}: {
  items: MenuItem[];
  /** Accessible name of the menu and of the default trigger. */
  label: string;
  /** Render your own trigger; spread the props onto a <button>. Omit for
   *  the default icon button. */
  trigger?: (props: MenuTriggerProps, open: boolean) => ReactElement;
  /** Glyph for the default trigger (a vertical ellipsis if omitted). */
  icon?: ReactNode;
  /** Which trigger edge the panel lines up with. */
  align?: 'start' | 'end';
  width?: number;
  emptyMessage?: string;
  /** Heading text per `group` key, shown above the group. */
  groupLabels?: Record<string, string>;
  triggerClassName?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpenState] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; flipped: boolean } | null>(null);
  const [inDialog, setInDialog] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const openedByKeyboard = useRef<'first' | 'last' | null>(null);
  const menuId = useId();

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  }, [onOpenChange]);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, [setOpen]);

  const { onKeyDown, focusFirst, focusLast } = useMenuKeyboard(panelRef, close);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const w = Math.min(width, window.innerWidth - 16);
    const rtl = document.documentElement.dir === 'rtl';
    const endAligned = (align === 'end') !== rtl;
    const rawLeft = endAligned ? r.right - w : r.left;
    const panelHeight = panelRef.current?.offsetHeight ?? Math.min(items.length * 40 + 8, 480);
    const spaceBelow = window.innerHeight - r.bottom;
    const flipped = spaceBelow < panelHeight + 12 && r.top > spaceBelow;
    setPos({
      top: flipped ? Math.max(8, r.top - panelHeight - 6) : r.bottom + 6,
      left: Math.max(8, Math.min(rawLeft, window.innerWidth - w - 8)),
      flipped,
    });
    setInDialog(!!trigger.closest('.modal-portal-backdrop'));
  }, [align, width, items.length]);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open || !pos) return;
    if (openedByKeyboard.current === 'first') focusFirst();
    else if (openedByKeyboard.current === 'last') focusLast();
    else panelRef.current?.focus();
    openedByKeyboard.current = null;
    // Focus placement is a one-time action on open, keyed on the panel's
    // arrival — the helpers are stable per render but not referentially.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pos]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    const onViewport = () => close(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    window.addEventListener('resize', onViewport);
    window.addEventListener('scroll', onViewport, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      window.removeEventListener('resize', onViewport);
      window.removeEventListener('scroll', onViewport, true);
    };
  }, [open, close]);

  const onTriggerKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openedByKeyboard.current = 'first';
      setOpen(true);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      openedByKeyboard.current = 'last';
      setOpen(true);
    }
  };

  const triggerProps: MenuTriggerProps = {
    ref: el => { triggerRef.current = el; },
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
    onClick: () => setOpen(!open),
    onKeyDown: onTriggerKeyDown,
  };

  const triggerNode = trigger
    ? trigger(triggerProps, open)
    : (
      <button type="button" className={triggerClassName || 'tm-menu__trigger'} aria-label={label} {...triggerProps}>
        {icon ?? <MoreVertical aria-hidden="true" />}
      </button>
    );

  // Group consecutive items by their `group` key, keeping the order given.
  const groups: { key: string | undefined; items: MenuItem[] }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.key === item.group) last.items.push(item);
    else groups.push({ key: item.group, items: [item] });
  }

  const panel = open && pos && typeof document !== 'undefined' ? createPortal(
    <div
      ref={panelRef}
      id={menuId}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      className={`tm-menu tm-elevated tm-motion tm-motion--menu${pos.flipped ? ' is-flipped' : ''}${inDialog ? ' tm-menu--in-dialog' : ''}`}
      style={{ top: pos.top, left: pos.left, width: Math.min(width, window.innerWidth - 16) }}
      onKeyDown={onKeyDown}
    >
      {items.length === 0 && <p className="tm-menu__empty">{emptyMessage || t('overlay.menuEmpty')}</p>}
      {groups.map((group, index) => (
        <div key={group.key ?? `g${index}`} role="none" className="tm-menu__group">
          {group.key && groupLabels?.[group.key] && (
            <div className="tm-menu__label" role="presentation">{groupLabels[group.key]}</div>
          )}
          {group.items.map(item => (
            <button
              key={item.key}
              type="button"
              role={item.selected !== undefined ? 'menuitemcheckbox' : 'menuitem'}
              className="tm-menu__item"
              data-tone={item.tone && item.tone !== 'default' ? item.tone : undefined}
              aria-current={item.current ? 'page' : undefined}
              aria-checked={item.selected}
              disabled={item.disabled}
              tabIndex={-1}
              onClick={event => {
                event.stopPropagation();
                if (item.disabled) return;
                close(false);
                item.onSelect();
              }}
            >
              {item.icon && <span className="tm-menu__item-icon" aria-hidden="true">{item.icon}</span>}
              <span className="tm-menu__item-text">
                <span>{item.label}</span>
                {item.hint && <span className="tm-menu__item-hint">{item.hint}</span>}
              </span>
              {item.shortcut && <kbd className="tm-menu__item-kbd">{item.shortcut}</kbd>}
              {item.selected && <span className="tm-menu__item-check" aria-hidden="true"><Check /></span>}
            </button>
          ))}
        </div>
      ))}
    </div>,
    document.body,
  ) : null;

  return (
    <>
      {isValidElement(triggerNode) ? cloneElement(triggerNode) : triggerNode}
      {panel}
    </>
  );
}
