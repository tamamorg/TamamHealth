'use client';

/**
 * `/rooming` has no board of its own — rooming is per patient.
 *
 * Same shape as `/triage`: the route is granted for the sake of
 * `/rooming/[patientId]`, and the prefix grant let the bare parent through to
 * a 404. The rooming queue lives on the shared clinical workspace.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/lib/i18n/useTranslation';

export default function RoomingIndexPage() {
  const { t } = useTranslation();
  const router = useRouter();

  useEffect(() => {
    router.replace('/dashboard');
  }, [router]);

  return <div className="cn-empty">{t('ui.openingYourWorklist')}</div>;
}
