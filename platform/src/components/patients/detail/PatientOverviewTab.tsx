'use client';
import type { FacesheetActions } from './chart-constants';
import type { ChartVitalsLike } from './chart-constants';
import type { ImmunizationDoc, LabResultDoc, PatientDoc, PrescriptionDoc, ProblemDoc, TriageDoc } from '@/lib/db-types';
import { FacesheetPanelId, DEFAULT_FACESHEET_PANELS } from './chart-constants';
import { PatientFacesheetView } from './FacesheetViews';
import type { Dispatch, SetStateAction } from 'react';
export default function PatientOverviewTab({ patient, latestVitals, vitalsReady, latestPatientTriage, patientProblems, allPrescriptions, allLabResults, allImmunizations, canViewClinical, selectTab, facesheetActions, facesheetPanels, showCustomizeView, setShowCustomizeView, toggleFacesheetPanel, setFacesheetPanels }: {
  patient: PatientDoc;
  latestVitals: ChartVitalsLike | undefined;
  vitalsReady: boolean;
  latestPatientTriage: TriageDoc;
  patientProblems: ProblemDoc[];
  allPrescriptions: PrescriptionDoc[];
  allLabResults: LabResultDoc[];
  allImmunizations: ImmunizationDoc[];
  canViewClinical: boolean;
  selectTab: (next: string, focus?: string | undefined) => void;
  facesheetActions: FacesheetActions;
  facesheetPanels: Set<FacesheetPanelId>;
  showCustomizeView: boolean;
  setShowCustomizeView: Dispatch<SetStateAction<boolean>>;
  toggleFacesheetPanel: (panelId: FacesheetPanelId) => void;
  setFacesheetPanels: Dispatch<SetStateAction<Set<FacesheetPanelId>>>;
}) {
  return (
            <PatientFacesheetView
              patient={patient}
              latestVitals={latestVitals}
              vitalsLoading={!vitalsReady}
              latestTriage={latestPatientTriage}
              problems={patientProblems}
              prescriptions={(allPrescriptions || []).filter(rx => rx.patientId === patient._id)}
              labResults={(allLabResults || []).filter(lab => lab.patientId === patient._id)}
              immunizations={(allImmunizations || []).filter(imm => imm.patientId === patient._id)}
              canViewClinical={canViewClinical}
              onOpenTab={selectTab}
              actions={facesheetActions}
              visiblePanelIds={facesheetPanels}
              customizeOpen={showCustomizeView}
              onToggleCustomize={() => setShowCustomizeView(open => !open)}
              onTogglePanel={toggleFacesheetPanel}
              onResetPanels={() => setFacesheetPanels(new Set(DEFAULT_FACESHEET_PANELS))}
            />
  );
}
