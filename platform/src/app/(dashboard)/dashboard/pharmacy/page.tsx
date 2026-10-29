'use client';

/**
 * The pharmacy dashboard: the doctor's workspace in counter terms
 * (PharmacyHomeView). Scripts are worked in the patient chart's dispensing
 * form; stock lives on /pharmacy.
 *
 * Older links named a script or patient here (`?rxId=`, `?patientId=`). They
 * now land where that work happens — the chart, with the dispensing form up.
 */

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import PharmacyHomeView, { dispenseFormHref } from '@/components/dashboards/PharmacyHomeView';
import { usePrescriptions } from '@/lib/hooks/usePrescriptions';

export default function PharmacyDashboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rxId = searchParams?.get('rxId') || '';
  const patientId = searchParams?.get('patientId') || '';
  const { prescriptions } = usePrescriptions();

  useEffect(() => {
    if (patientId) { router.replace(dispenseFormHref(patientId, rxId || undefined)); return; }
    if (!rxId) return;
    const rx = prescriptions.find(item => item._id === rxId);
    if (rx?.patientId) router.replace(dispenseFormHref(rx.patientId, rx._id));
  }, [patientId, rxId, prescriptions, router]);

  return <PharmacyHomeView />;
}
