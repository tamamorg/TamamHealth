'use client';

import type { NavItem } from '@/lib/permissions';

export default function EhrModuleMenu({
  groups,
  roleLabel,
  activeHref,
  navLabel,
  onOpenModule,
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
}) {
  const moduleCount = groups.reduce((total, group) => total + group.items.length, 0);

  return (
    /* Laid out like the marketing site's mega menu — a titled panel on the
       left, the links as a multi-column grid on the right — but compressed to
       workspace scale: this hangs off a toolbar button mid-task, so it opens
       shorter and wider instead of as one tall scrolling column. */
    <div className="ehr-module-menu" role="menu">
      <div className="ehr-module-menu-intro">
        <span className="ehr-module-menu-eyebrow">{roleLabel}</span>
        <h3>Modules</h3>
        <p>{moduleCount} places your role can open, grouped by the part of the day they belong to.</p>
      </div>
      <div className="ehr-module-menu-grid">
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

