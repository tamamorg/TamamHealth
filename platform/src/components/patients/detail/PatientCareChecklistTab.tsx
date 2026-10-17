'use client';
import { PostConsultPanel } from '@/modules/post-consult/client';
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
                  it opened under whichever panel came first ("Screenings"). */}
              <div className="tebra-facesheet">
                <div className="tebra-section-title"><h1>{t('chart.carePlanTitle')}</h1></div>
              </div>
              <PostConsultPanel key={patient._id} patientId={patient._id} embedded />
              <ScreeningsPanel patient={patient} />
              <RemindersPanel patient={patient} />
              <AssessmentsPanel patient={patient} focusId={focusId} />
            </div>
  );
}
