/**
 * Organization settings moved into the personal Settings page
 * (Settings → Organization → Organization profile). This route stays only so
 * old links keep working.
 */
import { redirect } from 'next/navigation';

export default function OrgSettingsRedirect() {
  redirect('/settings');
}
