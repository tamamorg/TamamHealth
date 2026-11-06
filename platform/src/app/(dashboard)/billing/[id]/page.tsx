'use client';

/**
 * Bill detail — Tamam O3-style invoice workspace. Patient banner, bill
 * actions (discount / add items / delete / finalize / print), the line-item
 * table, and the payments panel with a running totals sidebar.
 *
 * Flow: a bill stays editable until it is finalized; payments can only be
 * recorded after finalization (mirroring the O3 billing module).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useToast } from '@/components/Toast';
import { usePermissions } from '@/lib/hooks/usePermissions';
import Modal from '@/components/Modal';
import FormSlider from '@/components/overlay/FormSlider';
import { DialogFooter, DialogFrame, DialogHeader } from '@/components/overlay/Dialog';
import RowActionsMenu from '@/components/RowActionsMenu';
import AdmissionDepositControls from '@/components/billing/AdmissionDepositControls';
import { Receipt, Printer, Plus, Search, Activity, ChevronLeft } from '@/components/icons/lucide';
import { formatMoney } from '@/lib/format-utils';
import { patientFullName, patientInitials, patientAgeLabel, avatarTint } from '@/lib/patient-utils';
import {
  formatBillDate, STATUS_CHIP, CATEGORY_LABELS, PAYMENT_METHOD_LABELS, invoiceStatusLabel,
} from '@/components/billing/billing-utils';
import type { BillingDoc, BillLineItem, ChargeCategory, PaymentMethod, FeeScheduleDoc } from '@/lib/db-types-billing';
import type { PatientDoc } from '@/lib/db-types';
import '@/components/billing/billing.css';
import Select from '@/components/Select';
import { escapeHtml, openIsolatedHtmlWindow } from '@/lib/safe-html';
import { buildClinicalPrintDocument } from '@/lib/print-document';
import { formatPrintedAt, printDate } from '@/lib/print-identity';
import { formatDobOmrs } from '@/lib/date-utils';
import { useTranslation } from '@/lib/i18n/useTranslation';
import NumberInput from '@/components/forms/NumberInput';


const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'mobile_money', 'bank_transfer', 'insurance', 'credit'];
const CATEGORIES = Object.keys(CATEGORY_LABELS) as ChargeCategory[];

export default function BillDetailPage() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const billId = params?.id;
  const router = useRouter();
  const { currentUser } = useAuth();
  const scope = useDataScope();
  const { showToast } = useToast();
  const { canCollectPayments } = usePermissions();

  const [bill, setBill] = useState<BillingDoc | null>(null);
  const [patient, setPatient] = useState<PatientDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Line items
  const [itemSearch, setItemSearch] = useState('');
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [qtyDraft, setQtyDraft] = useState('1');

  // Payment entry
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash');
  const [payReference, setPayReference] = useState('');
  const [savingPayment, setSavingPayment] = useState(false);

  // Modals
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountAmount, setDiscountAmount] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [addItemsOpen, setAddItemsOpen] = useState(false);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  // "Add items" modal state
  const [fees, setFees] = useState<FeeScheduleDoc[]>([]);
  const [feesLoading, setFeesLoading] = useState(false);
  const [feeSearch, setFeeSearch] = useState('');
  const [pendingItems, setPendingItems] = useState<BillLineItem[]>([]);
  const [customDesc, setCustomDesc] = useState('');
  const [customCategory, setCustomCategory] = useState<ChargeCategory>('other');
  const [customPrice, setCustomPrice] = useState('');

  const actorId = currentUser?._id || 'system';
  const actorName = currentUser?.name || 'System';

  const loadBill = useCallback(async () => {
    if (!billId || !scope) return;
    try {
      const { getBillById } = await import('@/lib/services/billing-service');
      const doc = await getBillById(billId, scope);
      if (!doc) { setNotFound(true); return; }
      setBill(doc);
      const { getPatientById } = await import('@/lib/services/patient-service');
      setPatient(await getPatientById(doc.patientId, scope));
    } catch (err) {
      console.error('Error loading bill:', err);
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [billId, scope]);

  useEffect(() => { loadBill(); }, [loadBill]);

  const finalized = !!bill?.finalizedAt;
  // Rebuilt after charges were lost at sync: nothing is owed until it is finalized.
  const underReview = bill?.status === 'draft';
  const editable = !!bill && canCollectPayments && !finalized && bill.payments.length === 0 && bill.status === 'pending';
  const payable = !!bill && canCollectPayments && finalized && (bill.status === 'pending' || bill.status === 'partial');
  const currency = bill?.currency;
  const money = (n?: number | null) => formatMoney(n, { currency, decimals: 2 });

  const visibleItems = useMemo(() => {
    if (!bill) return [];
    const q = itemSearch.trim().toLowerCase();
    if (!q) return bill.items;
    return bill.items.filter(i =>
      i.description.toLowerCase().includes(q) || CATEGORY_LABELS[i.category]?.toLowerCase().includes(q));
  }, [bill, itemSearch]);

  // ── Mutations ──────────────────────────────────────────────────────

  const withReload = async (fn: () => Promise<unknown>, successMsg: string, failMsg: string) => {
    setBusy(true);
    try {
      const result = await fn();
      if (result === null) {
        showToast(failMsg, 'error');
      } else {
        showToast(successMsg, 'success');
        await loadBill();
      }
    } catch (err) {
      console.error(failMsg, err);
      showToast(failMsg, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleFinalize = async () => {
    if (!bill) return;
    const { finalizeBill } = await import('@/lib/services/billing-service');
    await withReload(
      () => finalizeBill(bill._id, actorId, actorName),
      `${bill.invoiceNumber} finalized — payments can now be recorded`,
      'Could not finalize this bill',
    );
    setConfirmFinalize(false);
  };

  const handleDelete = async () => {
    if (!bill) return;
    setBusy(true);
    try {
      const { cancelBill } = await import('@/lib/services/billing-service');
      const result = await cancelBill(bill._id, actorId, actorName);
      if (result === null) {
        showToast(t('msg.billNotDeletedItHas'), 'error');
      } else {
        showToast(t('msg.billDeleted', { invoiceNumber: bill.invoiceNumber }), 'success');
        router.push('/billing');
        return;
      }
    } catch (err) {
      console.error('Could not delete bill', err);
      showToast(t('msg.billNotDeletedTryAgain'), 'error');
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  const handleApplyDiscount = async () => {
    if (!bill) return;
    const amount = parseFloat(discountAmount);
    const reason = discountReason.trim();
    if (!Number.isFinite(amount) || amount < 0 || !reason) return;
    const { applyDiscount } = await import('@/lib/services/billing-service');
    await withReload(
      () => applyDiscount(bill._id, amount, reason, actorId, actorName),
      `Discount of ${money(amount)} applied`,
      'Could not apply discount (it may exceed the bill subtotal)',
    );
    setDiscountOpen(false);
    setDiscountAmount('');
    setDiscountReason('');
  };

  const saveItems = async (items: BillLineItem[], successMsg: string) => {
    if (!bill) return;
    const { updateBillItems } = await import('@/lib/services/billing-service');
    await withReload(
      () => updateBillItems(bill._id, items, actorId, actorName),
      successMsg,
      'Could not update bill items',
    );
  };

  const handleSaveQty = async (item: BillLineItem) => {
    if (!bill) return;
    const qty = parseInt(qtyDraft, 10);
    setEditingItemId(null);
    if (!Number.isFinite(qty) || qty < 1 || qty === item.quantity) return;
    await saveItems(
      bill.items.map(i => (i.id === item.id ? { ...i, quantity: qty } : i)),
      `Quantity updated for ${item.description}`,
    );
  };

  const handleRemoveItem = async (item: BillLineItem) => {
    if (!bill) return;
    if (bill.items.length <= 1) {
      showToast(t('msg.aBillNeedsAtLeast'), 'error');
      return;
    }
    await saveItems(bill.items.filter(i => i.id !== item.id), `${item.description} removed from bill`);
  };

  const openAddItems = async () => {
    setAddItemsOpen(true);
    setPendingItems([]);
    setFeeSearch('');
    if (fees.length === 0 && scope) {
      setFeesLoading(true);
      try {
        const { getActiveFees } = await import('@/lib/services/fee-schedule-service');
        setFees(await getActiveFees(scope) || []);
      } catch (err) {
        console.error('Could not load fee schedule', err);
      } finally {
        setFeesLoading(false);
      }
    }
  };

  const addFeeToPending = (fee: FeeScheduleDoc) => {
    setPendingItems(prev => [...prev, {
      id: `new-${Date.now()}-${prev.length}`,
      category: fee.category,
      description: fee.serviceName,
      quantity: 1,
      unitPrice: fee.unitPrice,
      totalPrice: fee.unitPrice,
    }]);
  };

  const addCustomToPending = () => {
    const price = parseFloat(customPrice);
    const desc = customDesc.trim();
    if (!desc || !Number.isFinite(price) || price < 0) return;
    setPendingItems(prev => [...prev, {
      id: `new-${Date.now()}-${prev.length}`,
      category: customCategory,
      description: desc,
      quantity: 1,
      unitPrice: price,
      totalPrice: price,
    }]);
    setCustomDesc('');
    setCustomPrice('');
  };

  const handleSaveNewItems = async () => {
    if (!bill || pendingItems.length === 0) return;
    await saveItems([...bill.items, ...pendingItems], `${pendingItems.length} item${pendingItems.length === 1 ? '' : 's'} added to bill`);
    setAddItemsOpen(false);
  };

  const handleRecordPayment = async () => {
    if (!bill) return;
    const amount = parseFloat(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast(t('msg.enterAPaymentAmountGreater'), 'error');
      return;
    }
    if (amount > bill.balanceDue) {
      showToast(t('msg.enterAnAmountUpTo', { value: money(bill.balanceDue) }), 'error');
      return;
    }
    setSavingPayment(true);
    try {
      const { recordPayment } = await import('@/lib/services/billing-service');
      const result = await recordPayment(bill._id, amount, payMethod, actorId, actorName, payReference.trim() || undefined);
      if (result === null) {
        showToast(t('payments.errorPaymentFailed'), 'error');
      } else {
        showToast(t('msg.paymentOfRecorded', { value: money(amount) }), 'success');
        setPayAmount('');
        setPayReference('');
        await loadBill();
      }
    } catch (err) {
      console.error('Could not record payment', err);
      showToast(t('payments.errorPaymentFailed'), 'error');
    } finally {
      setSavingPayment(false);
    }
  };

  const handlePrint = () => {
    if (!bill) return;
    const rows = bill.items.map((i, n) => `
      <tr>
        <td>${n + 1}</td><td>${escapeHtml(i.description)}</td><td>${escapeHtml(CATEGORY_LABELS[i.category] || i.category)}</td>
        <td class="num">${escapeHtml(i.quantity)}</td><td class="num">${escapeHtml(money(i.unitPrice))}</td><td class="num">${escapeHtml(money(i.totalPrice))}</td>
      </tr>`).join('');
    const payRows = bill.payments.map(p => `
      <tr><td>${escapeHtml(formatPrintedAt(new Date(p.receivedAt)))}</td><td>${escapeHtml(PAYMENT_METHOD_LABELS[p.method] || p.method)}</td>
      <td>${escapeHtml(p.reference || '—')}</td><td>${escapeHtml(p.receivedByName)}</td><td class="num">${escapeHtml(money(p.amount))}</td></tr>`).join('');
    const reversal = bill.chargeReversedAt
      ? `<p class="notice"><strong>${t('ui.chargeReversed')}</strong> on ${escapeHtml(printDate(bill.chargeReversedAt))}: ${escapeHtml(bill.chargeReversalReason || '')}. ${escapeHtml(money(bill.amountPaid))} collected against this invoice is a credit on the patient's account until refunded.</p>`
      : '';
    const body = `${reversal}
      <section class="section"><h2 class="section-title">${t('ui.lineItems')}</h2>
        <table><thead><tr><th>#</th><th>${t('ui.item')}</th><th>${t('equipment.colCategory')}</th><th class="num">${t('ui.qty')}</th><th class="num">${t('ui.unitPrice2')}</th><th class="num">${t('dashboard.total')}</th></tr></thead><tbody>${rows}</tbody></table>
      </section>
      ${bill.payments.length ? `<section class="section"><h2 class="section-title">${t('billing.activityPayments')}</h2><table><thead><tr><th>${t('billing.activityColumn.date')}</th><th>${t('payments.methodFallback')}</th><th>${t('patientPortal.reference')}</th><th>${t('labFlow.receivedBy')}</th><th class="num">${t('billing.amount')}</th></tr></thead><tbody>${payRows}</tbody></table></section>` : '<p class="notice">No payments have been recorded against this invoice.</p>'}
      <div class="totals">
        <div class="total-row"><span>${t('ui.subtotal2')}</span><strong>${escapeHtml(money(bill.subtotal))}</strong></div>
        <div class="total-row"><span>${t('ui.discount2')}</span><strong>− ${escapeHtml(money(bill.discount))}</strong></div>
        ${bill.taxAmount ? `<div class="total-row"><span>Tax (${escapeHtml(bill.taxRate)}%)</span><strong>${escapeHtml(money(bill.taxAmount))}</strong></div>` : ''}
        <div class="total-row"><span>${t('ui.invoiceTotal')}</span><strong>${escapeHtml(money(bill.totalAmount))}</strong></div>
        <div class="total-row"><span>${t('claims.colPaid')}</span><strong>− ${escapeHtml(money(bill.amountPaid))}</strong></div>
        <div class="total-row grand"><strong>${t('ui.amountDue')}</strong><strong>${escapeHtml(money(bill.balanceDue))}</strong></div>
      </div>`;
    const html = buildClinicalPrintDocument({
      title: bill.invoiceNumber,
      documentLabel: 'Patient Invoice',
      date: bill.createdAt,
      facilityName: bill.facilityName,
      metaTitle: 'Patient Information',
      meta: [
        { label: 'Patient Name', value: bill.patientName },
        { label: 'Patient ID', value: bill.hospitalNumber || bill.patientId },
        { label: 'Invoice Number', value: bill.invoiceNumber },
        { label: 'Invoice Status', value: invoiceStatusLabel(bill) },
      ],
      safeBodyHtml: body,
      footer: 'Patient invoice generated from the billing ledger. Retain with the payment record.',
    });
    openIsolatedHtmlWindow(html, '', true);
  };

  // ── Render ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <main className="page-container page-enter">
        <div className="bl-root"><div className="bl-loading"><Activity size={30} style={{ animation: 'spin 1s linear infinite' }} /><span>{t('ui.loadingBill')}</span></div></div>
      </main>
    );
  }

  if (notFound || !bill) {
    return (
      <main className="page-container page-enter">
        <div className="bl-root">
          <div className="bl-card">
            <div className="bl-empty">
              <Receipt size={34} />
              <h3>{t('ui.billNotFound')}</h3>
              <p>{t('ui.thisBillMayHaveBeen')}</p>
              <button type="button" className="bl-btn bl-btn--outline" onClick={() => router.push('/billing')}>
                <ChevronLeft size={15} /> {t('ui.backToBillList')}
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const chip = STATUS_CHIP[bill.status];
  const displayName = patient ? patientFullName(patient) : bill.patientName;
  const genderSymbol = patient?.gender === 'Male' ? '♂' : patient?.gender === 'Female' ? '♀' : null;
  const genderClass = patient?.gender === 'Male' ? 'male' : patient?.gender === 'Female' ? 'female' : '';
  // The line-item column reports the BILL's settlement state — line items carry
  // no state of their own — so it has to name every state the bill can be in.
  // It used to collapse everything except paid/cancelled into "PENDING", which
  // told a cashier looking at a half-settled bill that nothing had been paid.
  const serviceStatus = invoiceStatusLabel(bill);

  return (
    <main className="page-container page-enter">
      <div className="bl-root">
        {bill.items.filter(item => item.category === 'admission_deposit' && item.referenceId).map(item => <AdmissionDepositControls key={item.referenceId} admissionId={item.referenceId!} />)}
        {/* ── Patient banner ── */}
        <div className="bl-banner">
          <div className="bl-avatar" style={avatarTint(displayName)} aria-hidden>
            {patient ? patientInitials(patient) : (bill.patientName || '?').slice(0, 2).toUpperCase()}
          </div>
          <div className="bl-banner-body">
            <div className="bl-banner-name-row">
              <h1 className="bl-banner-name">{displayName}</h1>
              {genderSymbol && <span className={`bl-gender ${genderClass}`} aria-label={patient?.gender}>{genderSymbol}</span>}
              {chip && <span className={`bl-chip ${chip.cls}`}>{chip.label}</span>}
              {bill.insuranceProvider && <span className="bl-chip bl-chip--ontime">{bill.insuranceProvider}</span>}
            </div>
            <div className="bl-banner-meta">
              {patient && <>
                <span>{patientAgeLabel(patient)}</span>
                <span>·</span>
                <span>{formatDobOmrs(patient.dateOfBirth)}</span>
                <span>·</span>
              </>}
              <span className="bl-id-tag">{t('ui.facilityId')} <strong>{bill.hospitalNumber || patient?.hospitalNumber || patient?.geocodeId || '—'}</strong></span>
              <span className="bl-id-tag">{bill.facilityName}</span>
            </div>
          </div>
        </div>

        {/* ── Bill actions ── */}
        {canCollectPayments && (
          <div className="bl-actions-row no-print" data-tour="bill-actions">
            {(bill.status === 'pending' || bill.status === 'partial') && (
              <button type="button" className="bl-btn bl-btn--outline" onClick={() => setDiscountOpen(true)} disabled={busy}>
                {t('ui.requestDiscount')}
              </button>
            )}
            {editable && (
              <button type="button" className="bl-btn bl-btn--link" onClick={openAddItems} disabled={busy}>
                {t('ui.addItemsToBill')} <Plus size={15} />
              </button>
            )}
            {(editable || (underReview && canCollectPayments)) && (
              <button type="button" className="bl-btn bl-btn--danger-link" onClick={() => setConfirmDelete(true)} disabled={busy}>
                {t('ui.deleteBill')}
              </button>
            )}
            {!finalized && (bill.status === 'pending' || underReview) && (
              <button type="button" className="bl-btn bl-btn--primary" onClick={() => setConfirmFinalize(true)} disabled={busy}>
                {t('ui.finalizeBill')}
              </button>
            )}
            <button type="button" className="bl-btn bl-btn--primary" onClick={handlePrint}>
              {t('ui.printBill')} <Printer size={15} />
            </button>
          </div>
        )}

        {underReview && (
          <p role="status" style={{ margin: '0 0 12px', padding: '10px 14px', border: '1px solid var(--color-warning-border)', borderRadius: 0, background: 'var(--color-warning-bg)', color: 'var(--color-warning-text)', fontSize: 13 }}>
            <strong>{t('billing.review.title')}</strong> {t('billing.review.body')}
          </p>
        )}

        {bill.chargeReversedAt && (
          <p role="status" style={{ margin: '0 0 12px', padding: '10px 14px', border: '1px solid var(--color-warning-border)', borderRadius: 0, background: 'var(--color-warning-bg)', color: 'var(--color-warning-text)', fontSize: 13 }}>
            <strong>{t('ui.chargeReversed')}</strong> on {formatBillDate(bill.chargeReversedAt)}{bill.chargeReversedBy ? ` by ${bill.chargeReversedBy}` : ''}: {bill.chargeReversalReason}.
            {' '}{money(bill.amountPaid)} {t('ui.wasCollectedAgainstThisInvoice')}
          </p>
        )}

        {/* ── Summary strip ── */}
        <div className="bl-summary-strip">
          <div><p className="bl-summary-label">{t('ui.dateBillCreated')}</p><p className="bl-summary-value" style={{ fontSize: 16 }}>{formatBillDate(bill.createdAt)}</p></div>
          <div><p className="bl-summary-label">{t('ui.totalAmount')}</p><p className="bl-summary-value">{money(bill.totalAmount)}</p></div>
          <div><p className="bl-summary-label">{t('ui.amountTendered')}</p><p className="bl-summary-value">{money(bill.amountPaid)}</p></div>
          <div><p className="bl-summary-label">{t('ui.amountDue')}</p><p className="bl-summary-value">{money(bill.balanceDue)}</p></div>
          <div><p className="bl-summary-label">{t('ui.invoiceNumber')}</p><p className="bl-summary-value" style={{ fontSize: 16 }}>{bill.invoiceNumber}</p></div>
          <div><p className="bl-summary-label">{t('ui.invoiceStatus')}</p><p className="bl-summary-value" style={{ fontSize: 16 }}>{invoiceStatusLabel(bill)}</p></div>
        </div>

        {/* ── Line items ── */}
        <div className="bl-card">
          <div className="bl-card-head">
            <h2 className="bl-card-title">{t('ui.lineItems')}</h2>
            <p className="bl-card-sub">{t('ui.itemsToBeBilled')}</p>
            <span className="bl-underline" />
          </div>
          <div className="bl-search">
            <Search size={16} />
            <input
              type="text"
              value={itemSearch}
              onChange={e => setItemSearch(e.target.value)}
              placeholder={t('ui.searchThisTable')}
              aria-label={t('ui.searchLineItems')}
            />
          </div>
          <div className="bl-table-wrap">
            <table className="bl-table">
              <thead>
                <tr>
                  <th>{t('ui.number')}</th>
                  <th>{t('ui.billItem')}</th>
                  <th>{t('equipment.colCategory')}</th>
                  <th>{t('ui.serviceStatus')}</th>
                  <th className="bl-right">{t('pharmacy.quantity')}</th>
                  <th className="bl-right">{t('ui.price')}</th>
                  <th className="bl-right">{t('dashboard.total')}</th>
                  {editable && <th aria-label={t('ui.rowActions')} />}
                </tr>
              </thead>
              <tbody>
                {visibleItems.length === 0 ? (
                  <tr><td colSpan={editable ? 8 : 7} className="bl-muted" style={{ textAlign: 'center', padding: 24 }}>{t('ui.noLineItemsMatchYour')}</td></tr>
                ) : visibleItems.map((item, idx) => (
                  <tr key={item.id}>
                    <td className="bl-num">{idx + 1}</td>
                    <td>{item.description}</td>
                    <td className="bl-muted">{CATEGORY_LABELS[item.category] || item.category}</td>
                    <td>{serviceStatus}</td>
                    <td className="bl-num bl-right">
                      {editingItemId === item.id ? (
                        <NumberInput
                          className="bl-qty-input" step="any"
                          min={1}
                          value={qtyDraft}
                          autoFocus
                          onChange={e => setQtyDraft(e.target.value)}
                          onBlur={() => handleSaveQty(item)}
                          onKeyDown={e => { if (e.key === 'Enter') handleSaveQty(item); if (e.key === 'Escape') setEditingItemId(null); }}
                          style={{ font: 'inherit', border: '1px solid var(--bl-teal)', borderRadius: 0 }}
                        />
                      ) : item.quantity}
                    </td>
                    <td className="bl-num bl-right">{money(item.unitPrice)}</td>
                    <td className="bl-num bl-right">{money(item.totalPrice)}</td>
                    {editable && (
                      <td style={{ width: 34 }}>
                        {/* The shared list ⋮ (RowActionsMenu): same O3 menu, keyboard
                            and hover behaviour as every other list's row actions. */}
                        <RowActionsMenu
                          ariaLabel={`Actions for ${item.description}`}
                          actions={[
                            { key: 'qty', label: t('ui.editQuantity'), onClick: () => { setEditingItemId(item.id); setQtyDraft(String(item.quantity)); } },
                            { key: 'remove', label: t('ui.removeItem'), tone: 'danger', onClick: () => handleRemoveItem(item) },
                          ]}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Payments + totals ── */}
        <div className="bl-card">
          <div className="bl-pay-layout">
            <div className="bl-pay-main">
              <h2 className="bl-card-title">{t('billing.activityPayments')}</h2>
              <span className="bl-underline" />

              {!finalized && (bill.status === 'pending' || underReview) ? (
                <div className="bl-empty">
                  <h3>{t('ui.billNotFinalized')}</h3>
                  <p>{t('ui.finalizeThisBillBeforeRecording')}</p>
                  {canCollectPayments && (
                    <button type="button" className="bl-btn bl-btn--primary" onClick={() => setConfirmFinalize(true)} disabled={busy}>
                      {t('ui.finalizeBill')}
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {payable && (
                    <div className="bl-form-grid" style={{ marginTop: 14 }}>
                      <div className="bl-field">
                        <label htmlFor="bl-pay-method">{t('ui.paymentMethod')}</label>
                        <Select id="bl-pay-method" value={payMethod} onChange={e => setPayMethod(e.target.value as PaymentMethod)}>
                          {PAYMENT_METHODS.map(m => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}
                        </Select>
                      </div>
                      <div className="bl-field">
                        <label htmlFor="bl-pay-amount">{t('ui.amountTendered')}</label>
                        <NumberInput
                          id="bl-pay-amount"
                          min={0}
                          step="0.01"
                          value={payAmount}
                          onChange={e => setPayAmount(e.target.value)}
                          placeholder={String(bill.balanceDue)}
                        />
                      </div>
                      <div className="bl-field">
                        <label htmlFor="bl-pay-ref">{t('ui.referenceOptional')}</label>
                        <input
                          id="bl-pay-ref"
                          type="text"
                          value={payReference}
                          onChange={e => setPayReference(e.target.value)}
                          placeholder={t('ui.receiptTransactionNo')}
                        />
                      </div>
                      <div className="bl-field" style={{ justifyContent: 'flex-end' }}>
                        <button type="button" className="bl-btn bl-btn--primary" onClick={handleRecordPayment} disabled={savingPayment || !payAmount}>
                          {savingPayment ? 'Recording…' : 'Record payment'}
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="bl-table-wrap">
                    <table className="bl-table">
                      <thead>
                        <tr><th>{t('billing.activityColumn.date')}</th><th>{t('payments.methodFallback')}</th><th>{t('patientPortal.reference')}</th><th>{t('labFlow.receivedBy')}</th><th className="bl-right">{t('billing.amount')}</th></tr>
                      </thead>
                      <tbody>
                        {bill.payments.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="bl-muted" style={{ textAlign: 'center', padding: 24 }}>
                              {bill.status === 'paid' ? 'This bill is settled.' : 'Payments recorded against this bill will appear here.'}
                            </td>
                          </tr>
                        ) : bill.payments.map(p => (
                          <tr key={p.id}>
                            <td style={{ whiteSpace: 'nowrap' }}>{formatBillDate(p.receivedAt)}</td>
                            <td>{PAYMENT_METHOD_LABELS[p.method] || p.method}</td>
                            <td className="bl-muted">{p.reference || '—'}</td>
                            <td>{p.receivedByName}</td>
                            <td className="bl-num bl-right">{money(p.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>

            <aside className="bl-pay-aside">
              <dl className="bl-totals">
                <div className="bl-totals-row"><dt>{t('ui.totalAmount2')}</dt><dd>{money(bill.totalAmount)}</dd></div>
                <div className="bl-totals-row"><dt>{t('ui.totalTendered')}</dt><dd>{money(bill.amountPaid)}</dd></div>
                <div className="bl-totals-row"><dt>{t('ui.discount')}</dt><dd>- {money(bill.discount)}</dd></div>
                <div className="bl-totals-row"><dt>{t('ui.refunds')}</dt><dd>- {money(0)}</dd></div>
                <hr className="bl-totals-rule" />
                <div className="bl-totals-row bl-totals-row--due"><dt>{t('ui.amountDue2')}</dt><dd>{money(bill.balanceDue)}</dd></div>
              </dl>
              <button
                type="button"
                className="bl-btn bl-btn--dark"
                onClick={() => { setPayAmount(''); setPayReference(''); router.push('/billing'); }}
              >
                {t('consultation.discard')}
              </button>
            </aside>
          </div>
        </div>
      </div>

      {/* ── Request discount modal ── */}
      {discountOpen && (
        <FormSlider
          title={t('ui.requestDiscount')}
          subtitle={<>{t('ui.appliesToInvoice')} {bill.invoiceNumber} {t('ui.subtotal')} {money(bill.subtotal)}.</>}
          width={440}
          onClose={() => setDiscountOpen(false)}
          footer={<>
              <button type="button" className="btn btn-secondary" onClick={() => setDiscountOpen(false)}>{t('action.cancel')}</button>
              <button type="button" className="btn btn-primary" onClick={handleApplyDiscount} disabled={busy || !discountAmount || !discountReason.trim()}>
                {t('ui.applyDiscount')}
              </button>
          </>}
        >
          <div className="bl-root">
            <div className="bl-field">
              <label htmlFor="bl-disc-amount">{t('ui.discountAmount')}{currency})</label>
              <NumberInput id="bl-disc-amount" min={0} step="0.01" value={discountAmount} onChange={e => setDiscountAmount(e.target.value)} autoFocus />
            </div>
            <div className="bl-field">
              <label htmlFor="bl-disc-reason">{t('appointments.labelReason')}</label>
              <textarea id="bl-disc-reason" rows={2} value={discountReason} onChange={e => setDiscountReason(e.target.value)} placeholder={t('ui.eGIndigentPatientApproved')} />
            </div>
          </div>
        </FormSlider>
      )}

      {/* ── Add items modal ── */}
      {addItemsOpen && (
        <FormSlider
          title={t('ui.addItemsToBill')}
          subtitle={t('ui.pickFromTheFeeSchedule')}
          width={560}
          onClose={() => setAddItemsOpen(false)}
          footer={<>
              <button type="button" className="btn btn-secondary" onClick={() => setAddItemsOpen(false)}>{t('action.cancel')}</button>
              <button type="button" className="btn btn-primary" onClick={handleSaveNewItems} disabled={busy || pendingItems.length === 0}>
                {t('action.save')} {pendingItems.length > 0 ? `${pendingItems.length} item${pendingItems.length === 1 ? '' : 's'}` : 'items'}
              </button>
          </>}
        >
          <div className="bl-root">
            <div className="bl-field">
              <label htmlFor="bl-fee-search">{t('ui.searchFeeSchedule')}</label>
              <input id="bl-fee-search" type="text" value={feeSearch} onChange={e => setFeeSearch(e.target.value)} placeholder={t('ui.serviceNameOrCategory')} />
            </div>
            <div className="bl-fee-list">
              {feesLoading ? (
                <div className="bl-fee-row bl-muted">{t('ui.loadingFeeSchedule')}</div>
              ) : (
                (() => {
                  const q = feeSearch.trim().toLowerCase();
                  const list = fees.filter(f => !q
                    || f.serviceName.toLowerCase().includes(q)
                    || CATEGORY_LABELS[f.category]?.toLowerCase().includes(q)).slice(0, 30);
                  if (list.length === 0) return <div className="bl-fee-row bl-muted">{t('ui.noMatchingServices')}{fees.length === 0 ? ' — the fee schedule is empty; add a custom charge below' : ''}.</div>;
                  return list.map(fee => (
                    <div className="bl-fee-row" key={fee._id}>
                      <div>
                        <div className="bl-fee-name">{fee.serviceName}</div>
                        <div className="bl-fee-cat">{CATEGORY_LABELS[fee.category] || fee.category}</div>
                      </div>
                      <span className="bl-fee-price">{formatMoney(fee.unitPrice, { currency: fee.currency, decimals: 2 })}</span>
                      <button type="button" className="bl-fee-add" onClick={() => addFeeToPending(fee)}>{t('consultation.add')}</button>
                    </div>
                  ));
                })()
              )}
            </div>

            <div className="bl-form-grid">
              <div className="bl-field" style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="bl-custom-desc">{t('ui.customCharge')}</label>
                <input id="bl-custom-desc" type="text" value={customDesc} onChange={e => setCustomDesc(e.target.value)} placeholder={t('ui.description')} />
              </div>
              <div className="bl-field">
                <label htmlFor="bl-custom-cat">{t('equipment.colCategory')}</label>
                <Select id="bl-custom-cat" value={customCategory} onChange={e => setCustomCategory(e.target.value as ChargeCategory)}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                </Select>
              </div>
              <div className="bl-field">
                <label htmlFor="bl-custom-price">{t('ui.unitPrice')}{currency})</label>
                <NumberInput id="bl-custom-price" min={0} step="0.01" value={customPrice} onChange={e => setCustomPrice(e.target.value)} />
              </div>
              <div className="bl-field" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="bl-btn bl-btn--outline" onClick={addCustomToPending} disabled={!customDesc.trim() || !customPrice}>
                  {t('ui.addCustom')}
                </button>
              </div>
            </div>

            {pendingItems.length > 0 && (
              <div className="bl-fee-list">
                {pendingItems.map(item => (
                  <div className="bl-fee-row" key={item.id}>
                    <div>
                      <div className="bl-fee-name">{item.description}</div>
                      <div className="bl-fee-cat">{CATEGORY_LABELS[item.category]}</div>
                    </div>
                    <NumberInput
                      className="bl-qty-input" step="any"
                      min={1}
                      aria-label={`Quantity for ${item.description}`}
                      value={item.quantity}
                      onChange={e => {
                        const qty = Math.max(1, parseInt(e.target.value, 10) || 1);
                        setPendingItems(prev => prev.map(p => (p.id === item.id ? { ...p, quantity: qty, totalPrice: qty * p.unitPrice } : p)));
                      }}
                      style={{ font: 'inherit', border: '1px solid var(--ehr-border, #E2E6EB)', borderRadius: 0 }}
                    />
                    <span className="bl-fee-price">{money(item.totalPrice)}</span>
                    <button type="button" className="bl-fee-add" onClick={() => setPendingItems(prev => prev.filter(p => p.id !== item.id))}>{t('action.remove')}</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </FormSlider>
      )}

      {/* ── Finalize confirm ── */}
      {confirmFinalize && (
        <Modal onClose={() => setConfirmFinalize(false)} width={420} labelledBy="bl-finalize-title">
          <DialogFrame>
            <DialogHeader titleId="bl-finalize-title" title={<>{t('ui.finalizeBill')} {bill.invoiceNumber}?</>} description={t('ui.onceFinalizedLineItemsAnd')} onClose={() => setConfirmFinalize(false)} />
            <DialogFooter>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmFinalize(false)}>{t('action.cancel')}</button>
              <button type="button" className="btn btn-primary" onClick={handleFinalize} disabled={busy}>
                {busy ? 'Finalizing…' : 'Finalize bill'}
              </button>
            </DialogFooter>
          </DialogFrame>
        </Modal>
      )}

      {/* ── Delete confirm ── */}
      {confirmDelete && (
        <Modal onClose={() => setConfirmDelete(false)} width={420} labelledBy="bl-delete-title">
          <DialogFrame>
            <DialogHeader titleId="bl-delete-title" title={<>{t('ui.deleteBill')} {bill.invoiceNumber}?</>} description={<>{t('ui.theBillWillBeCancelled')} {money(bill.totalAmount)} {t('ui.chargeReversedFrom')} {bill.patientName}{t('ui.sBalanceThisCannotBe')}</>} onClose={() => setConfirmDelete(false)} />
            <DialogFooter>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmDelete(false)}>{t('action.cancel')}</button>
              <button type="button" className="btn btn-primary" style={{ background: 'var(--color-danger, #D92B20)' }} onClick={handleDelete} disabled={busy}>
                {busy ? 'Deleting…' : 'Delete bill'}
              </button>
            </DialogFooter>
          </DialogFrame>
        </Modal>
      )}
    </main>
  );
}
