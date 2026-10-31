'use client';
import { AlertTriangle } from '@/components/icons/lucide';
import { abbreviateProviderName } from '@/lib/patient-utils';
import TransferHistoryPanel from '@/components/patients/TransferHistoryPanel';
import type { PatientDoc } from '@/lib/db-types';
import ChartSection, { OmrsEmptyState } from '@/components/ehr/chart/ChartSection';
import type { Dispatch, SetStateAction } from 'react';
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import type { ReferralDoc } from '@/lib/db-types';
import { useTranslation } from '@/lib/i18n/useTranslation';
import RowActionsMenu from '@/components/RowActionsMenu';
import { formatDate } from '@/lib/format-utils';
import { useReferralActions } from '@/components/referrals/useReferralActions';
export default function PatientCoordinationTab({ patient, canViewClinical, canManageReferrals, setShowReferModal, router, patientReferrals, onReferralsChanged }: {
  patient: PatientDoc;
  canViewClinical: boolean;
  canManageReferrals: boolean;
  setShowReferModal: Dispatch<SetStateAction<boolean>>;
  router: AppRouterInstance;
  patientReferrals: ReferralDoc[];
  /** Re-read the list after a row action writes. */
  onReferralsChanged?: () => void;
}) {
  const { t } = useTranslation();
  const openReferrals = () => router.push(`/referrals?patient=${encodeURIComponent(patient._id)}`);
  const { actionsFor, slider } = useReferralActions({ canViewClinical, onChanged: onReferralsChanged, onOpenAll: openReferrals });

  return (
            <div className="space-y-3">
              <TransferHistoryPanel patient={patient} canViewClinical={canViewClinical} />
              <ChartSection
                title="Referrals"
                addLabel="New referral"
                onAdd={canManageReferrals ? () => setShowReferModal(true) : undefined}
                filterSlot={(
                  // The section's own link style, beside its Add — not a
                  // smaller bold one of its own.
                  <button
                    type="button"
                    onClick={openReferrals}
                    className="tamam-section-add"
                  >
                    {t('ptDetail.allReferrals')}
                  </button>
                )}
              >
                <table className="tamam-table tamam-table--referrals">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>From</th>
                        <th>Department</th>
                        <th>Reason</th>
                        <th>{t('ptDetail.referredBy')}</th>
                        <th>Urgency</th>
                        <th>Status</th>
                        <th className="tamam-col-actions">{t('chart.actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {patientReferrals.length === 0 && (
                        <tr>
                          <td colSpan={8} style={{ cursor: 'default', background: 'transparent' }}>
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
                            <td className="tamam-num">{formatDate(ref.referralDate)}</td>
                            <td>
                              {/* Where the referral came from — the chart
                                  table's plain cell, as on every other tab. */}
                              {ref.fromHospital}
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
                                {t(`referral.${ref.status}`)}
                              </span>
                            </td>
                            <td>
                              <RowActionsMenu ariaLabel={t('chart.referralRowActions', { name: ref.toHospital })} actions={actionsFor(ref)} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
              </ChartSection>
              {slider}
            </div>
  );
}
