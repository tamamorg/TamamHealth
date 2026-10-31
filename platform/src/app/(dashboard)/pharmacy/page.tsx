'use client';

import { useState, useMemo, useEffect, Fragment } from 'react';
import StationActionPill from '@/components/ehr/StationActionPill';
import DispenseSlider from '@/components/pharmacy/workflow/DispenseSlider';
import type { RxIntent } from '@/components/pharmacy/workflow/PharmacyWorkflowPanel';
import { counterActions, counterPillLabel } from '@/components/pharmacy/workflow/pharmacy-workflow-types';
import TableCols from '@/components/TableCols';
import Link from 'next/link';
import PatientAvatar from '@/components/patients/PatientAvatar';
import { INITIALS_PLATE_STYLE, nameInitials } from '@/components/ehr/initials-plate';
import { patientAgeLabel, shortenPersonName } from '@/lib/patient-utils';
import { AlertTriangle, Loader2, Plus, X, Printer, ChevronRight, AlertOctagon, Download } from '@/components/icons/lucide';
import EhrListHeader, { EhrListHeaderButton, LIST_STAT_COLORS } from '@/components/ehr/EhrListHeader';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth, useUi } from '@/lib/context';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { usePrescriptions } from '@/lib/hooks/usePrescriptions';
import { usePharmacyInventory } from '@/lib/hooks/usePharmacyInventory';
import { usePatients } from '@/lib/hooks/usePatients';
import { useToast } from '@/components/Toast';
import { classifyStockStatus, dispensedTodayOf } from '@/lib/services/pharmacy-inventory-service';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { formatCompactDateTime, formatMoney } from '@/lib/format-utils';
import { isActivePharmacyStage, isOutsidePharmacyOrder, pharmacyStage, pharmacyStageLabel } from '@/lib/pharmacy-workflow';
import { usePatientBalances } from '@/lib/hooks/usePatientBalances';
import Select from '@/components/Select';
import { escapeHtml, openIsolatedHtmlWindow } from '@/lib/safe-html';
import { buildClinicalPrintDocument } from '@/lib/print-document';
import { formatPrintedAt } from '@/lib/print-identity';
import { toIsoDate, todayIso } from '@/lib/date-utils';
import { useRoleChoice } from '@/lib/settings/useRoleSetting';
import { stopsClickPropagation } from '@/lib/a11y';
import PatientMedHistoryModal from '@/components/pharmacy/PatientMedHistoryModal';
import StockInModal from '@/components/pharmacy/StockInModal';
import RestockModal from '@/components/pharmacy/RestockModal';
import { RX_STAGE_PILL_CLASS, prescriptionSig, type PharmacyTab } from '@/components/pharmacy/pharmacy-helpers';

import { useUrlView } from '@/lib/navigation/use-url-view';

export default function PharmacyPage() {
  const searchParams = useSearchParams();
  // In the URL so Back returns to the tab the user was on.
  const [activeTab, setActiveTab] = useUrlView<PharmacyTab>(['queue', 'inventory', 'reorder', 'expiry', 'overview', 'patients'], searchParams.get('panel') === 'stock' ? 'inventory' : 'queue', 'tab');
  const stockExpiryChoice = useRoleChoice('stock.expiry', '30 days');
  const stockReorderChoice = useRoleChoice('stock.reorder', '');
  // Per-column filters: queue table (q*) + inventory table (medication name).
  // Category / stock-status filtering now lives in the shared header + table
  // toolbar (categoryFilter / statusFilter below) rather than per-column funnels.
  const [colFilters, setColFilters] = useState({ qPatient: '', qMedication: '', qPrescribedBy: '', iMedication: '' });
  // Header filters (category + stock status) live inside the search field —
  // see EhrSearchFilter, which owns the popover. Only the applied count is
  // still this page's business.
  // Patients tab — which patient's prescription view is open (patient _id)
  const [selectedPatient, setSelectedPatient] = useState<string | null>(null);
  const { currentUser } = useAuth();
  const { globalSearch, setGlobalSearch } = useUi();
  // Deep link from a patient chart: /pharmacy?patient=<name> pre-filters via
  // the shared global search (combined with the table's own search below).
  useEffect(() => {
    const patientParam = searchParams?.get('patient');
    if (patientParam) setGlobalSearch(patientParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const { canDispense } = usePermissions();
  const { showToast } = useToast();
  const { t } = useTranslation();
  const router = useRouter();
  const { prescriptions: allPrescriptions, loading: rxLoading } = usePrescriptions();
  // Scripts issued for an outside pharmacy are not this pharmacy's work — the
  // patient is holding them. Dropped here so no queue, count or export below
  // can pick one up.
  const rxQueue = useMemo(() => allPrescriptions.filter(rx => !isOutsidePharmacyOrder(rx)), [allPrescriptions]);
  const { items: rawInventory, create: createInventory, update: updateInventory } = usePharmacyInventory();
  const { patients } = usePatients();
  const patientById = useMemo(() => new Map(patients.map(patient => [patient._id, patient])), [patients]);
  // The script open in the slider from its pill's dropdown.
  const [counter, setCounter] = useState<{ id: string; intent?: RxIntent } | null>(null);
  const counterRx = counter ? allPrescriptions.find(rx => rx._id === counter.id) : undefined;
  // One handover confirmation combines counselling with dispensing; controlled
  // medicines add a verified witness to the same dialog.

  // ── Shared list-page toolbar state ──
  // Table search (the listpage-table-search input) takes priority over the
  // platform-wide global search, which mainly exists now for the ?patient=
  // deep link above.
  const [tableSearch, setTableSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'adequate' | 'low' | 'critical' | 'expired'>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const q = tableSearch || globalSearch;
  const anyColFilter = Object.values(colFilters).some(Boolean) || !!tableSearch || statusFilter !== 'all' || categoryFilter !== 'all';
  const clearColFilters = () => {
    setColFilters({ qPatient: '', qMedication: '', qPrescribedBy: '', iMedication: '' });
    setTableSearch('');
    setStatusFilter('all');
    setCategoryFilter('all');
  };
  // On the Patients tab, drop back to the search results whenever the query
  // changes (the table search drives the patient lookup now).
  useEffect(() => { setSelectedPatient(null); }, [tableSearch, globalSearch]);

  // Filtering lives in the header search + Filters popover (matching the
  // patients registry) — no per-column funnels.
  // Field style for the selects inside the header's Filters popover (mirrors
  // the patients registry's Filters panel fields).
  const popoverFieldStyle = { background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)', borderRadius: 8, minWidth: 0 } as const;
  const statusFilterRelevant = activeTab === 'inventory' || activeTab === 'reorder' || activeTab === 'expiry';
  const headerFilterCount = (categoryFilter !== 'all' ? 1 : 0) + (statusFilterRelevant && statusFilter !== 'all' ? 1 : 0);

  // Stock-in modal state
  const [showStockInModal, setShowStockInModal] = useState(false);
  const [stockForm, setStockForm] = useState({
    medicationName: '',
    category: 'General',
    stockLevel: 0,
    unit: 'tablets',
    reorderLevel: 50,
    batchNumber: '',
    expiryDate: '',
  });

  // Augment each inventory row with a live status classification (which
  // changes over time as stock drains or the expiry date passes).
  const inventory = useMemo(() =>
    rawInventory.map(item => ({ ...item, status: classifyStockStatus(item) })),
  [rawInventory]);

  // Shared fail-closed balance gate (src/lib/hooks/usePatientBalances.ts).
  // Previously this page fetched with a single `Promise.all` and a `.catch()`
  // that reset the WHOLE map to empty on any one patient's ledger hiccup —
  // so one bad read silently defaulted every patient on the queue to a "no
  // balance" 0, and `isFinanciallyCleared(0)` is true, waving every one of
  // them through the payment gate. The hook fetches per-patient with
  // `Promise.allSettled` and only ever marks a balance 'ready' once a real
  // read for THAT patient has landed.
  const rxPatientIds = useMemo(() => rxQueue.map(rx => rx.patientId), [rxQueue]);
  const { balanceFor, isKnownFor, isClearedFor } = usePatientBalances(rxPatientIds);

  // Distinct medication categories present in the current inventory, for the
  // header's "filter by category" select.
  const categories = useMemo(() => Array.from(new Set(inventory.map(i => i.category))).sort(), [inventory]);

  const handleStockIn = async () => {
    if (!stockForm.medicationName.trim() || stockForm.stockLevel <= 0) {
      showToast(t('pharmacy.medAndStockRequired'), 'error');
      return;
    }
    if (!currentUser?.hospitalId) {
      showToast(t('pharmacy.noFacilityAssigned'), 'error');
      return;
    }
    try {
      await createInventory({
        hospitalId: currentUser.hospitalId,
        hospitalName: currentUser.hospitalName || '',
        medicationName: stockForm.medicationName.trim(),
        category: stockForm.category,
        stockLevel: stockForm.stockLevel,
        unit: stockForm.unit,
        reorderLevel: stockForm.reorderLevel,
        batchNumber: stockForm.batchNumber.trim() || `BN${Date.now().toString(36).toUpperCase()}`,
        expiryDate: stockForm.expiryDate || toIsoDate(new Date(Date.now() + 365 * 86400000)),
        lastReceived: new Date().toISOString(),
        orgId: currentUser.orgId,
      });
      showToast(t('pharmacy.stockedMedication', { medication: stockForm.medicationName }), 'success');
      setShowStockInModal(false);
      setStockForm({ medicationName: '', category: 'General', stockLevel: 0, unit: 'tablets', reorderLevel: 50, batchNumber: '', expiryDate: '' });
    } catch (err) {
      console.error(err);
      showToast(t('pharmacy.saveStockReceiptFailed'), 'error');
    }
  };

  // Restock modal state — replaces the prompt() shortcut so users can also
  // record batch + expiry on a top-up, not just the quantity.
  const [restockTarget, setRestockTarget] = useState<{ id: string; name: string; unit: string } | null>(null);
  const [restockForm, setRestockForm] = useState({ qty: 0, batchNumber: '', expiryDate: '' });

  const openRestock = (itemId: string) => {
    const existing = inventory.find(i => i._id === itemId);
    if (!existing) return;
    setRestockTarget({ id: existing._id, name: existing.medicationName, unit: existing.unit });
    setRestockForm({ qty: 0, batchNumber: existing.batchNumber || '', expiryDate: existing.expiryDate || '' });
  };

  const handleRestock = async () => {
    if (!restockTarget || restockForm.qty <= 0) {
      showToast(t('pharmacy.enterQtyGreaterThanZero'), 'error');
      return;
    }
    const existing = inventory.find(i => i._id === restockTarget.id);
    if (!existing) { setRestockTarget(null); return; }
    try {
      await updateInventory(restockTarget.id, {
        stockLevel: existing.stockLevel + restockForm.qty,
        lastReceived: new Date().toISOString(),
        ...(restockForm.batchNumber.trim() ? { batchNumber: restockForm.batchNumber.trim() } : {}),
        ...(restockForm.expiryDate ? { expiryDate: restockForm.expiryDate } : {}),
      });
      showToast(t('pharmacy.addedToStockToast', { qty: restockForm.qty, unit: restockTarget.unit, name: restockTarget.name }), 'success');
      setRestockTarget(null);
    } catch (err) {
      console.error(err);
      showToast(t('pharmacy.updateStockFailed'), 'error');
    }
  };

  const pendingRx = rxQueue.filter(r => r.status === 'pending').length;
  const paymentDueCount = rxQueue.filter(r => pharmacyStage(r) === 'cleared_for_dispensing' && !isClearedFor(r.patientId)).length;
  const readyCount = rxQueue.filter(r => pharmacyStage(r) === 'cleared_for_dispensing' && isClearedFor(r.patientId)).length;
  const lowStock = inventory.filter(i => i.status === 'low' || i.status === 'critical').length;
  // Day-guarded reads — the raw counter can hold a stale or (on docs written
  // before the day-stamp) lifetime total (see dispensedTodayOf).
  const totalDispensedToday = inventory.reduce((sum, i) => sum + dispensedTodayOf(i), 0);

  const filteredInventory = inventory.filter(i => {
    if (q && !(i.medicationName.toLowerCase().includes(q.toLowerCase()) || i.category.toLowerCase().includes(q.toLowerCase()))) return false;
    if (colFilters.iMedication && !i.medicationName.toLowerCase().includes(colFilters.iMedication.toLowerCase())) return false;
    if (categoryFilter !== 'all' && i.category !== categoryFilter) return false;
    if (statusFilter !== 'all' && i.status !== statusFilter) return false;
    return true;
  });

  const filteredQueue = rxQueue.filter(rx => {
    if (!isActivePharmacyStage(pharmacyStage(rx)) || pharmacyStage(rx) === 'prescribed' || rx.status === 'discontinued') return false;
    if (q && !(rx.patientName.toLowerCase().includes(q.toLowerCase()) || rx.medication.toLowerCase().includes(q.toLowerCase()) || rx.prescribedBy.toLowerCase().includes(q.toLowerCase()))) return false;
    if (colFilters.qPatient && !rx.patientName.toLowerCase().includes(colFilters.qPatient.toLowerCase())) return false;
    if (colFilters.qMedication && !rx.medication.toLowerCase().includes(colFilters.qMedication.toLowerCase())) return false;
    if (colFilters.qPrescribedBy && !rx.prescribedBy.toLowerCase().includes(colFilters.qPrescribedBy.toLowerCase())) return false;
    return true;
  }).sort((a, b) => {
    // Emergency/immediate meds (given before results) float to the top of the
    // pending queue so they're dispensed first.
    const rank = (r: typeof a) => {
      const stage = pharmacyStage(r);
      if (r.urgency === 'immediate') return 0;
      if (stage === 'received_in_pharmacy_queue') return 1;
      if (stage === 'under_review') return 2;
      if (stage === 'cleared_for_dispensing' && !isClearedFor(r.patientId)) return 3;
      if (stage === 'cleared_for_dispensing') return 4;
      if (stage === 'dispensed') return 5;
      return 6;
    };
    return rank(a) - rank(b);
  });

  // ── Derived data for the Reorder / Expiry / Overview / Patients tabs ──
  const todayStr = todayIso();
  // Pharmacist stock settings (design 11, "Stock & reorder").
  const expiryWarningDays = Number(/^(\d+)/.exec(stockExpiryChoice)?.[1] ?? 90);
  const reorderCoverDays = Number(/(\d+)/.exec(stockReorderChoice)?.[1] ?? 0);
  const daysUntil = (date?: string) =>
    date ? Math.ceil((new Date(date).getTime() - new Date(todayStr).getTime()) / 86400000) : Infinity;

  // Reorder: anything at or below its reorder level (low or critical), neediest
  // first. The pharmacist's "Reorder trigger" (`stock.reorder`) widens this to
  // anything with less than that many days of cover, using the item's reorder
  // level as the daily-usage proxy the inventory record actually carries.
  const reorderList = useMemo(() =>
    inventory
      .filter(i => i.status === 'low' || i.status === 'critical'
        || (reorderCoverDays > 0 && i.reorderLevel > 0
            && i.stockLevel < (i.reorderLevel / 30) * reorderCoverDays))
      .filter(i => !q || i.medicationName.toLowerCase().includes(q.toLowerCase()) || i.category.toLowerCase().includes(q.toLowerCase()))
      .filter(i => categoryFilter === 'all' || i.category === categoryFilter)
      .filter(i => statusFilter === 'all' || i.status === statusFilter)
      .sort((a, b) => a.stockLevel - b.stockLevel),
  [inventory, q, categoryFilter, statusFilter, reorderCoverDays]);

  // The order quantity a reorder line should request: enough to reach double
  // its reorder level, never less than the reorder level itself.
  const orderQtyFor = (item: typeof inventory[number]) => Math.max(item.reorderLevel * 2 - item.stockLevel, item.reorderLevel);

  // Expiry (FEFO): soonest-to-expire first.
  const expiryList = useMemo(() =>
    [...inventory]
      .filter(i => !q || i.medicationName.toLowerCase().includes(q.toLowerCase()) || i.category.toLowerCase().includes(q.toLowerCase()))
      .filter(i => categoryFilter === 'all' || i.category === categoryFilter)
      .filter(i => statusFilter === 'all' || i.status === statusFilter)
      .sort((a, b) => (a.expiryDate || '').localeCompare(b.expiryDate || '')),
  [inventory, q, categoryFilter, statusFilter]);
  const expiredCount = inventory.filter(i => i.status === 'expired').length;
  const expiryStatusFor = (item: typeof inventory[number]) => {
    const days = daysUntil(item.expiryDate);
    const expired = item.status === 'expired' || days <= 0;
    // The pharmacist's "Expiry warning window" (`stock.expiry`) decides how
    // early a batch is flagged. 90 days was hard-coded before, which is still
    // the widest option offered.
    const soon = !expired && days <= expiryWarningDays;
    return { days, expired, soon };
  };

  // Overview: aggregate item counts + stock by category.
  const categoryOverview = useMemo(() => {
    const map = new Map<string, { category: string; items: number; units: number; adequate: number; low: number; critical: number; expired: number }>();
    for (const i of inventory) {
      const c = map.get(i.category) || { category: i.category, items: 0, units: 0, adequate: 0, low: 0, critical: 0, expired: 0 };
      c.items += 1;
      c.units += i.stockLevel;
      c[i.status] += 1;
      map.set(i.category, c);
    }
    // Surface the categories that need attention first: most at-risk
    // (critical + expired + low) lines, then by units held.
    return [...map.values()]
      .filter(c => !q || c.category.toLowerCase().includes(q.toLowerCase()))
      .filter(c => categoryFilter === 'all' || c.category === categoryFilter)
      .sort((a, b) => {
        const riskA = a.critical + a.expired + a.low;
        const riskB = b.critical + b.expired + b.low;
        return riskB - riskA || b.units - a.units;
      });
  }, [inventory, q, categoryFilter]);
  const totalUnits = inventory.reduce((s, i) => s + i.stockLevel, 0);

  // Patients: search the real patient registry (name / hospital number / phone),
  // not just people who already have a prescription queued — so any patient is findable.
  const patientName = (p: typeof patients[number]) => [p.firstName, p.middleName, p.surname].filter(Boolean).join(' ');
  const rxFor = (p: typeof patients[number]) =>
    rxQueue.filter(r => r.patientId === p._id || r.patientName === patientName(p));
  const patientResults = useMemo(() => {
    const query = q.trim().toLowerCase();
    return patients
      .filter(p => !query ||
        patientName(p).toLowerCase().includes(query) ||
        (p.hospitalNumber || '').toLowerCase().includes(query) ||
        (p.phone || '').toLowerCase().includes(query))
      .sort((a, b) => patientName(a).localeCompare(patientName(b)))
      .slice(0, 50);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patients, q, rxQueue]);
  const activePatient = selectedPatient ? patients.find(p => p._id === selectedPatient) : null;
  const activeRxs = activePatient ? rxFor(activePatient) : [];

  // Print a reorder / purchase order from the items currently needing restock.
  const handlePrintReorder = () => {
    const rows = reorderList.map(i =>
      `<tr><td>${escapeHtml(i.medicationName)}</td><td>${escapeHtml(i.category)}</td><td>${escapeHtml(`${i.stockLevel} ${i.unit}`)}</td><td>${escapeHtml(i.reorderLevel)}</td><td>${escapeHtml(orderQtyFor(i))}</td></tr>`
    ).join('');
    const body = `${reorderList.length === 0 ? '<p class="notice">No medicines currently require restocking.</p>' : `<section class="section"><h2 class="section-title">${escapeHtml(t('pharmacy.purchaseOrderRestock'))}</h2><table><thead><tr>
        <th>${escapeHtml(t('pharmacy.medication'))}</th><th>${escapeHtml(t('pharmacy.category'))}</th><th>${escapeHtml(t('pharmacy.currentStock'))}</th><th>${escapeHtml(t('pharmacy.reorderLevel'))}</th><th>${escapeHtml(t('pharmacy.orderQty'))}</th>
      </tr></thead><tbody>${rows}</tbody></table></section>`}
      <div class="signatures"><div><div class="signature"></div><div class="signature-label">${escapeHtml(t('pharmacy.authorizedBy'))}</div></div><div><div class="signature"></div><div class="signature-label">${escapeHtml(t('pharmacy.dateLabel'))}</div></div></div>`;
    const html = buildClinicalPrintDocument({
      title: t('pharmacy.purchaseOrderRestock'),
      documentLabel: t('pharmacy.purchaseOrder'),
      facilityName: currentUser?.hospitalName,
      metaTitle: 'Order Details',
      meta: [
        { label: 'Prepared', value: formatPrintedAt(new Date()) },
        { label: 'Items Requested', value: reorderList.length },
        { label: 'Prepared By', value: currentUser?.name || currentUser?.username || '—' },
      ],
      safeBodyHtml: body,
      footer: 'Stock request prepared from current inventory and reorder thresholds.',
    });
    openIsolatedHtmlWindow(html, '', true);
  };

  // Export the rows currently visible on the active tab to CSV — mirrors the
  // patients/appointments list-page "Download" toolbar action.
  const handleDownloadCsv = () => {
    let header: string[] = [];
    let rows: (string | number)[][] = [];
    switch (activeTab) {
      case 'queue':
        header = [t('pharmacy.patient'), t('pharmacy.medication'), t('pharmacy.dosage'), t('pharmacy.prescribedBy'), t('pharmacy.time'), t('pharmacy.statusLabel'), 'Payment'];
        rows = filteredQueue.map(rx => [
          rx.patientName,
          rx.medication,
          prescriptionSig(rx),
          rx.prescribedBy,
          rx.createdAt ? new Date(rx.createdAt).toLocaleString('en-GB') : '',
          pharmacyStageLabel(pharmacyStage(rx)),
          isClearedFor(rx.patientId) ? 'Clear' : isKnownFor(rx.patientId) ? formatMoney(balanceFor(rx.patientId)) : 'Unknown',
        ]);
        break;
      case 'inventory':
        header = [t('pharmacy.medication'), t('pharmacy.category'), t('pharmacy.stockLabel'), t('pharmacy.reorderLevel'), t('pharmacy.statusLabel'), t('pharmacy.batchLabel'), t('pharmacy.expiry'), t('pharmacy.kpiDispensedToday')];
        rows = filteredInventory.map(i => [
          i.medicationName,
          i.category,
          `${i.stockLevel} ${i.unit}`,
          `${i.reorderLevel} ${i.unit}`,
          i.status === 'adequate' ? t('pharmacy.inStock') : t(`pharmacy.invStatus_${i.status}`),
          i.batchNumber,
          i.expiryDate,
          dispensedTodayOf(i),
        ]);
        break;
      case 'reorder':
        header = [t('pharmacy.medication'), t('pharmacy.category'), t('pharmacy.stockLabel'), t('pharmacy.reorderLevel'), t('pharmacy.orderQty'), t('pharmacy.statusLabel')];
        rows = reorderList.map(i => [
          i.medicationName, i.category, `${i.stockLevel} ${i.unit}`, i.reorderLevel,
          `${orderQtyFor(i)} ${i.unit}`, t(`pharmacy.invStatus_${i.status}`),
        ]);
        break;
      case 'expiry':
        header = [t('pharmacy.medication'), t('pharmacy.batchLabel'), t('pharmacy.stockLabel'), t('pharmacy.expiry'), t('pharmacy.statusLabel')];
        rows = expiryList.map(i => {
          const { days, expired } = expiryStatusFor(i);
          return [
            i.medicationName, i.batchNumber, `${i.stockLevel} ${i.unit}`, i.expiryDate,
            expired ? t('pharmacy.expired') : t('pharmacy.daysLeft', { count: days }),
          ];
        });
        break;
      case 'overview':
        header = [t('pharmacy.category'), t('pharmacy.action'), t('pharmacy.stockLabel'), 'Adequate', 'Low', 'Critical', t('pharmacy.kpiExpired')];
        rows = categoryOverview.map(c => [c.category, c.items, c.units, c.adequate, c.low, c.critical, c.expired]);
        break;
      case 'patients':
        header = [t('pharmacy.patient'), t('patients.colHospitalNo'), 'Prescriptions on record', t('pharmacy.pending')];
        rows = patientResults.map(p => {
          const rxs = rxFor(p);
          return [patientName(p), p.hospitalNumber || '', rxs.length, rxs.filter(r => r.status === 'pending').length];
        });
        break;
    }
    const csv = [header, ...rows]
      .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `pharmacy-${activeTab}-${todayStr}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const tabsConfig: { key: PharmacyTab; label: string }[] = [
    { key: 'queue', label: `${t('pharmacy.prescriptionQueue')} (${pendingRx})` },
    { key: 'overview', label: t('pharmacy.inventoryOverview') },
    { key: 'inventory', label: `${t('pharmacy.inventory')} (${inventory.length})${lowStock > 0 ? ` · ${lowStock} ${t('pharmacy.kpiLowStockItems')}` : ''}` },
    { key: 'reorder', label: `${t('pharmacy.reorderNeeded')} (${reorderList.length})` },
    { key: 'expiry', label: `${t('pharmacy.expiryTracker')}${expiredCount > 0 ? ` · ${expiredCount} ${t('pharmacy.kpiExpired')}` : ''}` },
    { key: 'patients', label: t('pharmacy.patientMedHistory') },
  ];

  const sectionTitles: Record<PharmacyTab, string> = {
    queue: t('pharmacy.prescriptionQueue'),
    overview: t('pharmacy.inventoryOverview'),
    inventory: t('pharmacy.medicationInventory'),
    reorder: t('pharmacy.reorderNeeded'),
    expiry: t('pharmacy.expiryTracker'),
    patients: t('pharmacy.patientMedHistory'),
  };

  return (
    <main className="page-container page-enter">
      {/* ═══ Table card ═══ */}
      <div className="card-elevated overflow-hidden">
        <EhrListHeader
          title={sectionTitles[activeTab]}
          // On the queue tab the title IS the queue, so the total rides the
          // title; on every other tab the queue size stays as a chip instead,
          // since the title (and its count) belong to that tab's own list.
          count={activeTab === 'queue' ? rxQueue.length : undefined}
          stats={[
            ...(activeTab === 'queue' ? [] : [{ label: t('pharmacy.prescriptionQueue'), value: rxQueue.length, color: LIST_STAT_COLORS.muted }]),
            { label: t('pharmacy.pending'), value: pendingRx, color: LIST_STAT_COLORS.blue },
            { label: 'Payment due', value: paymentDueCount, color: LIST_STAT_COLORS.amber },
            { label: 'Ready', value: readyCount, color: LIST_STAT_COLORS.green },
            { label: t('pharmacy.kpiDispensedToday'), value: totalDispensedToday, color: LIST_STAT_COLORS.amber },
            { label: 'Low stock', value: lowStock, color: LIST_STAT_COLORS.green },
          ]}
          search={!(activeTab === 'patients' && activePatient) ? {
            value: tableSearch, onChange: setTableSearch,
            placeholder: 'Filter table', ariaLabel: 'Filter table',
            // Category and status fold into the field that already filters
            // this table, instead of a second control that also filtered it.
            filters: {
              activeCount: headerFilterCount,
              onClear: () => { setCategoryFilter('all'); setStatusFilter('all'); },
              label: t('patients.filtersTitle'),
              panelWidth: 420,
              children: (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{t('pharmacy.category')}</span>
                    <Select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="w-full text-sm py-2 px-3" style={popoverFieldStyle}>
                      <option value="all">{t('patients.all')}</option>
                      {categories.map(c => <option key={c} value={c}>{c}</option>)}
                    </Select>
                  </label>
                  {statusFilterRelevant && (
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{t('pharmacy.statusLabel')}</span>
                      <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)} className="w-full text-sm py-2 px-3" style={popoverFieldStyle}>
                        <option value="all">{t('patients.all')}</option>
                        <option value="adequate">{t('pharmacy.inStock')}</option>
                        <option value="low">{t('pharmacy.invStatus_low')}</option>
                        <option value="critical">{t('pharmacy.invStatus_critical')}</option>
                        <option value="expired">{t('pharmacy.invStatus_expired')}</option>
                      </Select>
                    </label>
                  )}
                </div>
              ),
            },
          } : undefined}
          actions={
            <>
              {/* View switcher. Was a six-tab strip under the header, which ran
                  ~1400px wide and scrolled horizontally on anything narrower;
                  as a select it sits beside the search and the card title
                  already names the current view. Counts stay on the options. */}
              <Select
                value={activeTab}
                onChange={e => setActiveTab(e.target.value as PharmacyTab)}
                aria-label="Choose which pharmacy view to display"
                title="Choose which pharmacy view to display"
                style={{
                  height: 38,
                  width: 'auto',
                  maxWidth: 320,
                  flexShrink: 0,
                  // 8px, matching the square icon buttons beside it.
                  borderRadius: 8,
                  padding: '0 14px',
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--accent-primary)',
                }}
              >
                {tabsConfig.map(tab => (
                  <option key={tab.key} value={tab.key}>{tab.label}</option>
                ))}
              </Select>
              {anyColFilter && (
                <EhrListHeaderButton onClick={clearColFilters} ariaLabel={t('nurse.clearAllFilters')}>
                  <X className="w-4 h-4" />
                </EhrListHeaderButton>
              )}
              {!(activeTab === 'patients' && activePatient) && activeTab === 'reorder' && canDispense && reorderList.length > 0 && (
                <button type="button" onClick={handlePrintReorder} className="btn btn-primary btn-sm" style={{ gap: 6, height: 38 }}>
                  <Printer size={15} /> {t('pharmacy.generateOrder')}
                </button>
              )}
              {!(activeTab === 'patients' && activePatient) && (
                <EhrListHeaderButton onClick={handleDownloadCsv} ariaLabel="Download">
                  <Download className="w-4 h-4" />
                </EhrListHeaderButton>
              )}
              {canDispense && (
                <button data-tour="pharmacy-receive-stock" onClick={() => setShowStockInModal(true)} className="btn btn-primary" style={{ height: 38, whiteSpace: 'nowrap' }}>
                  <Plus className="w-4 h-4" /> {t('pharmacy.receiveStock')}
                </button>
              )}
            </>
          }
        />
        {activeTab === 'queue' && (
          rxLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--text-muted)' }} />
            </div>
          ) : (
            // The lab queue's card grid (see lab/page.tsx): identical head,
            // row anatomy, and column spacing. The dosage rides under the
            // medication and the order time under the prescriber, the way the
            // lab stacks the accession under the specimen and the order date
            // under the ordering clinician. The row still unfolds the
            // dispensing workflow beneath itself, as a full-width flow row.
            <div className="appointment-card-surface patients-list-surface pharm-list-surface">
              <div className="appointment-card-flow">
                <div className="appointment-card-head" aria-hidden="true">
                  <span>{t('pharmacy.patient')}</span>
                  <span>{t('pharmacy.medication')}</span>
                  <span>{t('pharmacy.prescribedBy')}</span>
                  <span>Payment</span>
                  <span>{t('pharmacy.statusLabel')}</span>
                </div>
                {filteredQueue.length === 0 && (
                  <div className="appointment-card-empty">{t('pharmacy.noPrescriptionsFound')}</div>
                )}
                {filteredQueue.map(rx => {
                  const stage = pharmacyStage(rx);
                  const balance = balanceFor(rx.patientId);
                  const balanceKnown = isKnownFor(rx.patientId);
                  const paymentClear = isClearedFor(rx.patientId);
                  const rowPatient = patientById.get(rx.patientId);
                  const toggleWorkflow = () => setCounter({ id: rx._id });
                  return (
                    <Fragment key={rx._id}>
                      <div
                        className="ehr-appointment-row appointment-card-row"
                        role="button"
                        tabIndex={0}
                        onClick={toggleWorkflow}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleWorkflow(); } }}
                      >
                        <div className="ehr-appointment-identity">
                          {rowPatient ? (
                            <PatientAvatar patient={rowPatient} size={40} />
                          ) : (
                            <span aria-hidden="true" style={INITIALS_PLATE_STYLE}>{nameInitials(rx.patientName)}</span>
                          )}
                          <div className="ehr-appointment-main appointment-card-patient">
                            {rx.patientId ? (
                              <Link href={`/patients/${rx.patientId}?tab=prescriptions&focus=${encodeURIComponent(rx._id)}`} {...stopsClickPropagation}>
                                {shortenPersonName(rx.patientName)}
                              </Link>
                            ) : (
                              <strong>{shortenPersonName(rx.patientName)}</strong>
                            )}
                            <p>
                              {[rowPatient?.hospitalNumber || 'ID not recorded',
                                rowPatient && patientAgeLabel(rowPatient),
                                rowPatient?.gender].filter(Boolean).join(' \u00b7 ')}
                            </p>
                          </div>
                        </div>

                        <div className="appointment-card-provider">
                          <strong>{rx.medication}</strong>
                          <span className="font-mono">{prescriptionSig(rx)}</span>
                        </div>

                        <div className="appointment-card-provider">
                          <strong>{rx.prescribedBy}</strong>
                          <span>{rx.createdAt ? formatCompactDateTime(rx.createdAt) : '\u2014'}</span>
                        </div>

                        {/* Payment sits mid-table, so it aligns under its own
                            head instead of anchoring to the table's far edge. */}
                        <div className="appointment-card-status appointment-card-status--start">
                          <span className={`appointment-status-pill ${paymentClear ? 'status-completed' : balanceKnown ? 'status-attention' : 'status-scheduled'}`}>
                            {paymentClear ? 'Clear' : balanceKnown ? formatMoney(balance) : 'Unknown'}
                          </span>
                        </div>

                        <div className="appointment-card-status">
                          <StationActionPill
                            label={counterPillLabel(rx.orderStatus || 'prescribed', t)}
                            className={RX_STAGE_PILL_CLASS[stage] ?? 'status-scheduled'}
                            actions={canDispense ? counterActions(rx.orderStatus || 'prescribed', t) : []}
                            ariaLabel={`Next step for ${rx.medication}`}
                            onPick={action => setCounter({ id: rx._id, intent: action === 'hold' || action === 'stockout' ? action : undefined })}
                          />
                          {rx.urgency === 'immediate' && (
                            <small style={{ color: 'var(--color-warning-text)' }}>Immediate</small>
                          )}
                        </div>
                      </div>
                    </Fragment>
                  );
                })}
              </div>
            </div>
          )
        )}

        {activeTab === 'inventory' && (
          <div className="ehr-list-scroll">
            <table className="data-table" style={{ minWidth: 1080, tableLayout: 'fixed' }}>
              <TableCols widths={[1.9, 1.1, 0.8, 0.9, 0.9, 1, 1, 0.9, 0.8]} />
              <thead>
                <tr>
                  <th>{t('pharmacy.medication')}</th>
                  <th>{t('pharmacy.category')}</th>
                  <th>{t('pharmacy.stockLabel')}</th>
                  <th>{t('pharmacy.reorderLevel')}</th>
                  <th>{t('pharmacy.statusLabel')}</th>
                  <th>{t('pharmacy.batchLabel')}</th>
                  <th>{t('pharmacy.expiry')}</th>
                  <th>{t('pharmacy.kpiDispensedToday')}</th>
                  {canDispense && <th>{t('pharmacy.action')}</th>}
                </tr>
              </thead>
              <tbody>
                {filteredInventory.length === 0 ? (
                  <tr>
                    <td colSpan={canDispense ? 9 : 8} className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>
                      {t('pharmacy.noInventoryItems')}
                    </td>
                  </tr>
                ) : filteredInventory.map(item => (
                  <tr key={item._id}>
                    {/* Icon dropped: stock state is already its own Status
                        column, so the glyph was a second, weaker copy of it. */}
                    <td className="font-semibold text-sm">{item.medicationName}</td>
                    <td><span className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--overlay-medium)', color: 'var(--text-secondary)' }}>{item.category}</span></td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm" style={{ color: item.status === 'critical' ? 'var(--color-danger-text)' : item.status === 'low' ? 'var(--color-warning-text)' : 'inherit' }}>
                          {item.stockLevel}
                        </span>
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{item.unit}</span>
                      </div>
                      <div className="w-20 h-1.5 rounded-full mt-1" style={{ background: 'var(--overlay-medium)' }}>
                        <div className="h-full rounded-full" style={{
                          width: `${Math.min(100, (item.stockLevel / Math.max(1, item.reorderLevel * 3)) * 100)}%`,
                          background: item.status === 'critical' ? 'var(--color-danger)' : item.status === 'low' ? 'var(--color-warning)' : 'var(--color-success)',
                        }} />
                      </div>
                    </td>
                    <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{item.reorderLevel} {item.unit}</td>
                    <td>
                      <span className={`badge text-[10px] ${
                        item.status === 'adequate' ? 'badge-normal' :
                        item.status === 'low' ? 'badge-warning' :
                        'badge-emergency'
                      }`}>
                        {item.status === 'adequate' ? t('pharmacy.inStock') : t(`pharmacy.invStatus_${item.status}`)}
                      </span>
                    </td>
                    <td className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{item.batchNumber}</td>
                    <td className="text-xs" style={{ color: item.status === 'expired' ? 'var(--color-danger-text)' : 'var(--text-muted)' }}>
                      {item.expiryDate}
                    </td>
                    <td className="text-center font-semibold text-sm">{dispensedTodayOf(item)}</td>
                    {canDispense && (
                      <td>
                        <button className="btn btn-secondary btn-sm" onClick={() => openRestock(item._id)}>+ {t('pharmacy.receive')}</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'reorder' && (
          <div className="ehr-list-scroll">
            <table className="data-table" style={{ minWidth: 720, tableLayout: 'fixed' }}>
              <TableCols widths={[1.9, 1.1, 0.8, 0.9, 0.8, 0.9]} />
              <thead>
                <tr>
                  <th>{t('pharmacy.medication')}</th>
                  <th>{t('pharmacy.category')}</th>
                  <th>{t('pharmacy.stockLabel')}</th>
                  <th>{t('pharmacy.reorderLevel')}</th>
                  <th>{t('pharmacy.orderQty')}</th>
                  <th>{t('pharmacy.statusLabel')}</th>
                </tr>
              </thead>
              <tbody>
                {reorderList.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>{t('pharmacy.allStockAdequate')}</td></tr>
                ) : reorderList.map(item => (
                  <tr key={item._id}>
                    <td className="font-semibold text-sm">
                      <div className="flex items-center gap-2">
                        <div className="icon-box-sm">
                          {item.status === 'critical'
                            ? <AlertOctagon className="w-3.5 h-3.5" style={{ color: 'var(--color-danger)' }} />
                            : <AlertTriangle className="w-3.5 h-3.5" style={{ color: 'var(--color-warning-text)' }} />}
                        </div>
                        {item.medicationName}
                      </div>
                    </td>
                    <td><span className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--overlay-medium)', color: 'var(--text-secondary)' }}>{item.category}</span></td>
                    <td className="font-semibold text-sm" style={{ color: item.status === 'critical' ? 'var(--color-danger-text)' : 'var(--color-warning-text)' }}>{item.stockLevel} <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{item.unit}</span></td>
                    <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{item.reorderLevel}</td>
                    <td className="font-semibold text-sm" style={{ color: 'var(--accent-primary)' }}>{orderQtyFor(item)} {item.unit}</td>
                    <td>
                      <span className={`badge text-[10px] ${item.status === 'low' ? 'badge-warning' : 'badge-emergency'}`}>
                        {t(`pharmacy.invStatus_${item.status}`)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'expiry' && (
          <div className="ehr-list-scroll">
            <table className="data-table" style={{ minWidth: 600, tableLayout: 'fixed' }}>
              <TableCols widths={[1.9, 1, 0.8, 0.9, 0.9]} />
              <thead>
                <tr>
                  <th>{t('pharmacy.medication')}</th>
                  <th>{t('pharmacy.batchLabel')}</th>
                  <th>{t('pharmacy.stockLabel')}</th>
                  <th>{t('pharmacy.expiry')}</th>
                  <th>{t('pharmacy.statusLabel')}</th>
                </tr>
              </thead>
              <tbody>
                {expiryList.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>{t('pharmacy.noInventoryItems')}</td></tr>
                ) : expiryList.map(item => {
                  const { days, expired, soon } = expiryStatusFor(item);
                  return (
                    <tr key={item._id}>
                      {/* Icon dropped: the same calendar on every row said
                          nothing the Expiry and Status columns don't already
                          say, in colour, further right. */}
                      <td className="font-semibold text-sm">{item.medicationName}</td>
                      <td className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{item.batchNumber}</td>
                      <td className="text-sm">{item.stockLevel} <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{item.unit}</span></td>
                      <td className="text-xs" style={{ color: expired ? 'var(--color-danger-text)' : 'var(--text-muted)' }}>{item.expiryDate}</td>
                      <td>
                        <span className={`badge text-[10px] ${expired ? 'badge-emergency' : soon ? 'badge-warning' : 'badge-normal'}`}>
                          {expired ? t('pharmacy.expired') : t('pharmacy.daysLeft', { count: days })}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'overview' && (
          categoryOverview.length === 0 ? (
            <p className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>{t('pharmacy.noInventoryItems')}</p>
          ) : (
            <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="col-span-2 sm:col-span-3 text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                {totalUnits.toLocaleString()} {t('pharmacy.kpiTotalMeds')}
              </div>
              {categoryOverview.map(cat => {
                const okPct = cat.items ? Math.round((cat.adequate / cat.items) * 100) : 0;
                return (
                  <div key={cat.category} className="rounded-xl p-3" style={{ border: '1px solid var(--border-light)', background: 'var(--bg-card)' }}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-semibold" style={{ color: 'var(--accent-primary)' }}>{cat.category}</span>
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{
                        background: okPct > 80 ? 'rgba(79, 199, 155,0.15)' : okPct > 60 ? 'rgba(255, 210, 166,0.15)' : 'rgba(242, 109, 100,0.15)',
                        color: okPct > 80 ? 'var(--color-success-text)' : okPct > 60 ? 'var(--color-warning-text)' : 'var(--color-danger-text)',
                      }}>{okPct}%</span>
                    </div>
                    <p className="text-lg font-bold mb-1.5">{cat.units.toLocaleString()} <span className="text-[10px] font-semibold" style={{ color: 'var(--text-muted)' }}>{t('pharmacy.stockLabel')}</span></p>
                    <div className="h-1.5 rounded-full overflow-hidden mb-2" style={{ background: 'var(--border-light)' }}>
                      <div className="h-full rounded-full" style={{ width: `${okPct}%`, background: okPct > 80 ? 'var(--color-success)' : okPct > 60 ? 'var(--color-warning)' : 'var(--color-danger)' }} />
                    </div>
                    <div className="flex justify-between text-[9px]" style={{ color: 'var(--text-muted)' }}>
                      <span style={{ color: 'var(--color-success-text)' }}>{t('pharmacy.catOk', { count: cat.adequate })}</span>
                      <span style={{ color: 'var(--color-warning-text)' }}>{t('pharmacy.catLow', { count: cat.low })}</span>
                      <span style={{ color: 'var(--color-danger-text)' }}>{t('pharmacy.catCrit', { count: cat.critical + cat.expired })}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}

        {activeTab === 'patients' && (
            patientResults.length === 0 ? (
              <p className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>
                {q ? t('pharmacy.noPatientsFound', { query: q }) : t('pharmacy.searchPatientPlaceholder')}
              </p>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--border-light)' }}>
                {patientResults.map(p => {
                  const rxs = rxFor(p);
                  const pending = rxs.filter(r => isActivePharmacyStage(pharmacyStage(r)) && r.status !== 'discontinued').length;
                  return (
                    <button key={p._id} onClick={() => setSelectedPatient(p._id)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-start hover:bg-[var(--table-row-hover)]">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{patientName(p)}</p>
                        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          {p.hospitalNumber}{rxs.length ? ` · ${t('pharmacy.prescriptionsOnRecord', { count: rxs.length })}` : ''}
                        </p>
                      </div>
                      {pending > 0 && (
                        <span className="badge badge-warning text-[10px]">{t('pharmacy.pendingBadge', { count: pending })}</span>
                      )}
                      <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                    </button>
                  );
                })}
              </div>
            )
        )}
      </div>

      {activeTab === 'patients' && activePatient && (
        <PatientMedHistoryModal
          activePatient={activePatient}
          activeRxs={activeRxs}
          onClose={() => setSelectedPatient(null)}
          onViewAll={() => router.push(`/patients/${activePatient._id}?tab=prescriptions`)}
        />
      )}

      {/* Stock-in modal */}
      {showStockInModal && (
        <StockInModal
          stockForm={stockForm}
          setStockForm={setStockForm}
          onClose={() => setShowStockInModal(false)}
          onSave={handleStockIn}
        />
      )}

      {/* Restock modal — top up an existing inventory line with quantity + optional batch/expiry */}
      {restockTarget && (
        <RestockModal
          restockTarget={restockTarget}
          restockForm={restockForm}
          setRestockForm={setRestockForm}
          onClose={() => setRestockTarget(null)}
          onSave={handleRestock}
        />
      )}

      {/* Single medication handover; controlled medicines add witness sign-off. */}
      {counterRx && (
        <DispenseSlider
          rx={counterRx}
          patientName={shortenPersonName(counterRx.patientName)}
          activeMedications={allPrescriptions.filter(rx => rx.patientId === counterRx.patientId && rx._id !== counterRx._id && rx.status !== 'discontinued').map(rx => rx.medication).filter(Boolean)}
          intent={counter?.intent}
          onClose={() => setCounter(null)}
        />
      )}
    </main>
  );
}
