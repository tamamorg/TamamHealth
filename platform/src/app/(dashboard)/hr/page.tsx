'use client';

/**
 * `/hr` is no longer a page — the Staff & HR areas are independent routes
 * (leave / schedule / payroll), reached from the module dropdown.
 *
 * This forwards the old tabbed URL onto them so existing bookmarks, dashboard
 * deep links and `?tab=schedule&new=1`-style add-menu entries all still land
 * where they meant to, carrying every other query param through untouched.
 *
 * `?tab=roster` and a bare `/hr` go to the role's User Accounts page: the HR
 * roster was the same staff list as that page, and was removed rather than
 * kept as a second one. The old roster filters (`?role=`, `?status=`,
 * `?availability=`) are dropped with it — the accounts page has its own filter
 * UI and does not read them from the URL.
 */

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/context';
import { usersHrefForRole } from '@/lib/people-nav';
import { sectionFromTabParam } from './hr-shared';

export default function HrIndexPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentUser } = useAuth();

  useEffect(() => {
    if (!currentUser) return;
    const params = new URLSearchParams(searchParams?.toString() || '');
    const section = sectionFromTabParam(params.get('tab'));
    if (!section) {
      // No accounts page for this role means no staff list to send them to;
      // leave requests is the one HR area every workforce role can open.
      router.replace(usersHrefForRole(currentUser.role) || '/hr/leave');
      return;
    }
    params.delete('tab');
    const query = params.toString();
    router.replace(query ? `/hr/${section}?${query}` : `/hr/${section}`);
  }, [router, searchParams, currentUser]);

  return null;
}
