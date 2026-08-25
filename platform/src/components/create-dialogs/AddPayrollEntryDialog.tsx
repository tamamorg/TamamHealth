'use client';

/**
 * Add a payroll entry. Shared by /hr/payroll and the "Add" menu, which opens
 * it in place wherever the user is and routes to /hr/payroll only once the
 * entry exists — see AddInquiryDialog for the reasoning.
 */

import { useMemo, useState } from 'react';
import { X } from '@/components/icons/lucide';
import Modal from '@/components/Modal';
import Select from '@/components/Select';
import { useAuth } from '@/lib/context';
import { useUsers } from '@/lib/hooks/useUsers';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { formatMoney } from '@/lib/format-utils';
import { stopsClickPropagation } from '@/lib/a11y';

export interface AddPayrollEntryDialogProps {
  onClose: () => void;
  /** Period (YYYY-MM) the entry belongs to. Defaults to the current month. */
  period?: string;
  /** Runs with the entry's period once it is written. */
  onCreated: (period: string) => void;
}

export default function AddPayrollEntryDialog({ onClose, period, onCreated }: AddPayrollEntryDialogProps) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { users } = useUsers();
  const { showToast } = useToast();
  const entryPeriod = period || new Date().toISOString().slice(0, 7);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    userId: '', baseSalary: 0, allowances: 0, deductions: 0, currency: 'SSP', notes: '',
  });

  const facilityId = currentUser?.hospitalId;
  const facilityUsers = useMemo(
    () => facilityId ? users.filter(u => u.hospitalId === facilityId) : users,
    [users, facilityId],
  );

  const submit = async () => {
    const user = users.find(u => u._id === form.userId);
    if (!user) { showToast(t('hr.selectStaffMember'), 'error'); return; }
    if (form.baseSalary <= 0) { showToast(t('hr.baseSalaryPositive'), 'error'); return; }
    setSaving(true);
    try {
      const { createPayrollEntry } = await import('@/lib/services/payroll-service');
      await createPayrollEntry({
        userId: user._id, userName: user.name, role: user.role,
        facilityId: user.hospitalId || facilityId || '',
        facilityName: user.hospitalName || currentUser?.hospitalName || t('hr.defaultFacility'),
        period: entryPeriod,
        baseSalary: form.baseSalary,
        allowances: form.allowances,
        deductions: form.deductions,
        currency: form.currency,
        notes: form.notes || undefined,
        orgId: user.orgId,
      });
      showToast(t('hr.payrollEntryCreatedFor', { name: user.name }), 'success');
      onCreated(entryPeriod);
    } catch (err) {
      console.error(err);
      showToast(t('hr.payrollCreateFailed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} width={448}>
      <div className="modal-content card-elevated p-6 w-full" {...stopsClickPropagation}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold">{t('hr.addPayrollEntryPeriod', { period: entryPeriod })}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }} title="Close" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelStaffRequired')}</label>
            <Select value={form.userId} onChange={e => setForm({ ...form, userId: e.target.value })}>
              <option value="">{t('hr.selectStaffOption')}</option>
              {facilityUsers.map(u => (
                <option key={u._id} value={u._id}>{u.name} ({u.role.replace(/_/g, ' ')})</option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelCurrency')}</label>
              <Select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}>
                <option value="SSP">SSP</option><option value="USD">USD</option><option value="KES">KES</option>
              </Select>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelBaseSalary')}</label>
              <input type="number" min={0} value={form.baseSalary || ''} onChange={e => setForm({ ...form, baseSalary: parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelAllowances')}</label>
              <input type="number" min={0} value={form.allowances || ''} onChange={e => setForm({ ...form, allowances: parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelDeductions')}</label>
              <input type="number" min={0} value={form.deductions || ''} onChange={e => setForm({ ...form, deductions: parseFloat(e.target.value) || 0 })} />
            </div>
          </div>
          <div className="px-3 py-2 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
            <div className="flex justify-between text-[12px]">
              <span style={{ color: 'var(--text-muted)' }}>{t('hr.netPay')}</span>
              <span className="font-bold font-mono" style={{ color: 'var(--color-success-text)' }}>
                {formatMoney(form.baseSalary + form.allowances - form.deductions, { currency: form.currency })}
              </span>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelNotes')}</label>
            <textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <hr className="section-divider" />
        <div className="flex gap-2 mt-2">
          <button onClick={onClose} className="btn btn-secondary flex-1" disabled={saving}>{t('hr.cancel')}</button>
          <button onClick={submit} className="btn btn-primary flex-1" disabled={saving}>{t('hr.addEntry')}</button>
        </div>
      </div>
    </Modal>
  );
}
