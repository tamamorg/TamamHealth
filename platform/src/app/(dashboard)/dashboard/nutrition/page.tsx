'use client';

/**
 * Nutrition home. The station console (its own screening list, "New
 * screening" form and stat toggles) is retired: nutritionists work on the
 * shared clinical workspace like a doctor, and screen in the patient chart.
 * See NutritionHomeView.
 */
import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import NutritionHomeView, { screeningFormHref } from '@/components/dashboards/NutritionHomeView';

export default function NutritionDashboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Old links (`?patientId=` from the chart's Clinical forms) opened the
  // station's screening form for that patient. The form lives in the chart
  // now, so send them there with it open.
  const patientId = searchParams.get('patientId');
  useEffect(() => {
    if (patientId) router.replace(screeningFormHref(patientId));
  }, [patientId, router]);

  if (patientId) return null;
  return <NutritionHomeView />;
}
