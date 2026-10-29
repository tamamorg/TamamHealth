'use client';

/**
 * Nutrition supplies — RUTF, therapeutic milks, MUAC tapes and the rest.
 *
 * This was a panel toggled into the centre of the old nutrition station.
 * The station became the shared clinical workspace (NutritionHomeView), whose
 * centre is the worklist, so stock keeping has a page of its own; the
 * workspace's "Supplies" header action and its Supply alerts entries land
 * here. Same synced `nutrition_supply` store and +/- adjustments as before.
 */

import { useMemo, useState } from 'react';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useNutritionSupplies } from '@/lib/hooks/useNutritionSupplies';
import { classifySupplyStatus } from '@/lib/services/nutrition-supply-service';
import { describeError } from '@/lib/user-facing-error';
import { useToast } from '@/components/Toast';
import FormSlider from '@/components/overlay/FormSlider';
import FormField from '@/components/overlay/FormField';
import { AlertTriangle, CheckCircle2, Plus, TrendingDown } from '@/components/icons/lucide';

// Starter items persisted once as real docs when the store is empty in demo
// mode (useNutritionSupplies → seedSuppliesIfEmpty). Production never sees it.
const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
const DEMO_SUPPLY_SEED = [
  { name: 'RUTF (Plumpy\'Nut)', unit: 'sachets', currentLevel: 120, reorderLevel: 50 },
  { name: 'F-75 Therapeutic Milk', unit: 'tins', currentLevel: 8, reorderLevel: 15 },
  { name: 'F-100 Therapeutic Milk', unit: 'tins', currentLevel: 22, reorderLevel: 10 },
  { name: 'ReSoMal (ORS)', unit: 'packets', currentLevel: 3, reorderLevel: 10 },
  { name: 'Vitamin A Capsules', unit: 'capsules', currentLevel: 200, reorderLevel: 50 },
  { name: 'Iron/Folate Tabs', unit: 'tabs', currentLevel: 150, reorderLevel: 30 },
  { name: 'MUAC Tapes', unit: 'tapes', currentLevel: 5, reorderLevel: 10 },
  { name: 'Weighing Scale', unit: 'units', currentLevel: 2, reorderLevel: 1 },
];

const EMPTY_FORM = { name: '', unit: '', currentLevel: '', reorderLevel: '' };

export default function NutritionSuppliesPage() {
  const { currentUser } = useAuth();
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { items, create, adjust } = useNutritionSupplies({ demoSeed: IS_DEMO ? DEMO_SUPPLY_SEED : undefined });
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const rows = useMemo(
    () => items
      .map(item => ({ item, status: classifySupplyStatus(item) }))
      .sort((a, b) => ({ critical: 0, low: 1, ok: 2 }[a.status] - { critical: 0, low: 1, ok: 2 }[b.status])
        || a.item.name.localeCompare(b.item.name)),
    [items],
  );

  const change = (id: string, delta: number) => {
    adjust(id, delta, { id: currentUser?._id, name: currentUser?.name })
      .catch(err => showToast(describeError(err, t('msg.supplyItemNotSavedTry')), 'error'));
  };

  const save = async () => {
    const currentLevel = parseFloat(form.currentLevel);
    const reorderLevel = parseFloat(form.reorderLevel);
    if (!form.name.trim() || !form.unit.trim()) { showToast(t('nutrition.supplyFormErrorRequired'), 'error'); return; }
    if (!Number.isFinite(currentLevel) || currentLevel < 0) { showToast(t('nutrition.supplyFormErrorLevel'), 'error'); return; }
    setSaving(true);
    try {
      await create({
        name: form.name.trim(),
        unit: form.unit.trim(),
        currentLevel,
        reorderLevel: Number.isFinite(reorderLevel) ? Math.max(0, reorderLevel) : 0,
        hospitalId: currentUser?.hospitalId,
        orgId: currentUser?.orgId,
        createdBy: currentUser?._id,
      });
      setForm(EMPTY_FORM);
      setAdding(false);
    } catch (err) {
      showToast(describeError(err, t('msg.supplyItemNotSavedTry')), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="page-container page-enter nsup-page">
      <header className="nsup-head">
        <h1>{t('nutrition.supplies')}</h1>
        <button type="button" className="btn btn-primary inline-flex items-center gap-2" onClick={() => setAdding(true)}>
          <Plus className="w-4 h-4" /> {t('nutrition.addSupplyItem')}
        </button>
      </header>

      <section className="dash-card nsup-card">
        <table className="nsup-table">
          <thead>
            <tr>
              <th scope="col">{t('nutrition.supplyFormName')}</th>
              <th scope="col">{t('nutrition.supplyFormCurrentLevel')}</th>
              <th scope="col">{t('nutrition.supplyFormReorderLevel')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={3} className="nsup-empty">{t('nutrition.noSupplies')}</td></tr>
            )}
            {rows.map(({ item, status }) => (
              <tr key={item._id} data-status={status}>
                <td>
                  <span className="nsup-name">
                    {status === 'critical' ? <AlertTriangle className="w-4 h-4" />
                      : status === 'low' ? <TrendingDown className="w-4 h-4" />
                      : <CheckCircle2 className="w-4 h-4" />}
                    {item.name}
                  </span>
                </td>
                <td>
                  <span className="nsup-stepper">
                    <button type="button" onClick={() => change(item._id, -1)} aria-label={t('nutritionHome.decrease', { name: item.name })}>−</button>
                    <b>{item.currentLevel} {item.unit}</b>
                    <button type="button" onClick={() => change(item._id, 1)} aria-label={t('nutritionHome.increase', { name: item.name })}>+</button>
                  </span>
                </td>
                <td>{item.reorderLevel} {item.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {adding && (
        <FormSlider
          title={t('nutrition.addSupplyItem')}
          onClose={() => { setAdding(false); setForm(EMPTY_FORM); }}
          busy={saving}
          footer={<>
            <button type="button" className="btn btn-secondary" onClick={() => { setAdding(false); setForm(EMPTY_FORM); }} disabled={saving}>
              {t('nutrition.formCancel')}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving}>
              {t('nutrition.supplyFormSave')}
            </button>
          </>}
        >
          <div className="space-y-4">
            <FormField id="nsup-name" label={t('nutrition.supplyFormName')}>
              {control => <input {...control} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} data-modal-initial-focus />}
            </FormField>
            <FormField id="nsup-unit" label={t('nutrition.supplyFormUnit')}>
              {control => <input {...control} value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} />}
            </FormField>
            <FormField id="nsup-level" label={t('nutrition.supplyFormCurrentLevel')}>
              {control => <input {...control} type="number" min="0" step="1" value={form.currentLevel} onChange={e => setForm(f => ({ ...f, currentLevel: e.target.value }))} />}
            </FormField>
            <FormField id="nsup-reorder" label={t('nutrition.supplyFormReorderLevel')}>
              {control => <input {...control} type="number" min="0" step="1" value={form.reorderLevel} onChange={e => setForm(f => ({ ...f, reorderLevel: e.target.value }))} />}
            </FormField>
          </div>
        </FormSlider>
      )}
    </main>
  );
}
