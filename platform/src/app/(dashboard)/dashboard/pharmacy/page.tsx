'use client';
import { useState, useCallback, useEffect, useMemo } from 'react';
import { medicationMatches } from '@/lib/services/dispensing-service';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { usePrescriptions } from '@/lib/hooks/usePrescriptions';
import { usePharmacyInventory } from '@/lib/hooks/usePharmacyInventory';
import { useUsers } from '@/lib/hooks/useUsers';
import { useToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import { classifyStockStatus } from '@/lib/services/pharmacy-inventory-service';
import { checkNewPrescription, type DrugInteraction, type InteractionSeverity } from '@/lib/services/drug-interaction-service';
import { formatMoney , formatRxSig } from '@/lib/format-utils';
import { isActivePharmacyStage, isFinanciallyCleared, pharmacyStage, pharmacyStageGroup, pharmacyStageLabel, pharmacyStageTone } from '@/lib/pharmacy-workflow';
import type { PrescriptionDoc, PharmacyInventoryDoc, UserDoc } from '@/lib/db-types';
import type { PrescriptionStatus } from '@/lib/clinical-flow/order-lifecycles';
import EhrCareDashboard, {
  type EhrCareDashboardRow,
  type EhrCareDashboardAction,
} from '@/components/ehr/EhrCareDashboard';
import { type DayStatsItem } from '@/components/ehr/EhrDayStatsChart';
import { toIsoDate, addDays } from '@/components/ehr/EhrMiniCalendar';
import { tooltipStyle, axisTick } from '@/components/ChartCard';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, Cell, ResponsiveContainer,
} from 'recharts';
import {
  Pill, Package, ShieldCheck, ClipboardList,
  Activity, AlertTriangle, Clock, CheckCircle2, ChevronRight,
  AlertOctagon, X, Check, Plus, Users, BarChart3, Loader2,
  type LucideIcon,
} from '@/components/icons/lucide';
import Select from '@/components/Select';

const ACCENT = 'var(--accent-primary)';
type WorkflowStepKey = 'received' | 'review' | 'checked' | 'payment' | 'dispensed' | 'counseled' | 'cleared';
type WorkflowStepAction = { label: string; onClick: () => void };

// Interaction severities coming out of drug-interaction-service.checkInteractions().
const SEVERITY_STYLE: Record<InteractionSeverity, { bg: string; border: string; text: string; label: string }> = {
  contraindicated: { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.35)', text: 'var(--color-danger-text)', label: 'CONTRAINDICATED' },
  serious: { bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.22)', text: 'var(--color-danger-text)', label: 'SERIOUS' },
  moderate: { bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.3)', text: 'var(--color-warning-text)', label: 'MODERATE' },
};

function titleCaseDrug(name: string): string {
  return name.replace(/\b\w/g, c => c.toUpperCase());
}

function formatTime(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

// Turns a minutes count into "1h 20m" / "45m" for the queue-wait stat tile.
function formatMinutes(totalMinutes: number): string {
  const total = Math.round(totalMinutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Chart marks (not UI status pills, which keep using the --color-* tokens
// elsewhere in this file) use the fixed brand chart palette.
const CHART_BLUE = '#2a78d6';
const CHART_GREEN = 'var(--color-success)';
const CHART_RED = 'var(--color-danger)';
const CHART_AMBER = 'var(--color-warning)';
const CHART_NEUTRAL = '#94a3b8'; // "Other" aggregate bucket only — not a brand color
const DISPENSE_SERIES_COLORS = [CHART_BLUE, CHART_GREEN, CHART_RED, CHART_AMBER];
const DISPENSED_DONE_STAGES = new Set(['dispensed', 'counseled', 'complete']);

// ===================== DISPENSE CONFIRMATION MODAL =====================
// Shows the patient/drug summary, any real drug-interaction warnings pulled
// from the patient's other active prescriptions, and — when the matched
// inventory item is a controlled/witnessed drug — a witness picker that
// gates the confirm button until a second staff member is selected.
function DispenseModal({
  rx, inv, qty, interactions, users, currentUserId, witnessId, onWitnessChange, onConfirm, onCancel, confirming,
}: {
  rx: PrescriptionDoc;
  inv: PharmacyInventoryDoc;
  qty: number;
  interactions: DrugInteraction[];
  users: UserDoc[];
  currentUserId?: string;
  witnessId: string;
  onWitnessChange: (id: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  confirming: boolean;
}) {
  const { t } = useTranslation();
  const requiresWitness = !!(inv.controlledSchedule || inv.requiresWitness);
  const canConfirm = !confirming && (!requiresWitness || !!witnessId);

  return (
    <Modal onClose={onCancel} width={448}>
      <div className="dash-card rounded-2xl p-5 w-full" style={{
        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
      }}>
        <div className="flex items-center gap-2 mb-4">
          <Pill className="w-5 h-5" style={{ color: ACCENT }} />
          <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{t('pharmacy.confirmDispensing')}</h3>
        </div>

        {/* Interaction Warnings — real drug-interaction-service check against
            the patient's other active prescriptions. */}
        {interactions.length > 0 && (
          <div className="mb-4 space-y-2">
            {interactions.map((inter, i) => {
              const style = SEVERITY_STYLE[inter.severity];
              return (
                <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg" style={{
                  background: style.bg, border: `1px solid ${style.border}`,
                }}>
                  <AlertOctagon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: style.text }} />
                  <div>
                    <p className="text-xs font-bold" style={{ color: style.text }}>
                      {t('pharmacy.interactionLabel', { severity: style.label, drug1: titleCaseDrug(inter.drug1), drug2: titleCaseDrug(inter.drug2) })}
                    </p>
                    <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{inter.description}</p>
                    <p className="text-[10px] italic mt-0.5" style={{ color: 'var(--text-muted)' }}>{inter.clinicalAdvice}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="space-y-2 mb-4 p-3 rounded-xl" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
          <div className="flex justify-between">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('pharmacy.patient')}</span>
            <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{rx.patientName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('pharmacy.medication')}</span>
            <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{rx.medication}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('pharmacy.dose')}</span>
            <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{formatRxSig(rx)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('pharmacy.prescriber')}</span>
            <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{rx.prescribedBy}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Quantity</span>
            <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{qty} {inv.unit}</span>
          </div>
        </div>

        {requiresWitness && (
          <div className="mb-4 p-3 rounded-xl" style={{ background: 'var(--color-warning-bg)', border: '1px solid var(--color-warning-border)' }}>
            <div className="flex items-center gap-2 mb-2">
              <AlertOctagon className="w-4 h-4" style={{ color: 'var(--color-warning)' }} />
              <span className="text-xs font-bold" style={{ color: 'var(--color-warning-text)' }}>
                Controlled substance{inv.controlledSchedule ? ` (Schedule ${inv.controlledSchedule})` : ''} — witness required
              </span>
            </div>
            <Select
              value={witnessId}
              onChange={(e) => onWitnessChange(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
            >
              <option value="">Select witnessing staff…</option>
              {users.filter(u => u._id !== currentUserId).map(u => (
                <option key={u._id} value={u._id}>{u.name} — {u.role}</option>
              ))}
            </Select>
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 py-2 rounded-lg text-sm font-medium transition-all" style={{
            background: 'var(--overlay-subtle)', color: 'var(--text-primary)', border: '1px solid var(--border-light)',
          }}>{t('action.cancel')}</button>
          <button
            onClick={() => canConfirm && onConfirm()}
            disabled={!canConfirm}
            className="flex-1 py-2 rounded-lg text-sm font-bold text-white transition-all flex items-center justify-center gap-1.5"
            style={{ background: 'var(--color-success)', opacity: canConfirm ? 1 : 0.6 }}
          >
            {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {t('pharmacy.dispense')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ===================== RECEIVE STOCK MODAL =====================
// Record a delivery of purchased drugs and add the received quantity to the
// matching inventory line ("on what you have"). New items can also be added.
function ReceiveStockModal({ items, onConfirm, onClose, saving }: {
  items: { name: string; stock: number; unit: string }[];
  onConfirm: (name: string, qty: number, unit: string) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const selected = items.find(i => i.name === name);
  const unit = selected?.unit || 'units';
  const qtyNum = parseInt(qty) || 0;
  const canSave = !saving && name.trim().length > 0 && qtyNum > 0;

  return (
    <Modal onClose={onClose} width={448}>
      <div className="dash-card rounded-2xl p-5 w-full" style={{ boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5" style={{ color: ACCENT }} />
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{t('pharmacy.receiveStock')}</h3>
          </div>
          <button onClick={onClose} aria-label={t('action.close')}><X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} /></button>
        </div>

        <div className="space-y-3 mb-5">
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('pharmacy.medication')}</label>
            <input
              list="receive-stock-list"
              type="text"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              placeholder={t('pharmacy.medication')}
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-all"
              style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
            />
            <datalist id="receive-stock-list">
              {items.map(i => <option key={i.name} value={i.name}>{i.stock} {i.unit}</option>)}
            </datalist>
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>
              {t('pharmacy.quantityReceived', { unit })}
            </label>
            <input
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="0"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-all"
              style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
            />
            {selected && qtyNum > 0 && (
              <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                {selected.stock} → <strong style={{ color: 'var(--color-success-text)' }}>{selected.stock + qtyNum}</strong> {unit}
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg text-sm font-medium transition-all" style={{
            background: 'var(--overlay-subtle)', color: 'var(--text-primary)', border: '1px solid var(--border-light)',
          }}>{t('action.cancel')}</button>
          <button
            onClick={() => canSave && onConfirm(name.trim(), qtyNum, unit)}
            disabled={!canSave}
            className="flex-1 py-2 rounded-lg text-sm font-bold text-white transition-all flex items-center justify-center gap-1.5"
            style={{ background: canSave ? 'var(--color-success)' : 'var(--text-muted)', opacity: canSave ? 1 : 0.6 }}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} {t('pharmacy.addToStock')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ===================== MAIN COMPONENT =====================

export default function PharmacyDashboardPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentUser } = useAuth();
  const { canDispense, canAccess } = usePermissions();
  const { showToast } = useToast();
  const dateLabel = useMemo(() => new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: '2-digit' }).format(new Date()), []);

  // ── Real data sources ──
  const { prescriptions: rxQueue, loading: rxLoading, dispense, advance } = usePrescriptions();
  const { items: rawInventory, create: createInventory, update: updateInventory } = usePharmacyInventory();
  const { users } = useUsers();

  // Dispense confirmation modal (+ witness selection for controlled drugs)
  const [dispenseTarget, setDispenseTarget] = useState<{ rx: PrescriptionDoc; inv: PharmacyInventoryDoc; qty: number } | null>(null);
  const [witnessId, setWitnessId] = useState('');
  const [dispensing, setDispensing] = useState(false);
  // Receive stock modal (record purchased drugs arriving)
  const [showReceiveStock, setShowReceiveStock] = useState(false);
  const [receivingStock, setReceivingStock] = useState(false);
  // Prescription queue lane filter — the shared three-lane vocabulary every
  // role dashboard shows: Scheduled = ordered/awaiting pickup by the workflow,
  // In Office = actively being worked (review → cleared/held), Finished =
  // dispensed/counseled/complete.
  const [queueFilter, setQueueFilter] = useState<'scheduled' | 'in_office' | 'finished'>('scheduled');
  // Which stat panel (header toggles) occupies the center instead of the Rx
  // queue; null = normal queue view.
  const [centerPanel, setCenterPanel] = useState<'pipeline' | 'stock' | 'charts' | null>(null);
  // Queue text search (bound to the shared shell's left-rail search).
  const [queueSearch, setQueueSearch] = useState('');
  // 'loading'/'error' are distinct from a real zero balance: isFinanciallyCleared(0)
  // is true, so treating an in-flight or failed ledger fetch as balance=0 would
  // wave a patient who actually owes money straight through the payment gate.
  // Only 'ready' is a confirmed balance; everything else fails closed below.
  const [balanceByPatient, setBalanceByPatient] = useState<Map<string, { balance: number; status: 'loading' | 'ready' | 'error' }>>(new Map());
  const deepLinkPatientId = searchParams?.get('patientId') || '';
  const deepLinkPatientName = searchParams?.get('patient') || '';
  const deepLinkRxId = searchParams?.get('rxId') || '';

  useEffect(() => {
    if (!deepLinkPatientId && !deepLinkPatientName && !deepLinkRxId) return;
    setCenterPanel(null);
    setQueueFilter('scheduled');
    setQueueSearch('');
  }, [deepLinkPatientId, deepLinkPatientName, deepLinkRxId]);

  // Inventory augmented with a live status classification (same helper the
  // real /pharmacy page uses), so stock badges/percentages stay accurate as
  // stock drains or expiry dates pass.
  const inventory = useMemo(
    () => rawInventory.map(item => ({ ...item, status: classifyStockStatus(item) })),
    [rawInventory],
  );

  useEffect(() => {
    let cancelled = false;
    const patientIds = Array.from(new Set(rxQueue.map(rx => rx.patientId).filter(Boolean)));
    if (patientIds.length === 0) {
      setBalanceByPatient(new Map());
      return;
    }
    // Mark every patient 'loading' up front (keeping any previously-known
    // balance around) so the gate reads "unknown" — not a stale ready value —
    // for the whole time this fetch is in flight.
    setBalanceByPatient(prev => {
      const next = new Map(prev);
      for (const id of patientIds) next.set(id, { balance: next.get(id)?.balance ?? 0, status: 'loading' });
      return next;
    });
    (async () => {
      const { getPatientBalance } = await import('@/lib/services/ledger-service');
      // Settled per patient (not one Promise.all) so one patient's ledger
      // hiccup doesn't wipe out every other patient's already-known balance —
      // the previous all-or-nothing fetch reset the whole map to empty (and
      // every balance to the "cleared" 0 default) on any single failure.
      const results = await Promise.allSettled(patientIds.map(id => getPatientBalance(id)));
      if (cancelled) return;
      setBalanceByPatient(prev => {
        const next = new Map(prev);
        results.forEach((r, i) => {
          const id = patientIds[i];
          if (r.status === 'fulfilled') next.set(id, { balance: r.value, status: 'ready' });
          else next.set(id, { balance: next.get(id)?.balance ?? 0, status: 'error' });
        });
        return next;
      });
    })();
    return () => { cancelled = true; };
  }, [rxQueue]);

  const patientBalanceFor = useCallback((rx: PrescriptionDoc) =>
    rx.patientId ? balanceByPatient.get(rx.patientId)?.balance ?? 0 : 0,
  [balanceByPatient]);
  // True only once a real ledger read has landed for this patient — 'loading'
  // and 'error' (and a patient never queried at all) all read as unknown.
  const isBalanceKnownFor = useCallback((rx: PrescriptionDoc) =>
    !rx.patientId || balanceByPatient.get(rx.patientId)?.status === 'ready',
  [balanceByPatient]);
  // The actual payment gate: fails closed. An unknown balance is never
  // "cleared", however isFinanciallyCleared(undefined ?? 0) would read it.
  const isPatientClearedFor = useCallback((rx: PrescriptionDoc) =>
    isBalanceKnownFor(rx) && isFinanciallyCleared(patientBalanceFor(rx)),
  [isBalanceKnownFor, patientBalanceFor]);
  // Earliest-expiring in-stock batch at this facility, matched the same
  // normalised way the dispensing transaction matches — an exact-name lookup
  // missed every order written without a strength ("Amoxicillin" vs the
  // catalogued "Amoxicillin 500mg").
  const findInventoryFor = useCallback((medication: string) =>
    inventory
      .filter(i => medicationMatches(medication, i.medicationName))
      .filter(i => !currentUser?.hospitalId || i.hospitalId === currentUser.hospitalId)
      .filter(i => (i.stockLevel || 0) > 0)
      .sort((a, b) => (a.expiryDate || '9999').localeCompare(b.expiryDate || '9999'))[0],
  [inventory, currentUser?.hospitalId]);

  const isControlled = useCallback((rx: PrescriptionDoc) => {
    const inv = findInventoryFor(rx.medication);
    return !!(inv?.controlledSchedule || inv?.requiresWitness);
  }, [findInventoryFor]);

  // Only the lines that need attention, worst first — shown in the Stock
  // Alerts panel (the full inventory list lives on /pharmacy).
  const stockAlerts = useMemo(
    () => inventory
      .filter(i => i.status !== 'adequate')
      .sort((a, b) => (a.stockLevel / Math.max(1, a.reorderLevel)) - (b.stockLevel / Math.max(1, b.reorderLevel))),
    [inventory],
  );

  // ── Analytics panel data (centerPanel === 'charts') ──

  // (a) Dispensed-per-day for the last 14 days, split by the top 4 movers
  // (by total dispensed count in the window) plus an "Other" bucket for
  // everything else — real dispense events only (rx.status === 'dispensed'
  // with a real rx.dispensedAt timestamp from confirmDispense/dispense()).
  type DispensedDayRow = { key: string; label: string; Other: number } & Record<string, number | string>;
  const dispensedTrend = useMemo(() => {
    const dispensedRx = rxQueue.filter(rx => rx.status === 'dispensed' && !!rx.dispensedAt);
    const medTotals = new Map<string, number>();
    for (const rx of dispensedRx) medTotals.set(rx.medication, (medTotals.get(rx.medication) || 0) + 1);
    const topMeds = Array.from(medTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([name]) => name);

    const today = new Date();
    const days: DispensedDayRow[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = addDays(today, -i);
      const key = toIsoDate(d);
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const row = { key, label, Other: 0 } as DispensedDayRow;
      topMeds.forEach(med => { row[med] = 0; });
      days.push(row);
    }
    const dayIndex = new Map(days.map((d, i) => [d.key, i]));
    for (const rx of dispensedRx) {
      const idx = dayIndex.get(toIsoDate(new Date(rx.dispensedAt as string)));
      if (idx === undefined) continue; // outside the 14-day window
      const row = days[idx];
      if (topMeds.includes(rx.medication)) row[rx.medication] = (row[rx.medication] as number) + 1;
      else row.Other = row.Other + 1;
    }
    const hasOther = days.some(d => d.Other > 0);
    return { days, medNames: topMeds, hasOther };
  }, [rxQueue]);

  // Day-activity rail: the visible queue is the *pending* pipeline by design,
  // so charting it could never draw a Dispensed bar — the second series was
  // empty on every day of the week. Built from the whole prescription list
  // instead, each order plotted at the moment that series is about: a pending
  // one when it was written, a dispensed one when it left the counter.
  const chartItems = useMemo<DayStatsItem[]>(() => rxQueue
    .filter(rx => rx.status !== 'discontinued')
    .map(rx => {
      const dispensed = DISPENSED_DONE_STAGES.has(pharmacyStage(rx));
      const at = (dispensed && rx.dispensedAt) || rx.createdAt;
      return { date: at.slice(0, 10), time: formatTime(at), series: (dispensed ? 1 : 0) as 0 | 1 };
    }), [rxQueue]);

  // (b) Pending-dispensing queue depth + average wait for orders currently
  // sitting in the queue (real orderStatus stage via pharmacyStage(), same
  // classification the rest of this page uses — not yet dispensed/counseled/
  // complete, and not a discontinued order).
  const pendingQueueRx = useMemo(
    () => rxQueue.filter(rx => rx.status !== 'discontinued' && !DISPENSED_DONE_STAGES.has(pharmacyStage(rx))),
    [rxQueue],
  );
  const avgWaitMinutes = useMemo(() => {
    const withCreated = pendingQueueRx.filter(rx => !!rx.createdAt);
    if (withCreated.length === 0) return null;
    const now = Date.now();
    const totalMinutes = withCreated.reduce((sum, rx) => sum + Math.max(0, (now - new Date(rx.createdAt).getTime()) / 60000), 0);
    return totalMinutes / withCreated.length;
  }, [pendingQueueRx]);

  // (c) Estimated days-of-stock-remaining, proxied from today's real
  // consumption: stockLevel / dispensedToday (both real inventory fields —
  // see pharmacy-inventory-service.decrementStock). There is no multi-day
  // consumption-history collection to average over, so items with zero
  // dispenses recorded today get an honest "insufficient data" instead of a
  // fabricated rate. RAG thresholds: <=3d red, <=7d amber, >7d green.
  type StockRiskRow = { item: (typeof inventory)[number]; daysRemaining: number | null; rag: 'red' | 'amber' | 'green' | null };
  const stockRiskRows = useMemo<StockRiskRow[]>(() => {
    return inventory
      .map(item => {
        if (!item.dispensedToday || item.dispensedToday <= 0) return { item, daysRemaining: null, rag: null };
        const daysRemaining = item.stockLevel / item.dispensedToday;
        const rag: 'red' | 'amber' | 'green' = daysRemaining <= 3 ? 'red' : daysRemaining <= 7 ? 'amber' : 'green';
        return { item, daysRemaining, rag };
      })
      .sort((a, b) => {
        if (a.daysRemaining === null && b.daysRemaining === null) return a.item.medicationName.localeCompare(b.item.medicationName);
        if (a.daysRemaining === null) return 1;
        if (b.daysRemaining === null) return -1;
        return a.daysRemaining - b.daysRemaining;
      });
  }, [inventory]);
  const atRiskChartItems = useMemo(
    () => stockRiskRows.filter((r): r is StockRiskRow & { daysRemaining: number; rag: 'red' | 'amber' | 'green' } => r.daysRemaining !== null).slice(0, 8),
    [stockRiskRows],
  );

  const reviewStages: PrescriptionStatus[] = ['received_in_pharmacy_queue', 'under_review', 'held_awaiting_clarification', 'stockout_partial_referred', 'clinician_consultation_in_progress'];
  const pendingWorkflowCount = rxQueue.filter(r => r.status === 'pending').length;
  const reviewCount = rxQueue.filter(r => r.status === 'pending' && reviewStages.includes(pharmacyStage(r))).length;
  const paymentDueCount = rxQueue.filter(r => pharmacyStage(r) === 'cleared_for_dispensing' && !isPatientClearedFor(r)).length;
  const readyCount = rxQueue.filter(r => pharmacyStage(r) === 'cleared_for_dispensing' && isPatientClearedFor(r)).length;
  const dispensedCount = rxQueue.filter(r => ['dispensed', 'counseled', 'complete'].includes(pharmacyStage(r))).length;
  const pendingRx = pendingWorkflowCount;
  const lowStockCount = inventory.filter(i => i.status === 'low').length;
  const criticalCount = inventory.filter(i => i.status === 'critical').length;
  const expiredCount = inventory.filter(i => i.status === 'expired').length;
  const inStockCount = inventory.filter(i => i.status === 'adequate').length;
  // Lane tab counts — the same three lanes as every other role dashboard.
  // Finished reuses dispensedCount (dispensed/counseled/complete is exactly
  // the finished lane).
  const scheduledLaneCount = rxQueue.filter(r => pharmacyStageGroup(pharmacyStage(r)) === 'scheduled').length;
  const inOfficeLaneCount = rxQueue.filter(r => pharmacyStageGroup(pharmacyStage(r)) === 'in_office').length;

  // Queue filtered by the selected status chip and the inline search query.
  const queueQuery = queueSearch.trim().toLowerCase();
  const visibleQueue = rxQueue.filter(rx => {
    const stage = pharmacyStage(rx);
    const deepLinkOk =
      deepLinkRxId ? rx._id === deepLinkRxId :
      deepLinkPatientId ? rx.patientId === deepLinkPatientId :
      deepLinkPatientName ? rx.patientName.toLowerCase() === deepLinkPatientName.toLowerCase() :
      true;
    if (!deepLinkOk) return false;
    // A deep link targets one prescription/patient wherever it sits in the
    // workflow — never let the lane tab hide the row the link promised.
    const deepLinking = Boolean(deepLinkRxId || deepLinkPatientId || deepLinkPatientName);
    const statusOk = deepLinking || pharmacyStageGroup(stage) === queueFilter;
    if (!statusOk) return false;
    if (!queueQuery) return true;
    return (
      rx.patientName.toLowerCase().includes(queueQuery) ||
      rx.medication.toLowerCase().includes(queueQuery) ||
      (rx.prescribedBy || '').toLowerCase().includes(queueQuery)
    );
  });
  const autoOpenRxId = useMemo(() => {
    if (deepLinkRxId && visibleQueue.some(rx => rx._id === deepLinkRxId)) return deepLinkRxId;
    if (!deepLinkPatientId && !deepLinkPatientName) return null;
    const activeRx = visibleQueue.find(rx => isActivePharmacyStage(pharmacyStage(rx)) && rx.status !== 'discontinued');
    return (activeRx || visibleQueue[0])?._id || null;
  }, [deepLinkPatientId, deepLinkPatientName, deepLinkRxId, visibleQueue]);

  // Drug interaction check for the dispense modal — compare against the
  // patient's other active (non-discontinued) prescriptions in the real queue.
  const getInteractionsForRx = (rx: PrescriptionDoc): DrugInteraction[] => {
    const currentMeds = rxQueue
      .filter(r => r._id !== rx._id && r.status !== 'discontinued' &&
        (rx.patientId ? r.patientId === rx.patientId : r.patientName === rx.patientName))
      .map(r => r.medication);
    return checkNewPrescription(rx.medication, currentMeds).interactions;
  };

  const advanceRx = async (rx: PrescriptionDoc, to: PrescriptionStatus, successMessage: string) => {
    try {
      await advance(rx._id, to);
      showToast(successMessage, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update prescription workflow.', 'error');
    }
  };

  const handleStartReview = (rx: PrescriptionDoc) => {
    const stage = pharmacyStage(rx);
    const next: PrescriptionStatus = stage === 'prescribed' ? 'received_in_pharmacy_queue' : 'under_review';
    advanceRx(rx, next, `${rx.medication} moved to pharmacist review.`);
  };

  const handleClearForDispense = (rx: PrescriptionDoc) => {
    const qty = rx.quantityToDispense || 1;
    const inv = findInventoryFor(rx.medication);
    const interactions = getInteractionsForRx(rx);
    if (interactions.some(i => i.severity === 'contraindicated' || i.severity === 'serious')) {
      advanceRx(rx, 'held_awaiting_clarification', 'Held for prescriber clarification because of a serious interaction.');
      return;
    }
    if (!inv || inv.stockLevel < qty) {
      advanceRx(rx, 'stockout_partial_referred', `Stockout recorded: ${inv?.stockLevel ?? 0} ${inv?.unit || 'unit(s)'} available.`);
      return;
    }
    advanceRx(rx, 'cleared_for_dispensing', `${rx.medication} cleared. Send patient for payment if a balance remains.`);
  };

  const handlePaymentStep = (rx: PrescriptionDoc) => {
    if (canAccess('/payments') && rx.patientId) {
      router.push(`/payments?patientId=${rx.patientId}`);
      return;
    }
    const message = isBalanceKnownFor(rx)
      ? `Payment due for ${rx.patientName}: ${formatMoney(patientBalanceFor(rx))}. Send the patient to cashier before dispensing.`
      : `Could not confirm ${rx.patientName}'s balance. Send the patient to cashier to verify before dispensing.`;
    showToast(message, 'error');
  };

  const handleCounsel = (rx: PrescriptionDoc) =>
    advanceRx(rx, 'counseled', `Counseling recorded for ${rx.patientName}.`);

  const handleComplete = (rx: PrescriptionDoc) =>
    advanceRx(rx, 'complete', `${rx.medication} workflow completed.`);

  // Dispense handler — gates on real stock availability before opening the
  // confirm modal, exactly like the real /pharmacy page's handleDispense.
  const handleDispense = (rx: PrescriptionDoc) => {
    const stage = pharmacyStage(rx);
    if (stage !== 'cleared_for_dispensing') {
      showToast('Check and clear the medication order before dispensing.', 'error');
      return;
    }
    // Fail closed: an unresolved balance (still loading, or the ledger fetch
    // errored) is never treated as cleared — surfaced as its own visible
    // state rather than silently falling through to the stock check below.
    if (!isBalanceKnownFor(rx)) {
      showToast(`Could not confirm ${rx.patientName}'s balance — balance unavailable. Try again before dispensing.`, 'error');
      return;
    }
    if (!isFinanciallyCleared(patientBalanceFor(rx))) {
      handlePaymentStep(rx);
      return;
    }
    const qty = rx.quantityToDispense || 1;
    const inv = findInventoryFor(rx.medication);
    if (!inv || inv.stockLevel < qty) {
      showToast(`Insufficient stock: ${inv?.stockLevel ?? 0} ${inv?.unit || 'unit(s)'} available, ${qty} needed for the full course.`, 'error');
      return;
    }
    setWitnessId('');
    setDispenseTarget({ rx, inv, qty });
  };

  // One call, one transaction — the same dispenseMedication() the real
  // /pharmacy page and the API route use. Stock gate, FEFO batch decrement,
  // controlled-substance register and the prescription update either all land
  // or all roll back; the previous three-await sequence could strand any of
  // them half-applied.
  const confirmDispense = async () => {
    if (!dispenseTarget) return;
    const { rx, inv, qty } = dispenseTarget;
    const requiresWitness = !!(inv.controlledSchedule || inv.requiresWitness);
    let witness: { id: string; name: string } | null = null;
    if (requiresWitness) {
      const w = users.find(u => u._id === witnessId);
      if (!w) {
        showToast('Select a witnessing staff member.', 'error');
        return;
      }
      witness = { id: w._id, name: w.name };
    }

    setDispensing(true);
    try {
      // Re-assert financial clearance right before the write. The confirm
      // modal can sit open for a while (witness pick, a slow click) after
      // handleDispense's own gate ran against balanceByPatient's cached
      // snapshot — a live re-read here closes that window instead of
      // trusting a render that may already be stale by the time this fires.
      if (rx.patientId) {
        const patientId = rx.patientId;
        let liveBalance: number;
        try {
          const { getPatientBalance } = await import('@/lib/services/ledger-service');
          liveBalance = await getPatientBalance(patientId);
        } catch {
          setBalanceByPatient(prev => new Map(prev).set(patientId, { balance: prev.get(patientId)?.balance ?? 0, status: 'error' }));
          showToast(`Could not confirm ${rx.patientName}'s balance — balance unavailable. Dispense cancelled.`, 'error');
          setDispenseTarget(null);
          return;
        }
        setBalanceByPatient(prev => new Map(prev).set(patientId, { balance: liveBalance, status: 'ready' }));
        if (!isFinanciallyCleared(liveBalance)) {
          showToast(`Payment still due for ${rx.patientName}: ${formatMoney(liveBalance)}. Send the patient to cashier before dispensing.`, 'error');
          setDispenseTarget(null);
          return;
        }
      }

      const result = await dispense({
        prescription: rx,
        quantity: qty,
        dispenserId: currentUser?._id || '',
        dispenserName: currentUser?.name || currentUser?.username || '',
        facilityId: currentUser?.hospitalId || '',
        facilityName: currentUser?.hospitalName,
        orgId: currentUser?.orgId,
        witnessId: witness?.id,
        witnessName: witness?.name,
      });
      const batches = result.allocations.map(a => a.batchNumber).join(', ');
      showToast(
        result.outcome === 'partial'
          ? `Partial fill: ${result.quantityDispensed} ${inv.unit} of ${rx.medication} from batch ${batches}. Order stays open.`
          : t('pharmacy.dispensedToast', { medication: rx.medication, patient: rx.patientName }),
        result.outcome === 'partial' ? 'error' : 'success',
      );
      setDispenseTarget(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('pharmacy.dispenseMarkFailed'), 'error');
    } finally {
      setDispensing(false);
    }
  };

  // Receive purchased stock: add the delivered quantity to a matching real
  // inventory line, or create a new line if it's a drug we don't carry yet.
  const handleReceiveStock = async (name: string, qty: number, unit: string) => {
    if (!currentUser?.hospitalId) {
      showToast(t('pharmacy.noFacilityAssigned'), 'error');
      return;
    }
    setReceivingStock(true);
    try {
      const existing = inventory.find(i => i.medicationName.toLowerCase() === name.toLowerCase() && i.hospitalId === currentUser.hospitalId);
      if (existing) {
        await updateInventory(existing._id, {
          stockLevel: existing.stockLevel + qty,
          lastReceived: new Date().toISOString(),
        });
      } else {
        const reorder = Math.max(qty, 50);
        await createInventory({
          hospitalId: currentUser.hospitalId,
          hospitalName: currentUser.hospitalName || '',
          medicationName: name,
          category: 'General',
          stockLevel: qty,
          unit,
          reorderLevel: reorder,
          batchNumber: `BN${Date.now().toString(36).toUpperCase()}`,
          expiryDate: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
          lastReceived: new Date().toISOString(),
          orgId: currentUser.orgId,
        });
      }
      showToast(t('pharmacy.stockedMedication', { medication: name }), 'success');
      setShowReceiveStock(false);
    } catch (err) {
      console.error(err);
      showToast(t('pharmacy.saveStockReceiptFailed'), 'error');
    } finally {
      setReceivingStock(false);
    }
  };

  const renderWorkflowPopup = (rx: PrescriptionDoc) => {
    const stage = pharmacyStage(rx);
    const balance = patientBalanceFor(rx);
    const balanceKnown = isBalanceKnownFor(rx);
    const inv = findInventoryFor(rx.medication);
    const qty = rx.quantityToDispense || 1;
    const stockOk = !!inv && inv.stockLevel >= qty;
    const paymentClear = balanceKnown && isFinanciallyCleared(balance);
    const controlled = !!(inv?.controlledSchedule || inv?.requiresWitness);
    const completed = {
      received: stage !== 'prescribed',
      review: !['prescribed', 'received_in_pharmacy_queue'].includes(stage),
      checked: ['cleared_for_dispensing', 'dispensed', 'counseled', 'complete'].includes(stage),
      payment: ['dispensed', 'counseled', 'complete'].includes(stage) || (stage === 'cleared_for_dispensing' && paymentClear),
      dispensed: ['dispensed', 'counseled', 'complete'].includes(stage),
      counseled: ['counseled', 'complete'].includes(stage),
      cleared: stage === 'complete',
    };
    const currentKey: WorkflowStepKey | '' =
      !completed.received ? 'received' :
      !completed.review ? 'review' :
      !completed.checked ? 'checked' :
      !completed.payment ? 'payment' :
      !completed.dispensed ? 'dispensed' :
      !completed.counseled ? 'counseled' :
      !completed.cleared ? 'cleared' :
      '';
    // Replaces the old 7-step checklist strip: only the one step that's
    // actually actionable right now is shown, in plain language, with its
    // action as the panel's icon button rather than a receipt of every stage.
    const stepCopy: Record<WorkflowStepKey, { note: string; icon: LucideIcon; action: WorkflowStepAction }> = {
      received: { note: rx.prescribedBy ? `Ordered by ${rx.prescribedBy}` : 'Waiting in pharmacy queue', icon: ClipboardList, action: { label: 'Receive Order', onClick: () => handleStartReview(rx) } },
      review: { note: 'Confirm dose, frequency, patient, allergies and interactions.', icon: ClipboardList, action: { label: 'Check Order', onClick: () => handleStartReview(rx) } },
      checked: { note: stockOk ? `${qty} ${inv?.unit || 'unit(s)'} available` : `Stock issue: ${inv?.stockLevel ?? 0} available, ${qty} needed`, icon: ShieldCheck, action: { label: 'Clear Stock and Safety', onClick: () => handleClearForDispense(rx) } },
      payment: { note: !balanceKnown ? 'Balance unavailable — verify before dispensing' : paymentClear ? 'Payment clear or no charge' : `${formatMoney(balance)} outstanding`, icon: Clock, action: { label: canAccess('/payments') ? 'Collect Payment' : 'Send to Cashier', onClick: () => handlePaymentStep(rx) } },
      dispensed: { note: 'Issue the full course and update inventory.', icon: Pill, action: { label: t('pharmacy.dispense'), onClick: () => handleDispense(rx) } },
      counseled: { note: 'Explain dose, timing, side effects and return precautions.', icon: CheckCircle2, action: { label: 'Record Counseling', onClick: () => handleCounsel(rx) } },
      cleared: { note: 'Medication workflow complete.', icon: Check, action: { label: 'Complete Pharmacy Visit', onClick: () => handleComplete(rx) } },
    };
    const current = currentKey ? stepCopy[currentKey] : null;

    return (
      <div className="space-y-3">
        {/* First line: the prescription itself, with the one action this
            pharmacist can actually take right now as an icon button. */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="block font-semibold uppercase tracking-wider text-[10px]" style={{ color: 'var(--text-muted)' }}>Prescription</span>
            <strong className="text-sm" style={{ color: 'var(--text-primary)' }}>{rx.medication}</strong>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatRxSig(rx)} · {qty} {inv?.unit || 'unit(s)'}</p>
          </div>
          {current && (
            <div className="ehr-visit-pop-actions">
              <button
                type="button"
                className="ehr-visit-pop-icon is-primary"
                onClick={current.action.onClick}
                aria-label={current.action.label}
                title={current.action.label}
              >
                <current.icon className="w-4 h-4" aria-hidden />
              </button>
            </div>
          )}
        </div>

        <div className="rounded-xl p-3" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
          <span className="block font-semibold uppercase tracking-wider text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>Stock &amp; batch</span>
          {inv ? (
            <p className="text-xs" style={{ color: 'var(--text-primary)' }}>
              <strong style={{ color: stockOk ? 'var(--color-success-text)' : 'var(--color-danger-text)' }}>{inv.stockLevel} {inv.unit}</strong> available
              {inv.batchNumber ? ` · batch ${inv.batchNumber}` : ''}
              {inv.expiryDate ? ` · exp ${inv.expiryDate}` : ''}
              {controlled ? ' · Controlled substance' : ''}
            </p>
          ) : (
            <p className="text-xs" style={{ color: 'var(--color-danger-text)' }}>No matching inventory found for {rx.medication}.</p>
          )}
        </div>

        <div className="rounded-xl p-3" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
          <span className="block font-semibold uppercase tracking-wider text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>Dispensing state</span>
          <p className="text-xs" style={{ color: 'var(--text-primary)' }}>{current ? current.note : 'Pharmacy workflow complete.'}</p>
        </div>
      </div>
    );
  };

  const headerActions: EhrCareDashboardAction[] = [];
  if (canDispense) {
    headerActions.push({ label: t('pharmacy.receiveStock'), icon: Package, onClick: () => setShowReceiveStock(true), tone: 'primary' });
  }
  headerActions.push({ label: t('pharmacy.kpiControlled'), icon: ShieldCheck, onClick: () => router.push('/controlled-substances') });
  headerActions.push({ label: t('pharmacy.stockAlerts'), icon: AlertTriangle, onClick: () => setCenterPanel(p => (p === 'stock' ? null : 'stock')), active: centerPanel === 'stock', tone: centerPanel === 'stock' ? 'primary' : 'neutral' });
  headerActions.push({ label: 'Analytics', icon: BarChart3, onClick: () => setCenterPanel(p => (p === 'charts' ? null : 'charts')), active: centerPanel === 'charts', tone: centerPanel === 'charts' ? 'primary' : 'neutral' });

  return (
    <>
      <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <EhrCareDashboard
          title={t('pharmacy.operations')}
          eyebrow={t('nav.pharmacy')}
          greetingName={currentUser?.name}
          dateLabel={dateLabel}
          // Rows are dated by when the prescription was written, not by when
          // the pharmacy will fill it: an order raised yesterday and still
          // undispensed belongs in today's queue, not off the end of it.
          filterRowsByDate={false}
          tabs={[
            { key: 'scheduled', label: 'Scheduled', count: scheduledLaneCount },
            { key: 'in_office', label: 'In Office', count: inOfficeLaneCount },
            { key: 'finished', label: 'Finished', count: dispensedCount },
          ]}
          activeTab={queueFilter}
          onTabChange={(k) => setQueueFilter(k as typeof queueFilter)}
          searchValue={queueSearch}
          searchPlaceholder={t('topbar.searchPlaceholder')}
          onSearchChange={setQueueSearch}
          filters={[]}
          actions={headerActions}
          hideRowList={centerPanel !== null}
          chartSeriesNames={['Pending', 'Dispensed']}
          chartItems={chartItems}
          rows={visibleQueue.map((rx): EhrCareDashboardRow => {
            const stage = pharmacyStage(rx);
            const balance = patientBalanceFor(rx);
            const balanceKnown = isBalanceKnownFor(rx);
            const paymentDue = stage === 'cleared_for_dispensing' && !(balanceKnown && isFinanciallyCleared(balance));
            const controlled = isControlled(rx);
            const pastPaymentGate = ['cleared_for_dispensing', 'dispensed', 'counseled', 'complete'].includes(stage);
            // Context: the one real fact about this order worth a glance —
            // an outstanding balance (with the amount, honestly), otherwise
            // a controlled-substance flag, otherwise (once payment has
            // actually been checked) that it's clear. No invented state
            // before the order has reached a payment-relevant stage. A
            // balance that hasn't loaded (or failed to) is its own visible
            // state — it fails the gate above but must not be shown as a
            // fabricated "0 due".
            const location = paymentDue
              ? (balanceKnown ? `Payment due · ${formatMoney(balance)}` : 'Balance unavailable — verify before dispensing')
              : controlled
                ? 'Controlled substance'
                : pastPaymentGate ? 'Payment clear' : undefined;
            return {
              id: rx._id,
              title: rx.patientName,
              patientId: rx.patientId,
              subtitle: `${rx.medication} · ${formatRxSig(rx)}`,
              meta: `${rx.prescribedBy} · ${formatTime(rx.createdAt)}`,
              compactMeta: formatTime(rx.createdAt),
              time: formatTime(rx.createdAt),
              date: rx.createdAt.slice(0, 10),
              timeSecondary: rx.createdAt.slice(0, 10),
              careTeam: rx.prescribedBy,
              careTeamLabel: 'Prescriber',
              // Status pill = the real dispense-pipeline stage, not a
              // money amount or free-text urgency label (those don't belong
              // in a pill — see `location` and `statusTone` below instead).
              status: stage,
              statusLabel: rx.status === 'discontinued' ? 'Discontinued' : pharmacyStageLabel(stage),
              statusSecondary: paymentDue
                ? (balanceKnown ? formatMoney(balance) : 'Unavailable')
                : rx.urgency === 'immediate'
                  ? 'Immediate'
                  : controlled
                    ? 'Controlled'
                    : 'Standard',
              statusTone: rx.status === 'discontinued' ? 'danger' : paymentDue ? 'warning' : rx.urgency === 'immediate' ? 'warning' : pharmacyStageTone(stage),
              location: location || rx.medication,
              locationSecondary: location ? (controlled && !paymentDue ? 'Substance' : 'Payment') : 'Medication',
              locationLabel: location ? (controlled && !paymentDue ? 'Substance' : 'Payment') : undefined,
              popupDetail: renderWorkflowPopup(rx),
              // New order/Ready/Dispensed (plus payment-due/discontinued) IS
              // this screen's whole point — a same-day visit must not paint
              // over the dispense-pipeline stage. The shared shell still
              // surfaces the visit status on the line under the pill.
              lockStatus: true,
            };
          })}
          autoOpenRowId={autoOpenRxId}
          metrics={[
            { label: 'Payment due', value: paymentDueCount, tone: paymentDueCount > 0 ? 'warning' : 'neutral' },
            { label: 'Ready', value: readyCount, tone: 'success' },
            { label: t('pharmacy.kpiLowStock'), value: lowStockCount, tone: 'warning' },
            { label: 'Critical Stock', value: criticalCount + expiredCount, tone: 'danger' },
          ]}
          metricsTitle={t('pharmacy.operations')}
          emptyTitle={rxLoading ? '' : t('pharmacy.noPrescriptionsFound')}
        >
          {/* Stat panels — opened from the header toggles; the active one
              replaces the Rx queue and occupies the whole center. */}
          {centerPanel === 'pipeline' && (
            <div className="dash-card rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: 'var(--border-light)' }}>
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4" style={{ color: ACCENT }} />
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('pharmacy.dispensingPipeline')}</span>
                </div>
                <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{t('pharmacy.pendingBadge', { count: pendingRx })}</span>
              </div>
              <div className="p-4 overflow-x-auto">
                <div className="flex items-center gap-1 min-w-[600px]">
                  {[
                    { key: 'stock', label: t('pharmacy.inStock'), icon: Package, color: ACCENT, count: inStockCount },
                    { key: 'received', label: t('pharmacy.stageReceived'), icon: ClipboardList, color: ACCENT, count: reviewCount },
                    { key: 'payment', label: 'Payment', icon: Clock, color: 'var(--color-warning-text)', count: paymentDueCount },
                    { key: 'ready', label: 'Ready', icon: CheckCircle2, color: 'var(--color-success-text)', count: readyCount },
                    { key: 'dispensed', label: t('pharmacy.kpiDispensed'), icon: CheckCircle2, color: 'var(--color-success-text)', count: dispensedCount },
                    { key: 'reorder', label: t('pharmacy.reorderNeeded'), icon: AlertTriangle, color: 'var(--color-danger-text)', count: criticalCount + lowStockCount + expiredCount },
                  ].map((stage, idx, arr) => (
                    <div key={stage.key} className="flex items-center flex-1">
                      <div className="flex-1 p-2.5 rounded-xl transition-all" style={{
                        background: stage.count > 0 ? 'var(--overlay-subtle)' : 'transparent',
                        border: `1px solid ${stage.count > 0 ? 'var(--border-light)' : 'transparent'}`,
                        opacity: stage.count > 0 ? 1 : 0.5,
                      }}>
                        <div className="flex items-center gap-1.5 mb-1">
                          <stage.icon className="w-3.5 h-3.5" style={{ color: stage.color }} />
                          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: stage.color }}>{stage.label}</span>
                        </div>
                        <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{stage.count}</span>
                      </div>
                      {idx < arr.length - 1 && (
                        <div className="px-1 flex-shrink-0">
                          <ChevronRight className="w-4 h-4" style={{ color: 'var(--text-muted)', opacity: 0.45 }} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {centerPanel === 'stock' && (
            <div className="dash-card rounded-2xl overflow-hidden flex flex-col">
              <div className="px-3 py-2 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-light)' }}>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" style={{ color: 'var(--color-danger)' }} />
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('pharmacy.stockAlerts')}</span>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger-text)' }}>{t('pharmacy.criticalBadge', { count: criticalCount + expiredCount })}</span>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'var(--color-warning-bg)', color: 'var(--color-warning-text)' }}>{lowStockCount} {t('pharmacy.kpiLowStock')}</span>
                </div>
                {canDispense && (
                  <button onClick={() => setShowReceiveStock(true)} className="text-[10px] font-bold flex items-center gap-1 px-2.5 py-1 rounded-lg text-white transition-all hover:opacity-90" style={{ background: 'var(--color-success)' }}>
                    <Plus className="w-3 h-3" /> {t('pharmacy.receiveStock')}
                  </button>
                )}
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                {stockAlerts.length === 0 ? (
                  <p className="text-center text-[11px] py-6" style={{ color: 'var(--text-muted)' }}>{t('pharmacy.allStockAdequate')}</p>
                ) : stockAlerts.map((item) => {
                  const isDanger = item.status === 'critical' || item.status === 'expired';
                  const pct = Math.min(100, Math.round((item.stockLevel / Math.max(1, item.reorderLevel)) * 100));
                  const statusLabel = item.status === 'expired' ? t('pharmacy.expired') : item.status === 'critical' ? t('pharmacy.stockStatus_critical') : t('pharmacy.stockStatus_low');
                  return (
                    <div key={item._id} className="p-2.5 rounded-lg transition-all" style={{
                      background: isDanger ? 'var(--color-danger-bg)' : 'var(--color-warning-bg)',
                      border: `1px solid ${isDanger ? 'var(--color-danger-border)' : 'var(--color-warning-border)'}`,
                    }}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{item.medicationName}</span>
                        <span className="text-[8px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ml-1" style={{
                          background: isDanger ? 'var(--color-danger-bg)' : 'var(--color-warning-bg)',
                          color: isDanger ? 'var(--color-danger-text)' : 'var(--color-warning-text)',
                        }}>{statusLabel}</span>
                      </div>
                      <div className="flex items-center justify-between text-[10px] mb-1.5" style={{ color: 'var(--text-muted)' }}>
                        <span>{item.stockLevel} / {item.reorderLevel} {item.unit}</span>
                        <span style={{ color: isDanger ? 'var(--color-danger-text)' : 'var(--color-warning-text)' }}>{pct}%</span>
                      </div>
                      <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--overlay-subtle)' }}>
                        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: isDanger ? 'var(--color-danger)' : 'var(--color-warning)' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {centerPanel === 'charts' && (
            <div className="dash-card rounded-2xl overflow-hidden flex flex-col">
              <div className="px-3 py-2 border-b flex items-center gap-2" style={{ borderColor: 'var(--border-light)' }}>
                <BarChart3 className="w-4 h-4" style={{ color: ACCENT }} />
                <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Dispensing &amp; Stock Analytics</span>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-4">

                {/* (b) Queue depth + average wait stat tiles */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-3 rounded-xl" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Pending dispensing queue</p>
                    <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{pendingQueueRx.length}</p>
                    <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Orders not yet dispensed, counseled or complete</p>
                  </div>
                  <div className="p-3 rounded-xl" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Average wait in queue</p>
                    <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{avgWaitMinutes == null ? '—' : formatMinutes(avgWaitMinutes)}</p>
                    <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      {avgWaitMinutes == null ? 'No orders currently waiting' : `Across ${pendingQueueRx.length} order${pendingQueueRx.length === 1 ? '' : 's'} still in queue, right now`}
                    </p>
                  </div>
                </div>

                {/* (a) Dispensed-per-day, top medications */}
                <div>
                  <span className="text-xs font-semibold block mb-1.5" style={{ color: 'var(--text-primary)' }}>Dispensed per day — top medications (last 14 days)</span>
                  {dispensedTrend.medNames.length === 0 ? (
                    <p className="text-[11px] py-4 text-center" style={{ color: 'var(--text-muted)' }}>No dispensed prescriptions recorded in the last 14 days.</p>
                  ) : (
                    <div style={{ width: '100%', height: 190 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={dispensedTrend.days} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                          <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} interval={1} />
                          <YAxis allowDecimals={false} tick={axisTick} axisLine={false} tickLine={false} width={26} />
                          <Tooltip {...tooltipStyle} />
                          <Legend wrapperStyle={{ fontSize: 10 }} />
                          {dispensedTrend.medNames.map((med, i) => (
                            <Bar
                              key={med}
                              dataKey={med}
                              name={med}
                              stackId="dispensed"
                              fill={DISPENSE_SERIES_COLORS[i % DISPENSE_SERIES_COLORS.length]}
                              radius={!dispensedTrend.hasOther && i === dispensedTrend.medNames.length - 1 ? [3, 3, 0, 0] : undefined}
                            />
                          ))}
                          {dispensedTrend.hasOther && (
                            <Bar dataKey="Other" name="Other" stackId="dispensed" fill={CHART_NEUTRAL} radius={[3, 3, 0, 0]} />
                          )}
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>

                {/* (c) Most at-risk stock, by estimated days remaining */}
                <div>
                  <span className="text-xs font-semibold block mb-1.5" style={{ color: 'var(--text-primary)' }}>Most at-risk stock — estimated days remaining</span>
                  <p className="text-[10px] mb-1.5" style={{ color: 'var(--text-muted)' }}>
                    Estimated from stock on hand ÷ units dispensed today. Items with no dispenses recorded today are excluded — there isn&apos;t a rate to estimate from.
                  </p>
                  {atRiskChartItems.length === 0 ? (
                    <p className="text-[11px] py-4 text-center" style={{ color: 'var(--text-muted)' }}>No items have recorded dispenses today to estimate a consumption rate.</p>
                  ) : (
                    <div style={{ width: '100%', height: Math.max(120, atRiskChartItems.length * 26) }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={atRiskChartItems.map(r => ({ name: r.item.medicationName, days: Math.round(r.daysRemaining * 10) / 10, rag: r.rag }))}
                          layout="vertical"
                          margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
                        >
                          <XAxis type="number" allowDecimals={false} tick={axisTick} axisLine={false} tickLine={false} />
                          <YAxis type="category" dataKey="name" width={150} tick={{ ...axisTick, fontSize: 10 }} axisLine={false} tickLine={false} />
                          <Tooltip {...tooltipStyle} formatter={(v: number | undefined) => {
                            const days = v ?? 0;
                            return [`${days} day${days === 1 ? '' : 's'}`, 'Est. remaining'];
                          }} />
                          <Bar dataKey="days" radius={[0, 3, 3, 0]}>
                            {atRiskChartItems.map((r, i) => (
                              <Cell key={i} fill={r.rag === 'red' ? CHART_RED : r.rag === 'amber' ? CHART_AMBER : CHART_GREEN} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>

                {/* (c) RAG table — every inventory item */}
                <div>
                  <span className="text-xs font-semibold block mb-1.5" style={{ color: 'var(--text-primary)' }}>Days of stock remaining, by medication</span>
                  <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-light)' }}>
                    <table className="w-full text-[11px]" style={{ borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: 'var(--overlay-subtle)' }}>
                          <th className="text-left px-2.5 py-1.5 font-semibold" style={{ color: 'var(--text-muted)' }}>Medication</th>
                          <th className="text-right px-2.5 py-1.5 font-semibold" style={{ color: 'var(--text-muted)' }}>Stock</th>
                          <th className="text-right px-2.5 py-1.5 font-semibold" style={{ color: 'var(--text-muted)' }}>Dispensed today</th>
                          <th className="text-right px-2.5 py-1.5 font-semibold" style={{ color: 'var(--text-muted)' }}>Est. days remaining</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stockRiskRows.map(({ item, daysRemaining, rag }) => (
                          <tr key={item._id} style={{ borderTop: '1px solid var(--border-light)' }}>
                            <td className="px-2.5 py-1.5" style={{ color: 'var(--text-primary)' }}>{item.medicationName}</td>
                            <td className="px-2.5 py-1.5 text-right" style={{ color: 'var(--text-muted)' }}>{item.stockLevel} {item.unit}</td>
                            <td className="px-2.5 py-1.5 text-right" style={{ color: 'var(--text-muted)' }}>{item.dispensedToday}</td>
                            <td className="px-2.5 py-1.5 text-right">
                              {daysRemaining == null ? (
                                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>No dispenses today</span>
                              ) : (
                                <span className="font-bold px-1.5 py-0.5 rounded" style={{
                                  background: rag === 'red' ? 'var(--color-danger-bg)' : rag === 'amber' ? 'var(--color-warning-bg)' : 'var(--color-success-bg)',
                                  color: rag === 'red' ? 'var(--color-danger-text)' : rag === 'amber' ? 'var(--color-warning-text)' : 'var(--color-success-text)',
                                }}>
                                  {Math.round(daysRemaining * 10) / 10}d
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}
        </EhrCareDashboard>
      </main>

      {/* Modals */}
      {dispenseTarget && (
        <DispenseModal
          rx={dispenseTarget.rx}
          inv={dispenseTarget.inv}
          qty={dispenseTarget.qty}
          interactions={getInteractionsForRx(dispenseTarget.rx)}
          users={users}
          currentUserId={currentUser?._id}
          witnessId={witnessId}
          onWitnessChange={setWitnessId}
          onConfirm={confirmDispense}
          onCancel={() => setDispenseTarget(null)}
          confirming={dispensing}
        />
      )}
      {showReceiveStock && (
        <ReceiveStockModal
          items={inventory.map(i => ({ name: i.medicationName, stock: i.stockLevel, unit: i.unit }))}
          onConfirm={handleReceiveStock}
          onClose={() => setShowReceiveStock(false)}
          saving={receivingStock}
        />
      )}
    </>
  );
}
