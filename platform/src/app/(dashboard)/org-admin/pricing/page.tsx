'use client';

import { useEffect, useState, useCallback } from 'react';
import Modal from '@/components/Modal';
import { useAuth } from '@/lib/context';
import { useToast } from '@/components/Toast';
import { Plus, Save, Search, Trash2 } from '@/components/icons/lucide';
import EhrListHeader from '@/components/ehr/EhrListHeader';
import {
  getFeeSchedule, createFee, updateFee, deleteFee, type FeeInput,
} from '@/lib/services/fee-schedule-service';
import type { FeeScheduleDoc, ChargeCategory } from '@/lib/db-types-billing';
import { formatMoney } from '@/lib/format-utils';
import Select from '@/components/Select';

const CATEGORIES: { value: ChargeCategory; label: string }[] = [
  { value: 'consultation', label: 'Consultation' },
  { value: 'laboratory', label: 'Laboratory' },
  { value: 'pharmacy', label: 'Pharmacy' },
  { value: 'radiology', label: 'Radiology / Imaging' },
  { value: 'procedure', label: 'Procedure' },
  { value: 'bed_charge', label: 'Bed / Ward charge' },
  { value: 'surgery', label: 'Surgery' },
  { value: 'ambulance', label: 'Ambulance' },
  { value: 'other', label: 'Other' },
];

const emptyForm = (): FeeInput & { isActive: boolean } => ({
  facilityId: '', facilityName: '', category: 'consultation',
  serviceCode: '', serviceName: '', unitPrice: 0, currency: 'SSP', isActive: true,
});

export default function ServicePricingPage() {
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const [fees, setFees] = useState<FeeScheduleDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  // Confirm before removing a catalog row so an accidental click on "Remove"
  // is recoverable (the row isn't deleted until the user confirms).
  const [removingFee, setRemovingFee] = useState<FeeScheduleDoc | null>(null);

  const actor = { id: currentUser?._id, name: currentUser?.name };
  const scope = currentUser
    ? { orgId: currentUser.orgId, hospitalId: currentUser.hospitalId, role: currentUser.role }
    : undefined;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setFees(await getFeeSchedule(scope));
    } catch {
      showToast('Failed to load price catalog', 'error');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.orgId, currentUser?.hospitalId, currentUser?.role]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    const f = emptyForm();
    f.facilityId = currentUser?.hospitalId || '';
    f.facilityName = currentUser?.hospitalName || '';
    setForm(f);
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (fee: FeeScheduleDoc) => {
    setForm({
      facilityId: fee.facilityId, facilityName: fee.facilityName, category: fee.category,
      serviceCode: fee.serviceCode, serviceName: fee.serviceName, unitPrice: fee.unitPrice,
      currency: fee.currency, isActive: fee.isActive,
    });
    setEditingId(fee._id);
    setShowForm(true);
  };

  const save = async () => {
    if (!form.serviceName.trim() || form.unitPrice < 0) {
      showToast('Enter a service name and a valid price', 'error');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await updateFee(editingId, form, actor);
        showToast('Price updated', 'success');
      } else {
        await createFee({ ...form, orgId: currentUser?.orgId }, actor);
        showToast('Service added to catalog', 'success');
      }
      setShowForm(false);
      await load();
    } catch {
      showToast('Could not save the price', 'error');
    } finally {
      setSaving(false);
    }
  };

  const confirmRemove = async () => {
    if (!removingFee) return;
    try {
      await deleteFee(removingFee._id, actor);
      showToast('Service removed', 'success');
      setRemovingFee(null);
      await load();
    } catch {
      showToast('Could not remove the service', 'error');
    }
  };

  const q = search.trim().toLowerCase();
  const filtered = fees.filter(f =>
    !q || f.serviceName.toLowerCase().includes(q) || f.serviceCode.toLowerCase().includes(q) || f.category.includes(q));

  return (
    <>
      <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        <div className="dash-card overflow-hidden flex flex-col" style={{ flex: 1, minHeight: 0 }}>
          <EhrListHeader
            title="Service Pricing"
            actions={
              <button onClick={openAdd} className="btn btn-primary inline-flex items-center gap-2" style={{ marginLeft: 'auto' }}>
                <Plus className="w-4 h-4" /> Add service
              </button>
            }
          />
          <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--border-light)' }}>
            <Search className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search services…"
              className="flex-1 bg-transparent outline-none text-sm"
              style={{ color: 'var(--text-primary)' }}
            />
          </div>

          {loading ? (
            <div className="p-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
              {fees.length === 0 ? 'No services priced yet. Add your first service to start charging.' : 'No services match your search.'}
            </div>
          ) : (
            <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
            <table className="w-full" style={{ minWidth: 720 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-light)' }}>
                  {['Service', 'Code', 'Category', 'Price', 'Status', ''].map(h => (
                    <th key={h} className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(fee => (
                  <tr key={fee._id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <td className="px-4 py-2.5 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{fee.serviceName}</td>
                    <td className="px-4 py-2.5 text-[12px] font-mono" style={{ color: 'var(--text-muted)' }}>{fee.serviceCode || '—'}</td>
                    <td className="px-4 py-2.5 text-[12px]" style={{ color: 'var(--text-secondary)' }}>{CATEGORIES.find(c => c.value === fee.category)?.label || fee.category}</td>
                    <td className="px-4 py-2.5 text-sm font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>{formatMoney(fee.unitPrice, { currency: fee.currency, decimals: 2 })}</td>
                    <td className="px-4 py-2.5">
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full" style={{
                        background: fee.isActive ? 'var(--accent-light)' : 'var(--overlay-medium)',
                        color: fee.isActive ? 'var(--accent-text)' : 'var(--text-muted)',
                      }}>{fee.isActive ? 'Active' : 'Inactive'}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <button onClick={() => openEdit(fee)} className="text-[12px] font-semibold mr-3" style={{ color: 'var(--accent-text)' }}>Edit</button>
                      <button onClick={() => setRemovingFee(fee)} aria-label="Remove fee" title="Remove fee" className="p-1.5 rounded-lg transition-colors hover:bg-red-50" style={{ color: 'var(--color-danger-text)' }}><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>

        {showForm && (
          <Modal onClose={() => setShowForm(false)} width={460}>
            <div className="card-elevated" style={{ background: 'var(--bg-card-solid)', borderRadius: 16, padding: 20, width: '100%' }}>
              <h2 className="text-base font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
                {editingId ? 'Edit service price' : 'Add service price'}
              </h2>
              <div className="flex flex-col gap-3">
                <Field label="Service name">
                  <input value={form.serviceName} onChange={e => setForm({ ...form, serviceName: e.target.value })} className="fee-input" placeholder="e.g. General consultation" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Category">
                    <Select value={form.category} onChange={e => setForm({ ...form, category: e.target.value as ChargeCategory })} className="fee-input">
                      {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </Select>
                  </Field>
                  <Field label="Service code">
                    <input value={form.serviceCode} onChange={e => setForm({ ...form, serviceCode: e.target.value })} className="fee-input" placeholder="e.g. CONS-GEN" />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Price">
                    <input type="number" min={0} value={form.unitPrice} onChange={e => setForm({ ...form, unitPrice: Number(e.target.value) })} className="fee-input" />
                  </Field>
                  <Field label="Currency">
                    <input value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} className="fee-input" />
                  </Field>
                </div>
                <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  <input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} />
                  Active (available for charging)
                </label>
              </div>
              <div className="flex gap-2 mt-5">
                <button onClick={() => setShowForm(false)} className="btn btn-secondary flex-1">Cancel</button>
                <button onClick={save} disabled={saving} className="btn btn-primary flex-1 inline-flex items-center justify-center gap-2">
                  <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </Modal>
        )}

        {/* Confirm removal — gives the admin a chance to back out before the
            catalog row is deleted, so an accidental Remove click is recoverable. */}
        {removingFee && (
          <Modal onClose={() => setRemovingFee(null)} width={400}>
            <div className="card-elevated" style={{ background: 'var(--bg-card-solid)', borderRadius: 16, padding: 20, width: '100%' }}>
              <h2 className="text-base font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Remove service?</h2>
              <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>
                {removingFee.serviceName} ({formatMoney(removingFee.unitPrice, { currency: removingFee.currency, decimals: 2 })}) will be removed from the price catalog.
              </p>
              <p className="text-[12px] mb-4" style={{ color: 'var(--text-muted)' }}>
                It will no longer be available for charging.
              </p>
              <div className="flex gap-2">
                <button onClick={() => setRemovingFee(null)} className="btn btn-secondary flex-1">Cancel</button>
                <button onClick={confirmRemove} className="btn flex-1 text-white" style={{ background: 'var(--color-danger)' }}>Remove</button>
              </div>
            </div>
          </Modal>
        )}
      </main>

      <style>{`
        .fee-input {
          width: 100%; padding: 9px 12px; border-radius: 8px;
          border: 1px solid var(--border-medium); background: var(--bg-secondary);
          color: var(--text-primary); font-size: 14px;
        }
      `}</style>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>{label}</label>
      {children}
    </div>
  );
}
