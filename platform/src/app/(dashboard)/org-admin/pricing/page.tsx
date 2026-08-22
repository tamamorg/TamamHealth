'use client';

/**
 * Service pricing — the org's fee catalog, on the shared admin console kit
 * (sadb-*). Restyled from the hand-rolled table 2026-08-21: grid list whose
 * header row survives an empty catalog, tonal status chips, and the shared
 * sadb modal grammar (which also retired this file's injected <style> tag
 * and its one-off .fee-input class).
 *
 * A row click opens the editor; Remove lives inside the editor (with its
 * own confirm) rather than as a per-row trash can, because a grid row is a
 * single button and cannot nest a second one.
 */

import { useEffect, useState, useCallback } from 'react';
import Modal from '@/components/Modal';
import { useAuth } from '@/lib/context';
import { useToast } from '@/components/Toast';
import { Plus, Save } from '@/components/icons/lucide';
import {
  SadbPage, SadbCard, SadbSearch, SadbGridList, SadbGridRow, SadbChip, SadbConfirmModal,
} from '@/components/admin/sadb-ui';
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

/* Service · Code · Category · Price · Status */
const FEE_GRID = 'minmax(200px, 1.6fr) minmax(110px, 0.8fr) minmax(130px, 1fr) minmax(120px, 0.9fr) minmax(90px, 0.7fr)';

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
      setShowForm(false);
      await load();
    } catch {
      showToast('Could not remove the service', 'error');
    }
  };

  const q = search.trim().toLowerCase();
  const filtered = fees.filter(f =>
    !q || f.serviceName.toLowerCase().includes(q) || f.serviceCode.toLowerCase().includes(q) || f.category.includes(q));

  const editingFee = editingId ? fees.find(f => f._id === editingId) ?? null : null;

  return (
    <SadbPage roles={['org_admin', 'super_admin']}>
      <div data-tour="org-pricing-table">
        <SadbCard
          title="Service Pricing"
          meta={loading ? undefined : `${filtered.length} of ${fees.length}`}
          action={
            <button type="button" className="btn btn-primary btn-sm" onClick={openAdd}>
              <Plus className="w-4 h-4" /> Add service
            </button>
          }
        >
          <div className="sadb-search-row" style={{ paddingBottom: 12 }}>
            <SadbSearch value={search} onChange={setSearch} placeholder="Search services…" />
          </div>

          <SadbGridList
            template={FEE_GRID}
            minWidth={700}
            head={['Service', 'Code', 'Category', 'Price', 'Status']}
            alignEndLast
            empty={loading
              ? 'Loading…'
              : fees.length === 0
                ? 'No services priced yet. Add your first service to start charging.'
                : 'No services match your search.'}
          >
            {!loading && filtered.map(fee => (
              <SadbGridRow key={fee._id} template={FEE_GRID} onClick={() => openEdit(fee)}>
                <span className="sadb-tenant-name truncate">{fee.serviceName}</span>
                <span className="sadb-tenant-sub font-mono">{fee.serviceCode || '—'}</span>
                <span className="truncate">{CATEGORIES.find(c => c.value === fee.category)?.label || fee.category}</span>
                <span className="sadb-tenant-num" style={{ fontWeight: 700 }}>
                  {formatMoney(fee.unitPrice, { currency: fee.currency, decimals: 2 })}
                </span>
                <span style={{ justifySelf: 'end' }}>
                  <SadbChip tone={fee.isActive ? 'green' : 'neutral'}>
                    {fee.isActive ? 'Active' : 'Inactive'}
                  </SadbChip>
                </span>
              </SadbGridRow>
            ))}
          </SadbGridList>
        </SadbCard>
      </div>

      {showForm && (
        <Modal onClose={() => setShowForm(false)} width={460} labelledBy="fee-form-title">
          <div className="sadb-modal">
            <div className="sadb-modal-copy">
              <h2 id="fee-form-title" className="sadb-modal-title">
                {editingId ? 'Edit service price' : 'Add service price'}
              </h2>
            </div>
            <div className="flex flex-col gap-3">
              <Field label="Service name">
                <input className="sadb-modal-input" value={form.serviceName} onChange={e => setForm({ ...form, serviceName: e.target.value })} placeholder="e.g. General consultation" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Category">
                  <Select className="sadb-modal-input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value as ChargeCategory })}>
                    {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </Select>
                </Field>
                <Field label="Service code">
                  <input className="sadb-modal-input" value={form.serviceCode} onChange={e => setForm({ ...form, serviceCode: e.target.value })} placeholder="e.g. CONS-GEN" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Price">
                  <input className="sadb-modal-input" type="number" min={0} value={form.unitPrice} onChange={e => setForm({ ...form, unitPrice: Number(e.target.value) })} />
                </Field>
                <Field label="Currency">
                  <input className="sadb-modal-input" value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)', textTransform: 'none' }}>
                <input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} />
                Active (available for charging)
              </label>
            </div>
            <div className="sadb-modal-actions" style={editingId ? { justifyContent: 'space-between' } : undefined}>
              {editingId && (
                <button
                  type="button"
                  className="sadb-action-btn is-danger"
                  onClick={() => setRemovingFee(editingFee)}
                >
                  Remove service
                </button>
              )}
              <span className="flex gap-2">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="button" className="btn btn-primary btn-sm inline-flex items-center gap-2" onClick={save} disabled={saving}>
                  <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save'}
                </button>
              </span>
            </div>
          </div>
        </Modal>
      )}

      {/* Confirm removal — gives the admin a chance to back out before the
          catalog row is deleted, so an accidental Remove click is recoverable. */}
      {removingFee && (
        <SadbConfirmModal
          title="Remove service?"
          body={`${removingFee.serviceName} (${formatMoney(removingFee.unitPrice, { currency: removingFee.currency, decimals: 2 })}) will be removed from the price catalog and no longer available for charging.`}
          confirmLabel="Remove"
          auditNote={false}
          onCancel={() => setRemovingFee(null)}
          onConfirm={confirmRemove}
        />
      )}
    </SadbPage>
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
