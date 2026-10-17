'use client';
import { AlertTriangle, ChevronRight } from '@/components/icons/lucide';
import { abbreviateProviderName } from '@/lib/patient-utils';
import TransferHistoryPanel from '@/components/patients/TransferHistoryPanel';
import type { PatientDoc } from '@/lib/db-types';
import ChartSection, { OmrsEmptyState } from '@/components/ehr/chart/ChartSection';
import type { Dispatch, SetStateAction } from 'react';
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import type { ReferralDoc } from '@/lib/db-types';
import { useTranslation } from '@/lib/i18n/useTranslation';
export default function PatientCoordinationTab({ patient, canViewClinical, canManageReferrals, setShowReferModal, router, patientReferrals }: {
  patient: PatientDoc;
  canViewClinical: boolean;
  canManageReferrals: boolean;
  setShowReferModal: Dispatch<SetStateAction<boolean>>;
  router: AppRouterInstance;
  patientReferrals: ReferralDoc[];
}) {
  const { t } = useTranslation();
  return (
            <div className="space-y-3">
              <TransferHistoryPanel patient={patient} canViewClinical={canViewClinical} />
              <ChartSection
                title="Referrals"
                addLabel="New referral"
                onAdd={canManageReferrals ? () => setShowReferModal(true) : undefined}
                filterSlot={(
                  <button
                    type="button"
                    onClick={() => router.push(`/referrals?patient=${encodeURIComponent(patient._id)}`)}
                    className="text-xs font-semibold flex items-center gap-1"
                    style={{ color: 'var(--tamamhealth-blue)' }}
                  >
                    {t('ptDetail.allReferrals')} <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                )}
              >
                <table className="tamam-table tamam-table--referrals">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>From → To</th>
                        <th>Department</th>
                        <th>Reason</th>
                        <th>{t('ptDetail.referredBy')}</th>
                        <th>Urgency</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {patientReferrals.length === 0 && (
                        <tr>
                          <td colSpan={7} style={{ cursor: 'default', background: 'transparent' }}>
                            <OmrsEmptyState
                              itemLabel="referrals"
                              actionLabel="New referral"
                              onAction={canManageReferrals ? () => setShowReferModal(true) : undefined}
                            />
                          </td>
                        </tr>
                      )}
                      {patientReferrals.map(ref => {
                        const tp = ref.transferPackage as { medicalRecords?: unknown[]; labResults?: unknown[]; attachments?: unknown[]; packageSizeBytes?: number } | undefined;
                        const refAtts = ref.referralAttachments as unknown[] | undefined;
                        const extras = [
                          refAtts && refAtts.length > 0 && `${refAtts.length} attachment(s)`,
                          tp?.medicalRecords && `${(tp.medicalRecords as unknown[]).length} record(s) in package`,
                          tp && 'data package',
                        ].filter(Boolean).join(' · ');
                        return (
                          <tr key={ref._id}>
                            <td className="font-mono">{ref.referralDate}</td>
                            <td>
                              <div className="appointment-card-provider">
                                <strong>{ref.toHospital}</strong>
                                <span>from {ref.fromHospital}</span>
                              </div>
                            </td>
                            <td>{ref.department}</td>
                            <td className="tamam-cell-note">
                              {canViewClinical ? (
                                <>
                                  {/* Two lines then an ellipsis, with the full
                                      text on hover — one verbose referral used
                                      to set the height of the whole row. */}
                                  <div className="tamam-cell-clamp" title={ref.reason}>{ref.reason}</div>
                                  {ref.notes && <div className="tamam-cell-sub tamam-cell-clamp" title={ref.notes}>Notes: {ref.notes}</div>}
                                  {extras && <div className="tamam-cell-sub">{extras}</div>}
                                </>
                              ) : (
                                <span className="italic" style={{ color: 'var(--text-muted)' }}>{t('ptDetail.reasonRestricted')}</span>
                              )}
                            </td>
                            {/* `referringDoctor` is stored WITH its own title
                                ("Dr. Achol Mayen Deng"), so prefixing one here
                                printed "Dr. Dr. …". Shortened to first + last
                                like every other provider cell. */}
                            <td title={ref.referringDoctor}>{abbreviateProviderName(ref.referringDoctor)}</td>
                            <td>
                              <span className={`badge urgency-${ref.urgency} text-[10px]`}>
                                {ref.urgency === 'emergency' && <AlertTriangle className="w-3 h-3" />}
                                {ref.urgency.charAt(0).toUpperCase() + ref.urgency.slice(1)}
                              </span>
                            </td>
                            <td>
                              <span className={`badge ${ref.status === 'sent' ? 'ref-sent' : ref.status === 'received' ? 'ref-received' : ref.status === 'seen' ? 'ref-seen' : ref.status === 'completed' ? 'ref-completed' : 'ref-cancelled'} text-[10px]`}>
                                {ref.status === 'sent' ? 'Sent' : ref.status === 'received' ? 'Received' : ref.status === 'seen' ? 'Being Seen' : ref.status === 'completed' ? 'Completed' : 'Cancelled'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
              </ChartSection>
            </div>
  );
}
