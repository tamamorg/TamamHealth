'use client';

/**
 * Order basket workspace panel — OpenMRS-style: two collapsible groups (drug
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
      <div className="omrs-drawer-body">
        <div className="omrs-panel-section">
          <button
            type="button"
            className={drugsOpen ? 'omrs-panel-section-head' : 'omrs-panel-section-head is-collapsed'}
            onClick={() => setDrugsOpen(v => !v)}
          >
            <ChevronDown className="omrs-chevron" />
            <Pill />
            <span className="omrs-panel-section-title">Drug orders ({activeDrugOrders.length})</span>
            {canPrescribe && (
              <span
                className="omrs-panel-add-btn"
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
              <p className="omrs-panel-empty">No active drug orders for this patient.</p>
            ) : (
              activeDrugOrders.map(rx => (
                <div className="omrs-panel-row" key={rx._id}>
                  <div>
                    <div className="omrs-panel-row-main">{rx.medication}</div>
                    <div className="omrs-panel-row-sub">{formatRxSig(rx)}</div>
                  </div>
                  <span className={`omrs-panel-badge ${rx.status === 'pending' ? 'omrs-panel-badge--pending' : rx.status === 'discontinued' ? 'omrs-panel-badge--muted' : 'omrs-panel-badge--active'}`}>
                    {rx.status}
                  </span>
                </div>
              ))
            )
          )}
        </div>

        <div className="omrs-panel-section">
          <button
            type="button"
            className={labsOpen ? 'omrs-panel-section-head' : 'omrs-panel-section-head is-collapsed'}
            onClick={() => setLabsOpen(v => !v)}
          >
            <ChevronDown className="omrs-chevron" />
            <FlaskConical />
            <span className="omrs-panel-section-title">Lab orders ({activeLabOrders.length})</span>
            {canOrderLabs && (
              <span
                className="omrs-panel-add-btn"
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
              <p className="omrs-panel-empty">No pending lab orders for this patient.</p>
            ) : (
              activeLabOrders.map(l => (
                <div className="omrs-panel-row" key={l._id}>
                  <div>
                    <div className="omrs-panel-row-main">{l.testName}</div>
                    <div className="omrs-panel-row-sub">{l.specimen}{l.tier ? ` · ${l.tier}` : ''}</div>
                  </div>
                  <span className={`omrs-panel-badge ${l.status === 'pending' ? 'omrs-panel-badge--pending' : 'omrs-panel-badge--active'}`}>
                    {l.status.replace('_', ' ')}
                  </span>
                </div>
              ))
            )
          )}
        </div>
      </div>
      <div className="omrs-drawer-footer">
        {/* Orders persist the moment they're added via the Prescribe/OrderLab
            modals — there is no separate signing step in the data model, so a
            "Sign and close" affordance here would be a no-op lie. */}
        <span className="omrs-panel-row-sub" style={{ marginRight: 'auto', alignSelf: 'center' }}>
          Orders are saved as soon as they&rsquo;re added.
        </span>
        <button type="button" className="omrs-btn-primary" onClick={onClose}>Done</button>
      </div>
    </>
  );
}
