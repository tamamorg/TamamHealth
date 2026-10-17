'use client';
import type { PatientDoc } from '@/lib/db-types';
import { AllergiesSection, DirectivesSection } from './lazy-panels';
import type { Dispatch, SetStateAction } from 'react';
export default function PatientAllergiesTab({ focusId, patient, sectionAddRequest, setSectionAddRequest }: {
  focusId: string | undefined;
  patient: PatientDoc;
  sectionAddRequest: "allergies" | "problems" | null;
  setSectionAddRequest: Dispatch<SetStateAction<"allergies" | "problems" | null>>;
}) {
  return (
            <div className="space-y-4">
              <AllergiesSection
                focusId={focusId}
                patient={patient}
                autoOpenAdd={sectionAddRequest === 'allergies'}
                onAutoOpenHandled={() => setSectionAddRequest(null)}
              />
              <DirectivesSection patient={patient} />
            </div>
  );
}
