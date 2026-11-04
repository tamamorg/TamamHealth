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
import { hubForPath, visibleMembers } from '@/lib/navigation/module-hubs';
import './module-hub-tabs.css';

export function useModuleHubTabs() {
  const pathname = usePathname();
  const { currentUser } = useAuth();
  const hub = hubForPath(pathname);
  const members = hub ? visibleMembers(hub, currentUser?.role) : [];
  return members.length > 1 && hub ? { hub, members, pathname } : null;
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
