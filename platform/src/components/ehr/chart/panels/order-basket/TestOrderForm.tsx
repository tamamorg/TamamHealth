'use client';

/**
 * The O3 test order form: the test, a reference number, its priority and
 * instructions for the bench, over Discard / Save order. Saving puts it in
 * the basket; the lab sees nothing until the basket is signed.
 */

import { useState } from 'react';
import { ArrowLeft } from '@/components/icons/lucide';
import Select from '@/components/Select';
import type { LabOrderPriority } from '@/components/lab/order/lab-order-types';
import { useTranslation } from '@/lib/i18n/useTranslation';
import FormNotices from '@/components/overlay/FormNotices';
import type { TestOrderDraft } from './basket-types';

const INSTRUCTIONS_MAX = 500;

export default function TestOrderForm({ initial, onSave, onDiscard, onBack }: {
  initial: TestOrderDraft;
  onSave: (order: TestOrderDraft) => void;
  onDiscard: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [order, setOrder] = useState<TestOrderDraft>(initial);
  const patch = (p: Partial<TestOrderDraft>) => setOrder(prev => ({ ...prev, ...p }));

  return (
    <div className="obf-form">
      <div className="obf-form-body">
        <div className="obf-pad">
          <button type="button" className="obf-back" onClick={onBack}>
            <ArrowLeft aria-hidden /> {t('basket.backToBasket')}
          </button>
          <div className="obf-field">
            <span className="obf-label">{t('basket.testType')}</span>
            <p className="obf-value">{order.test.name}{order.test.specimen ? <span> — {order.test.specimen}</span> : null}</p>
          </div>
          <label className="obf-field">
            <span className="obf-label">{t('basket.referenceNumber')}</span>
            <input type="text" value={order.referenceNumber} onChange={e => patch({ referenceNumber: e.target.value })} />
          </label>
          <label className="obf-field obf-field--half">
            <span className="obf-label">{t('basket.priority')}</span>
            <Select value={order.priority} onChange={e => patch({ priority: e.target.value as LabOrderPriority })}>
              {(['routine', 'urgent', 'stat'] as const).map(p => <option key={p} value={p}>{t(`basket.priorityName.${p}`)}</option>)}
            </Select>
          </label>
          <label className="obf-field">
            <span className="obf-label obf-label--count">
              <span>{t('basket.additionalInstructions')}</span>
              <span>{order.instructions.length}/{INSTRUCTIONS_MAX}</span>
            </span>
            <textarea rows={5} maxLength={INSTRUCTIONS_MAX} value={order.instructions} onChange={e => patch({ instructions: e.target.value })} />
          </label>
        </div>
      </div>
      <FormNotices />
      <div className="obk-footer">
        <button type="button" className="obk-footer-btn obk-footer-btn--secondary" onClick={onDiscard}>{t('basket.discard')}</button>
        <button type="button" className="obk-footer-btn obk-footer-btn--primary" onClick={() => onSave(order)}>{t('basket.saveOrder')}</button>
      </div>
    </div>
  );
}
