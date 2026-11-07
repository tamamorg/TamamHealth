'use client';

import { useState, useEffect, useCallback } from 'react';
import FormSlider from '@/components/overlay/FormSlider';
import EhrListHeader from '@/components/ehr/EhrListHeader';
import FacilityKpiBand, { weekOverWeek } from '@/components/dashboards/FacilityKpiBand';
import { Pill, Plus, UserCheck } from '@/components/icons/lucide';
import { useAuth } from '@/lib/context';
import { useToast } from '@/components/Toast';
import {
  getAllMovements,
  recordMovement,
  type RecordMovementInput,
} from '@/lib/services/controlled-substance-service';
import type { ControlledSubstanceLogDoc } from '@/lib/db-types';
import Badge, { type BadgeTone } from '@/components/Badge';
import EmptyState from '@/components/EmptyState';
import { formatDateTime } from '@/lib/format-utils';
import Select from '@/components/Select';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useTranslation } from '@/lib/i18n/useTranslation';
import NumberInput from '@/components/forms/NumberInput';
import { usePharmacyInventory } from '@/lib/hooks/usePharmacyInventory';
import { isControlledMedicine } from '@/lib/data/formulary';
import { matchControlledInventoryItem, registerInventoryId } from '@/components/pharmacy/controlled-register-helpers';

const SCHEDULES: ControlledSubstanceLogDoc['schedule'][] = ['I', 'II', 'III', 'IV', 'V'];
const MOVEMENTS: ControlledSubstanceLogDoc['movement'][] = ['intake', 'dispense', 'waste', 'reconciliation', 'transfer'];

/** Semantic Badge tone per movement type for the small status pill. */
const MOVEMENT_TONE: Record<ControlledSubstanceLogDoc['movement'], BadgeTone> = {
  intake: 'success',
  dispense: 'info',
  waste: 'danger',
  reconciliation: 'accent',
  transfer: 'warning',
  return: 'success',
};

/** Turn a free-typed witness name into a stable id so it differs from the operator. */
function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const blankForm = {
  medicationName: '',
  /** Real inventory item this movement is against, when the drug was matched to
   *  the facility's controlled stock — so the register reconciles against real
   *  balances instead of a synthetic per-name id (security audit 2026-11-05,
   *  §2.1 #7). Empty when the drug is typed free-hand (off-catalogue). */
  selectedInventoryId: '',
  schedule: 'II' as ControlledSubstanceLogDoc['schedule'],
  movement: 'dispense' as ControlledSubstanceLogDoc['movement'],
  quantity: '',
  unit: 'mg',
  beforeBalance: '',
  operatorName: '',
  witnessName: '',
  patientName: '',
  reason: '',
};

export default function ControlledSubstancesPage() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const scope = useDataScope();
  // The facility's controlled stock, so a register movement can tie to a real
  // inventory item (real balances) instead of a synthetic per-name id.
  const { items: inventory } = usePharmacyInventory();
  const controlledItems = inventory.filter(i => i.controlledSchedule || i.requiresWitness || isControlledMedicine(i.medicationName));

  const [movements, setMovements] = useState<ControlledSubstanceLogDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ ...blankForm });

  const load = useCallback(async () => {
    if (!scope) {
      setMovements([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const rows = await getAllMovements(scope);
      setMovements(rows);
    } catch (err) {
      console.error(err);
      showToast(t('msg.controlledSubstanceRegisterNotLoaded'), 'error');
    } finally {
      setLoading(false);
    }
  }, [scope, showToast, t]);

  useEffect(() => { void load(); }, [load]);

  const openModal = () => {
    setForm({ ...blankForm, operatorName: currentUser?.name || '' });
    setOpen(true);
  };

  const facilityId = currentUser?.hospitalId || currentUser?.hospital?._id || '';
  const facilityName = currentUser?.hospital?.name || currentUser?.hospitalName || '';

  const handleSubmit = async () => {
    if (!currentUser) {
      showToast(t('msg.yourSessionHasEndedSign'), 'error');
      return;
    }
    const operatorId = currentUser._id || '';
    const witnessId = slugify(form.witnessName);
    if (!form.medicationName.trim()) {
      showToast(t('msg.enterTheMedicationName'), 'error');
      return;
    }
    if (!form.witnessName.trim()) {
      showToast(t('msg.selectAWitnessControlledSubstance'), 'error');
      return;
    }
    if (operatorId && witnessId && operatorId === witnessId) {
      showToast(t('msg.selectADifferentWitnessThe'), 'error');
      return;
    }
    const quantity = Number(form.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      showToast(t('rxFlow.errQuantity'), 'error');
      return;
    }

    const input: RecordMovementInput = {
      inventoryId: registerInventoryId(form.selectedInventoryId, form.medicationName),
      medicationName: form.medicationName.trim(),
      schedule: form.schedule,
      movement: form.movement,
      quantity,
      unit: form.unit.trim() || 'unit',
      beforeBalance: Number(form.beforeBalance) || 0,
      operatorId,
      operatorName: form.operatorName.trim() || currentUser.name || '',
      witnessId,
      witnessName: form.witnessName.trim(),
      reason: form.reason.trim() || undefined,
      patientName: form.patientName.trim() || undefined,
      facilityId,
      facilityName,
      orgId: currentUser.orgId,
    };

    setSaving(true);
    try {
      await recordMovement(input);
      showToast(t('msg.ofRecorded', { value: t(`msg.movement.${form.movement}`), medicationName: input.medicationName }), 'success');
      setOpen(false);
      setForm({ ...blankForm });
      await load();
    } catch (err) {
      // recordMovement throws on missing/duplicate signatories and bad math.
      const message = err instanceof Error ? err.message : t('controlledSubstances.notRecorded');
      showToast(message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const countOf = (movement: ControlledSubstanceLogDoc['movement']) => movements.filter(m => m.movement === movement).length;
  const lastReconciled = movements
    .filter(m => m.movement === 'reconciliation')
    .map(m => m.createdAt)
    .sort()
    .pop();

  return (
    <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, overflow: 'hidden' }}>
        <FacilityKpiBand tiles={[
          { key: 'all', label: t('controlledSubstances.kpiMovements'), value: movements.length, detail: t('controlledSubstances.kpiMovementsDetail', { intake: countOf('intake'), transfer: countOf('transfer') }), trend: weekOverWeek(movements, m => m.createdAt, t('controlledSubstances.trendRecorded'), 'up', t) },
          { key: 'dispense', label: t('controlledSubstances.kpiDispensed'), value: countOf('dispense'), detail: t('controlledSubstances.kpiDispensedDetail') },
          { key: 'waste', label: t('controlledSubstances.kpiWaste'), value: countOf('waste'), detail: countOf('waste') ? t('controlledSubstances.kpiWasteDetail') : t('controlledSubstances.kpiNoWaste'), warn: countOf('waste') > 0 },
          { key: 'recon', label: t('controlledSubstances.kpiReconciliations'), value: countOf('reconciliation'), detail: lastReconciled ? t('controlledSubstances.kpiLastOn', { when: formatDateTime(lastReconciled) }) : t('controlledSubstances.kpiNoneYet') },
        ]} />
        <div className="dash-card flex flex-col" style={{ flex: 1, minHeight: 0 }}>
          <EhrListHeader
            title={t('ui.controlledSubstances')}
            count={movements.length}
            actions={
              <button data-tour="csub-record-movement" onClick={openModal} className="btn btn-primary">
                <Plus className="w-4 h-4" /> {t('ui.recordMovement')}
              </button>
            }
          />

          <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {loading ? (
            <div className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>{t('ui.loadingLog')}</div>
          ) : (
            <div className="ehr-list-scroll">
              <table className="data-table" style={{ minWidth: 960, tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: '20%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '7%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '13%' }} />
                  <col style={{ width: '10%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>{t('hospitals.colMedication')}</th>
                    <th>{t('boma.schedule')}</th>
                    <th>{t('ui.movement')}</th>
                    <th>{t('ui.qty')}</th>
                    <th>{t('ui.operator')}</th>
                    <th>{t('mar.witness')}</th>
                    <th>{t('appointments.labelReason')}</th>
                    <th>{t('billing.activityColumn.date')}</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ padding: 0 }}>
                        <EmptyState
                          icon={Pill}
                          title={t('ui.noMovementsRecordedYet')}
                          message={t('controlledSubstances.emptyHint')}
                        />
                      </td>
                    </tr>
                  ) : movements.map(m => (
                    <tr key={m._id}>
                      <td className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{m.medicationName}</td>
                      <td>
                        <Badge tone="neutral">{t('ui.sch')} {m.schedule}</Badge>
                      </td>
                      <td>
                        <Badge tone={MOVEMENT_TONE[m.movement]}>{t(`msg.movement.${m.movement}`)}</Badge>
                      </td>
                      <td className="text-sm" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{m.quantity} {m.unit}</td>
                      <td className="text-xs" style={{ color: 'var(--text-secondary)' }}>{m.operatorName}</td>
                      <td className="text-xs" style={{ color: 'var(--text-secondary)' }}>{m.witnessName}</td>
                      <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{m.reason || '—'}</td>
                      <td className="text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                        {formatDateTime(m.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          </div>
        </div>

        {open && (
          <FormSlider
            title={t('ui.recordControlledSubstanceMovement')}
            onClose={() => setOpen(false)}
            footer={<>
                <button onClick={() => setOpen(false)} className="btn btn-secondary" disabled={saving}>{t('action.cancel')}</button>
                {/* Correct a mis-typed draft before it is committed. The committed
                    log itself is append-only for regulatory compliance and is
                    never editable or deletable from here. */}
                <button
                  onClick={() => setForm({ ...blankForm, operatorName: currentUser?.name || '' })}
                  className="btn btn-secondary"
                  disabled={saving}
                >
                  {t('action.clear')}
                </button>
                <button onClick={handleSubmit} className="btn btn-primary" disabled={saving}>
                  {saving ? t('controlledSubstances.recording') : t('ui.recordMovement')}
                </button>
            </>}
          >
            <div className="space-y-4">
              <div className="space-y-3" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                <div>
                  <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hospitals.colMedication')}</label>
                  <input
                    type="text"
                    list="csub-med-list"
                    value={form.medicationName}
                    onChange={e => {
                      const name = e.target.value;
                      // Tie the movement to a real inventory item when the name
                      // matches the facility's controlled stock; carry its id,
                      // schedule and unit so balances reconcile. Otherwise keep
                      // it free-hand (off-catalogue) with no synthetic link.
                      const match = matchControlledInventoryItem(name, controlledItems);
                      setForm({
                        ...form,
                        medicationName: name,
                        selectedInventoryId: match?._id || '',
                        schedule: match?.controlledSchedule || form.schedule,
                        unit: match?.unit || form.unit,
                      });
                    }}
                    placeholder={t('ui.eGMorphineSulfate')}
                  />
                  <datalist id="csub-med-list">
                    {controlledItems.map(i => <option key={i._id} value={i.medicationName} />)}
                  </datalist>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('boma.schedule')}</label>
                    <Select value={form.schedule} onChange={e => setForm({ ...form, schedule: e.target.value as ControlledSubstanceLogDoc['schedule'] })}>
                      {SCHEDULES.map(s => <option key={s} value={s}>{t('boma.schedule')} {s}</option>)}
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('ui.movement')}</label>
                    <Select value={form.movement} onChange={e => setForm({ ...form, movement: e.target.value as ControlledSubstanceLogDoc['movement'] })}>
                      {MOVEMENTS.map(m => <option key={m} value={m}>{t(`msg.movement.${m}`)}</option>)}
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('pharmacy.quantity')}</label>
                    <NumberInput min={0} step="any" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} placeholder="0" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('lab.unit')}</label>
                    <input type="text" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder="mg" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('ui.beforeBalance')}</label>
                    <NumberInput min={0} step="any" value={form.beforeBalance} onChange={e => setForm({ ...form, beforeBalance: e.target.value })} placeholder="0" />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('feedback.patientOptional')}</label>
                  <input type="text" value={form.patientName} onChange={e => setForm({ ...form, patientName: e.target.value })} placeholder={t('ui.forDispenseMovements')} />
                </div>

                <hr className="section-divider" />

                <div className="rounded-lg p-3" style={{ background: 'var(--accent-light)', border: '1px solid var(--border-light)' }}>
                  <label className="text-xs font-semibold mb-2 flex items-center gap-1.5" style={{ color: 'var(--accent-primary)' }}>
                    <UserCheck className="w-3 h-3" /> {t('ui.twoSignatureAudit')}
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('ui.operator')}</label>
                      <input type="text" value={form.operatorName} onChange={e => setForm({ ...form, operatorName: e.target.value })} placeholder={t('ui.operatorName')} />
                    </div>
                    <div>
                      <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('mar.witness')}</label>
                      <input type="text" value={form.witnessName} onChange={e => setForm({ ...form, witnessName: e.target.value })} placeholder={t('rxFlow.witnessName')} />
                    </div>
                  </div>
                  <p className="text-[10px] mt-2" style={{ color: 'var(--text-muted)' }}>
                    {t('ui.theOperatorYouAndThe')}
                  </p>
                </div>

                <div>
                  <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('screenings.declineReason')}</label>
                  <textarea rows={2} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder={t('ui.reasonNotesForThisMovement')} />
                </div>
              </div>
            </div>
          </FormSlider>
        )}
    </main>
  );
}
