'use client';
import type { PatientDoc } from '@/lib/db-types';
import { DocumentsPanel } from './lazy-panels';
import type { Dispatch, SetStateAction } from 'react';
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import type { ReferralDoc } from '@/lib/db-types';
export default function PatientDocumentsTab({ patient, patientReferrals, canViewClinical, focusId, setMessageSubject, setMessageIsEducation, setShowMessageModal, router, canManageReferrals, setShowReferModal }: {
  patient: PatientDoc;
  patientReferrals: ReferralDoc[];
  canViewClinical: boolean;
  focusId: string | undefined;
  setMessageSubject: Dispatch<SetStateAction<string>>;
  setMessageIsEducation: Dispatch<SetStateAction<boolean>>;
  setShowMessageModal: Dispatch<SetStateAction<boolean>>;
  router: AppRouterInstance;
  canManageReferrals: boolean;
  setShowReferModal: Dispatch<SetStateAction<boolean>>;
}) {
  return (
            <div className="space-y-4">
              {/* Documents ▸ Referrals ▸ Patient education. Referrals are read
                  here (the record itself is owned by the referrals module) and
                  education reuses the header's own send action, so the section
                  adds no second way to do either. */}
              <DocumentsPanel
                patient={patient}
                referrals={patientReferrals}
                canViewClinical={canViewClinical}
                focusId={focusId}
                onSendEducation={() => {
                  setMessageSubject('Patient education');
                  setMessageIsEducation(true);
                  setShowMessageModal(true);
                }}
                onOpenAllReferrals={() => router.push(`/referrals?patient=${encodeURIComponent(patient._id)}`)}
                onNewReferral={canManageReferrals ? () => setShowReferModal(true) : undefined}
              />
            </div>
  );
}
