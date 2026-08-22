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

export default function NurseMarPage() {
  redirect('/wards');
}
