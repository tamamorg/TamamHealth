'use client';

/**
 * The tabs of a management hub (lib/navigation/module-hubs.ts), at the top of
 * each of the hub's pages: one nav row per task, its related pages one click
 * apart here. Drawn only on a hub's own pages (not on a form or record
 * beneath one) and only when the role can open two or more of them.
 *
 * Links, not buttons: each tab is a real page with its own URL, so it can be
 * opened in a new tab, bookmarked and reached with Back. The look is the
 * platform's one segmented switch (the chart's Upcoming / Today / Past), on
 * the page canvas rather than a strip of its own.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/context';
import { hubForPath } from '@/lib/navigation/module-hubs';
import { getRoleConfig, isHrefAllowedForRole } from '@/lib/permissions';
import type { UserRole } from '@/lib/db-types';
import './module-hub-tabs.css';

/**
 * The hub tabs for a page, or null. Only for a role whose own nav carries the
 * hub as a row: a doctor on /patients or a pharmacist on /pharmacy is on a
 * clinical page that happens to sit in a management hub — no hub tabs there,
 * and the Back bar (which hub tabs replace) stays.
 */
export function hubTabsFor(pathname: string | null, role: UserRole | null | undefined) {
  const hub = hubForPath(pathname);
  if (!hub || !role || !getRoleConfig(role).navItems.some(item => item.hub === hub.id)) return null;
  // The same rule the nav uses for the hub's row, so a tab never offers a page
  // the role's nav would not.
  const members = hub.members.filter(m => isHrefAllowedForRole(role, m.href));
  return members.length > 1 && pathname ? { hub, members, pathname } : null;
}

export function useModuleHubTabs() {
  const pathname = usePathname();
  const { currentUser } = useAuth();
  return hubTabsFor(pathname, currentUser?.role as UserRole | undefined);
}

export default function ModuleHubTabs() {
  const tabs = useModuleHubTabs();
  if (!tabs) return null;
  const { hub, members, pathname } = tabs;
  return (
    <nav className="module-hub-tabs" aria-label={hub.label}>
      {members.map(member => {
        const current = pathname === member.href;
        return (
          <Link
            key={member.href}
            href={member.href}
            className={`module-hub-tab${current ? ' is-current' : ''}`}
            aria-current={current ? 'page' : undefined}
          >
            {member.label}
          </Link>
        );
      })}
    </nav>
  );
}
