'use client';

/**
 * The order basket workspace, on OpenMRS O3's model. Drug and test orders are
 * built here — search, then straight into the basket or through the order
 * form — and sit unsigned until "Sign and close" writes them all: the
 * prescriptions to the pharmacy queue, the tests to the bench. Until then
 * nothing has been ordered; the unsigned orders survive closing the panel
 * (useOrderBasket keeps them encrypted on this device).
 *
 * Under the unsigned orders each group still lists what is already active
 * for the patient, so a clinician does not order twice.
 */

import { useCallback, useEffect, useMemo, useState, type MutableRefObject } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useDrawerBack } from '../drawer-back';
import { formatRxSig } from '@/lib/format-utils';
import { AlertTriangle, ChevronDown, FlaskConical, Pencil, Pill, Plus, Trash2 } from '@/components/icons/lucide';
import { usePrescriptions } from '@/lib/hooks/usePrescriptions';
import { useLabResults } from '@/lib/hooks/useLabResults';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useFacilityName } from '@/lib/hooks/useFacilityName';
import { useSettings } from '@/lib/settings/SettingsProvider';
import { useConfirmPrompt } from '@/components/ConfirmDialog';
import RowActionsMenu from '@/components/RowActionsMenu';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { isOpenLabOrder } from '@/lib/services/lab-service';
import { canCancelLabOrder, useCancelLabOrder } from '@/components/lab/useCancelLabOrder';
import { useToast } from '@/components/Toast';
import { FORMULARY, hasUsLabel, offFormularyDrug } from '@/lib/data/formulary';
import { catalogFor, searchCatalog, toOrderedTest } from '@/components/lab/order/lab-order-catalog';
import { stockPositionFor } from '@/lib/pharmacy-stock-position';
import type { PatientDoc, PharmacyInventoryDoc, PrescriptionDoc } from '@/lib/db-types';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { describeError } from '@/lib/user-facing-error';
import type { ChartPanelUser } from './types';
import {
  doseText, draftFromPrescription, drugOrderGaps, durationText, frequencyText, newDrugOrder, newTestOrder,
  type BasketContext, type BasketRequest, type DrugOrderDraft, type TestOrderDraft,
} from './order-basket/basket-types';
import { useOrderBasket } from './order-basket/useOrderBasket';
import { signOrders } from './order-basket/sign-orders';
import { markNoteOrdersSigned } from './order-basket/note-orders-signal';
import OrderSearchView from './order-basket/OrderSearchView';
import DrugOrderForm from './order-basket/DrugOrderForm';
import TestOrderForm from './order-basket/TestOrderForm';
import { AllergyLine } from './order-basket/PatientBanner';
import './order-basket/order-basket.css';

/**
 * The Drug orders and Lab orders groups start closed and keep whatever the
 * clinician last left them as, on this device: open stays open, closed stays
 * closed, across patients and visits.
 */
type BasketGroup = 'drug' | 'lab';
const GROUP_KEY = 'tamam.orderBasket.open';
function readGroupOpen(): Record<BasketGroup, boolean> {
  const closed = { drug: false, lab: false };
  if (typeof window === 'undefined') return closed;
  try {
    const saved = JSON.parse(window.localStorage.getItem(GROUP_KEY) || '{}') as Partial<Record<BasketGroup, unknown>>;
    return { drug: saved.drug === true, lab: saved.lab === true };
  } catch {
    return closed;
  }
}

type View =
  | { name: 'basket' }
  | { name: 'drug-search' }
  | { name: 'drug-form'; order: DrugOrderDraft }
  | { name: 'lab-search' }
  | { name: 'lab-form'; order: TestOrderDraft };

interface OrderBasketPanelProps {
  patient: PatientDoc;
  currentUser: ChartPanelUser | null | undefined;
  canPrescribe: boolean;
  canOrderLabs: boolean;
  /** One-shot: which screen to open on. Acknowledged via onRequestHandled. */
  request?: BasketRequest | null;
  onRequestHandled?: () => void;
  /** The note the basket was last opened from, stamped on orders added now. */
  context?: BasketContext;
  /** The drawer's title follows the screen ("Add drug order"); null = the panel's own. */
  onTitleChange: (title: string | null) => void;
  /** True while an order form holds edits, so closing the drawer can ask first. */
  formEditedRef?: MutableRefObject<boolean>;
  onClose: () => void;
}

export default function OrderBasketPanel({
  patient, currentUser, canPrescribe, canOrderLabs, request, onRequestHandled, context, onTitleChange, formEditedRef, onClose,
}: OrderBasketPanelProps) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const confirmPrompt = useConfirmPrompt();
  const scope = useDataScope();
  const { labCatalog, clinicalPolicy } = useSettings();
  const facilityName = useFacilityName() || t('basket.thisFacility');
  const basket = useOrderBasket(patient._id);
  const [view, setView] = useState<View>({ name: 'basket' });
  const [query, setQuery] = useState('');
  const [groupOpen, setGroupOpenState] = useState(readGroupOpen);
  const setGroupOpen = useCallback((group: BasketGroup, open: boolean) => {
    setGroupOpenState(prev => {
      const next = { ...prev, [group]: open };
      try { window.localStorage.setItem(GROUP_KEY, JSON.stringify(next)); } catch { /* private mode: this visit only */ }
      return next;
    });
  }, []);
  const drugsOpen = groupOpen.drug;
  const labsOpen = groupOpen.lab;
  const [signing, setSigning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname() || `/patients/${patient._id}`;

  // Scoped to this patient at the query, not filtered down from the whole
  // facility's orders.
  const { prescriptions } = usePrescriptions(patient._id);
  const { results } = useLabResults(patient._id);
  const { canEnterLabResults } = usePermissions();
  const cancelLabOrder = useCancelLabOrder();
  const activeDrugOrders = (prescriptions || []).filter(rx => rx.patientId === patient._id && rx.status === 'pending');
  const activeLabOrders = (results || []).filter(l => l.patientId === patient._id && isOpenLabOrder(l));
  const activeMedications = useMemo(
    () => (prescriptions || []).filter(rx => rx.status !== 'discontinued').map(rx => rx.medication),
    [prescriptions],
  );
  // Two pending orders for the same medicine are usually repeat therapy.
  const medKey = (name?: string) => (name || '').trim().toLowerCase();
  const medCounts = new Map<string, number>();
  for (const rx of activeDrugOrders) medCounts.set(medKey(rx.medication), (medCounts.get(medKey(rx.medication)) || 0) + 1);

  // The facility shelf, for the stock line under the quantity. A prescriber
  // with no facility of their own has no shelf (their scope spans several).
  const [inventory, setInventory] = useState<PharmacyInventoryDoc[]>([]);
  useEffect(() => {
    if (!scope || !currentUser?.hospitalId || !clinicalPolicy.onSitePharmacy) return;
    let cancelled = false;
    void (async () => {
      try {
        const { getAllInventory } = await import('@/lib/services/pharmacy-inventory-service');
        const items = await getAllInventory(scope);
        if (!cancelled) setInventory(items);
      } catch { /* the stock line says "not tracked" */ }
    })();
    return () => { cancelled = true; };
  }, [scope, currentUser?.hospitalId, clinicalPolicy.onSitePharmacy]);
  const stockFor = useCallback((medication: string, quantity: number) => (
    clinicalPolicy.onSitePharmacy
      ? stockPositionFor(medication, inventory, quantity, { facilityId: currentUser?.hospitalId })
      : null
  ), [inventory, clinicalPolicy.onSitePharmacy, currentUser?.hospitalId]);

  // A request from a header button or the note editor opens its screen —
  // applied while rendering (React's "adjust state on a prop change"), then
  // acknowledged so a later remount does not apply it again.
  const [appliedRequest, setAppliedRequest] = useState<BasketRequest | null>(null);
  if (request && request !== appliedRequest) {
    setAppliedRequest(request);
    setQuery('');
    setView(request.view === 'drug' ? { name: 'drug-search' } : request.view === 'lab' ? { name: 'lab-search' } : { name: 'basket' });
  }
  useEffect(() => {
    if (request) onRequestHandled?.();
  }, [request, onRequestHandled]);

  useEffect(() => {
    onTitleChange(view.name.startsWith('drug') ? t('basket.addDrugOrder') : view.name.startsWith('lab') ? t('basket.addTestOrder') : null);
  }, [view.name, onTitleChange, t]);
  useEffect(() => () => onTitleChange(null), [onTitleChange]);

  const markEdited = useCallback((edited: boolean) => {
    if (formEditedRef) formEditedRef.current = edited;
  }, [formEditedRef]);
  useEffect(() => () => markEdited(false), [markEdited]);
  const toBasket = () => { markEdited(false); setQuery(''); setView({ name: 'basket' }); };
  // An order just added shows where it landed: its group opens (and stays
  // open, like any other opening).
  const putOrder = (order: DrugOrderDraft | TestOrderDraft) => {
    basket.put(order);
    setGroupOpen(order.kind === 'drug' ? 'drug' : 'lab', true);
  };
  // The drawer's → goes back to the basket from a search or an order form.
  useDrawerBack(view.name !== 'basket', toBasket);
  const stamp = <T extends DrugOrderDraft | TestOrderDraft>(order: T): T => (
    order.context || !context ? order : { ...order, context }
  );

  const drugOrders = basket.orders.filter((o): o is DrugOrderDraft => o.kind === 'drug');
  const testOrders = basket.orders.filter((o): o is TestOrderDraft => o.kind === 'test');
  const incomplete = drugOrders.filter(o => drugOrderGaps(o).length > 0);

  const drugMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return FORMULARY.filter(d => `${d.name} ${d.category} ${d.atc}`.toLowerCase().includes(q)).slice(0, 50);
  }, [query]);
  // A medicine the list does not carry can still be ordered, with a reason.
  // Only when nothing matches, so it never sits beside the checked listing.
  const typedOffList = query.trim().length >= 3 && drugMatches.length === 0 ? query.trim() : '';
  const testCatalog = useMemo(() => catalogFor(labCatalog, 'labs'), [labCatalog]);
  const testMatches = useMemo(() => searchCatalog(testCatalog, query), [testCatalog, query]);

  const sign = async () => {
    if (!scope) { showToast(t('basket.noScope'), 'error'); return; }
    setSigning(true);
    try {
      const outcome = await signOrders({
        orders: basket.orders,
        patient,
        currentUser,
        scope,
        onSitePharmacy: clinicalPolicy.onSitePharmacy,
        confirmPrompt,
        t,
        onSigned: ids => ids.forEach(id => basket.remove(id)),
      });
      const signedSet = new Set(outcome.signed);
      const signedOrders = basket.orders.filter(o => signedSet.has(o.id));
      basket.replaceAll(basket.orders.filter(o => !signedSet.has(o.id)));

      // A note that raised orders says so in its Plan, and brings its
      // medication list up to date when it is back on top.
      const notes = new Map<string, Set<'medication' | 'lab'>>();
      for (const o of signedOrders) {
        const noteId = o.context?.noteId;
        if (!noteId) continue;
        notes.set(noteId, (notes.get(noteId) || new Set()).add(o.kind === 'drug' ? 'medication' : 'lab'));
      }
      for (const [noteId, kinds] of notes) {
        markNoteOrdersSigned(noteId);
        try {
          const { recordPlanAction } = await import('@/lib/clinical-notes/note-service');
          for (const kind of kinds) {
            await recordPlanAction(noteId, {
              kind,
              label: kind === 'medication' ? t('basket.planMedication') : t('basket.planLab'),
              createdBy: currentUser?._id,
            });
          }
        } catch { /* the orders are placed; a signed note cannot take the line */ }
      }

      // Corner: the panel closes below, and a warning raised in a form lands
      // inside it, so a dose or interaction warning would vanish with the form.
      for (const line of outcome.warnings) showToast(line, 'warning', { placement: 'corner' });
      const failed = outcome.kept.filter(k => k.reason === 'failed');
      if (failed.length) {
        showToast(t('basket.signPartlyFailed', { count: failed.length }), 'error');
      } else if (outcome.signed.length) {
        showToast(t('basket.signed', { count: outcome.signed.length }), 'success');
      }
      if (outcome.kept.length === 0) onClose();
    } catch (err) {
      showToast(describeError(err, t('basket.signFailed')), 'error');
    } finally {
      setSigning(false);
    }
  };

  // ── Signed orders: what can still be done to them ──
  // The chart tab that holds the order, with the row picked out.
  const openOrder = (tab: 'prescriptions' | 'labs', id: string) => {
    router.push(`${pathname}?${new URLSearchParams({ tab, focus: id }).toString()}`);
  };
  // Modify, O3's way: the signed order comes into the basket as a draft; the
  // change is only made when it is signed, and signing stops the old order.
  const modifyOrder = (rx: PrescriptionDoc) => {
    const existing = drugOrders.find(o => o.replaces?.id === rx._id);
    const prnPrefix = t('basket.prnReasonLine', { reason: '' }).trim();
    setView({ name: 'drug-form', order: existing ?? stamp(draftFromPrescription(rx, prnPrefix)) });
  };
  // The same write the Medications and Orders tabs make, reason required.
  const discontinueOrder = async (rx: PrescriptionDoc) => {
    const reason = await confirmPrompt({
      title: t('chart.medicationDiscontinueTitle', { medication: rx.medication }),
      inputLabel: t('chart.medicationDiscontinueReason'),
      inputRequired: true,
      confirmLabel: t('chart.medicationDiscontinue'),
      tone: 'danger',
    });
    if (!reason?.trim()) return;
    setBusyId(rx._id);
    try {
      const { discontinuePrescription } = await import('@/lib/services/prescription-service');
      const stopped = await discontinuePrescription(
        rx._id,
        { id: currentUser?._id, name: currentUser?.name || currentUser?.username },
        reason.trim(),
      );
      if (!stopped) throw new Error('Change not saved. Try again.');
      // A pending change to the stopped order has nothing left to change.
      for (const o of drugOrders) if (o.replaces?.id === rx._id) basket.remove(o.id);
      showToast(t('msg.discontinued', { medication: rx.medication }), 'success');
    } catch (err) {
      showToast(describeError(err, t('msg.medicationNotDiscontinuedTryAgain')), 'error');
    } finally {
      setBusyId(null);
    }
  };

  // ── Screens ──
  if (view.name === 'drug-search') {
    return (
      <div className="tamam-drawer-workspace obk-root">
        <OrderSearchView
          items={[...drugMatches.map(d => ({
            key: d.name,
            title: d.name,
            detail: [d.form, hasUsLabel(d.name) ? '' : t('rxLabel.tag'), d.note].filter(Boolean).join(' · '),
            inBasket: drugOrders.some(o => o.drug.name === d.name),
          })), ...(typedOffList ? [{
            key: typedOffList,
            title: t('prescribe.offListUse', { name: typedOffList }),
            detail: t('prescribe.offListDetail'),
            inBasket: drugOrders.some(o => o.drug.name === typedOffList),
          }] : [])]}
          query={query}
          onQuery={setQuery}
          placeholder={t('basket.searchDrugs')}
          onBack={toBasket}
          header={<AllergyLine patient={patient} />}
          onAdd={key => {
            putOrder(stamp(newDrugOrder(FORMULARY.find(d => d.name === key) ?? offFormularyDrug(key))));
            toBasket();
          }}
          onForm={key => {
            setView({ name: 'drug-form', order: stamp(newDrugOrder(FORMULARY.find(d => d.name === key) ?? offFormularyDrug(key))) });
          }}
        />
      </div>
    );
  }
  if (view.name === 'drug-form') {
    return (
      <div className="tamam-drawer-workspace obk-root">
        <DrugOrderForm
          key={view.order.id}
          initial={view.order}
          patient={patient}
          activeMedications={activeMedications}
          stockFor={stockFor}
          facilityName={facilityName}
          onSave={order => { putOrder(order); toBasket(); }}
          onDiscard={toBasket}
          onEdited={markEdited}
        />
      </div>
    );
  }
  if (view.name === 'lab-search') {
    return (
      <div className="tamam-drawer-workspace obk-root">
        <OrderSearchView
          items={testMatches.map(test => ({
            key: test.name,
            title: test.name,
            detail: test.specimen,
            inBasket: testOrders.some(o => o.test.name === test.name),
          }))}
          query={query}
          onQuery={setQuery}
          placeholder={t('basket.searchTests')}
          onBack={toBasket}
          showAllWhenEmpty
          minQuery={1}
          onAdd={key => {
            const test = testCatalog.find(x => x.name === key);
            if (test) putOrder(stamp(newTestOrder(toOrderedTest(test))));
            toBasket();
          }}
          onForm={key => {
            const test = testCatalog.find(x => x.name === key);
            if (test) setView({ name: 'lab-form', order: stamp(newTestOrder(toOrderedTest(test))) });
          }}
        />
      </div>
    );
  }
  if (view.name === 'lab-form') {
    return (
      <div className="tamam-drawer-workspace obk-root">
        <TestOrderForm
          key={view.order.id}
          initial={view.order}
          onSave={order => { putOrder(order); toBasket(); }}
          onDiscard={toBasket}
          onEdited={markEdited}
          onBack={toBasket}
        />
      </div>
    );
  }

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
      {open && <div className="obk-items tm-motion tm-reveal">{body}</div>}
    </section>
  );

  const draftRow = (id: string, line: React.ReactNode, tags: React.ReactNode, onEdit: () => void) => (
    <div className="obk-item obk-item--draft" key={id}>
      <span className="obk-tags">{tags}</span>
      <div className="obk-draft-line">
        <p className="obk-line">{line}</p>
        <span className="obk-draft-actions">
          <button type="button" className="obk-icon-btn" onClick={onEdit} aria-label={t('basket.editOrder')}><Pencil aria-hidden /></button>
          <button type="button" className="obk-icon-btn" onClick={() => basket.remove(id)} aria-label={t('basket.removeOrder')}><Trash2 aria-hidden /></button>
        </span>
      </div>
    </div>
  );

  return (
    <div className="tamam-drawer-workspace obk-root">
      <div className="obk-body">
        {group('drug', t('basket.drugOrders', { count: drugOrders.length + activeDrugOrders.length }), drugsOpen, () => setGroupOpen('drug', !drugsOpen), canPrescribe, () => { setQuery(''); setView({ name: 'drug-search' }); }, (
          <>
            {drugOrders.map(o => {
              const gaps = drugOrderGaps(o).length > 0;
              const sig = formatRxSig({ dose: o.freeText ? '' : doseText(o), route: o.freeText ? '' : o.route, frequency: frequencyText(o), duration: durationText(o) });
              return draftRow(
                o.id,
                <><strong>{o.drug.name}</strong>{sig ? ` — ${sig}` : ''}</>,
                <>
                  <span className="obk-tag obk-tag--new">{o.replaces ? t('basket.modify') : t('basket.new')}</span>
                  {gaps && <span className="obk-tag obk-tag--warn">{t('basket.incomplete')}</span>}
                </>,
                () => setView({ name: 'drug-form', order: o }),
              );
            })}
            {activeDrugOrders.length > 0 && drugOrders.length > 0 && <p className="obk-subhead">{t('basket.alreadyOrdered')}</p>}
            {drugOrders.length === 0 && activeDrugOrders.length === 0 && <p className="obk-empty">{t('basket.noDrugOrders')}</p>}
            {activeDrugOrders.map(rx => {
              const warned = !!(rx.medicationSafety?.allergyWarnings.length
                || rx.medicationSafety?.interactionWarnings.length
                || rx.medicationSafety?.duplicateWarnings.length);
              const changing = drugOrders.some(o => o.replaces?.id === rx._id);
              return (
                <div className="obk-item obk-item--signed" key={rx._id}>
                  <span className="obk-tags">
                    <span className={warned ? 'obk-tag obk-tag--danger' : 'obk-tag'}>{warned ? t('basket.review') : rx.status}</span>
                    {(medCounts.get(medKey(rx.medication)) || 0) > 1 && (
                      <span className="obk-tag obk-tag--warn" title={t('chart.duplicateOrderHint')}>{t('chart.duplicateOrder')}</span>
                    )}
                    {changing && <span className="obk-tag obk-tag--new">{t('basket.changeInBasket')}</span>}
                  </span>
                  <div className="obk-draft-line">
                    <p className="obk-line"><strong>{rx.medication}</strong> — {formatRxSig(rx)}</p>
                    <span className="obk-draft-actions">
                      <RowActionsMenu
                        ariaLabel={t('chart.orderRowActions', { name: rx.medication })}
                        actions={[
                          { key: 'open', label: t('chart.orderOpenPrescription'), onClick: () => openOrder('prescriptions', rx._id) },
                          ...(canPrescribe ? [
                            { key: 'modify', label: changing ? t('basket.editChange') : t('basket.modifyOrder'), disabled: busyId === rx._id, onClick: () => modifyOrder(rx) },
                            { key: 'stop', label: t('chart.medicationDiscontinue'), tone: 'danger' as const, disabled: busyId === rx._id, onClick: () => void discontinueOrder(rx) },
                          ] : []),
                        ]}
                      />
                    </span>
                  </div>
                  {warned && <p className="obk-warn"><AlertTriangle aria-hidden /> {t('basket.safetyWarning')}</p>}
                </div>
              );
            })}
          </>
        ))}
        {group('lab', t('basket.labOrders', { count: testOrders.length + activeLabOrders.length }), labsOpen, () => setGroupOpen('lab', !labsOpen), canOrderLabs, () => { setQuery(''); setView({ name: 'lab-search' }); }, (
          <>
            {testOrders.map(o => draftRow(
              o.id,
              <><strong>{o.test.name}</strong>{o.test.specimen ? ` — ${o.test.specimen}` : ''}</>,
              <>
                <span className="obk-tag obk-tag--new">{t('basket.new')}</span>
                {o.priority !== 'routine' && <span className="obk-tag obk-tag--warn">{t(`basket.priorityName.${o.priority}`)}</span>}
              </>,
              () => setView({ name: 'lab-form', order: o }),
            ))}
            {activeLabOrders.length > 0 && testOrders.length > 0 && <p className="obk-subhead">{t('basket.alreadyOrdered')}</p>}
            {testOrders.length === 0 && activeLabOrders.length === 0 && <p className="obk-empty">{t('basket.noLabOrders')}</p>}
            {activeLabOrders.map(l => (
              <div className="obk-item obk-item--signed" key={l._id}>
                <span className="obk-tag">{l.status.replace('_', ' ')}</span>
                <div className="obk-draft-line">
                  <p className="obk-line"><strong>{l.testName}</strong> — {l.specimen}{l.tier ? ` · ${l.tier}` : ''}</p>
                  <span className="obk-draft-actions">
                    {/* A sent test can be withdrawn only until the specimen is
                        collected; after that the bench rejects it. */}
                    <RowActionsMenu
                      ariaLabel={t('chart.orderRowActions', { name: l.testName })}
                      actions={[
                        { key: 'open', label: t('chart.orderOpenResult'), onClick: () => openOrder('labs', l._id) },
                        ...(canCancelLabOrder(l) && (canOrderLabs || canEnterLabResults)
                          ? [{ key: 'cancel-order', label: t('lab.cancelOrder'), tone: 'danger' as const, onClick: () => void cancelLabOrder(l) }]
                          : []),
                      ]}
                    />
                  </span>
                </div>
              </div>
            ))}
          </>
        ))}
        {incomplete.length > 0 && (
          <p className="obk-warn obk-warn--block"><AlertTriangle aria-hidden /> {t('basket.incompleteHint', { count: incomplete.length })}</p>
        )}
      </div>
      {/* "Sign and close", as O3 labels it. This is the write: every unsigned
          order above goes to the pharmacy or the bench now. Cancel closes the
          panel and keeps the unsigned orders for later. A failed signing
          is reported just above it, not in the corner. */}
      <div className="obk-footer">
        <button type="button" className="obk-footer-btn obk-footer-btn--secondary" onClick={onClose} disabled={signing}>{t('common.cancel')}</button>
        <button
          type="button"
          className="obk-footer-btn obk-footer-btn--primary"
          onClick={() => void sign()}
          disabled={signing || !basket.loaded || basket.orders.length === 0 || incomplete.length > 0}
        >
          {signing ? t('basket.signing') : t('chart.signAndClose')}
        </button>
      </div>
    </div>
  );
}
