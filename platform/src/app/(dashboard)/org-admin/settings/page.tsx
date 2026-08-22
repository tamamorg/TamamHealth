/**
 * DEPRECATED REDIRECT — remove after 2027-02-01.
 *
 * Kept only so existing bookmarks and any external link keep working;
 * org preferences moved into Settings.
 * Nothing in the product links here. Each of these stubs was added without
 * an end date, and nine of them accumulated — this one has one. If the
 * date has passed, delete the route.
 */
/**
 * Organization settings moved into the personal Settings page
 * (Settings → Organization → Organization profile). This route stays only so
 * old links keep working.
 */
import { redirect } from 'next/navigation';

export default function OrgSettingsRedirect() {
  redirect('/settings');
}
