'use client';

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { useAuth } from '@/lib/context';
import { useDataScope } from '@/lib/hooks/useDataScope';
import type { PatientDoc } from '@/lib/db-types';
import type { FeeScheduleDoc } from '@/lib/db-types-billing';
import type { SuperbillSelection } from '@/lib/services/superbill-service';
import { Plus, X } from '@/components/icons/lucide';
import { patientFullName } from '@/lib/patient-utils';
import Select from '@/components/Select';

interface Line {
  fee: FeeScheduleDoc;
  quantity: number;
  nonCovered: boolean;
}

/**
 * Superbill / fee ticket (P2.3) — the provider picks the services rendered
 * (priced from the fee schedule), marks any non-covered items (ABN), sees the
 * total, and posts the charges: the Centricity checkout review.
 *
 * It used to be its own card above the billing tab. It now lives *inside* the
 * Charges card — the service picker is one control on the table toolbar, the
 * draft ticket sits above the charges it prices — so the state is shared
 * through `useSuperbill()` and rendered by two slots that sit in different
 * places in the DOM.
 */
export interface Superbill {
  fees: FeeScheduleDoc[];
  /** Fees not already on the ticket — what the picker offers. */
  available: FeeScheduleDoc[];
  lines: Line[];
  picker: string;
  addLine: (feeId: string) => void;
  setLines: Dispatch<SetStateAction<Line[]>>;
  totals: { total: number; nonCovered: number; covered: number };
  money: (n: number) => string;
  post: () => Promise<void>;
  busy: boolean;
  error: string | null;
  posted: string | null;
}

export function useSuperbill({
  patient,
  encounterId,
  hospitalName,
  onPosted,
}: {
  patient: PatientDoc;
  encounterId?: string;
  hospitalName?: string;
  /** Fired after a successful post — the charges table reloads on it. */
  onPosted?: (message: string) => void;
}): Superbill {
  const { currentUser } = useAuth();
  const scope = useDataScope();
  const [fees, setFees] = useState<FeeScheduleDoc[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [picker, setPicker] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getActiveFees } = await import('@/lib/services/fee-schedule-service');
        const f = await getActiveFees(scope);
        if (!cancelled) setFees(f);
      } catch { /* noop */ }
    })();
    return () => { cancelled = true; };
  }, [scope]);

  const currency = fees[0]?.currency || 'SSP';
  const totals = useMemo(() => {
    const total = lines.reduce((s, l) => s + l.quantity * l.fee.unitPrice, 0);
    const nonCovered = lines.filter((l) => l.nonCovered).reduce((s, l) => s + l.quantity * l.fee.unitPrice, 0);
    return { total, nonCovered, covered: total - nonCovered };
  }, [lines]);

  function addLine(feeId: string) {
    const fee = fees.find((f) => f._id === feeId);
    if (!fee || lines.some((l) => l.fee._id === feeId)) return;
    setLines((ls) => [...ls, { fee, quantity: 1, nonCovered: false }]);
    setPicker('');
    setPosted(null);
  }

  async function post() {
    setBusy(true);
    setError(null);
    try {
      const { postSuperbill } = await import('@/lib/services/superbill-service');
      const selections: SuperbillSelection[] = lines.map((l) => ({
        category: l.fee.category,
        serviceCode: l.fee.serviceCode,
        description: l.fee.serviceName,
        quantity: l.quantity,
        unitPrice: l.fee.unitPrice,
        nonCovered: l.nonCovered,
      }));
      const result = await postSuperbill({
        patientId: patient._id,
        patientName: patientFullName(patient),
        facilityId: patient.registrationHospital,
        facilityName: hospitalName || patient.registrationHospital,
        facilityLevel: 'hospital',
        state: patient.state,
        orgId: patient.orgId,
        encounterId,
        generatedBy: currentUser?._id || '',
        generatedByName: currentUser?.name || currentUser?.username || 'Clinician',
        currency,
        scope,
      }, selections);
      const message = `Posted ${lines.length} charge${lines.length === 1 ? '' : 's'}${result.abnRecorded ? ` · ${result.abnRecorded} ABN recorded` : ''}.`;
      setPosted(message);
      setLines([]);
      onPosted?.(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to post charges');
    } finally {
      setBusy(false);
    }
  }

  const money = (n: number) => `${currency} ${n.toLocaleString()}`;
  const available = fees.filter((f) => !lines.some((l) => l.fee._id === f._id));

  return { fees, available, lines, picker, addLine, setLines, totals, money, post, busy, error, posted };
}

/**
 * SuperbillPicker — the "Add a service…" select, sized for the Charges table
 * toolbar (same 38px height as the toolbar's date input and icon buttons).
 * Disabled, with the reason in the option text, when the facility has no fee
 * schedule — the control stays put instead of the row reflowing.
 */
export function SuperbillPicker({ sb }: { sb: Superbill }) {
  const noFees = sb.fees.length === 0;
  return (
    <Select
      className="bl-toolbar-select"
      value={sb.picker}
      disabled={noFees}
      onChange={(e) => sb.addLine(e.target.value)}
      aria-label="Add a service to the superbill"
      title={noFees ? 'No fee schedule configured for this facility' : 'Superbill / fee ticket — add a service'}
    >
      <option value="">{noFees ? 'No fee schedule' : 'Add a service…'}</option>
      {sb.available.map((f) => (
        <option key={f._id} value={f._id}>{f.serviceName} — {sb.money(f.unitPrice)} ({f.category})</option>
      ))}
    </Select>
  );
}

/**
 * SuperbillDraft — the unposted ticket: services picked so far, ABN marks,
 * totals and the post action. Renders nothing until a service is picked (or a
 * post has just reported back), so the Charges card stays quiet by default.
 */
export function SuperbillDraft({ sb }: { sb: Superbill }) {
  const { lines, totals, money, setLines } = sb;
  if (lines.length === 0 && !sb.posted && !sb.error) return null;

  return (
    <div className="bl-draft">
      {lines.length > 0 && (
        <>
          <div className="bl-draft-head">
            <span className="bl-draft-title">Superbill / fee ticket</span>
            <span className="bl-draft-note">Review charges before checkout</span>
          </div>
          <table className="bl-table bl-draft-table">
            <thead>
              <tr>
                <th>Service</th>
                <th className="bl-center">Qty</th>
                <th className="bl-right">Amount</th>
                <th className="bl-center">ABN</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.fee._id}>
                  <td>{l.fee.serviceName}</td>
                  <td className="bl-center">
                    <input
                      type="number" step="any"
                      min={1}
                      value={l.quantity}
                      onChange={(e) => setLines((ls) => ls.map((x, j) => j === i ? { ...x, quantity: Math.max(1, parseInt(e.target.value) || 1) } : x))}
                      className="bl-draft-qty"
                      aria-label={`Quantity for ${l.fee.serviceName}`}
                    />
                  </td>
                  <td className="bl-num bl-right">{money(l.quantity * l.fee.unitPrice)}</td>
                  <td className="bl-center">
                    <input
                      type="checkbox"
                      checked={l.nonCovered}
                      onChange={(e) => setLines((ls) => ls.map((x, j) => j === i ? { ...x, nonCovered: e.target.checked } : x))}
                      title="Non-covered — patient advised (ABN)"
                      aria-label={`Mark ${l.fee.serviceName} non-covered (ABN)`}
                    />
                  </td>
                  <td className="bl-right">
                    <button type="button" className="bl-draft-remove" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} title="Remove" aria-label={`Remove ${l.fee.serviceName}`}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="bl-draft-foot">
            <dl className="bl-draft-totals">
              {totals.nonCovered > 0 && (
                <>
                  <div><dt>Covered</dt><dd>{money(totals.covered)}</dd></div>
                  <div className="bl-draft-abn"><dt>Non-covered (ABN)</dt><dd>{money(totals.nonCovered)}</dd></div>
                </>
              )}
              <div className="bl-draft-total"><dt>Total</dt><dd>{money(totals.total)}</dd></div>
            </dl>
            <button type="button" className="bl-btn bl-btn--primary" disabled={sb.busy} onClick={sb.post}>
              <Plus size={15} /> Post charges
            </button>
          </div>
          {totals.nonCovered > 0 && (
            <p className="bl-draft-hint">Posting records an ABN acknowledgement on the chart for each non-covered service.</p>
          )}
        </>
      )}

      {sb.posted && <p className="bl-draft-posted">{sb.posted}</p>}
      {sb.error && <p className="bl-draft-error">{sb.error}</p>}
    </div>
  );
}
