'use client';

/**
 * The O3 drug order form: who it is for and what they react to, then
 * 1. Dosage instructions, 2. Prescription duration, 3. Dispensing
 * instructions, over Discard / Save order. Saving puts the order in the
 * basket; nothing is written until the basket is signed.
 *
 * The allergy and interaction checks run as the drug is ordered, so a clash
 * is seen here rather than at signing; signing checks again (sign-orders.ts).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Minus, Plus } from '@/components/icons/lucide';
import Select from '@/components/Select';
import StockNotice from '@/components/clinical-notes/prescribe/StockNotice';
import { checkAllergiesStructured } from '@/lib/services/drug-interaction-service';
import type { StockPosition } from '@/lib/pharmacy-stock-position';
import type { PatientDoc } from '@/lib/db-types';
import { useTranslation } from '@/lib/i18n/useTranslation';
import FormNotices from '@/components/overlay/FormNotices';
import {
  DOSE_UNITS, FREQUENCIES, ROUTES, drugOrderGaps, quantityFor,
  type DrugOrderDraft, type DurationUnit,
} from './basket-types';
import PatientBanner from './PatientBanner';

/** The −/+ number field O3 uses for durations and refills. */
function Stepper({ id, value, onChange, min = 0, label }: {
  id: string; value: string; onChange: (v: string) => void; min?: number; label: string;
}) {
  const n = parseInt(value, 10);
  const step = (d: number) => onChange(String(Math.max(min, (Number.isFinite(n) ? n : min) + d)));
  return (
    <div className="obf-stepper">
      <input id={id} type="number" inputMode="numeric" min={min} value={value} onChange={e => onChange(e.target.value)} />
      <button type="button" onClick={() => step(-1)} aria-label={`${label} −1`}><Minus aria-hidden /></button>
      <button type="button" onClick={() => step(1)} aria-label={`${label} +1`}><Plus aria-hidden /></button>
    </div>
  );
}

export default function DrugOrderForm({
  initial, patient, activeMedications, stockFor, facilityName, onSave, onDiscard,
}: {
  initial: DrugOrderDraft;
  patient: PatientDoc;
  /** Names of the patient's current medicines, for the interaction check. */
  activeMedications: string[];
  /** Where this drug stands on the facility shelf at a quantity; null when not tracked. */
  stockFor: (medication: string, quantity: number) => StockPosition | null;
  facilityName: string;
  onSave: (order: DrugOrderDraft) => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation();
  const [order, setOrder] = useState<DrugOrderDraft>(initial);
  const [tried, setTried] = useState(false);
  const patch = (p: Partial<DrugOrderDraft>) => setOrder(prev => ({ ...prev, ...p }));
  const gaps = drugOrderGaps(order);
  const showGap = (gap: (typeof gaps)[number]) => tried && gaps.includes(gap);

  // O3 pins the drug's name in a coloured bar once its heading scrolls away.
  const heading = useRef<HTMLHeadingElement>(null);
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    const el = heading.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setPinned(!entry.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const allergyHits = useMemo(() => checkAllergiesStructured(
    [order.drug.name],
    (patient.structuredAllergies || []).filter(a => a.status === 'active'),
  ), [order.drug.name, patient.structuredAllergies]);
  const [interactions, setInteractions] = useState<{ severity: string; text: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { checkNewPrescription } = await import('@/lib/services/drug-interaction-service');
        const result = checkNewPrescription(order.drug.name, activeMedications);
        if (!cancelled) setInteractions(result.interactions.map(i => ({ severity: i.severity, text: `${i.drug1} ↔ ${i.drug2} — ${i.description}` })));
      } catch { if (!cancelled) setInteractions([]); }
    })();
    return () => { cancelled = true; };
  }, [order.drug.name, activeMedications]);

  const quantity = quantityFor(order);
  const stock = stockFor(order.drug.name, Math.max(1, quantity));
  const drugName = (
    <>
      <strong>{order.drug.name}</strong>{order.drug.form ? <span> — {order.drug.form}</span> : null}
    </>
  );

  const save = () => {
    setTried(true);
    if (gaps.length) return;
    onSave(order);
  };

  return (
    <div className="obf-form">
      {pinned && <div className="obf-pinned" aria-hidden>{drugName}</div>}
      <div className="obf-form-body">
        <PatientBanner patient={patient} />
        <div className="obf-pad">
          <h2 className="obf-form-title">{t('basket.orderFormTitle')}</h2>
          <h3 ref={heading} className="obf-drug">{drugName}</h3>

          {(allergyHits.length > 0 || interactions.length > 0) && (
            <div className="obf-alerts" role="alert">
              {allergyHits.map(hit => (
                <p key={hit.allergy} className="obf-alert obf-alert--danger">
                  <AlertTriangle aria-hidden />
                  {t('basket.allergyClash', { medication: hit.medication, allergy: hit.allergy })}
                  {hit.reaction ? ` (${hit.reaction})` : ''}
                </p>
              ))}
              {interactions.map(i => (
                <p key={i.text} className={i.severity === 'contraindicated' || i.severity === 'serious' ? 'obf-alert obf-alert--danger' : 'obf-alert'}>
                  <AlertTriangle aria-hidden /> {i.text}
                </p>
              ))}
            </div>
          )}

          <section className="obf-section">
            <div className="obf-section-head">
              <h4>{t('basket.sectionDosage')}</h4>
              <label className="obf-toggle">
                <span>{t('basket.freeTextDosage')}</span>
                <span className="obf-switch">
                  <input type="checkbox" role="switch" checked={order.freeText} onChange={e => patch({ freeText: e.target.checked })} />
                  <span aria-hidden />
                  <em>{order.freeText ? t('basket.on') : t('basket.off')}</em>
                </span>
              </label>
            </div>

            {order.freeText ? (
              <label className="obf-field">
                <span className="obf-label">{t('basket.freeTextLabel')}</span>
                <textarea
                  rows={3}
                  value={order.freeTextDosage}
                  onChange={e => patch({ freeTextDosage: e.target.value })}
                  placeholder={t('basket.freeTextPlaceholder')}
                  aria-invalid={showGap('freeText') || undefined}
                />
                {showGap('freeText') && <span className="obf-error">{t('basket.required')}</span>}
              </label>
            ) : (
              <>
                <div className="obf-row">
                  <label className="obf-field">
                    <span className="obf-label">{t('basket.dose')}</span>
                    <input type="text" inputMode="decimal" value={order.dose} placeholder={t('basket.dose')} onChange={e => patch({ dose: e.target.value })} aria-invalid={showGap('dose') || undefined} />
                    {showGap('dose') && <span className="obf-error">{t('basket.required')}</span>}
                  </label>
                  <label className="obf-field">
                    <span className="obf-label">{t('basket.doseUnit')}</span>
                    <Select value={order.doseUnit} onChange={e => patch({ doseUnit: e.target.value })}>
                      {DOSE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </Select>
                  </label>
                </div>
                <label className="obf-field">
                  <span className="obf-label">{t('basket.route')}</span>
                  <Select value={order.route} onChange={e => patch({ route: e.target.value })} aria-invalid={showGap('route') || undefined}>
                    <option value="">{t('basket.route')}</option>
                    {ROUTES.map(r => <option key={r} value={r}>{t(`basket.routeName.${r}`)}</option>)}
                  </Select>
                  {showGap('route') && <span className="obf-error">{t('basket.required')}</span>}
                </label>
                <label className="obf-field">
                  <span className="obf-label">{t('basket.frequency')}</span>
                  <Select value={order.frequency} onChange={e => patch({ frequency: e.target.value })} aria-invalid={showGap('frequency') || undefined}>
                    <option value="">{t('basket.frequency')}</option>
                    {FREQUENCIES.map(f => <option key={f} value={f}>{t(`basket.freqName.${f}`)}</option>)}
                  </Select>
                  {showGap('frequency') && <span className="obf-error">{t('basket.required')}</span>}
                </label>
              </>
            )}

            <label className="obf-field">
              <span className="obf-label">{t('basket.patientInstructions')}</span>
              <textarea rows={3} value={order.patientInstructions} placeholder={t('basket.patientInstructionsPlaceholder')} onChange={e => patch({ patientInstructions: e.target.value })} />
            </label>

            <div className="obf-row obf-row--prn">
              <div className="obf-field">
                <span className="obf-label">{t('basket.prn')}</span>
                <label className="obf-check">
                  <input type="checkbox" checked={order.prn} onChange={e => patch({ prn: e.target.checked })} />
                  <span>{t('basket.takeAsNeeded')}</span>
                </label>
              </div>
              <label className="obf-field">
                <span className="obf-label">{t('basket.prnReason')}</span>
                <textarea rows={3} disabled={!order.prn} value={order.prnReason} placeholder={t('basket.prnReasonPlaceholder')} onChange={e => patch({ prnReason: e.target.value })} aria-invalid={showGap('prnReason') || undefined} />
                {showGap('prnReason') && <span className="obf-error">{t('basket.required')}</span>}
              </label>
            </div>
          </section>

          <section className="obf-section">
            <div className="obf-section-head"><h4>{t('basket.sectionDuration')}</h4></div>
            <label className="obf-field obf-field--half">
              <span className="obf-label">{t('basket.startDate')}</span>
              <input type="date" value={order.startDate} onChange={e => patch({ startDate: e.target.value })} />
            </label>
            <div className="obf-row">
              <div className="obf-field">
                <label className="obf-label" htmlFor="obf-duration">{t('basket.duration')}</label>
                <Stepper id="obf-duration" value={order.duration} onChange={v => patch({ duration: v })} label={t('basket.duration')} />
              </div>
              <label className="obf-field">
                <span className="obf-label">{t('basket.durationUnit')}</span>
                <Select value={order.durationUnit} onChange={e => patch({ durationUnit: e.target.value as DurationUnit })}>
                  {(['days', 'weeks', 'months'] as const).map(u => <option key={u} value={u}>{t(`basket.unit.${u}`)}</option>)}
                </Select>
              </label>
            </div>
          </section>

          <section className="obf-section">
            <div className="obf-section-head"><h4>{t('basket.sectionDispensing')}</h4></div>
            <div className="obf-row">
              <label className="obf-field">
                <span className="obf-label">{t('basket.quantity')}</span>
                <input type="number" inputMode="numeric" min={1} value={order.quantity} placeholder={String(quantity)} onChange={e => patch({ quantity: e.target.value })} />
              </label>
              <label className="obf-field">
                <span className="obf-label">{t('basket.quantityUnit')}</span>
                <Select value={order.quantityUnit} onChange={e => patch({ quantityUnit: e.target.value })}>
                  {DOSE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </Select>
              </label>
            </div>
            {stock && <StockNotice position={stock} facilityName={facilityName} />}
            <div className="obf-field obf-field--half">
              <label className="obf-label" htmlFor="obf-refills">{t('basket.refills')}</label>
              <Stepper id="obf-refills" value={order.refills} onChange={v => patch({ refills: v })} label={t('basket.refills')} />
            </div>
            <label className="obf-field">
              <span className="obf-label">{t('basket.indication')}</span>
              <input type="text" value={order.indication} placeholder={t('basket.indicationPlaceholder')} onChange={e => patch({ indication: e.target.value })} />
            </label>
          </section>
        </div>
      </div>
      <FormNotices />
      <div className="obk-footer">
        <button type="button" className="obk-footer-btn obk-footer-btn--secondary" onClick={onDiscard}>{t('basket.discard')}</button>
        <button type="button" className="obk-footer-btn obk-footer-btn--primary" onClick={save}>{t('basket.saveOrder')}</button>
      </div>
    </div>
  );
}
