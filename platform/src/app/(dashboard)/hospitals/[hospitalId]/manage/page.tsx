'use client';

/**
 * /hospitals/[hospitalId]/manage — kept as a redirect into the facility
 * profile, which now carries these tabs itself.
 *
 * Staff, Wards, Equipment, Inventory, Schedules, Performance and Settings used
 * to be a page of their own here, reached by a "Manage" button on the profile.
 * That split a facility in two: its record on one screen, the work you do on
 * that facility on another, with a navigation (and a trip back) between them.
 * The tabs moved into the profile on /hospitals — see
 * `components/facilities/FacilityManageTabs` — so this route exists only to
 * keep old links, bookmarks, tours and the facility-settings picker working.
 * `?tab=` is carried across unchanged.
 */

import { useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useTranslation } from '@/lib/i18n/useTranslation';

export default function HospitalManageRedirect() {
  // Next 16: `params` is a Promise in client components — use the hook.
  const { hospitalId } = useParams<{ hospitalId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useTranslation();
  const tab = searchParams.get('tab');

  useEffect(() => {
    if (!hospitalId) return;
    const params = new URLSearchParams({ facility: hospitalId });
    if (tab) params.set('tab', tab);
    // replace, not push: the profile IS this page now, so a Back from there
    // must not bounce through a redirect that sends the user forward again.
    router.replace(`/hospitals?${params.toString()}`);
  }, [hospitalId, tab, router]);

  return (
    <main className="page-container flex items-center justify-center">
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('status.loading')}</p>
    </main>
  );
}
