/**
 * DEPRECATED REDIRECT — remove after 2027-02-01.
 *
 * Kept only so existing bookmarks and any external link keep working;
 * the nurse station was merged into /dashboard (v74 era).
 * Nothing in the product links here. Each of these stubs was added without
 * an end date, and nine of them accumulated — this one has one. If the
 * date has passed, delete the route.
 */
import { redirect } from 'next/navigation';

// The standalone nurse station is retired: nurse-family roles now land on
// the shared clinical workspace at /dashboard, role-adapted the same way
// doctors and clinicians already are. This stub only exists so old
// bookmarks/links to /dashboard/nurse still land somewhere useful.
export default function NurseDashboardPage() {
  redirect('/dashboard');
}
