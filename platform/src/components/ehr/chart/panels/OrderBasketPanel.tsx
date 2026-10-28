'use client';

/**
 * Active orders workspace panel — Tamam-style: two collapsible groups (drug
 * orders, lab orders), each listing the patient's active orders with an
 * "Add +" affordance that opens the SAME modals already wired into the
 * patient chart page (PrescribeModal / OrderLabModal via
 * usePrescriptions / useLabResults) — no new data layer.
 */

import { useState } from 'react';
import { formatRxSig } from '@/lib/format-utils';
import { Plus, ChevronDown, Pill, FlaskConical, AlertTriangle } from '@/components/icons/lucide';
import { usePrescriptions } from '@/lib/hooks/usePrescriptions';
import { useLabResults } from '@/lib/hooks/useLabResults';
import type { PatientDoc } from '@/lib/db-types';
import { useTranslation } from '@/lib/i18n/useTranslation';

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
  const { t } = useTranslation();
  // Scoped to this patient at the query, not filtered down from the whole
  // facility's orders: the un-scoped call pulled every prescription and lab
  // result in the hospital into the drawer to show at most a handful.
  const { prescriptions } = usePrescriptions(patient._id);
  const { results } = useLabResults(patient._id);
  const [drugsOpen, setDrugsOpen] = useState(true);
  const [labsOpen, setLabsOpen] = useState(true);

  const activeDrugOrders = (prescriptions || []).filter(rx => rx.patientId === patient._id && rx.status === 'pending');
  const activeLabOrders = (results || []).filter(l => l.patientId === patient._id && l.status !== 'completed');

  const group = (kind: 'drug' | 'lab', title: string, open: boolean, toggle: () => void, canAdd: boolean, onAdd: () => void, body: React.ReactNode) => (
    <section className={`obk-group obk-group--${kind}`}>
      <div className="obk-head">
        <span className="obk-icon" aria-hidden>{kind === 'drug' ? <Pill /> : <FlaskConical />}</span>
        <h3 className="obk-title">{title}</h3>
        {canAdd && (
          <button type="button" className="obk-add" onClick={onAdd}>
            <span className="obk-add-label">Add</span> <Plus aria-hidden />
          </button>
        )}
        <button type="button" className="obk-toggle" aria-expanded={open} aria-label={open ? `Collapse ${title}` : `Expand ${title}`} onClick={toggle}>
          <ChevronDown aria-hidden className={open ? 'obk-chevron is-open' : 'obk-chevron'} />
        </button>
      </div>
      {open && <div className="obk-items">{body}</div>}
    </section>
  );

  return (
    <div className="tamam-drawer-workspace obk-root">
      <div className="obk-body">
        {group('drug', `Drug orders (${activeDrugOrders.length})`, drugsOpen, () => setDrugsOpen(v => !v), canPrescribe, onAddDrugOrder,
          activeDrugOrders.length === 0 ? (
            <p className="obk-empty">No active drug orders for this patient.</p>
          ) : activeDrugOrders.map(rx => {
            const warned = !!(rx.medicationSafety?.allergyWarnings.length
              || rx.medicationSafety?.interactionWarnings.length
              || rx.medicationSafety?.duplicateWarnings.length);
            return (
              <div className="obk-item" key={rx._id}>
                <span className={warned ? 'obk-tag obk-tag--danger' : 'obk-tag'}>{warned ? 'Review' : rx.status}</span>
                <p className="obk-line"><strong>{rx.medication}</strong> — {formatRxSig(rx)}</p>
                {warned && (
                  <p className="obk-warn"><AlertTriangle aria-hidden /> Safety warning recorded — review before dispensing</p>
                )}
              </div>
            );
          }),
        )}
        {group('lab', `Lab orders (${activeLabOrders.length})`, labsOpen, () => setLabsOpen(v => !v), canOrderLabs, onAddLabOrder,
          activeLabOrders.length === 0 ? (
            <p className="obk-empty">No pending lab orders for this patient.</p>
          ) : activeLabOrders.map(l => (
            <div className="obk-item" key={l._id}>
              <span className="obk-tag">{l.status.replace('_', ' ')}</span>
              <p className="obk-line"><strong>{l.testName}</strong> — {l.specimen}{l.tier ? ` · ${l.tier}` : ''}</p>
            </div>
          )),
        )}
      </div>
      {/* Every order here was saved and attributed to its prescriber the
          moment it was placed (Prescribe / Order lab), so there is nothing
          left to sign: a "Sign and close" button would promise a step that
          does not exist. The footer is one honest Close. */}
      <div className="obk-footer">
        <button type="button" className="obk-footer-btn obk-footer-btn--primary" onClick={onClose}>{t('action.close')}</button>
      </div>
    </div>
  );
}
