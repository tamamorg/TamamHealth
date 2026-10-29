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
import { useState } from 'react';
import RowActionsMenu, { type RowAction } from '@/components/RowActionsMenu';
import { useConfirm, useConfirmPrompt } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/lib/context';
import { todayIso } from '@/lib/date-utils';
import { formatDate } from '@/lib/format-utils';
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
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const confirmPrompt = useConfirmPrompt();
  const confirm = useConfirm();
  const [busyId, setBusyId] = useState<string | null>(null);
  const openReferrals = () => router.push(`/referrals?patient=${encodeURIComponent(patient._id)}`);

  // The same writes the /referrals worklist makes, with the reason asked in
  // the shared prompt instead of that page's own dialogs.
  const run = async (id: string, write: () => Promise<unknown>, ok: string, failed: string) => {
    setBusyId(id);
    try {
      await write();
      showToast(ok, 'success');
      onReferralsChanged?.();
    } catch {
      showToast(failed, 'error');
    } finally {
      setBusyId(null);
    }
  };

  /** A timestamped line appended to the referral's notes, as /referrals writes it. */
  const appendNote = (ref: ReferralDoc, line: string) => {
    const entry = `[${todayIso()} ${currentUser?.name || 'Unknown'}] ${line}`;
    return ref.notes ? `${ref.notes}\n\n${entry}` : entry;
  };

  const rowActions = (ref: ReferralDoc): RowAction[] => {
    // Accept, decline and reopen belong to the receiving facility only.
    const incoming = !!currentUser?.hospitalId && ref.toHospitalId === currentUser.hospitalId;
    const busy = busyId === ref._id;
    return [
      { key: 'open', label: t('chart.referralOpen'), onClick: openReferrals },
      ...(canManageReferrals && incoming && (ref.status === 'sent' || ref.status === 'received') ? [
        { key: 'accept', label: t('referrals.accept'), disabled: busy, onClick: () => void run(ref._id, async () => {
          const { acceptReferral } = await import('@/lib/services/referral-service');
          if (!(await acceptReferral(ref._id))) throw new Error('not saved');
        }, t('referrals.toastAccepted', { name: ref.patientName }), t('referrals.toastAcceptFailed')) },
        { key: 'decline', label: t('referrals.decline'), tone: 'danger' as const, disabled: busy, onClick: async () => {
          const reason = await confirmPrompt({
            title: t('referrals.declineTitle'),
            message: t('referrals.declineHint'),
            inputPlaceholder: t('referrals.declinePlaceholder'),
            inputRequired: true,
            confirmLabel: t('referrals.confirmDecline'),
            tone: 'danger',
          });
          if (!reason?.trim()) return;
          await run(ref._id, async () => {
            const { updateReferralStatus, updateReferralNotes } = await import('@/lib/services/referral-service');
            // null is a failed write, not a success.
            if (!(await updateReferralStatus(ref._id, 'cancelled'))) throw new Error('not saved');
            await updateReferralNotes(ref._id, appendNote(ref, `DECLINED: ${reason.trim()}`));
          }, t('referrals.toastDeclined'), t('referrals.toastDeclineFailed'));
        } },
      ] : []),
      ...(canManageReferrals && incoming && ref.status === 'cancelled' ? [
        { key: 'reopen', label: t('action.reopen'), disabled: busy, onClick: async () => {
          // /referrals confirms a reversal before writing it; so does the chart.
          const ok = await confirm({ title: t('chart.referralReopenTitle'), message: t('chart.referralReopenBody', { name: ref.fromHospital }), confirmLabel: t('action.reopen') });
          if (!ok) return;
          await run(ref._id, async () => {
            const { updateReferralStatus } = await import('@/lib/services/referral-service');
            if (!(await updateReferralStatus(ref._id, 'received'))) throw new Error('not saved');
          }, t('chart.referralReopened'), t('chart.referralReopenFailed'));
        } },
      ] : []),
      ...(canManageReferrals && ref.status !== 'cancelled' ? [
        { key: 'note', label: t('action.addNote'), disabled: busy, onClick: async () => {
          const text = await confirmPrompt({
            title: t('referrals.addNoteTitle'),
            message: t('referrals.addNoteHint'),
            inputPlaceholder: t('referrals.notePlaceholder'),
            inputRequired: true,
            confirmLabel: t('action.addNote'),
          });
          if (!text?.trim()) return;
          await run(ref._id, async () => {
            const { updateReferralNotes } = await import('@/lib/services/referral-service');
            await updateReferralNotes(ref._id, appendNote(ref, text.trim()));
          }, t('referrals.toastNoteAdded'), t('referrals.toastNoteFailed'));
        } },
      ] : []),
    ];
  };
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
                    onClick={openReferrals}
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
                                {t(`referral.${ref.status}`)}
                              </span>
                            </td>
                            <td>
                              <RowActionsMenu ariaLabel={t('chart.referralRowActions', { name: ref.toHospital })} actions={rowActions(ref)} />
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
