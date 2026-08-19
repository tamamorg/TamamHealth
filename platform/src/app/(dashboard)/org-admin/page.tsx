/**
 * The standalone "Org Overview" dashboard was merged into Facility Management
 * on 2026-08-19 and deleted. It held the organization's headline numbers
 * (facilities, visits, inpatients, staff, revenue), an operational-status
 * strip and a transfer inbox — all of which an org admin needed beside the
 * work queue, not on a second screen the nav deliberately did not link to.
 * They are now the overview band on `/facility-management`
 * (`components/dashboards/FacilityOverviewBand.tsx`).
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
