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

import { useEffect, useState, useCallback, useRef } from 'react';
import Modal from '@/components/Modal';
import { DialogBody, DialogFooter, DialogFrame, DialogHeader } from '@/components/overlay/Dialog';
import { useAuth } from '@/lib/context';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useToast } from '@/components/Toast';
import { Plus, Save } from '@/components/icons/lucide';
import {
  SadbPage, SadbCard, SadbSearch, SadbGridList, SadbGridRow, SadbChip, SadbConfirmModal,
} from '@/components/admin/sadb-ui';
import { getFeeSchedule, type FeeInput } from '@/lib/services/fee-schedule-service';
import { apiFetch } from '@/lib/api-fetch';
import { getSyncManager } from '@/lib/sync/sync-manager';
import type { FeeScheduleDoc, ChargeCategory, BillingUnit } from '@/lib/db-types-billing';
import { formatMoney } from '@/lib/format-utils';
import Select from '@/components/Select';
import { useTranslation } from '@/lib/i18n/useTranslation';

const CATEGORIES: { value: ChargeCategory; label: string }[] = [
  { value: 'consultation', label: 'Consultation' },
  { value: 'laboratory', label: 'Laboratory' },
  { value: 'pharmacy', label: 'Pharmacy' },
  { value: 'radiology', label: 'Radiology / Imaging' },
  { value: 'procedure', label: 'Procedure' },
  { value: 'bed_charge', label: 'Bed / Ward charge' },
  { value: 'admission_deposit', label: 'Admission deposit' },
  { value: 'surgery', label: 'Surgery' },
  { value: 'dental', label: 'Dental' },
  { value: 'dialysis', label: 'Dialysis' },
  { value: 'optical', label: 'Optical' },
  { value: 'cardiac_diagnostics', label: 'Cardiac diagnostics' },
  { value: 'mental_health', label: 'Mental health' },
  { value: 'theatre', label: 'Theatre' },
  { value: 'rehabilitation', label: 'Physiotherapy / rehabilitation' },
  { value: 'ambulance', label: 'Ambulance' },
  { value: 'other', label: 'Other' },
];

const emptyForm = (): FeeInput & { isActive: boolean } => ({
  facilityId: '', facilityName: '', category: 'consultation',
  serviceCode: '', serviceName: '', unitPrice: 0, billingUnit: 'each', currency: 'SSP', isActive: true,
});

/* Service · Code · Category · Price · Status */
const FEE_GRID = 'minmax(200px, 1.6fr) minmax(110px, 0.8fr) minmax(130px, 1fr) minmax(120px, 0.9fr) minmax(90px, 0.7fr)';

export default function ServicePricingPage() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const scope = useDataScope();
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

  // The catalog is server-written (its replication is pull-only), so a saved
  // edit reaches this device by pull. Until it lands, show what the server
  // confirmed: id -> the confirmed doc, or null once confirmed deleted.
  const confirmed = useRef(new Map<string, FeeScheduleDoc | null>());

  // Ask the server to change the catalog. Never writes the local database:
  // a local-only edit would look saved and be silently invisible to everyone
  // else's charges. Offline = an error, not a local write.
  const callFeeApi = useCallback(async (payload: Record<string, unknown>): Promise<{ fee?: FeeScheduleDoc; id?: string } | null> => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
    try {
      const res = await apiFetch('/api/fee-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (!scope) return;
      const local = await getFeeSchedule(scope);
      const byId = new Map(local.map(f => [f._id, f]));
      for (const [id, doc] of confirmed.current) {
        const have = byId.get(id);
        if (doc === null) {
          byId.delete(id);
        } else if (!have || (have.updatedAt || '') < (doc.updatedAt || '')) {
          byId.set(id, doc);
        } else {
          confirmed.current.delete(id); // pull caught up
        }
      }
      setFees(Array.from(byId.values()).sort((a, b) => (a.category + a.serviceName).localeCompare(b.category + b.serviceName)));
    } catch {
      showToast(t('msg.priceCatalogNotLoadedReload'), 'error');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.orgId, currentUser?.hospitalId, currentUser?.role, scope]);

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
      billingUnit: fee.billingUnit || 'each', currency: fee.currency, isActive: fee.isActive,
    });
    setEditingId(fee._id);
    setShowForm(true);
  };

  const save = async () => {
    if (!form.serviceName.trim() || form.unitPrice < 0) {
      showToast(t('msg.enterAServiceNameAnd'), 'error');
      return;
    }
    setSaving(true);
    try {
      // orgId is deliberately not sent: the server stamps it from the session.
      const { isActive, ...rest } = form;
      const result = editingId
        ? await callFeeApi({ action: 'update', id: editingId, fee: { ...rest, isActive } })
        : await callFeeApi({ action: 'create', fee: { ...rest, isActive } });
      if (!result?.fee) {
        showToast(t('msg.priceNotSavedTryAgain'), 'error');
        return;
      }
      confirmed.current.set(result.fee._id, result.fee);
      showToast(editingId ? t('msg.priceUpdated') : t('msg.serviceAddedToThePrice'), 'success');
      setShowForm(false);
      void getSyncManager()?.syncNow().catch(() => undefined);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const confirmRemove = async () => {
    if (!removingFee) return;
    const result = await callFeeApi({ action: 'delete', id: removingFee._id });
    if (!result) {
      showToast(t('msg.serviceNotRemovedTryAgain'), 'error');
      return;
    }
    confirmed.current.set(removingFee._id, null);
    showToast(t('msg.serviceRemovedFromThePrice'), 'success');
    setRemovingFee(null);
    setShowForm(false);
    void getSyncManager()?.syncNow().catch(() => undefined);
    await load();
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
        <Modal variant="slider" onClose={() => setShowForm(false)} width={460} labelledBy="fee-form-title">
          <DialogFrame>
            <DialogHeader
              titleId="fee-form-title"
              title={editingId ? 'Edit service price' : 'Add service price'}
              onClose={() => setShowForm(false)}
            />
            <DialogBody tight>
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
              <div className="grid grid-cols-3 gap-3">
                <Field label="Price">
                  <input className="sadb-modal-input" type="number" step="any" min={0} value={form.unitPrice} onChange={e => setForm({ ...form, unitPrice: Number(e.target.value) })} />
                </Field>
                <Field label="Currency">
                  <input className="sadb-modal-input" value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} />
                </Field>
                <Field label="Unit">
                  <Select className="sadb-modal-input" value={form.billingUnit || 'each'} onChange={e => setForm({ ...form, billingUnit: e.target.value as BillingUnit })}>
                    {(['each', 'session', 'night', 'procedure', 'item'] as BillingUnit[]).map(unit => <option key={unit} value={unit}>{unit}</option>)}
                  </Select>
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)', textTransform: 'none' }}>
                <input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} />
                Active (available for charging)
              </label>
            </div>
            </DialogBody>
            <DialogFooter
              start={editingId && (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => setRemovingFee(editingFee)}
                >
                  Remove service
                </button>
              )}
            >
              <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
                <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save'}
              </button>
            </DialogFooter>
          </DialogFrame>
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
