'use client';
import type { MedicalRecordDoc, PatientDoc } from '@/lib/db-types';
import { BillingTab } from './lazy-panels';
import type { Dispatch, SetStateAction } from 'react';
import type { HospitalDoc } from '@/lib/db-types';
export default function PatientBillingTab({ patient, patientBalance, showPaymentPanel, showPlanWizard, setShowPaymentPanel, setShowPlanWizard, reloadPayments, latestRecord, hospitals }: {
  patient: PatientDoc;
  patientBalance: number;
  showPaymentPanel: boolean;
  showPlanWizard: boolean;
  setShowPaymentPanel: Dispatch<SetStateAction<boolean>>;
  setShowPlanWizard: Dispatch<SetStateAction<boolean>>;
  reloadPayments: () => Promise<void>;
  latestRecord: MedicalRecordDoc | undefined;
  hospitals: HospitalDoc[];
}) {
  return (
            <div className="space-y-5">
              {/* The superbill / fee ticket (P2.3) is no longer its own card —
                  its service picker rides the Charges toolbar inside BillingTab
                  and the draft ticket renders above the charges it prices. */}
              <BillingTab
                patient={patient}
                patientBalance={patientBalance}
                showPaymentPanel={showPaymentPanel}
                showPlanWizard={showPlanWizard}
                setShowPaymentPanel={setShowPaymentPanel}
                setShowPlanWizard={setShowPlanWizard}
                reloadPayments={reloadPayments}
                superbillEncounterId={(latestRecord as { encounterId?: string } | undefined)?.encounterId}
                hospitalName={hospitals.find(h => h._id === patient.registrationHospital)?.name}
              />
            </div>
  );
}
