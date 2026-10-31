'use client';

import FormSlider from '@/components/overlay/FormSlider';
import { formatDateTime, formatDate, formatMoney, humanizeStatus } from '@/lib/format-utils';
import { getMethodConfig } from '@/lib/payment-method-config';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { AccountLine, AccountLineUpdate } from '@/lib/billing-account-lines';
import type { PaymentDoc } from '@/lib/db-types-payments';
import '@/components/billing/billing.css';

type Translate = ReturnType<typeof useTranslation>['t'];

/** What a billing line is called: its first two items, then a count. */
export function accountLineTitle(line: AccountLine, t: Translate): string {
  const names = [...new Set(line.items.map(item => item.description))];
  if (names.length === 0) return t('billing.lineOnAccount');
  const shown = names.slice(0, 2).join(' + ');
  return names.length > 2 ? `${shown} + ${t('billing.lineMore', { count: names.length - 2 })}` : shown;
}

/**
 * One billing line in full: everything charged on the visit, then every
 * payment, refund and adjustment that has updated it. The list shows one row
 * however many of these there are, so this is where they are read.
 */
export default function BillingLinePanel({ line, patientName, payments, refundableIds, onClose, onCollect, onAdjust, onPrintReceipt, onRefund }: {
  line: AccountLine;
  patientName: string;
  payments: Map<string, PaymentDoc>;
  /** Payments this user can refund now. */
  refundableIds: Set<string>;
  onClose: () => void;
  onCollect?: () => void;
  onAdjust?: () => void;
  onPrintReceipt: (paymentId: string) => void;
  onRefund: (paymentId: string) => void;
}) {
  const { t } = useTranslation();
  const money = (amount: number) => formatMoney(amount, { currency: line.currency });
  const signed = (amount: number) => (amount < 0 ? `− ${money(Math.abs(amount))}` : money(amount));

  const updateText = (update: AccountLineUpdate) => {
    const payment = update.paymentId ? payments.get(update.paymentId) : undefined;
    // A payment's ledger text repeats the amount; a reversal's carries its reason.
    return payment && update.amount < 0 ? getMethodConfig(payment.method).label : update.description;
  };
  const updateLabel = (update: AccountLineUpdate) => {
    const kind = t(`billing.activityKind.${update.kind}`);
    if (update.kind === 'charge') return kind;
    // A reversal names itself, and a refund's ledger text already opens with "Refund:".
    if (update.kind === 'payment' && update.amount > 0) return update.description;
    return `${kind}: ${updateText(update).replace(/^Refund:\s*/, '')}`;
  };
  const updateMeta = (update: AccountLineUpdate) => [
    formatDateTime(update.date),
    update.by,
    update.reference,
    update.entryAmount !== undefined ? t('billing.linePartOf', { amount: money(Math.abs(update.entryAmount)) }) : undefined,
    t('billing.lineBalanceAfter', { amount: signed(update.balance) }),
  ].filter(Boolean).join(' · ');

  return (
    <FormSlider
      title={accountLineTitle(line, t)}
      subtitle={`${patientName} · ${formatDate(line.date)}`}
      className="tamam-dialog"
      width={560}
      onClose={onClose}
      footer={<>
        <button type="button" className="btn btn-secondary" onClick={onClose}>{t('billing.activityClose')}</button>
        {onCollect && <button type="button" className="btn btn-primary" onClick={onCollect}>{t('billing.collectPayment')}</button>}
      </>}
    >
      <div className="bl-root bl-line">
        <dl className="bl-totals">
          <div className="bl-totals-row"><dt>{t('billing.lineBilled')}</dt><dd>{money(line.charged)}</dd></div>
          <div className="bl-totals-row"><dt>{t('billing.linePaid')}</dt><dd>{money(line.paid)}</dd></div>
          {line.adjusted !== 0 && <div className="bl-totals-row"><dt>{t('billing.lineAdjusted')}</dt><dd>{money(line.adjusted)}</dd></div>}
          {line.refunded !== 0 && <div className="bl-totals-row"><dt>{t('billing.lineRefunded')}</dt><dd>{money(line.refunded)}</dd></div>}
          <hr className="bl-totals-rule" />
          <div className="bl-totals-row bl-totals-row--due"><dt>{t('billing.lineBalance')}</dt><dd>{signed(line.balance)}</dd></div>
        </dl>
        {onAdjust && (
          <div className="bl-line-actions">
            <button type="button" className="bl-btn bl-btn--outline" onClick={onAdjust}>{t('billing.adjustmentWriteOff')}</button>
          </div>
        )}

        {line.items.length > 0 && (
          <section className="bl-line-section">
            <h3>{t('billing.lineCharged')}</h3>
            <ul className="bl-line-list">
              {line.items.map(item => (
                <li key={item.id}>
                  <span>{item.description}</span>
                  <strong>{money(item.total)}</strong>
                  <p className="bl-line-sub">
                    {[
                      item.unitPrice !== undefined ? `${item.quantity} × ${money(item.unitPrice)}` : undefined,
                      item.category,
                      item.status ? humanizeStatus(item.status) : undefined,
                    ].filter(Boolean).join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="bl-line-section">
          <h3>{t('billing.lineUpdates')}</h3>
          <ul className="bl-line-list">
            {[...line.updates].reverse().map(update => (
              <li key={update.id}>
                <span>{updateLabel(update)}</span>
                <strong>{signed(update.amount)}</strong>
                <p className="bl-line-sub">{updateMeta(update)}</p>
                {update.paymentId && update.amount < 0 && (
                  <div className="bl-line-actions">
                    <button type="button" className="bl-btn bl-btn--outline" onClick={() => onPrintReceipt(update.paymentId!)}>{t('billing.rowPrintReceipt')}</button>
                    {refundableIds.has(update.paymentId) && <button type="button" className="bl-btn bl-btn--outline" onClick={() => onRefund(update.paymentId!)}>{t('billing.issueRefund')}</button>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </FormSlider>
  );
}
