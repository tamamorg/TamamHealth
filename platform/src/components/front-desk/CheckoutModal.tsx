'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Modal from '@/components/Modal';
import { LogOut, X, Wallet, CheckCircle } from '@/components/icons/lucide';
import { formatMoney } from '@/lib/format-utils';
import type { CheckoutTarget } from '@/lib/front-desk-utils';
import { useDataScope } from '@/lib/hooks/useDataScope';

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
  const [balance, setBalance] = useState<number | null>(null);
  const [charges, setCharges] = useState<{ description: string; amount: number }[]>([]);
  const [completing, setCompleting] = useState(false);
  // Live checkout-gate evaluation (KAN-96): unmet critical conditions render
  // here with a route to resolve each, and block the button until either
  // resolved or explicitly overridden with a reason.
  const [gate, setGate] = useState<import('@/lib/services/checkout-gate-service').CheckoutGateEvaluation | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  // An override needs a named authorizer, not just a reason — "reason +
  // authorization, logged" is the documented gate rule (Principle 2.12).
  const [overrideAuthorizedBy, setOverrideAuthorizedBy] = useState('');
  const [disposition, setDisposition] = useState<import('@/lib/services/encounter-service').DischargeDisposition>('discharged');

  useEffect(() => {
    if (!scope) {
      setBalance(null);
      setGate(null);
      return;
    }
    let cancelled = false;
    (async () => {
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
        if (!cancelled) setGate(evaluation);
      } catch { /* non-fatal — balance still shows */ }
    })();
    return () => { cancelled = true; };
  }, [scope, target.encounterId, target.patientId]);

  const owes = (balance ?? 0) > 0;

  return (
    <Modal onClose={onClose} width={440}>
      <div className="modal-content card-elevated" style={{ width: '100%' }}>
        {/* Header */}
        <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <div className="flex items-center gap-2">
            <LogOut className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
            <div>
              <h2 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>Final checkout</h2>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {target.patientName}{target.hospitalNumber ? ` · ${target.hospitalNumber}` : ''}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg transition-colors hover:bg-black/5" aria-label="Close">
            <X className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          {charges.length > 0 && (
            <div className="rounded-xl p-3" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
              <p className="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-muted)' }}>Visit charges</p>
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
            <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>Checking balance…</p>
          ) : owes ? (
            <div className="rounded-xl p-3" style={{ background: 'rgba(224, 49, 39,0.06)', border: '1px solid rgba(224, 49, 39,0.18)' }}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-danger-text)' }}>Outstanding balance</span>
                <Wallet className="w-4 h-4" style={{ color: 'var(--color-danger-text)' }} />
              </div>
              <p className="text-2xl font-bold mt-1 tabular-nums" style={{ color: 'var(--color-danger-text)' }}>{formatMoney(balance)}</p>
              {canCollectPayment ? (
                <button
                  onClick={() => onCollectPayment(target.patientId)}
                  className="mt-2.5 w-full text-[12px] font-semibold py-2 rounded-lg text-white transition-opacity hover:opacity-90 flex items-center justify-center gap-1.5"
                  style={{ background: 'var(--color-danger)' }}
                >
                  <Wallet className="w-4 h-4" />Collect payment
                </button>
              ) : (
                <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>
                  Send this patient to cashier or billing to collect payment.
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-xl p-3 flex items-center gap-2" style={{ background: 'var(--accent-light)', border: '1px solid var(--border-light)' }}>
              <CheckCircle className="w-5 h-5" style={{ color: 'var(--color-success)' }} />
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Balance settled</p>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>No outstanding charges on this account.</p>
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
                Life-sustaining medication not dispensed
              </p>
              <ul className="space-y-1">
                {gate.tier1Outstanding.map(rx => (
                  <li key={rx.id} className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>{rx.medication}</li>
                ))}
              </ul>
              <p className="text-[11.5px] mt-1.5" style={{ color: 'var(--text-secondary)' }}>
                This is a clinical safety issue regardless of payment status and needs a manager or clinician to intervene before the patient leaves.
                {' '}
                <Link href="/pharmacy" className="font-semibold underline" style={{ color: 'var(--accent-primary)' }}>Open pharmacy</Link>
              </p>
            </div>
          )}

          {gate && gate.blocking.length > 0 && (
            <div className="rounded-xl p-3" style={{ background: 'rgba(255, 127, 0,0.07)', border: '1px solid rgba(255, 127, 0,0.25)' }}>
              <p className="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-warning-text)' }}>
                Checkout blocked — unresolved items
              </p>
              <ul className="space-y-1.5">
                {gate.blocking.map(condition => (
                  <li key={condition.key} className="text-[12px]" style={{ color: 'var(--text-primary)' }}>
                    <span className="font-semibold">{condition.label}</span>
                    {condition.detail && <span style={{ color: 'var(--text-secondary)' }}> — {condition.detail}</span>}
                    {condition.resolveHref && (
                      <Link href={condition.resolveHref} className="ms-1.5 font-semibold underline" style={{ color: 'var(--accent-primary)' }}>
                        Resolve
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
              <input
                type="text"
                value={overrideReason}
                onChange={e => setOverrideReason(e.target.value)}
                placeholder="Override reason (required to check out anyway)"
                className="mt-2.5 w-full rounded-lg px-3 py-2 text-[12px]"
                style={{ border: '1px solid var(--border-light)', background: 'var(--bg-card-solid)', color: 'var(--text-primary)' }}
              />
              <input
                type="text"
                value={overrideAuthorizedBy}
                onChange={e => setOverrideAuthorizedBy(e.target.value)}
                placeholder="Authorized by (name of the approving clinician/manager)"
                className="mt-2 w-full rounded-lg px-3 py-2 text-[12px]"
                style={{ border: '1px solid var(--border-light)', background: 'var(--bg-card-solid)', color: 'var(--text-primary)' }}
              />
            </div>
          )}

          {/* Discharge disposition — before this, every checkout reported as a
              routine discharge; referral hand-offs and walk-outs were
              unrepresentable in the record. */}
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              Disposition
            </span>
            <select
              value={disposition}
              onChange={e => setDisposition(e.target.value as typeof disposition)}
              className="mt-1 w-full rounded-lg px-3 py-2 text-[12px]"
              style={{ border: '1px solid var(--border-light)', background: 'var(--bg-card-solid)', color: 'var(--text-primary)' }}
            >
              <option value="discharged">Routine discharge</option>
              <option value="discharged_with_referral">Discharged with referral</option>
              <option value="dismissed_without_formal_checkout">Patient left without formal checkout</option>
            </select>
          </label>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4" style={{ borderTop: '1px solid var(--border-light)' }}>
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold transition-colors hover:bg-black/5" style={{ color: 'var(--text-muted)' }}>
            Cancel
          </button>
          {(() => {
            const blocked = !!gate && gate.blocking.length > 0;
            const canSubmit = balance !== null && !completing
              && (!blocked || (overrideReason.trim().length > 0 && overrideAuthorizedBy.trim().length > 0));
            return (
              <button
                onClick={async () => {
                  setCompleting(true);
                  await onComplete(
                    target,
                    blocked ? { reason: overrideReason.trim(), authorizedBy: overrideAuthorizedBy.trim() } : undefined,
                    disposition,
                  );
                  setCompleting(false);
                }}
                disabled={!canSubmit}
                className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
                style={{ background: blocked ? 'var(--color-warning)' : 'var(--color-success)' }}
              >
                <CheckCircle className="w-4 h-4" />
                {completing ? 'Closing…' : blocked ? 'Override & check out' : 'Complete checkout'}
              </button>
            );
          })()}
        </div>
      </div>
    </Modal>
  );
}
