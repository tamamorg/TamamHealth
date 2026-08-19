'use client';

/**
 * Bill detail — OpenMRS O3-style invoice workspace. Patient banner, bill
 * actions (discount / add items / delete / finalize / print), the line-item
 * table, and the payments panel with a running totals sidebar.
 *
 * Flow: a bill stays editable until it is finalized; payments can only be
 * recorded after finalization (mirroring the O3 billing module).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { returnToFromSearch } from '@/lib/navigation/return-to';
import { useApp } from '@/lib/context';
import { useToast } from '@/components/Toast';
import { usePermissions } from '@/lib/hooks/usePermissions';
import Modal from '@/components/Modal';
import {
  Receipt, Printer, Plus, Search, Activity, MoreVertical, ChevronLeft,
} from '@/components/icons/lucide';
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

/** dd-MMM-yyyy — the OpenMRS DOB convention (matches ChartHeader). */
function formatDobOmrs(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')}-${d.toLocaleDateString('en-US', { month: 'short' })}-${d.getFullYear()}`;
}

const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'mobile_money', 'bank_transfer', 'insurance', 'credit'];
const CATEGORIES = Object.keys(CATEGORY_LABELS) as ChargeCategory[];

export default function BillDetailPage() {
  const params = useParams<{ id: string }>();
  const billId = params?.id;
  const router = useRouter();
  const { currentUser } = useApp();
  const { showToast } = useToast();
  const { canCollectPayments } = usePermissions();

  const [bill, setBill] = useState<BillingDoc | null>(null);
  const [patient, setPatient] = useState<PatientDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Line items
  const [itemSearch, setItemSearch] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
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

  const scope = useMemo(() => (
    currentUser ? { orgId: currentUser.orgId, hospitalId: currentUser.hospitalId, role: currentUser.role } : undefined
  ), [currentUser]);

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
        showToast('This bill has payments and can no longer be deleted', 'error');
      } else {
        showToast(`${bill.invoiceNumber} deleted`, 'success');
        router.push('/billing');
        return;
      }
    } catch (err) {
      console.error('Could not delete bill', err);
      showToast('Could not delete this bill', 'error');
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
    setOpenMenuId(null);
    if (bill.items.length <= 1) {
      showToast('A bill needs at least one line item — delete the bill instead', 'error');
      return;
    }
    await saveItems(bill.items.filter(i => i.id !== item.id), `${item.description} removed from bill`);
  };

  const openAddItems = async () => {
    setAddItemsOpen(true);
    setPendingItems([]);
    setFeeSearch('');
    if (fees.length === 0) {
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
      showToast('Enter a valid payment amount', 'error');
      return;
    }
    if (amount > bill.balanceDue) {
      showToast(`Amount exceeds the ${money(bill.balanceDue)} due`, 'error');
      return;
    }
    setSavingPayment(true);
    try {
      const { recordPayment } = await import('@/lib/services/billing-service');
      const result = await recordPayment(bill._id, amount, payMethod, actorId, actorName, payReference.trim() || undefined);
      if (result === null) {
        showToast('Could not record payment', 'error');
      } else {
        showToast(`Payment of ${money(amount)} recorded`, 'success');
        setPayAmount('');
        setPayReference('');
        await loadBill();
      }
    } catch (err) {
      console.error('Could not record payment', err);
      showToast('Could not record payment', 'error');
    } finally {
      setSavingPayment(false);
    }
  };

  const handlePrint = () => {
    if (!bill) return;
    const rows = bill.items.map((i, n) => `
      <tr>
        <td>${n + 1}</td><td>${escapeHtml(i.description)}</td><td>${escapeHtml(CATEGORY_LABELS[i.category] || i.category)}</td>
        <td class="r">${escapeHtml(i.quantity)}</td><td class="r">${escapeHtml(money(i.unitPrice))}</td><td class="r">${escapeHtml(money(i.totalPrice))}</td>
      </tr>`).join('');
    const payRows = bill.payments.map(p => `
      <tr><td>${escapeHtml(new Date(p.receivedAt).toLocaleString())}</td><td>${escapeHtml(PAYMENT_METHOD_LABELS[p.method] || p.method)}</td>
      <td>${escapeHtml(p.reference || '—')}</td><td>${escapeHtml(p.receivedByName)}</td><td class="r">${escapeHtml(money(p.amount))}</td></tr>`).join('');
    const html = `<!doctype html><html><head><title>${escapeHtml(bill.invoiceNumber)}</title><style>
      body { font-family: 'IBM Plex Sans', system-ui, sans-serif; color: #102634; margin: 32px; font-size: 13px; }
      h1 { font-size: 18px; margin: 0; } h2 { font-size: 13px; margin: 24px 0 8px; }
      .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid var(--chart-4); padding-bottom: 12px; }
      .muted { color: #667; } table { width: 100%; border-collapse: collapse; margin-top: 6px; }
      th { text-align: left; background: #eef2f5; padding: 6px 8px; font-size: 11px; text-transform: uppercase; }
      td { padding: 6px 8px; border-bottom: 1px solid #e5ebf0; } .r { text-align: right; }
      .totals { margin-top: 14px; margin-left: auto; width: 260px; }
      .totals div { display: flex; justify-content: space-between; padding: 3px 0; }
      .totals .due { font-weight: 700; border-top: 1px solid #102634; margin-top: 4px; padding-top: 6px; }
    </style></head><body>
      <div class="head">
        <div><h1>${escapeHtml(bill.facilityName)}</h1><div class="muted">Invoice ${escapeHtml(bill.invoiceNumber)} · ${escapeHtml(formatBillDate(bill.createdAt))}</div></div>
        <div style="text-align:right"><strong>${escapeHtml(bill.patientName)}</strong><div class="muted">ID: ${escapeHtml(bill.hospitalNumber || bill.patientId)}</div></div>
      </div>
      <h2>Line items</h2>
      <table><thead><tr><th>#</th><th>Item</th><th>Category</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Total</th></tr></thead><tbody>${rows}</tbody></table>
      ${bill.payments.length ? `<h2>Payments</h2><table><thead><tr><th>Date</th><th>Method</th><th>Reference</th><th>Received by</th><th class="r">Amount</th></tr></thead><tbody>${payRows}</tbody></table>` : ''}
      <div class="totals">
        <div><span>Subtotal</span><span>${escapeHtml(money(bill.subtotal))}</span></div>
        <div><span>Discount</span><span>- ${escapeHtml(money(bill.discount))}</span></div>
        ${bill.taxAmount ? `<div><span>Tax (${escapeHtml(bill.taxRate)}%)</span><span>${escapeHtml(money(bill.taxAmount))}</span></div>` : ''}
        <div><span>Total</span><span>${escapeHtml(money(bill.totalAmount))}</span></div>
        <div><span>Paid</span><span>- ${escapeHtml(money(bill.amountPaid))}</span></div>
        <div class="due"><span>Amount due</span><span>${escapeHtml(money(bill.balanceDue))}</span></div>
      </div>
    </body></html>`;
    openIsolatedHtmlWindow(html, 'width=800,height=900', true);
  };

  // ── Render ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <main className="page-container page-enter">
        <div className="bl-root"><div className="bl-loading"><Activity size={30} style={{ animation: 'spin 1s linear infinite' }} /><span>Loading bill…</span></div></div>
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
              <h3>Bill not found</h3>
              <p>This bill may have been removed or you may not have access to it.</p>
              <button type="button" className="bl-btn bl-btn--outline" onClick={() => router.push('/billing')}>
                <ChevronLeft size={15} /> Back to bill list
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
              <span className="bl-id-tag">Facility ID: <strong>{bill.hospitalNumber || patient?.hospitalNumber || patient?.geocodeId || '—'}</strong></span>
              <span className="bl-id-tag">{bill.facilityName}</span>
            </div>
          </div>
          <div className="bl-banner-actions no-print">
            <button type="button" className="bl-btn bl-btn--link" onClick={() => router.push(returnToFromSearch(window.location.search, '/billing'))}>
              <ChevronLeft size={15} /> Back
            </button>
          </div>
        </div>

        {/* ── Bill actions ── */}
        {canCollectPayments && (
          <div className="bl-actions-row no-print" data-tour="bill-actions">
            {(bill.status === 'pending' || bill.status === 'partial') && (
              <button type="button" className="bl-btn bl-btn--outline" onClick={() => setDiscountOpen(true)} disabled={busy}>
                Request discount
              </button>
            )}
            {editable && (
              <button type="button" className="bl-btn bl-btn--link" onClick={openAddItems} disabled={busy}>
                Add items to bill <Plus size={15} />
              </button>
            )}
            {editable && (
              <button type="button" className="bl-btn bl-btn--danger-link" onClick={() => setConfirmDelete(true)} disabled={busy}>
                Delete bill
              </button>
            )}
            {!finalized && bill.status === 'pending' && (
              <button type="button" className="bl-btn bl-btn--primary" onClick={() => setConfirmFinalize(true)} disabled={busy}>
                Finalize bill
              </button>
            )}
            <button type="button" className="bl-btn bl-btn--primary" onClick={handlePrint}>
              Print bill <Printer size={15} />
            </button>
          </div>
        )}

        {/* ── Summary strip ── */}
        <div className="bl-summary-strip">
          <div><p className="bl-summary-label">Date bill created</p><p className="bl-summary-value" style={{ fontSize: 16 }}>{formatBillDate(bill.createdAt)}</p></div>
          <div><p className="bl-summary-label">Total amount</p><p className="bl-summary-value">{money(bill.totalAmount)}</p></div>
          <div><p className="bl-summary-label">Amount tendered</p><p className="bl-summary-value">{money(bill.amountPaid)}</p></div>
          <div><p className="bl-summary-label">Amount due</p><p className="bl-summary-value">{money(bill.balanceDue)}</p></div>
          <div><p className="bl-summary-label">Invoice number</p><p className="bl-summary-value" style={{ fontSize: 16 }}>{bill.invoiceNumber}</p></div>
          <div><p className="bl-summary-label">Invoice status</p><p className="bl-summary-value" style={{ fontSize: 16 }}>{invoiceStatusLabel(bill)}</p></div>
        </div>

        {/* ── Line items ── */}
        <div className="bl-card">
          <div className="bl-card-head">
            <h2 className="bl-card-title">Line items</h2>
            <p className="bl-card-sub">Items to be billed</p>
            <span className="bl-underline" />
          </div>
          <div className="bl-search">
            <Search size={16} />
            <input
              type="text"
              value={itemSearch}
              onChange={e => setItemSearch(e.target.value)}
              placeholder="Search this table"
              aria-label="Search line items"
            />
          </div>
          <div className="bl-table-wrap">
            <table className="bl-table">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Bill item</th>
                  <th>Category</th>
                  <th>Service status</th>
                  <th className="bl-right">Quantity</th>
                  <th className="bl-right">Price</th>
                  <th className="bl-right">Total</th>
                  {editable && <th aria-label="Row actions" />}
                </tr>
              </thead>
              <tbody>
                {visibleItems.length === 0 ? (
                  <tr><td colSpan={editable ? 8 : 7} className="bl-muted" style={{ textAlign: 'center', padding: 24 }}>No line items match your search.</td></tr>
                ) : visibleItems.map((item, idx) => (
                  <tr key={item.id}>
                    <td className="bl-num">{idx + 1}</td>
                    <td>{item.description}</td>
                    <td className="bl-muted">{CATEGORY_LABELS[item.category] || item.category}</td>
                    <td>{serviceStatus}</td>
                    <td className="bl-num bl-right">
                      {editingItemId === item.id ? (
                        <input
                          className="bl-qty-input"
                          type="number"
                          min={1}
                          value={qtyDraft}
                          autoFocus
                          onChange={e => setQtyDraft(e.target.value)}
                          onBlur={() => handleSaveQty(item)}
                          onKeyDown={e => { if (e.key === 'Enter') handleSaveQty(item); if (e.key === 'Escape') setEditingItemId(null); }}
                          style={{ font: 'inherit', border: '1px solid var(--bl-teal)', borderRadius: 5 }}
                        />
                      ) : item.quantity}
                    </td>
                    <td className="bl-num bl-right">{money(item.unitPrice)}</td>
                    <td className="bl-num bl-right">{money(item.totalPrice)}</td>
                    {editable && (
                      <td style={{ width: 34 }}>
                        <div className="bl-row-menu">
                          <button
                            type="button"
                            className="bl-row-menu-btn"
                            aria-label={`Actions for ${item.description}`}
                            onClick={() => setOpenMenuId(openMenuId === item.id ? null : item.id)}
                          >
                            <MoreVertical size={15} />
                          </button>
                          {openMenuId === item.id && (
                            <>
                              <div className="bl-menu-backdrop" onClick={() => setOpenMenuId(null)} />
                              <div className="bl-menu" role="menu">
                                <button type="button" role="menuitem" onClick={() => { setOpenMenuId(null); setEditingItemId(item.id); setQtyDraft(String(item.quantity)); }}>
                                  Edit quantity
                                </button>
                                <button type="button" role="menuitem" className="bl-menu-danger" onClick={() => handleRemoveItem(item)}>
                                  Remove item
                                </button>
                              </div>
                            </>
                          )}
                        </div>
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
              <h2 className="bl-card-title">Payments</h2>
              <span className="bl-underline" />

              {!finalized && (bill.status === 'pending') ? (
                <div className="bl-empty">
                  <h3>Bill not finalized</h3>
                  <p>Finalize this bill before recording a payment.</p>
                  {canCollectPayments && (
                    <button type="button" className="bl-btn bl-btn--primary" onClick={() => setConfirmFinalize(true)} disabled={busy}>
                      Finalize bill
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {payable && (
                    <div className="bl-form-grid" style={{ marginTop: 14 }}>
                      <div className="bl-field">
                        <label htmlFor="bl-pay-method">Payment method</label>
                        <Select id="bl-pay-method" value={payMethod} onChange={e => setPayMethod(e.target.value as PaymentMethod)}>
                          {PAYMENT_METHODS.map(m => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}
                        </Select>
                      </div>
                      <div className="bl-field">
                        <label htmlFor="bl-pay-amount">Amount tendered</label>
                        <input
                          id="bl-pay-amount"
                          type="number"
                          min={0}
                          step="0.01"
                          value={payAmount}
                          onChange={e => setPayAmount(e.target.value)}
                          placeholder={String(bill.balanceDue)}
                        />
                      </div>
                      <div className="bl-field">
                        <label htmlFor="bl-pay-ref">Reference (optional)</label>
                        <input
                          id="bl-pay-ref"
                          type="text"
                          value={payReference}
                          onChange={e => setPayReference(e.target.value)}
                          placeholder="Receipt / transaction no."
                        />
                      </div>
                      <div className="bl-field" style={{ justifyContent: 'flex-end' }}>
                        <button type="button" className="bl-btn bl-btn--primary" onClick={handleRecordPayment} disabled={savingPayment || !payAmount}>
                          {savingPayment ? 'Recording…' : 'Record payment'}
                        </button>
                      </div>
                    </div>
                  )}

                  {bill.payments.length > 0 ? (
                    <div className="bl-table-wrap">
                      <table className="bl-table">
                        <thead>
                          <tr><th>Date</th><th>Method</th><th>Reference</th><th>Received by</th><th className="bl-right">Amount</th></tr>
                        </thead>
                        <tbody>
                          {bill.payments.map(p => (
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
                  ) : !payable && (
                    <div className="bl-empty">
                      <h3>No payments recorded</h3>
                      <p>{bill.status === 'paid' ? 'This bill is settled.' : 'Payments recorded against this bill will appear here.'}</p>
                    </div>
                  )}
                </>
              )}
            </div>

            <aside className="bl-pay-aside">
              <dl className="bl-totals">
                <div className="bl-totals-row"><dt>Total amount:</dt><dd>{money(bill.totalAmount)}</dd></div>
                <div className="bl-totals-row"><dt>Total tendered:</dt><dd>{money(bill.amountPaid)}</dd></div>
                <div className="bl-totals-row"><dt>Discount:</dt><dd>- {money(bill.discount)}</dd></div>
                <div className="bl-totals-row"><dt>Refunds:</dt><dd>- {money(0)}</dd></div>
                <hr className="bl-totals-rule" />
                <div className="bl-totals-row bl-totals-row--due"><dt>Amount due:</dt><dd>{money(bill.balanceDue)}</dd></div>
              </dl>
              <button
                type="button"
                className="bl-btn bl-btn--dark"
                onClick={() => { setPayAmount(''); setPayReference(''); router.push('/billing'); }}
              >
                Discard
              </button>
            </aside>
          </div>
        </div>
      </div>

      {/* ── Request discount modal ── */}
      {discountOpen && (
        <Modal onClose={() => setDiscountOpen(false)} width={440} labelledBy="bl-discount-title">
          <div className="bl-root bl-modal-body">
            <h3 className="bl-modal-title" id="bl-discount-title">Request discount</h3>
            <p className="bl-modal-sub">Applies to invoice {bill.invoiceNumber} — subtotal {money(bill.subtotal)}.</p>
            <div className="bl-field">
              <label htmlFor="bl-disc-amount">Discount amount ({currency})</label>
              <input id="bl-disc-amount" type="number" min={0} step="0.01" value={discountAmount} onChange={e => setDiscountAmount(e.target.value)} autoFocus />
            </div>
            <div className="bl-field">
              <label htmlFor="bl-disc-reason">Reason</label>
              <textarea id="bl-disc-reason" rows={2} value={discountReason} onChange={e => setDiscountReason(e.target.value)} placeholder="e.g. Indigent patient — approved by supervisor" />
            </div>
            <div className="bl-modal-actions">
              <button type="button" className="bl-btn bl-btn--ghost" onClick={() => setDiscountOpen(false)}>Cancel</button>
              <button type="button" className="bl-btn bl-btn--primary" onClick={handleApplyDiscount} disabled={busy || !discountAmount || !discountReason.trim()}>
                Apply discount
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Add items modal ── */}
      {addItemsOpen && (
        <Modal onClose={() => setAddItemsOpen(false)} width={560} labelledBy="bl-add-title">
          <div className="bl-root bl-modal-body">
            <h3 className="bl-modal-title" id="bl-add-title">Add items to bill</h3>
            <p className="bl-modal-sub">Pick from the fee schedule or add a custom charge.</p>

            <div className="bl-field">
              <label htmlFor="bl-fee-search">Search fee schedule</label>
              <input id="bl-fee-search" type="text" value={feeSearch} onChange={e => setFeeSearch(e.target.value)} placeholder="Service name or category" />
            </div>
            <div className="bl-fee-list">
              {feesLoading ? (
                <div className="bl-fee-row bl-muted">Loading fee schedule…</div>
              ) : (
                (() => {
                  const q = feeSearch.trim().toLowerCase();
                  const list = fees.filter(f => !q
                    || f.serviceName.toLowerCase().includes(q)
                    || CATEGORY_LABELS[f.category]?.toLowerCase().includes(q)).slice(0, 30);
                  if (list.length === 0) return <div className="bl-fee-row bl-muted">No matching services{fees.length === 0 ? ' — the fee schedule is empty; add a custom charge below' : ''}.</div>;
                  return list.map(fee => (
                    <div className="bl-fee-row" key={fee._id}>
                      <div>
                        <div className="bl-fee-name">{fee.serviceName}</div>
                        <div className="bl-fee-cat">{CATEGORY_LABELS[fee.category] || fee.category}</div>
                      </div>
                      <span className="bl-fee-price">{formatMoney(fee.unitPrice, { currency: fee.currency, decimals: 2 })}</span>
                      <button type="button" className="bl-fee-add" onClick={() => addFeeToPending(fee)}>Add</button>
                    </div>
                  ));
                })()
              )}
            </div>

            <div className="bl-form-grid">
              <div className="bl-field" style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="bl-custom-desc">Custom charge</label>
                <input id="bl-custom-desc" type="text" value={customDesc} onChange={e => setCustomDesc(e.target.value)} placeholder="Description" />
              </div>
              <div className="bl-field">
                <label htmlFor="bl-custom-cat">Category</label>
                <Select id="bl-custom-cat" value={customCategory} onChange={e => setCustomCategory(e.target.value as ChargeCategory)}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                </Select>
              </div>
              <div className="bl-field">
                <label htmlFor="bl-custom-price">Unit price ({currency})</label>
                <input id="bl-custom-price" type="number" min={0} step="0.01" value={customPrice} onChange={e => setCustomPrice(e.target.value)} />
              </div>
              <div className="bl-field" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="bl-btn bl-btn--outline" onClick={addCustomToPending} disabled={!customDesc.trim() || !customPrice}>
                  Add custom
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
                    <input
                      className="bl-qty-input"
                      type="number"
                      min={1}
                      aria-label={`Quantity for ${item.description}`}
                      value={item.quantity}
                      onChange={e => {
                        const qty = Math.max(1, parseInt(e.target.value, 10) || 1);
                        setPendingItems(prev => prev.map(p => (p.id === item.id ? { ...p, quantity: qty, totalPrice: qty * p.unitPrice } : p)));
                      }}
                      style={{ font: 'inherit', border: '1px solid var(--ehr-border, #DDEAF3)', borderRadius: 5 }}
                    />
                    <span className="bl-fee-price">{money(item.totalPrice)}</span>
                    <button type="button" className="bl-fee-add" onClick={() => setPendingItems(prev => prev.filter(p => p.id !== item.id))}>Remove</button>
                  </div>
                ))}
              </div>
            )}

            <div className="bl-modal-actions">
              <button type="button" className="bl-btn bl-btn--ghost" onClick={() => setAddItemsOpen(false)}>Cancel</button>
              <button type="button" className="bl-btn bl-btn--primary" onClick={handleSaveNewItems} disabled={busy || pendingItems.length === 0}>
                Save {pendingItems.length > 0 ? `${pendingItems.length} item${pendingItems.length === 1 ? '' : 's'}` : 'items'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Finalize confirm ── */}
      {confirmFinalize && (
        <Modal onClose={() => setConfirmFinalize(false)} width={420} labelledBy="bl-finalize-title">
          <div className="bl-root bl-modal-body">
            <h3 className="bl-modal-title" id="bl-finalize-title">Finalize bill {bill.invoiceNumber}?</h3>
            <p className="bl-modal-sub">
              Once finalized, line items and the bill itself can no longer be changed or deleted — only payments and discounts can be applied.
            </p>
            <div className="bl-modal-actions">
              <button type="button" className="bl-btn bl-btn--ghost" onClick={() => setConfirmFinalize(false)}>Cancel</button>
              <button type="button" className="bl-btn bl-btn--primary" onClick={handleFinalize} disabled={busy}>
                {busy ? 'Finalizing…' : 'Finalize bill'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Delete confirm ── */}
      {confirmDelete && (
        <Modal onClose={() => setConfirmDelete(false)} width={420} labelledBy="bl-delete-title">
          <div className="bl-root bl-modal-body">
            <h3 className="bl-modal-title" id="bl-delete-title">Delete bill {bill.invoiceNumber}?</h3>
            <p className="bl-modal-sub">
              The bill will be cancelled and the {money(bill.totalAmount)} charge reversed from {bill.patientName}&rsquo;s balance. This cannot be undone.
            </p>
            <div className="bl-modal-actions">
              <button type="button" className="bl-btn bl-btn--ghost" onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button type="button" className="bl-btn bl-btn--dark" style={{ background: 'var(--color-danger, #DC2626)' }} onClick={handleDelete} disabled={busy}>
                {busy ? 'Deleting…' : 'Delete bill'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}
