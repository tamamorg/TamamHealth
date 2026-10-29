'use client';

/**
 * Radiology home. The station console (its own imaging worklist with the
 * report form in a row popup) is retired: radiologists work on the shared
 * clinical workspace like a doctor, and report in the patient chart.
 * See RadiologyHomeView.
 */
import RadiologyHomeView from '@/components/dashboards/RadiologyHomeView';

export default function RadiologyDashboardPage() {
  return <RadiologyHomeView />;
}
