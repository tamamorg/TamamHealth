'use client';
import { defaultCurrency } from '@/lib/country/country-pack';
import DepartmentSelect from '@/components/DepartmentSelect';

import { useState, useMemo } from 'react';
import FormSlider from '@/components/overlay/FormSlider';
import { Plus, CheckCircle2, Settings as Wrench, Edit3, Trash2, XCircle } from '@/components/icons/lucide';
import RowActionsMenu from '@/components/RowActionsMenu';
import type { RowAction } from '@/components/RowActionsMenu';
import { useAuth, useUi } from '@/lib/context';
import { useAssets } from '@/lib/hooks/useAssets';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { AssetDoc, AssetCategory, AssetStatus } from '@/lib/db-types-asset';
import EhrListHeader from '@/components/ehr/EhrListHeader';
import FacilityKpiBand from '@/components/dashboards/FacilityKpiBand';
import { SadbChip, type ChipTone } from '@/components/admin/sadb-ui';
import Select from '@/components/Select';
import { useNow } from '@/lib/hooks/useNow';
import NumberInput from '@/components/forms/NumberInput';
import { useConfirm } from '@/components/ConfirmDialog';
import { describeError } from '@/lib/user-facing-error';

const CATEGORIES: { id: AssetCategory; labelKey: string }[] = [
  { id: 'medical_equipment', labelKey: 'equipment.categoryMedicalEquipment' },
  { id: 'imaging', labelKey: 'equipment.categoryImaging' },
  { id: 'lab', labelKey: 'equipment.categoryLab' },
  { id: 'surgical', labelKey: 'equipment.categorySurgical' },
  { id: 'vehicle', labelKey: 'equipment.categoryVehicle' },
  { id: 'it', labelKey: 'equipment.categoryIt' },
  { id: 'furniture', labelKey: 'equipment.categoryFurniture' },
  { id: 'utility', labelKey: 'equipment.categoryUtility' },
  { id: 'cold_chain', labelKey: 'equipment.categoryColdChain' },
  { id: 'other', labelKey: 'equipment.categoryOther' },
];

const STATUS_TOKENS: Record<AssetStatus, { labelKey: string; tone: ChipTone }> = {
  operational:    { labelKey: 'equipment.statusOperational',     tone: 'green' },
  needs_service:  { labelKey: 'equipment.statusNeedsService',    tone: 'yellow' },
  under_repair:   { labelKey: 'equipment.statusUnderRepair',     tone: 'blue' },
  decommissioned: { labelKey: 'equipment.statusDecommissioned',  tone: 'neutral' },
  lost_or_stolen: { labelKey: 'equipment.statusLostOrStolen',    tone: 'red' },
};

export default function AssetsPage() {
  const { currentUser } = useAuth();
  const { globalSearch, setGlobalSearch } = useUi();
  const { assets, summary, create, update, remove, setStatus, logService } = useAssets();
  const confirm = useConfirm();
  const { showToast } = useToast();
  const { t } = useTranslation();

  // Text search comes from the shared global search state, surfaced via the card header's search box.
  const q = globalSearch;
  // "Due soon" is a comparison against the clock, so the clock is an input —
  // reading it mid-render made two renders of the same data disagree.
  const now = useNow(60_000);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [serviceFor, setServiceFor] = useState<AssetDoc | null>(null);
  // One popup for the table; the clicked row supplies its actions and position.

  const actor = { id: currentUser?._id || 'unknown', name: currentUser?.name || 'Staff' };

  const changeStatus = async (a: AssetDoc, status: AssetStatus, toastKey: string) => {
    try {
      const doc = await setStatus(a._id, status, actor);
      if (!doc) throw new Error('not saved');
      showToast(t(toastKey, { name: a.name }), 'success');
    } catch (err) {
      showToast(describeError(err, t('equipment.toastStatusFailed')), 'error');
    }
  };

  const retireAsset = async (a: AssetDoc) => {
    const ok = await confirm({
      title: t('equipment.retireTitle', { name: a.name }),
      message: t('equipment.retireMessage'),
      confirmLabel: t('equipment.retireConfirm'),
      tone: 'warning',
    });
    if (ok) await changeStatus(a, 'decommissioned', 'equipment.toastRetired');
  };

  const deleteAssetRow = async (a: AssetDoc) => {
    const ok = await confirm({
      title: t('equipment.deleteTitle', { name: a.name }),
      message: t('equipment.deleteMessage'),
      confirmLabel: t('equipment.deleteConfirm'),
      tone: 'danger',
    });
    if (!ok) return;
    try {
      if (!(await remove(a._id))) throw new Error('not deleted');
      showToast(t('equipment.toastDeleted', { name: a.name }), 'success');
    } catch (err) {
      showToast(describeError(err, t('equipment.toastDeleteFailed')), 'error');
    }
  };

  const startEdit = (a: AssetDoc) => {
    setEditingId(a._id);
    setForm({
      name: a.name, assetTag: a.assetTag, serialNumber: a.serialNumber || '', category: a.category,
      manufacturer: a.manufacturer || '', model: a.model || '', department: a.department || '', location: a.location || '',
      condition: a.condition, cost: a.cost || 0, costCurrency: a.costCurrency || defaultCurrency(), donor: a.donor || '',
      warrantyExpiresAt: a.warrantyExpiresAt || '', serviceIntervalMonths: a.serviceIntervalMonths || 0,
      notes: a.notes || '',
    });
    setCreateOpen(true);
  };

  /** What a row offers. Status moves only show while they would change something. */
  const actionsFor = (a: AssetDoc): RowAction[] => [
    { key: 'service', label: t('equipment.logServiceTitle'), icon: <Wrench className="w-4 h-4" />, onClick: () => setServiceFor(a) },
    { key: 'edit', label: t('equipment.editAsset'), icon: <Edit3 className="w-4 h-4" />, onClick: () => startEdit(a) },
    ...(a.status !== 'operational'
      ? [{
          key: 'operational',
          label: t('equipment.markOperationalTitle'),
          tone: 'success' as const,
          icon: <CheckCircle2 className="w-4 h-4" />,
          onClick: () => void changeStatus(a, 'operational', 'equipment.toastOperational'),
        }]
      : []),
    ...(a.status !== 'under_repair' && a.status !== 'decommissioned'
      ? [{
          key: 'out-of-service',
          label: t('equipment.markOutOfService'),
          icon: <XCircle className="w-4 h-4" />,
          group: 'status',
          onClick: () => void changeStatus(a, 'under_repair', 'equipment.toastOutOfService'),
        }]
      : []),
    ...(a.status !== 'decommissioned'
      ? [{ key: 'retire', label: t('equipment.retireAsset'), icon: <XCircle className="w-4 h-4" />, group: 'status', onClick: () => void retireAsset(a) }]
      : []),
    { key: 'delete', label: t('equipment.deleteAsset'), tone: 'danger' as const, icon: <Trash2 className="w-4 h-4" />, group: 'danger', onClick: () => void deleteAssetRow(a) },
  ];

  const [form, setForm] = useState({
    name: '', assetTag: '', serialNumber: '', category: 'medical_equipment' as AssetCategory,
    manufacturer: '', model: '', department: '', location: '',
    condition: 'good' as AssetDoc['condition'],
    cost: 0, costCurrency: defaultCurrency(), donor: '',
    warrantyExpiresAt: '', serviceIntervalMonths: 12,
    notes: '',
  });

  const [serviceForm, setServiceForm] = useState({ type: 'service' as 'inspection' | 'repair' | 'calibration' | 'service', notes: '', cost: 0 });

  const facility = useMemo(() => ({
    id: currentUser?.hospitalId || '',
    name: currentUser?.hospitalName || 'Facility',
    level: 'county' as AssetDoc['facilityLevel'],
  }), [currentUser]);

  const filtered = useMemo(() => {
    return assets.filter(a => {
      if (q) {
        const needle = q.toLowerCase();
        if (
          !a.name.toLowerCase().includes(needle) &&
          !a.assetTag.toLowerCase().includes(needle) &&
          !(a.serialNumber || '').toLowerCase().includes(needle) &&
          !(a.location || '').toLowerCase().includes(needle)
        ) return false;
      }
      return true;
    });
  }, [assets, q]);

  const handleCreate = async () => {
    if (!form.name.trim() || !form.assetTag.trim()) {
      showToast(t('equipment.toastNameTagRequired'), 'error');
      return;
    }
    if (!facility.id) {
      showToast(t('equipment.toastNoFacility'), 'error');
      return;
    }
    if (editingId) {
      try {
        const doc = await update(editingId, {
          ...form,
          cost: form.cost || undefined,
          warrantyExpiresAt: form.warrantyExpiresAt || undefined,
        });
        if (!doc) throw new Error('not saved');
        showToast(t('equipment.toastUpdated', { name: form.name }), 'success');
        closeForm();
      } catch (err) {
        showToast(describeError(err, t('equipment.toastUpdateFailed')), 'error');
      }
      return;
    }
    try {
      await create({
        ...form,
        facilityId: facility.id,
        facilityName: facility.name,
        facilityLevel: facility.level,
        cost: form.cost || undefined,
        warrantyExpiresAt: form.warrantyExpiresAt || undefined,
        createdBy: currentUser?._id || currentUser?.username,
        createdByName: currentUser?.name,
      });
      showToast(t('equipment.toastRegistered', { name: form.name }), 'success');
      closeForm();
    } catch (err) {
      console.error(err);
      showToast(t('equipment.toastRegisterFailed'), 'error');
    }
  };
  const closeForm = () => {
    setCreateOpen(false);
    setEditingId(null);
    setForm({ name: '', assetTag: '', serialNumber: '', category: 'medical_equipment', manufacturer: '', model: '', department: '', location: '', condition: 'good', cost: 0, costCurrency: defaultCurrency(), donor: '', warrantyExpiresAt: '', serviceIntervalMonths: 12, notes: '' });
  };

  const handleLogService = async () => {
    if (!serviceFor || !currentUser) return;
    if (!serviceForm.notes.trim()) {
      showToast(t('equipment.toastServiceNoteRequired'), 'error');
      return;
    }
    try {
      await logService(serviceFor._id, {
        type: serviceForm.type,
        notes: serviceForm.notes.trim(),
        cost: serviceForm.cost || undefined,
        performedBy: currentUser._id || currentUser.username || 'unknown',
        performedByName: currentUser.name,
      });
      showToast(t('equipment.toastLogged', { type: serviceForm.type, name: serviceFor.name }), 'success');
      setServiceFor(null);
      setServiceForm({ type: 'service', notes: '', cost: 0 });
    } catch (err) {
      console.error(err);
      showToast(t('equipment.toastLogFailed'), 'error');
    }
  };

  return (
    <>
      <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {/* Headline counts as the management KPI band, above the register. */}
        {summary && (
          <FacilityKpiBand tiles={[
            { key: 'operational', label: t('equipment.kpiOperational'), value: summary.operational, detail: t('equipment.kpiOperationalDetail', { total: summary.total }) },
            { key: 'service', label: t('equipment.kpiNeedsService'), value: summary.needsService, detail: summary.needsService ? t('equipment.kpiNeedsServiceDetail') : t('equipment.kpiNoneNeedService'), warn: summary.needsService > 0 },
            { key: 'repair', label: t('equipment.kpiUnderRepair'), value: summary.underRepair, detail: summary.underRepair ? t('equipment.kpiUnderRepairDetail') : t('equipment.kpiNoneUnderRepair') },
            { key: 'due', label: t('equipment.kpiServiceDueSoon'), value: summary.serviceDueSoon, detail: t('equipment.kpiServiceDueDetail'), warn: summary.serviceDueSoon > 0 },
          ]} />
        )}
        <div className="card-elevated overflow-hidden flex flex-col" style={{ flex: 1, minHeight: 0 }} data-tour="equipment-list">
          <EhrListHeader
            title={t('equipment.topBarTitle')}
            count={summary?.total}
            search={{ value: globalSearch, onChange: setGlobalSearch, placeholder: 'Search assets…' }}
            actions={
              <button type="button" onClick={() => setCreateOpen(true)} className="btn btn-primary">
                <Plus className="w-4 h-4" /> {t('equipment.registerAsset')}
              </button>
            }
          />
          <div className="ehr-list-scroll">
          <table className="data-table" style={{ minWidth: 820, tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '26%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '10%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>{t('equipment.colAsset')}</th>
                <th>{t('equipment.colCategory')}</th>
                <th>{t('equipment.colLocation')}</th>
                <th>{t('equipment.colStatus')}</th>
                <th>{t('equipment.colService')}</th>
                <th>{t('chart.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>{t('equipment.noAssetsMatch')}</td></tr>
              )}
              {filtered.map(a => {
                const tok = STATUS_TOKENS[a.status];
                const dueSoon = a.nextServiceDueAt && (new Date(a.nextServiceDueAt).getTime() - now) < 30 * 86400000;
                return (
                  <tr key={a._id}>
                    <td>
                      <div className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{a.name}</div>
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {t('equipment.tagLabel')} <span className="font-mono">{a.assetTag}</span>{a.serialNumber ? ` · ${t('equipment.snLabel')} ${a.serialNumber}` : ''}
                      </div>
                    </td>
                    <td className="text-xs capitalize" style={{ color: 'var(--text-secondary)' }}>{(() => { const cat = CATEGORIES.find(c => c.id === a.category); return cat ? t(cat.labelKey) : a.category; })()}</td>
                    <td className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {a.department || '—'}
                      {a.location && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{a.location}</div>}
                    </td>
                    <td>
                      <SadbChip tone={tok.tone}>{t(tok.labelKey)}</SadbChip>
                    </td>
                    <td className="text-xs">
                      {a.nextServiceDueAt ? (
                        <span style={{ color: dueSoon ? 'var(--color-danger-text)' : 'var(--text-secondary)' }} className="inline-flex items-center gap-1">
                          {a.nextServiceDueAt}
                        </span>
                      ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td><RowActionsMenu ariaLabel={t('equipment.rowActionsAria', { name: a.name })} actions={actionsFor(a)} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>

        {/* Register modal */}
        {createOpen && (
          <FormSlider
            title={editingId ? t('equipment.editModalTitle') : t('equipment.registerModalTitle')}
            onClose={closeForm}
            footer={<>
                <button onClick={closeForm} className="btn btn-secondary">{t('action.cancel')}</button>
                <button onClick={handleCreate} className="btn btn-primary">{editingId ? t('equipment.saveChanges') : t('equipment.register')}</button>
            </>}
          >
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-required text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('equipment.labelName')}</label>
                  <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder={t('equipment.placeholderName')} />
                </div>
                <div>
                  <label className="field-required text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('equipment.labelAssetTag')}</label>
                  <input value={form.assetTag} onChange={e => setForm({ ...form, assetTag: e.target.value })} placeholder={t('ui.jthUs001')} />
                </div>
                <div>
                  <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('equipment.labelCategory')}</label>
                  <Select value={form.category} onChange={e => setForm({ ...form, category: e.target.value as AssetCategory })}>
                    {CATEGORIES.map(c => <option key={c.id} value={c.id}>{t(c.labelKey)}</option>)}
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('equipment.labelCondition')}</label>
                  <Select value={form.condition} onChange={e => setForm({ ...form, condition: e.target.value as AssetDoc['condition'] })}>
                    <option value="new">{t('equipment.conditionNew')}</option><option value="good">{t('equipment.conditionGood')}</option><option value="fair">{t('equipment.conditionFair')}</option><option value="poor">{t('equipment.conditionPoor')}</option>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('equipment.labelManufacturer')}</label>
                  <input value={form.manufacturer} onChange={e => setForm({ ...form, manufacturer: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('equipment.labelModel')}</label>
                  <input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('equipment.labelSerialNumber')}</label>
                  <input value={form.serialNumber} onChange={e => setForm({ ...form, serialNumber: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('equipment.labelDepartment')}</label>
                  <DepartmentSelect value={form.department} onChange={name => setForm({ ...form, department: name })} />
                </div>
                <div>
                  <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('equipment.labelLocation')}</label>
                  <input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder={t('equipment.placeholderLocation')} />
                </div>
                <div>
                  <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('equipment.labelDonor')}</label>
                  <input value={form.donor} onChange={e => setForm({ ...form, donor: e.target.value })} placeholder={t('equipment.placeholderDonor')} />
                </div>
                <div>
                  <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('equipment.labelCost', { currency: form.costCurrency })}</label>
                  <NumberInput step="any" min={0} value={form.cost || ''} onChange={e => setForm({ ...form, cost: parseFloat(e.target.value) || 0 })} />
                </div>
                <div>
                  <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('equipment.labelWarrantyExpires')}</label>
                  <input type="date" value={form.warrantyExpiresAt} onChange={e => setForm({ ...form, warrantyExpiresAt: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('equipment.labelServiceInterval')}</label>
                  <NumberInput step="1" min={0} value={form.serviceIntervalMonths || ''} onChange={e => setForm({ ...form, serviceIntervalMonths: parseInt(e.target.value) || 0 })} />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('equipment.labelNotes')}</label>
                  <textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
                </div>
              </div>
            </div>
          </FormSlider>
        )}

        {/* Maintenance modal */}
        {serviceFor && (
          <FormSlider
            title={t('equipment.logServiceTitle')}
            subtitle={<>{serviceFor.name} · {t('equipment.tagLabel')} {serviceFor.assetTag}</>}
            width={448}
            onClose={() => setServiceFor(null)}
            footer={<>
                <button onClick={() => setServiceFor(null)} className="btn btn-secondary">{t('action.cancel')}</button>
                <button onClick={handleLogService} className="btn btn-primary">{t('equipment.saveLog')}</button>
            </>}
          >
            <div className="space-y-4">
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('equipment.labelType')}</label>
                  <Select value={serviceForm.type} onChange={e => setServiceForm({ ...serviceForm, type: e.target.value as typeof serviceForm.type })}>
                    <option value="inspection">{t('equipment.serviceTypeInspection')}</option>
                    <option value="service">{t('equipment.serviceTypeRoutine')}</option>
                    <option value="repair">{t('equipment.serviceTypeRepair')}</option>
                    <option value="calibration">{t('equipment.serviceTypeCalibration')}</option>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('equipment.labelServiceCost')}</label>
                  <NumberInput step="any" min={0} value={serviceForm.cost || ''} onChange={e => setServiceForm({ ...serviceForm, cost: parseFloat(e.target.value) || 0 })} />
                </div>
                <div>
                  <label className="field-required text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('equipment.labelServiceNotes')}</label>
                  <textarea rows={3} value={serviceForm.notes} onChange={e => setServiceForm({ ...serviceForm, notes: e.target.value })} placeholder={t('equipment.placeholderServiceNotes')} />
                </div>
              </div>
            </div>
          </FormSlider>
        )}
      </main>
    </>
  );
}
