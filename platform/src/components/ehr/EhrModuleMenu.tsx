'use client';

import type { NavItem } from '@/lib/permissions';

export default function EhrModuleMenu({
  groups,
  roleLabel,
  activeHref,
  navLabel,
  onOpenModule,
  onWarm,
}: {
  groups: { section: string | null; items: NavItem[] }[];
  roleLabel: string;
  /**
   * The one module the rail considers current, already resolved by
   * longest-match in EhrTopRail. Matching on a prefix here instead would light
   * up "Dashboard" alongside "Lab" the moment a role's menu holds both
   * `/dashboard` and `/dashboard/lab` — two rows claiming to be where you are,
   * and neither agreeing with the icon on the trigger.
   */
  activeHref?: string | null;
  navLabel: (item: NavItem) => string;
  onOpenModule: (href: string) => void;
  /**
   * Warm a destination before it is chosen. The menu is the second click of
   * every two-click journey through the rail, so the moment it opens is the
   * last chance to fetch the route ahead of the user — see `warm` in
   * EhrTopRail.
   */
  onWarm?: (href: string) => void;
}) {
  // Warming is per row on hover, not the whole menu on open. An admin menu runs
  // to twenty rows, and this platform is used over field connections where
  // twenty speculative fetches to save one is the wrong trade — the pointer
  // arriving on a row is a much better signal than the menu being open.

  return (
    <div className="ehr-module-menu" role="menu">
      <div className="ehr-module-menu-head">
        <span>{roleLabel}</span>
      </div>
      <div className="ehr-module-menu-scroll">
        {groups.map((group, groupIndex) => (
          <section key={`${group.section || 'main'}-${groupIndex}`}>
            {group.section && <p>{group.section}</p>}
            {group.items.map(item => {
              const ItemIcon = item.icon;
              const active = !!item.href && item.href === activeHref;
              return (
                <button
                  key={item.href || item.label}
                  type="button"
                  role="menuitem"
                  className={active ? 'active' : ''}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => onOpenModule(item.href)}
                  onMouseEnter={() => item.href && onWarm?.(item.href)}
                  onFocus={() => item.href && onWarm?.(item.href)}
                >
                  <ItemIcon className="w-4 h-4" color="currentColor" />
                  <span>{navLabel(item)}</span>
                </button>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}

