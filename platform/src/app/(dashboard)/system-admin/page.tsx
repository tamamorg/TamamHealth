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
