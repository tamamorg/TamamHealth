/**
 * DEPRECATED REDIRECT — remove after 2027-02-01.
 *
 * Kept only so existing bookmarks and any external link keep working;
 * Org Overview merged into /facility-management.
 * Nothing in the product links here. Each of these stubs was added without
 * an end date, and nine of them accumulated — this one has one. If the
 * date has passed, delete the route.
 */
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
