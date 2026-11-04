'use client';

/**
 * A management hub's pages as a dropdown in the top route bar
 * (lib/navigation/module-hubs.ts): "Patients › [Inquiries ▾]". It replaced a
 * segmented strip of tabs above the page (2026-11-04, user: "remove this and
 * put it somewhere as a dropdown to select from").
 *
 * The platform's one menu (overlay/Menu): keyboard, phone width and
 * aria-current come with it. Choosing a page navigates to its own URL. Drawn
 * only on a hub's own pages (not on a form or record beneath one) and only
 * when the role can open two or more of them.
 */
import { useRouter, usePathname } from 'next/navigation';
import { ChevronDown } from '@/components/icons/lucide';
import Menu from '@/components/overlay/Menu';
import { useAuth } from '@/lib/context';
import { hubForPath } from '@/lib/navigation/module-hubs';
import { getRoleConfig, isHrefAllowedForRole } from '@/lib/permissions';
import type { UserRole } from '@/lib/db-types';
import './module-hub-menu.css';

/** The hub a page belongs to for this role, or null (the dropdown stays away). */
export function hubTabsFor(pathname: string | null, role: UserRole | null | undefined) {
  const hub = hubForPath(pathname);
  if (!hub || !role || !getRoleConfig(role).navItems.some(item => item.hub === hub.id)) return null;
  const members = hub.members.filter(m => isHrefAllowedForRole(role, m.href));
  return members.length > 1 && pathname ? { hub, members, pathname } : null;
}

export function useModuleHubTabs() {
  const pathname = usePathname();
  const { currentUser } = useAuth();
  return hubTabsFor(pathname, currentUser?.role as UserRole | undefined);
}

export default function ModuleHubMenu({ hub, members, pathname }: NonNullable<ReturnType<typeof useModuleHubTabs>>) {
  const router = useRouter();
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const current = members.find(m => m.href === path);
  return (
    <Menu
      label={hub.label}
      align="start"
      width={248}
      items={members.map(member => ({
        key: member.href,
        label: member.label,
        current: member.href === path,
        onSelect: () => router.push(member.href),
      }))}
      trigger={(props, open) => (
        <button type="button" className="route-hub-trigger" data-open={open || undefined} aria-label={`${hub.label}: ${current?.label ?? ''}`} {...props}>
          <span>{current?.label ?? hub.label}</span>
          <ChevronDown aria-hidden="true" />
        </button>
      )}
    />
  );
}
