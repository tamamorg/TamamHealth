/**
 * DEPRECATED REDIRECT — remove after 2027-02-01.
 *
 * Kept only so existing bookmarks and any external link keep working;
 * the Control Center split into Risk / Audit / Security.
 * Nothing in the product links here. Each of these stubs was added without
 * an end date, and nine of them accumulated — this one has one. If the
 * date has passed, delete the route.
 */
/**
 * The Control Center has been superseded by the split Risk Center / Audit
 * Logs / Security & Compliance surfaces. This route stays registered (old
 * links, bookmarks) and just forwards on. SuperAdminControlCenter.tsx is
 * kept around, unused, rather than deleted.
 */
import { redirect } from 'next/navigation';

export default function AdminControlCenterPage() {
  redirect('/admin/security');
}
