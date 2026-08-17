import { redirect } from 'next/navigation';

// The standalone nurse station is retired: nurse-family roles now land on
// the shared clinical workspace at /dashboard, role-adapted the same way
// doctors and clinicians already are. This stub only exists so old
// bookmarks/links to /dashboard/nurse still land somewhere useful.
export default function NurseDashboardPage() {
  redirect('/dashboard');
}
