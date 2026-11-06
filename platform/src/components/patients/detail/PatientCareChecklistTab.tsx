'use client';
import type { PatientDoc } from '@/lib/db-types';
import { AssessmentsPanel, ScreeningsPanel, RemindersPanel } from './lazy-panels';
export default function PatientCareChecklistTab({ t, patient, focusId }: {
  t: (key: string, vars?: Record<string, string | number> | undefined) => string;
  patient: PatientDoc;
  focusId: string | undefined;
}) {
  return (
            <div className="space-y-4">
              {/* The rail calls this section "Care plan"; without a page title
                  it opened under whichever panel came first ("Screenings").
                  Styled to match the other chart tab titles (Patient summary). */}
              <div className="tebra-section-title">
                <div className="tamam-section-title-wrap">
                  <h3 className="tamam-section-title">{t('chart.carePlanTitle')}</h3>
                </div>
              </div>
              <ScreeningsPanel patient={patient} />
              <RemindersPanel patient={patient} />
              <AssessmentsPanel patient={patient} focusId={focusId} />
            </div>
  );
}
