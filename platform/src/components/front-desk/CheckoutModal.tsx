'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import FormSlider from '@/components/overlay/FormSlider';
import { Wallet, CheckCircle } from '@/components/icons/lucide';
import { formatMoney } from '@/lib/format-utils';
import type { CheckoutTarget } from '@/lib/front-desk-utils';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { CLINICIANS } from '@/lib/sync/write-permissions';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { allowedChartTabIds, chartHrefOpensForViewer } from '@/lib/chart-tabs';
import { makeCoalescer } from '@/lib/hooks/live-reload';
import { postConsultReady } from '@/modules/post-consult/client';
import Select from '@/components/Select';

/** Encounter statuses at or past the clinician closing their part of a visit. */
const CLOSES_CLINIC_PORTION_OR_LATER = new Set<string>([
  'ready_for_clinic_checkout', 'referred_out', 'in_clinic_checkout',
  'clinic_complete_awaiting_next_station', 'awaiting_facility_checkout', 'in_facility_checkout',
]);

/**
 * True when checkout is blocked only by records the clinician has already
 * produced but this device has not received: the encounter is at or past
 * clinic checkout (signing a note is what moves it there), and every blocker
 * is the missing signed note, or a post-consult handoff whose tasks this
 * device already shows done (so only the care plan it was checked against
 * is missing). Undone tasks are a person's job, not sync, and return false.
 */
export function isAwaitingClinicianRecords(
  blocking: ReadonlyArray<{ key: string }>,
  encounterStatus: string | null,
  handoffDoneHere: boolean,
): boolean {
  if (!blocking.length || !encounterStatus || !CLOSES_CLINIC_PORTION_OR_LATER.has(encounterStatus)) return false;
  const syncShaped = (key: string) => key === 'required_documentation_generated'
    || (key === 'post_consult_handoff' && handoffDoneHere);
  return blocking.every(c => syncShaped(c.key));
}

// ── Final-checkout modal: confirm balance settled, mark the visit complete ──
export default function CheckoutModal({
  target,
  onClose,
  onComplete,
  canCollectPayment,
  onCollectPayment,
}: {
  target: CheckoutTarget;
  onClose: () => void;
  onComplete: (
    target: CheckoutTarget,
    override?: { reason: string; authorizedBy: string },
    disposition?: import('@/lib/services/encounter-service').DischargeDisposition,
  ) => Promise<void>;
  canCollectPayment: boolean;
  onCollectPayment: (patientId: string) => void;
}) {
  const scope = useDataScope();
  const { currentUser } = useAuth();
  const { t } = useTranslation();
  const canAuthorize = !!currentUser && CLINICIANS.includes(currentUser.role);
  // A resolve link into a chart section the viewer can't open bounced the
  // desk to Appointments — offer it only where it lands on the thing to fix.
  const { canViewClinical, canEnterLabResults, canDispense } = usePermissions();
  const chartTabs = allowedChartTabIds({ canViewClinical, canEnterLabResults, canDispense, role: currentUser?.role });
  const [balance, setBalance] = useState<number | null>(null);
  const [charges, setCharges] = useState<{ description: string; amount: number }[]>([]);
  const [completing, setCompleting] = useState(false);
  // Live checkout-gate evaluation (KAN-96): unmet critical conditions render
  // here with a route to resolve each, and block the button until either
  // resolved or explicitly overridden with a reason.
  const [gate, setGate] = useState<import('@/lib/services/checkout-gate-service').CheckoutGateEvaluation | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  // "Bill to account": the cashier carries the balance as a debt, with a reason.
  const [debtReason, setDebtReason] = useState('');
  const [debtBusy, setDebtBusy] = useState(false);
  const [debtError, setDebtError] = useState('');
  const [encounterId, setEncounterId] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [encounterStatus, setEncounterStatus] = useState<string | null>(null);
  // Whether this device's copy of the encounter shows the post-consult tasks
  // done — a handoff that still blocks then means the care plan it was
  // reviewed against has not synced here yet, not that work is outstanding.
  const [handoffDoneHere, setHandoffDoneHere] = useState(false);
  // An override needs a named authorizer, not just a reason — "reason +
  // authorization, logged" is the documented gate rule (Principle 2.12).
  const [disposition, setDisposition] = useState<import('@/lib/services/encounter-service').DischargeDisposition>('discharged');

  useEffect(() => {
    if (!scope) {
      setBalance(null);
      setGate(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const { getPatientBalance } = await import('@/lib/services/ledger-service');
        const b = await getPatientBalance(target.patientId, scope);
        if (!cancelled) setBalance(b);
      } catch {
        if (!cancelled) setBalance(null);
      }
      // Itemized fee ticket for this visit so the desk sees what was billed.
      try {
        const { getEncounter, getOpenEncounterForPatient } = await import('@/lib/services/encounter-service');
        const enc = target.encounterId
          ? await getEncounter(target.encounterId)
          : await getOpenEncounterForPatient(target.patientId);
        if (enc) {
          const { getChargesByEncounter } = await import('@/lib/services/payment-service');
          const ch = await getChargesByEncounter(enc._id);
          if (!cancelled) setCharges(ch.map(c => ({ description: c.description, amount: c.billedAmount })));
        }
        // The same evaluation the discharge handler runs, shown up front so
        // the desk can resolve conditions before pressing the button.
        const { evaluateCheckoutGate } = await import('@/lib/services/checkout-gate-service');
        const evaluation = await evaluateCheckoutGate(target.patientId, (enc ?? undefined) as never, scope);
        // "Done here" means done against the plan THIS device holds. A review
        // signed off before the plan changed (a script discontinued, an order
        // added) is invalidated on purpose — that block is real work, not sync
        // lag, so the "notes have not reached this device" message must not
        // explain it away.
        let handoffReadyHere = !!enc && postConsultReady(enc.postConsult);
        if (handoffReadyHere && enc?.postConsult?.reviewedPlan) {
          try {
            const { currentPlanRevision } = await import('@/modules/post-consult/services/plan-service');
            handoffReadyHere = (await currentPlanRevision(enc as never, scope)) === enc.postConsult.reviewedPlan;
          } catch { /* plan unreadable here: keep the sync explanation */ }
        }
        if (!cancelled) {
          setGate(evaluation);
          setEncounterStatus(enc?.status ?? null);
          setEncounterId(enc?._id ?? null);
          setHandoffDoneHere(handoffReadyHere);
        }
      } catch { /* non-fatal — balance still shows */ }
    };
    void load();
    // Re-evaluate as records arrive. The gate reads this device's copy, and
    // the doctor's signed note and care plan reach the desk by sync up to a
    // minute or more after the encounter itself does — evaluating once left
    // a legitimate checkout reading "blocked" until the dialog was reopened.
    const reload = makeCoalescer(() => { if (!cancelled) void load(); }, 1000);
    const feeds: Array<{ cancel: () => void }> = [];
    void (async () => {
      const db = await import('@/lib/db');
      const { clinicalNotesDB } = await import('@/lib/clinical-notes/note-service');
      if (cancelled) return;
      for (const open of [db.encountersDB, clinicalNotesDB, db.medicalRecordsDB, db.prescriptionsDB,
        db.labResultsDB, db.proceduresDB, db.ledgerDB]) {
        try {
          feeds.push(open().changes({ since: 'now', live: true, include_docs: false })
            .on('change', () => reload.trigger())
            .on('error', () => { /* a dead feed only stops live refresh */ }));
        } catch { /* same */ }
      }
    })();
    return () => {
      cancelled = true;
      reload.cancel();
      for (const feed of feeds) { try { feed.cancel(); } catch { /* noop */ } }
    };
  }, [scope, target.encounterId, target.patientId, reloadTick]);

  // The encounter says the clinician closed their part of the visit, yet the
  // only open items are ones the clinician's records answer, and they read
  // as missing on THIS device: no signed note here (signing is what moved
  // the encounter, so one exists), or tasks shown done against a care plan
  // that has not arrived. Those records are still syncing — say so, rather
  // than leave the desk reading a block it cannot resolve. Post-consult tasks
  // that are simply not done yet are a person's job, not sync, and keep the
  // ordinary blocked message.
  const awaitingClinicianRecords = isAwaitingClinicianRecords(gate?.blocking ?? [], encounterStatus, handoffDoneHere);

  const owes = (balance ?? 0) > 0;
  // A balance that is neither paid, waived nor carried as a debt holds the
  // visit open, and no override clears it (only a walk-out is recorded as is).
  const paymentBlocked = !!gate?.blocking.some(b => b.key === 'payment_status_determined');
  const overridable = (gate?.blocking ?? []).filter(b => b.key !== 'payment_status_determined');

  const recordDebt = async () => {
    if (!encounterId || !balance || debtBusy) return;
    setDebtBusy(true);
    setDebtError('');
    try {
      const { recordDebtToAccount } = await import('@/lib/services/payment-service');
      await recordDebtToAccount({
        patientId: target.patientId,
        patientName: target.patientName,
        encounterId,
        balance,
        reason: debtReason,
        recordedBy: currentUser?._id ?? '',
        recordedByName: currentUser?.name ?? '',
        facilityId: currentUser?.hospitalId ?? '',
        orgId: currentUser?.orgId,
      });
      setDebtReason('');
      setReloadTick(n => n + 1);
    } catch (err) {
      setDebtError(err instanceof Error && err.message === 'DEBT_REASON_REQUIRED' ? t('checkout.debtReasonRequired') : t('checkout.debtFailed'));
    } finally {
      setDebtBusy(false);
    }
  };

  return (
    <FormSlider
      title={t('ui.finalCheckout')}
      subtitle={<>{target.patientName}{target.hospitalNumber ? ` · ${target.hospitalNumber}` : ''}</>}
      width={440}
      onClose={onClose}
      footer={<>
          <button type="button" onClick={onClose} className="btn btn-secondary">
            {t('action.cancel')}
          </button>
          {(() => {
            const blocked = overridable.length > 0;
            const needsAuthorization = blocked || disposition === 'dismissed_without_formal_checkout';
            const canSubmit = !!gate && balance !== null && !completing
              && (!paymentBlocked || disposition === 'dismissed_without_formal_checkout')
              && (!needsAuthorization || (canAuthorize && overrideReason.trim().length > 0));
            return (
              <button
                onClick={async () => {
                  setCompleting(true);
                  await onComplete(
                    target,
                    needsAuthorization ? { reason: overrideReason.trim(), authorizedBy: currentUser!._id } : undefined,
                    disposition,
                  );
                  setCompleting(false);
                }}
                type="button"
                disabled={!canSubmit}
                // The shared action bar's primary. An override says so in its
                // label; the Checkout blocked panel above carries the warning.
                className="btn btn-primary"
              >
                {completing ? 'Closing…' : blocked ? 'Override & check out' : 'Complete checkout'}
                <CheckCircle className="w-4 h-4" aria-hidden="true" />
              </button>
            );
          })()}
      </>}
    >
      <div className="space-y-4">
        {/* Body */}
        <div className="p-4 space-y-3">
          {charges.length > 0 && (
            <div className="rounded-xl p-3" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
              <p className="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-muted)' }}>{t('ui.visitCharges')}</p>
              <ul className="space-y-1">
                {charges.map((c, i) => (
                  <li key={i} className="flex justify-between text-[12px]">
                    <span style={{ color: 'var(--text-primary)' }}>{c.description}</span>
                    <span className="tabular-nums" style={{ color: 'var(--text-secondary)' }}>{formatMoney(c.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {balance === null ? (
            <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>{t('ui.checkingBalance')}</p>
          ) : owes ? (
            <div className="rounded-xl p-3" style={{ background: 'rgba(224, 49, 39,0.06)', border: '1px solid rgba(224, 49, 39,0.18)' }}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-danger-text)' }}>{t('patients.filterOutstanding')}</span>
                <Wallet className="w-4 h-4" style={{ color: 'var(--color-danger-text)' }} />
              </div>
              <p className="text-2xl font-bold mt-1 tabular-nums" style={{ color: 'var(--color-danger-text)' }}>{formatMoney(balance)}</p>
              {canCollectPayment ? (
                <button
                  onClick={() => onCollectPayment(target.patientId)}
                  className="mt-2.5 w-full text-[12px] font-semibold py-2 rounded-lg text-white transition-opacity hover:opacity-90 flex items-center justify-center gap-1.5"
                  style={{ background: 'var(--color-danger)' }}
                >
                  <Wallet className="w-4 h-4" />{t('ui.collectPayment')}
                </button>
              ) : (
                <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>
                  {t('ui.sendThisPatientToCashier')}
                </p>
              )}
              {paymentBlocked && (
                <div className="mt-3" role="status">
                  <p className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {t('checkout.balanceBlocked', { amount: formatMoney(balance) })}
                  </p>
                  {canCollectPayment && (
                    <div className="mt-2 space-y-2">
                      <label className="block" style={{ textTransform: 'none', letterSpacing: 'normal' }}>
                        <span className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>{t('checkout.debtReason')}</span>
                        <textarea rows={2} maxLength={500} value={debtReason} onChange={e => setDebtReason(e.target.value)}
                          className="w-full rounded-lg p-2" placeholder={t('checkout.debtReasonPlaceholder')} />
                      </label>
                      <button type="button" className="btn btn-secondary" disabled={debtBusy || debtReason.trim().length < 3 || !encounterId} onClick={() => void recordDebt()}>
                        {debtBusy ? t('common.processing') : t('checkout.recordDebt')}
                      </button>
                      {debtError && <p role="alert" className="text-[12px]" style={{ color: 'var(--color-danger-text)' }}>{debtError}</p>}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl p-3 flex items-center gap-2" style={{ background: 'var(--accent-light)', border: '1px solid var(--border-light)' }}>
              <CheckCircle className="w-5 h-5" style={{ color: 'var(--color-success)' }} />
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('ui.balanceSettled')}</p>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{t('ui.noOutstandingChargesOnThis')}</p>
              </div>
            </div>
          )}

          {/* Life-sustaining medication outstanding — TIER1_CHECKOUT_SAFETY_RULE.
              Rendered ABOVE the blocking list and in the danger colour, not
              folded into it, because it must survive the override: the same
              click that lets a patient go home without their vitamins must not
              read the same as sending someone home without their insulin. */}
          {gate && gate.tier1Outstanding.length > 0 && (
            <div className="rounded-xl p-3" style={{ background: 'rgba(224, 49, 39,0.08)', border: '1px solid rgba(224, 49, 39,0.35)' }}>
              <p className="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-danger)' }}>
                {t('ui.lifeSustainingMedicationNotDispensed')}
              </p>
              <ul className="space-y-1">
                {gate.tier1Outstanding.map(rx => (
                  <li key={rx.id} className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>{rx.medication}</li>
                ))}
              </ul>
              <p className="text-[11.5px] mt-1.5" style={{ color: 'var(--text-secondary)' }}>
                {t('ui.thisIsAClinicalSafety')}
                {' '}
                <Link href="/pharmacy" className="font-semibold underline" style={{ color: 'var(--accent-primary)' }}>{t('ui.openPharmacy')}</Link>
              </p>
            </div>
          )}

          {gate && gate.blocking.length > 0 && (
            <div className="rounded-xl p-3" style={{ background: 'rgba(255, 127, 0,0.07)', border: '1px solid rgba(255, 127, 0,0.25)' }}>
              <p className="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-warning-text)' }}>
                {t('ui.checkoutBlockedUnresolvedItems')}
              </p>
              {awaitingClinicianRecords && (
                <p role="status" className="text-[12px] mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  {t('checkout.awaitingClinicianRecords')}
                </p>
              )}
              <ul className="space-y-1.5">
                {gate.blocking.map(condition => (
                  <li key={condition.key} className="text-[12px]" style={{ color: 'var(--text-primary)' }}>
                    <span className="font-semibold">{condition.label}</span>
                    {condition.detail && <span style={{ color: 'var(--text-secondary)' }}> — {condition.detail}</span>}
                    {condition.resolveHref && chartHrefOpensForViewer(condition.resolveHref, chartTabs) && (
                      <Link href={condition.resolveHref} className="ms-1.5 font-semibold underline" style={{ color: 'var(--accent-primary)' }}>
                        {t('feedback.resolve')}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Discharge disposition — before this, every checkout reported as a
              routine discharge; referral hand-offs and walk-outs were
              unrepresentable in the record. */}
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              {t('noteEditor.section.disposition')}
            </span>
            <Select
              value={disposition}
              onChange={e => setDisposition(e.target.value as typeof disposition)}
              className="mt-1 w-full rounded-lg px-3 py-2 text-[12px]"
              style={{ border: '1px solid var(--border-light)', background: 'var(--bg-card-solid)', color: 'var(--text-primary)' }}
            >
              <option value="discharged">{t('ui.routineDischarge')}</option>
              <option value="discharged_with_referral">{t('visitStages.dischargedWithReferral')}</option>
              <option value="dismissed_without_formal_checkout">{t('ui.patientLeftWithoutFormalCheckout')}</option>
            </Select>
          </label>
          {(overridable.length > 0 || disposition === 'dismissed_without_formal_checkout') && (
            <div role="status">
              <p className="text-sm">{t('postConsult.clinicianAuthorization')}</p>
              {canAuthorize && <label style={{ textTransform: 'none', letterSpacing: 'normal' }}>
                {t('postConsult.reason')}
                <textarea value={overrideReason} maxLength={2000} onChange={e => setOverrideReason(e.target.value)} className="w-full rounded-lg p-2" />
                <span>{currentUser?.name}</span>
              </label>}
            </div>
          )}
        </div>

        {/* Footer */}
      </div>
    </FormSlider>
  );
}
