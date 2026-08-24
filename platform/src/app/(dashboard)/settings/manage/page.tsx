import { redirect } from 'next/navigation';

/** Compatibility route: facility configuration now lives in the single Settings workspace. */
export default function LegacyManagementSettingsPage() {
  redirect('/settings?panel=facility-config');
}
