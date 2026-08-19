/**
 * The standalone "Org Overview" dashboard was merged into Facility Management
 * on 2026-08-19 and deleted. Its transfer inbox and Quick Actions live on
 * `/facility-management`; its headline KPI/operational-status band came along
 * too and was dropped the same day, because it read all-zero for real accounts
 * and pushed the work queue below the fold to say nothing.
 *
 * This route stays only so old links and bookmarks keep working — same pattern
 * as /org-admin/settings and /system-admin. Roles other than super_admin never
 * reach it: `/org-admin` is off their allow-list, so the Edge proxy already
 * redirects them to their own default dashboard.
 */
import { redirect } from 'next/navigation';

export default function OrgOverviewRedirect() {
  redirect('/facility-management');
}
