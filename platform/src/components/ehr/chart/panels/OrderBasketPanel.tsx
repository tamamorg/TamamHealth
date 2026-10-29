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
  // Two pending orders for the same medicine are usually repeat therapy
  // (ordered again at a later visit), so both rows say so.
  const medKey = (name?: string) => (name || '').trim().toLowerCase();
  const medCounts = new Map<string, number>();
  for (const rx of activeDrugOrders) medCounts.set(medKey(rx.medication), (medCounts.get(medKey(rx.medication)) || 0) + 1);
  const activeLabOrders = (results || []).filter(l => l.patientId === patient._id && l.status !== 'completed');

  const group = (kind: 'drug' | 'lab', title: string, open: boolean, toggle: () => void, canAdd: boolean, onAdd: () => void, body: React.ReactNode) => (
    <section className={`obk-group obk-group--${kind}`}>
      <div className="obk-head">
        <span className="obk-icon" aria-hidden>{kind === 'drug' ? <Pill /> : <FlaskConical />}</span>
        <h3 className="obk-title">{title}</h3>
        {canAdd && (
          <button type="button" className="obk-add" onClick={onAdd}>
            <span className="obk-add-label">{t('chart.apptAdd')}</span> <Plus aria-hidden />
          </button>
        )}
        <button type="button" className="obk-toggle" aria-expanded={open} aria-label={open ? t('basket.collapse', { title }) : t('basket.expand', { title })} onClick={toggle}>
          <ChevronDown aria-hidden className={open ? 'obk-chevron is-open' : 'obk-chevron'} />
        </button>
      </div>
      {open && <div className="obk-items">{body}</div>}
    </section>
  );

  return (
    <div className="tamam-drawer-workspace obk-root">
      <div className="obk-body">
        {group('drug', t('basket.drugOrders', { count: activeDrugOrders.length }), drugsOpen, () => setDrugsOpen(v => !v), canPrescribe, onAddDrugOrder,
          activeDrugOrders.length === 0 ? (
            <p className="obk-empty">{t('basket.noDrugOrders')}</p>
          ) : activeDrugOrders.map(rx => {
            const warned = !!(rx.medicationSafety?.allergyWarnings.length
              || rx.medicationSafety?.interactionWarnings.length
              || rx.medicationSafety?.duplicateWarnings.length);
            return (
              <div className="obk-item" key={rx._id}>
                <span className="obk-tags">
                  <span className={warned ? 'obk-tag obk-tag--danger' : 'obk-tag'}>{warned ? t('basket.review') : rx.status}</span>
                  {(medCounts.get(medKey(rx.medication)) || 0) > 1 && (
                    <span className="obk-tag obk-tag--warn" title={t('chart.duplicateOrderHint')}>{t('chart.duplicateOrder')}</span>
                  )}
                </span>
                <p className="obk-line"><strong>{rx.medication}</strong> — {formatRxSig(rx)}</p>
                {warned && (
                  <p className="obk-warn"><AlertTriangle aria-hidden /> {t('basket.safetyWarning')}</p>
                )}
              </div>
            );
          }),
        )}
        {group('lab', t('basket.labOrders', { count: activeLabOrders.length }), labsOpen, () => setLabsOpen(v => !v), canOrderLabs, onAddLabOrder,
          activeLabOrders.length === 0 ? (
            <p className="obk-empty">{t('basket.noLabOrders')}</p>
          ) : activeLabOrders.map(l => (
            <div className="obk-item" key={l._id}>
              <span className="obk-tag">{l.status.replace('_', ' ')}</span>
              <p className="obk-line"><strong>{l.testName}</strong> — {l.specimen}{l.tier ? ` · ${l.tier}` : ''}</p>
            </div>
          )),
        )}
      </div>
      {/* "Sign and close", as OpenMRS O3 labels it (chosen by the user
          2026-10-28). Every order here was already saved and attributed to its
          prescriber when it was placed (Prescribe / Order lab), so this
          confirms the basket and closes it; it writes nothing new. It waits
          until the basket holds an order, as O3's does. */}
      <div className="obk-footer">
        <button type="button" className="obk-footer-btn obk-footer-btn--secondary" onClick={onClose}>{t('common.cancel')}</button>
        <button type="button" className="obk-footer-btn obk-footer-btn--primary" onClick={onClose} disabled={activeDrugOrders.length + activeLabOrders.length === 0}>{t('chart.signAndClose')}</button>
      </div>
    </div>
  );
}
