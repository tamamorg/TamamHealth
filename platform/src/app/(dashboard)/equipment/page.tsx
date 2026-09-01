'use client';

import { useState, useMemo } from 'react';
import Modal from '@/components/Modal';
import { Plus, X, CheckCircle2, Settings as Wrench } from '@/components/icons/lucide';
import RowActionsPopup, { rowActionsAt, rowActionsFromElement, isRowActivationKey, type RowActionsPopupState } from '@/components/RowActionsPopup';
import type { RowAction } from '@/components/RowActionsMenu';
import { useAuth, useUi } from '@/lib/context';
import { useAssets } from '@/lib/hooks/useAssets';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { AssetDoc, AssetCategory, AssetStatus } from '@/lib/db-types-asset';
import EhrListHeader, { LIST_STAT_COLORS } from '@/components/ehr/EhrListHeader';
import Select from '@/components/Select';
import { stopsClickPropagation } from '@/lib/a11y';

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

const STATUS_TOKENS: Record<AssetStatus, { labelKey: string; color: string; bg: string }> = {
  operational:    { labelKey: 'equipment.statusOperational',     color: 'var(--color-success-text)', bg: 'rgba(15, 160, 106, 0.12)' },
  needs_service:  { labelKey: 'equipment.statusNeedsService',   color: 'var(--color-warning-text)', bg: 'rgba(254, 230, 151, 0.16)' },
  under_repair:   { labelKey: 'equipment.statusUnderRepair',    color: 'var(--accent-primary)', bg: 'rgba(33, 145, 208, 0.12)' },
  decommissioned: { labelKey: 'equipment.statusDecommissioned',  color: 'var(--text-muted)', bg: 'var(--overlay-light)' },
  lost_or_stolen: { labelKey: 'equipment.statusLostOrStolen',   color: 'var(--color-danger-text)', bg: 'rgba(224, 49, 39, 0.14)' },
};

export default function AssetsPage() {
  const { currentUser } = useAuth();
  const { globalSearch, setGlobalSearch } = useUi();
  const { assets, summary, create, setStatus, logService } = useAssets();
  const { showToast } = useToast();
  const { t } = useTranslation();

  // Text search comes from the shared global search state, surfaced via the card header's search box.
  const q = globalSearch;
  const [createOpen, setCreateOpen] = useState(false);
  const [serviceFor, setServiceFor] = useState<AssetDoc | null>(null);
  // One popup for the table; the clicked row supplies its actions and position.
  const [rowMenu, setRowMenu] = useState<RowActionsPopupState | null>(null);

  /** What a row offers. "Mark operational" only shows while it is not. */
  const actionsFor = (a: AssetDoc): RowAction[] => [
    { key: 'service', label: t('equipment.logServiceTitle'), icon: <Wrench className="w-4 h-4" />, onClick: () => setServiceFor(a) },
    ...(a.status !== 'operational'
      ? [{
          key: 'operational',
          label: t('equipment.markOperationalTitle'),
          tone: 'success' as const,
          icon: <CheckCircle2 className="w-4 h-4" />,
          onClick: () => setStatus(a._id, 'operational', { id: currentUser?._id || 'unknown', name: currentUser?.name || 'Staff' }),
        }]
      : []),
  ];

  const [form, setForm] = useState({
    name: '', assetTag: '', serialNumber: '', category: 'medical_equipment' as AssetCategory,
    manufacturer: '', model: '', department: '', location: '',
    condition: 'good' as AssetDoc['condition'],
    cost: 0, costCurrency: 'SSP', donor: '',
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
      setCreateOpen(false);
      setForm({ name: '', assetTag: '', serialNumber: '', category: 'medical_equipment', manufacturer: '', model: '', department: '', location: '', condition: 'good', cost: 0, costCurrency: 'SSP', donor: '', warrantyExpiresAt: '', serviceIntervalMonths: 12, notes: '' });
    } catch (err) {
      console.error(err);
      showToast(t('equipment.toastRegisterFailed'), 'error');
    }
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
        {/* Asset table. The register's counts ride in the list header as dot
            chips — the same row every other module list uses — rather than a
            KPI strip above the card, which cost a band of vertical space and
            was the only place in the app still framing counts as cards. */}
        <div className="card-elevated overflow-hidden flex flex-col" style={{ flex: 1, minHeight: 0 }} data-tour="equipment-list">
          <EhrListHeader
            title={t('equipment.topBarTitle')}
            stats={summary ? [
              { label: t('equipment.kpiTotal'), value: summary.total, color: LIST_STAT_COLORS.muted },
              { label: t('equipment.kpiOperational'), value: summary.operational, color: LIST_STAT_COLORS.green },
              { label: t('equipment.kpiNeedsService'), value: summary.needsService, color: LIST_STAT_COLORS.amber },
              { label: t('equipment.kpiUnderRepair'), value: summary.underRepair, color: LIST_STAT_COLORS.blue },
              { label: t('equipment.kpiServiceDueSoon'), value: summary.serviceDueSoon, color: 'var(--color-danger)' },
            ] : []}
            search={{ value: globalSearch, onChange: setGlobalSearch, placeholder: 'Search assets…' }}
            actions={
              <button onClick={() => setCreateOpen(true)} className="btn btn-primary" style={{ height: 38, whiteSpace: 'nowrap', flexShrink: 0 }}>
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
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>{t('equipment.noAssetsMatch')}</td></tr>
              )}
              {filtered.map(a => {
                const tok = STATUS_TOKENS[a.status];
                const dueSoon = a.nextServiceDueAt && (new Date(a.nextServiceDueAt).getTime() - Date.now()) < 30 * 86400000;
                return (
                  <tr key={a._id} style={{ cursor: 'pointer' }} tabIndex={0}
                      onClick={e => setRowMenu(rowActionsAt(e, actionsFor(a)))}
                      onKeyDown={e => { if (isRowActivationKey(e.key)) { e.preventDefault(); setRowMenu(rowActionsFromElement(e.currentTarget, actionsFor(a))); } }}>
                    <td>
                      <div className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{a.name}</div>
                      <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        {t('equipment.tagLabel')} <span className="font-mono">{a.assetTag}</span>{a.serialNumber ? ` · ${t('equipment.snLabel')} ${a.serialNumber}` : ''}
                      </div>
                    </td>
                    <td className="text-xs capitalize" style={{ color: 'var(--text-secondary)' }}>{(() => { const cat = CATEGORIES.find(c => c.id === a.category); return cat ? t(cat.labelKey) : a.category; })()}</td>
                    <td className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {a.department || '—'}
                      {a.location && <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{a.location}</div>}
                    </td>
                    <td>
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-md" style={{ background: tok.bg, color: tok.color, border: `1px solid ${tok.color}40` }}>
                        {t(tok.labelKey)}
                      </span>
                    </td>
                    <td className="text-xs">
                      {a.nextServiceDueAt ? (
                        <span style={{ color: dueSoon ? 'var(--color-danger-text)' : 'var(--text-secondary)' }} className="inline-flex items-center gap-1">
                          {a.nextServiceDueAt}
                        </span>
                      ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <RowActionsPopup state={rowMenu} onClose={() => setRowMenu(null)} />
          </div>
        </div>

        {/* Register modal */}
        {createOpen && (
          <Modal onClose={() => setCreateOpen(false)}>
            <div className="modal-content card-elevated p-6 max-w-2xl w-full" style={{ maxHeight: '90vh', overflowY: 'auto' }} {...stopsClickPropagation}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold">{t('equipment.registerModalTitle')}</h3>
                <button onClick={() => setCreateOpen(false)} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-required text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('equipment.labelName')}</label>
                  <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder={t('equipment.placeholderName')} />
                </div>
                <div>
                  <label className="field-required text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('equipment.labelAssetTag')}</label>
                  <input value={form.assetTag} onChange={e => setForm({ ...form, assetTag: e.target.value })} placeholder="JTH-US-001" />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('equipment.labelCategory')}</label>
                  <Select value={form.category} onChange={e => setForm({ ...form, category: e.target.value as AssetCategory })}>
                    {CATEGORIES.map(c => <option key={c.id} value={c.id}>{t(c.labelKey)}</option>)}
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('equipment.labelCondition')}</label>
                  <Select value={form.condition} onChange={e => setForm({ ...form, condition: e.target.value as AssetDoc['condition'] })}>
                    <option value="new">{t('equipment.conditionNew')}</option><option value="good">{t('equipment.conditionGood')}</option><option value="fair">{t('equipment.conditionFair')}</option><option value="poor">{t('equipment.conditionPoor')}</option>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('equipment.labelManufacturer')}</label>
                  <input value={form.manufacturer} onChange={e => setForm({ ...form, manufacturer: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('equipment.labelModel')}</label>
                  <input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('equipment.labelSerialNumber')}</label>
                  <input value={form.serialNumber} onChange={e => setForm({ ...form, serialNumber: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('equipment.labelDepartment')}</label>
                  <input value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} placeholder={t('equipment.placeholderDepartment')} />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('equipment.labelLocation')}</label>
                  <input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder={t('equipment.placeholderLocation')} />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('equipment.labelDonor')}</label>
                  <input value={form.donor} onChange={e => setForm({ ...form, donor: e.target.value })} placeholder={t('equipment.placeholderDonor')} />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('equipment.labelCost', { currency: form.costCurrency })}</label>
                  <input type="number" min={0} value={form.cost || ''} onChange={e => setForm({ ...form, cost: parseFloat(e.target.value) || 0 })} />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('equipment.labelWarrantyExpires')}</label>
                  <input type="date" value={form.warrantyExpiresAt} onChange={e => setForm({ ...form, warrantyExpiresAt: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('equipment.labelServiceInterval')}</label>
                  <input type="number" min={0} value={form.serviceIntervalMonths || ''} onChange={e => setForm({ ...form, serviceIntervalMonths: parseInt(e.target.value) || 0 })} />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('equipment.labelNotes')}</label>
                  <textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
                </div>
              </div>
              <hr className="section-divider" />
              <div className="flex gap-2 mt-2">
                <button onClick={() => setCreateOpen(false)} className="btn btn-secondary flex-1">{t('action.cancel')}</button>
                <button onClick={handleCreate} className="btn btn-primary flex-1">{t('equipment.register')}</button>
              </div>
            </div>
          </Modal>
        )}

        {/* Maintenance modal */}
        {serviceFor && (
          <Modal onClose={() => setServiceFor(null)} width={448}>
            <div className="modal-content card-elevated p-6 w-full" {...stopsClickPropagation}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-semibold">{t('equipment.logServiceTitle')}</h3>
                  <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{serviceFor.name} · {t('equipment.tagLabel')} {serviceFor.assetTag}</p>
                </div>
                <button onClick={() => setServiceFor(null)} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('equipment.labelType')}</label>
                  <Select value={serviceForm.type} onChange={e => setServiceForm({ ...serviceForm, type: e.target.value as typeof serviceForm.type })}>
                    <option value="inspection">{t('equipment.serviceTypeInspection')}</option>
                    <option value="service">{t('equipment.serviceTypeRoutine')}</option>
                    <option value="repair">{t('equipment.serviceTypeRepair')}</option>
                    <option value="calibration">{t('equipment.serviceTypeCalibration')}</option>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('equipment.labelServiceCost')}</label>
                  <input type="number" min={0} value={serviceForm.cost || ''} onChange={e => setServiceForm({ ...serviceForm, cost: parseFloat(e.target.value) || 0 })} />
                </div>
                <div>
                  <label className="field-required text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('equipment.labelServiceNotes')}</label>
                  <textarea rows={3} value={serviceForm.notes} onChange={e => setServiceForm({ ...serviceForm, notes: e.target.value })} placeholder={t('equipment.placeholderServiceNotes')} />
                </div>
              </div>
              <hr className="section-divider" />
              <div className="flex gap-2 mt-2">
                <button onClick={() => setServiceFor(null)} className="btn btn-secondary flex-1">{t('action.cancel')}</button>
                <button onClick={handleLogService} className="btn btn-primary flex-1">{t('equipment.saveLog')}</button>
              </div>
            </div>
          </Modal>
        )}
      </main>
    </>
  );
}
