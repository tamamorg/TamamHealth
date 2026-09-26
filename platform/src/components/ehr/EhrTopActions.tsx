'use client';

import type { NavItem } from '@/lib/permissions';
import Tooltip from '@/components/overlay/Tooltip';
import { useTranslation } from '@/lib/i18n/useTranslation';

export default function EhrTopActions({
  items,
  navLabel,
  activeHref,
  onOpenModule,
  onWarm,
  badges,
}: {
  items: NavItem[];
  navLabel: (item: NavItem) => string;
  /**
   * The module currently open, resolved once in EhrTopRail so this row, the
   * module dropdown, and the trigger icon all name the same place. These
   * shortcuts previously had no current state at all: every icon looked
   * equally unvisited, so the row said where you could go but never where
   * you were.
   */
  activeHref?: string | null;
  onOpenModule: (href: string) => void;
  /**
   * Warm a destination on hover/focus. The row navigates imperatively, so
   * nothing prefetches it otherwise — see the note on `warm` in EhrTopRail.
   */
  onWarm?: (href: string) => void;
  /** href → count of open work in that module. Omitted hrefs show no badge. */
  badges?: Record<string, number>;
}) {
  const { t } = useTranslation();
  if (items.length === 0) return null;

  return (
    <>
      {items.map(item => {
        const ItemIcon = item.icon;
        const label = navLabel(item);
        const count = badges?.[item.href] ?? 0;
        const active = item.href === activeHref;
        const tip = count > 0 ? t('topbar.waiting', { label, count }) : label;
        const name = count > 0 ? t('topbar.waitingAria', { label, count }) : label;
        return (
          <Tooltip key={item.href} content={tip}>
            <button
              type="button"
              onClick={() => onOpenModule(item.href)}
              onMouseEnter={() => onWarm?.(item.href)}
              onFocus={() => onWarm?.(item.href)}
              aria-label={name}
              aria-current={active ? 'page' : undefined}
              className={active ? 'relative is-active' : 'relative'}
            >
              <ItemIcon className="w-5 h-5" />
              {count > 0 && (
                <span className="ehr-top-action-badge">{count > 99 ? '99+' : count}</span>
              )}
            </button>
          </Tooltip>
        );
      })}
    </>
  );
}
