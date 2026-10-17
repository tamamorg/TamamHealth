'use client';
import { patientFullName } from '@/lib/patient-utils';
import type { PatientDoc } from '@/lib/db-types';
import { ConditionsSection } from './lazy-panels';
import type { Dispatch, SetStateAction } from 'react';
export default function PatientProblemsTab({ focusId, patient, sectionAddRequest, setSectionAddRequest }: {
  focusId: string | undefined;
  patient: PatientDoc;
  sectionAddRequest: "allergies" | "problems" | null;
  setSectionAddRequest: Dispatch<SetStateAction<"allergies" | "problems" | null>>;
}) {
  return (
            <div className="space-y-4">
              <ConditionsSection
                focusId={focusId}
                patientId={patient._id}
                patientName={patientFullName(patient)}
                noKnownProblems={patient.noKnownProblems}
                reconciledAt={patient.problemReconciledAt}
                autoOpenAdd={sectionAddRequest === 'problems'}
                onAutoOpenHandled={() => setSectionAddRequest(null)}
              />
            </div>
  );
}
