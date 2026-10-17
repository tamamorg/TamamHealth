'use client';
import { Building2 } from '@/components/icons/lucide';
import { patientFullName } from '@/lib/patient-utils';
import type { PatientDoc } from '@/lib/db-types';
import { PharmacyWorkspace } from './lazy-panels';
import type { Dispatch, SetStateAction } from 'react';
import type { AppUser } from '@/lib/context/types';
import { useTranslation } from '@/lib/i18n/useTranslation';
export default function PatientMedicationsTab({ patient, canPrescribe, canDispense, setShowPrescribeModal, currentUser, focusId }: {
  patient: PatientDoc;
  canPrescribe: boolean;
  canDispense: boolean;
  setShowPrescribeModal: Dispatch<SetStateAction<boolean>>;
  currentUser: AppUser | null;
  focusId: string | undefined;
}) {
  const { t } = useTranslation();
  return (
            <div className="space-y-4">
              {patient.preferredPharmacy && (
                <div className="card-elevated px-5 py-3 flex items-center gap-3">
                  <div className="icon-box-sm flex-shrink-0">
                    <Building2 className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t('ptDetail.preferredPharmacy')}</p>
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {patient.preferredPharmacy.name}
                      {patient.preferredPharmacy.address && <span className="font-normal" style={{ color: 'var(--text-muted)' }}> · {patient.preferredPharmacy.address}</span>}
                      {patient.preferredPharmacy.phone && <span className="font-normal" style={{ color: 'var(--text-muted)' }}> · {patient.preferredPharmacy.phone}</span>}
                    </p>
                  </div>
                </div>
              )}
              {/* Medication list, and the counter workflow for one script —
                  the same shape the Labs tab gives the bench. */}
              <PharmacyWorkspace
                patientId={patient._id}
                patientName={patientFullName(patient)}
                canPrescribe={canPrescribe}
                canWork={canDispense}
                onAdd={() => setShowPrescribeModal(true)}
                noKnownMedications={patient.noKnownMedications}
                reconciliation={patient.medReconciliation}
                reconciledAt={patient.medReconciliationAt}
                currentUser={currentUser}
                focusId={focusId}
              />
            </div>
  );
}
