/**
 * DEPRECATED REDIRECT — remove after 2027-02-01.
 *
 * Kept only so existing bookmarks and any external link keep working;
 * the console moved into Settings.
 * Nothing in the product links here. Each of these stubs was added without
 * an end date, and nine of them accumulated — this one has one. If the
 * date has passed, delete the route.
 */
/**
 * System Administration moved into the personal Settings page
 * (Settings → System administration). The console's sections were always the
 * shared components in `components/settings/SystemAdminSections.tsx`, hosted
 * in both places; keeping two entry points meant two places to fix whenever
 * the apps/privileges/metadata registry moved. This route stays only so old
 * links and bookmarks keep working — same pattern as /org-admin/settings.
 */

import { redirect } from 'next/navigation';

export default function SystemAdminRedirect() {
  // Land on Manage Apps, which is what the console opened on.
  redirect('/settings?panel=sysadmin-apps');
}
