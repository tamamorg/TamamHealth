'use client';

/**
 * /notes — the cross-patient notes queue, retired.
 *
 * Documentation belongs to the patient it documents. The chart's Notes tab is
 * the same list already scoped to one person, next to the history, vitals and
 * problems that give a note its meaning — so a second, facility-wide copy of it
 * was a list you had to filter back down to the patient you were already
 * looking at.
 *
 * The ROUTE is kept as a redirect rather than deleted, for the same reason
 * `/consultation` is: bookmarks, the browser's back button, and any link
 * written down before the change all still land somewhere useful instead of on
 * a 404. `/notes/[id]` — the note editor itself — is untouched and is still
 * where the chart opens a note.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/lib/i18n/useTranslation';

export default function NotesQueueRetiredPage() {
  const { t } = useTranslation();
  const router = useRouter();

  useEffect(() => {
    router.replace('/patients');
  }, [router]);

  return <div className="cn-empty">{t('ui.openingThePatientRegistry')}</div>;
}
