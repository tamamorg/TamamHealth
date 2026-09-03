'use client';

/**
 * Order basket workspace panel — Tamam-style: two collapsible groups (drug
 * orders, lab orders), each listing the patient's active orders with an
 * "Add +" affordance that opens the SAME modals already wired into the
 * patient chart page (PrescribeModal / OrderLabModal via
 * usePrescriptions / useLabResults) — no new data layer.
 */

import { useState } from 'react';
import { formatRxSig } from '@/lib/format-utils';
import { Plus, ChevronDown, Pill, FlaskConical } from '@/components/icons/lucide';
import { usePrescriptions } from '@/lib/hooks/usePrescriptions';
import { useLabResults } from '@/lib/hooks/useLabResults';
import type { PatientDoc } from '@/lib/db-types';

interface OrderBasketPanelProps {
  patient: PatientDoc;
  canPrescribe: boolean;
  canOrderLabs: boolean;
  onAddDrugOrder: () => void;
  onAddLabOrder: () => void;
  onClose: () => void;
}

export default function OrderBasketPanel({
  patient, canPrescribe, canOrderLabs, onAddDrugOrder, onAddLabOrder, onClose,
}: OrderBasketPanelProps) {
  // Scoped to this patient at the query, not filtered down from the whole
  // facility's orders: the un-scoped call pulled every prescription and lab
  // result in the hospital into the drawer to show at most a handful.
  const { prescriptions } = usePrescriptions(patient._id);
  const { results } = useLabResults(patient._id);
  const [drugsOpen, setDrugsOpen] = useState(true);
  const [labsOpen, setLabsOpen] = useState(true);

  const activeDrugOrders = (prescriptions || []).filter(rx => rx.patientId === patient._id && rx.status !== 'dispensed');
  const activeLabOrders = (results || []).filter(l => l.patientId === patient._id && l.status !== 'completed');

  return (
    <>
      <div className="tamam-drawer-body">
        <div className="tamam-panel-section">
          <button
            type="button"
            className={drugsOpen ? 'tamam-panel-section-head' : 'tamam-panel-section-head is-collapsed'}
            onClick={() => setDrugsOpen(v => !v)}
          >
            <ChevronDown className="tamam-chevron" />
            <Pill />
            <span className="tamam-panel-section-title">Drug orders ({activeDrugOrders.length})</span>
            {canPrescribe && (
              <span
                className="tamam-panel-add-btn"
                role="button"
                tabIndex={0}
                onClick={e => { e.stopPropagation(); onAddDrugOrder(); }}
                onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); onAddDrugOrder(); } }}
              >
                <Plus /> Add
              </span>
            )}
          </button>
          {drugsOpen && (
            activeDrugOrders.length === 0 ? (
              <p className="tamam-panel-empty">No active drug orders for this patient.</p>
            ) : (
              activeDrugOrders.map(rx => (
                <div className="tamam-panel-row" key={rx._id}>
                  <div>
                    <div className="tamam-panel-row-main">{rx.medication}</div>
                    <div className="tamam-panel-row-sub">{formatRxSig(rx)}</div>
                  </div>
                  <span className={`tamam-panel-badge ${rx.status === 'pending' ? 'tamam-panel-badge--pending' : rx.status === 'discontinued' ? 'tamam-panel-badge--muted' : 'tamam-panel-badge--active'}`}>
                    {rx.status}
                  </span>
                </div>
              ))
            )
          )}
        </div>

        <div className="tamam-panel-section">
          <button
            type="button"
            className={labsOpen ? 'tamam-panel-section-head' : 'tamam-panel-section-head is-collapsed'}
            onClick={() => setLabsOpen(v => !v)}
          >
            <ChevronDown className="tamam-chevron" />
            <FlaskConical />
            <span className="tamam-panel-section-title">Lab orders ({activeLabOrders.length})</span>
            {canOrderLabs && (
              <span
                className="tamam-panel-add-btn"
                role="button"
                tabIndex={0}
                onClick={e => { e.stopPropagation(); onAddLabOrder(); }}
                onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); onAddLabOrder(); } }}
              >
                <Plus /> Add
              </span>
            )}
          </button>
          {labsOpen && (
            activeLabOrders.length === 0 ? (
              <p className="tamam-panel-empty">No pending lab orders for this patient.</p>
            ) : (
              activeLabOrders.map(l => (
                <div className="tamam-panel-row" key={l._id}>
                  <div>
                    <div className="tamam-panel-row-main">{l.testName}</div>
                    <div className="tamam-panel-row-sub">{l.specimen}{l.tier ? ` · ${l.tier}` : ''}</div>
                  </div>
                  <span className={`tamam-panel-badge ${l.status === 'pending' ? 'tamam-panel-badge--pending' : 'tamam-panel-badge--active'}`}>
                    {l.status.replace('_', ' ')}
                  </span>
                </div>
              ))
            )
          )}
        </div>
      </div>
      <div className="tamam-drawer-footer">
        {/* Orders persist the moment they're added via the Prescribe/OrderLab
            modals — there is no separate signing step in the data model, so a
            "Sign and close" affordance here would be a no-op lie. */}
        <span className="tamam-panel-row-sub" style={{ marginInlineEnd: 'auto', alignSelf: 'center' }}>
          Orders are saved as soon as they&rsquo;re added.
        </span>
        <button type="button" className="tamam-btn-primary" onClick={onClose}>Done</button>
      </div>
    </>
  );
}
