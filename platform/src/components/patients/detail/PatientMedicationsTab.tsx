'use client';
import ChartSection from '@/components/ehr/chart/ChartSection';
import { patientFullName } from '@/lib/patient-utils';
import type { PatientDoc } from '@/lib/db-types';
import { PharmacyWorkspace } from './lazy-panels';
import type { AppUser } from '@/lib/context/types';
import { useTranslation } from '@/lib/i18n/useTranslation';
export default function PatientMedicationsTab({ patient, canPrescribe, canRecordMedications, canDispense, onPrescribe, currentUser, focusId }: {
  patient: PatientDoc;
  canPrescribe: boolean;
  canRecordMedications: boolean;
  canDispense: boolean;
  /** Opens the order basket's Add drug order (or the Prescribe form). */
  onPrescribe: () => void;
  currentUser: AppUser | null;
  focusId: string | undefined;
}) {
  const { t } = useTranslation();
  return (
            <div className="space-y-4">
              {patient.preferredPharmacy && (
                <ChartSection title={t('ptDetail.preferredPharmacy')}>
                  <table className="tamam-table tamam-table--fixed">
                    <thead>
                      <tr>
                        <th>{t('breadcrumb.pharmacy')}</th>
                        <th>{t('hospitals.colLocation')}</th>
                        <th>{t('hospitals.fieldPhone')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="tamam-cell-strong">{patient.preferredPharmacy.name}</td>
                        <td>{patient.preferredPharmacy.address || '—'}</td>
                        <td>{patient.preferredPharmacy.phone || '—'}</td>
                      </tr>
                    </tbody>
                  </table>
                </ChartSection>
              )}
              {/* Medication list, and the counter workflow for one script —
                  the same shape the Labs tab gives the bench. */}
              <PharmacyWorkspace
                patientId={patient._id}
                patientName={patientFullName(patient)}
                canPrescribe={canPrescribe}
                canRecordMedications={canRecordMedications}
                canWork={canDispense}
                onAdd={onPrescribe}
                noKnownMedications={patient.noKnownMedications}
                reconciliation={patient.medReconciliation}
                reconciledAt={patient.medReconciliationAt}
                currentUser={currentUser}
                focusId={focusId}
                hospitalNumber={patient.hospitalNumber}
              />
            </div>
  );
}
