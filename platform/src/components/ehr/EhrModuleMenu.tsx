'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Search, X } from '@/components/icons/lucide';
import type { NavItem } from '@/lib/permissions';
import { useTranslation } from '@/lib/i18n/useTranslation';

/** Long role maps become task groups; short specialist maps stay one glance. */
export const MODULE_MENU_COLLAPSE_THRESHOLD = 10;

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
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const totalItems = groups.reduce((sum, group) => sum + group.items.length, 0);
  const condensed = totalItems > MODULE_MENU_COLLAPSE_THRESHOLD;
  const activeSection = groups.find(group => group.items.some(item => item.href === activeHref))?.section ?? null;
  const [expandedSection, setExpandedSection] = useState<string | null>(activeSection);

  useEffect(() => {
    if (activeSection) setExpandedSection(activeSection);
  }, [activeSection]);

  const filteredGroups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return groups;
    return groups
      .map(group => ({
        ...group,
        items: group.items.filter(item => navLabel(item).toLowerCase().includes(needle)),
      }))
      .filter(group => group.items.length > 0);
  }, [groups, navLabel, query]);

  const renderItem = (item: NavItem) => {
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
  };

  // Warming is per row on hover, not the whole menu on open. An admin menu runs
  // to twenty rows, and this platform is used over field connections where
  // twenty speculative fetches to save one is the wrong trade — the pointer
  // arriving on a row is a much better signal than the menu being open.

  return (
    <div className="ehr-module-menu" role="menu">
      <div className="ehr-module-menu-head">
        <span>{roleLabel}</span>
        {condensed && (
          <div className="ehr-module-menu-search">
            <Search aria-hidden="true" />
            <input
              type="search"
              aria-label={t('nav.findModule')}
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={t('nav.findModule')}
              autoFocus
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label={t('nav.clearModuleSearch')}>
                <X aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </div>
      <div className="ehr-module-menu-scroll">
        {filteredGroups.map((group, groupIndex) => {
          const expanded = !condensed || !!query || !group.section || expandedSection === group.section;
          const GroupIcon = group.items[0]?.icon;
          return (
            <section key={`${group.section || 'main'}-${groupIndex}`}>
              {condensed && !query && group.section ? (
                <button
                  type="button"
                  className={`ehr-module-group ${expanded ? 'is-expanded' : ''}`}
                  onClick={() => setExpandedSection(current => current === group.section ? null : group.section)}
                  aria-expanded={expanded}
                >
                  {GroupIcon && <GroupIcon className="w-4 h-4" color="currentColor" />}
                  <span>{group.section}</span>
                  <small>{group.items.length}</small>
                  <ChevronRight className="ehr-module-group-chevron" aria-hidden="true" />
                </button>
              ) : group.section ? <p>{group.section}</p> : null}
              {expanded && group.items.map(renderItem)}
            </section>
          );
        })}
        {query && filteredGroups.length === 0 && (
          <p className="ehr-module-menu-empty">{t('nav.noModulesFound')}</p>
        )}
      </div>
    </div>
  );
}
