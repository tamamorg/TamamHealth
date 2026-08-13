'use client';

/**
 * Payroll — one of the four independent Staff & HR routes (see
 * ../hr-shared.tsx). Owns one period's register and its status transitions.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Plus, Wallet, X } from '@/components/icons/lucide';
import Modal from '@/components/Modal';
import RowActionsMenu from '@/components/RowActionsMenu';
import EhrListHeader from '@/components/ehr/EhrListHeader';
import EmptyState from '@/components/EmptyState';
import Select from '@/components/Select';
import { formatMoney } from '@/lib/format-utils';
import type { PayrollEntryDoc } from '@/lib/db-types-hr';
import type { PayrollSummary } from '@/lib/services/payroll-service';
import { HrPageShell, PAYROLL_STATUS_TOKENS, StaffCell, Th, useHrContext, useUrlParams } from '../hr-shared';

export default function HrPayrollPage() {
  const { t, currentUser, users, facilityUsers, facilityId, facilityName, isApprover, showToast } = useHrContext();
  const searchParams = useSearchParams();
  const updateUrlParams = useUrlParams('/hr/payroll');

  const [payroll, setPayroll] = useState<PayrollEntryDoc[]>([]);
  const [summary, setSummary] = useState<PayrollSummary | null>(null);
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    userId: '', baseSalary: 0, allowances: 0, deductions: 0, currency: 'SSP', notes: '',
  });

  const reload = useCallback(async () => {
    const { getPayrollByPeriod, getPayrollSummary } = await import('@/lib/services/payroll-service');
    const [list, sum] = await Promise.all([
      getPayrollByPeriod(period),
      getPayrollSummary(period),
    ]);
    setPayroll(list);
    setSummary(sum);
  }, [period]);
  useEffect(() => { reload(); }, [reload]);

  // `?new=1` — open the create modal on arrival, then strip the param.
  useEffect(() => {
    if (searchParams?.get('new') !== '1') return;
    setOpen(true);
    updateUrlParams({ new: null });
  }, [searchParams, updateUrlParams]);

  const handleAddPayroll = async () => {
    const user = users.find(u => u._id === form.userId);
    if (!user) { showToast(t('hr.selectStaffMember'), 'error'); return; }
    if (form.baseSalary <= 0) { showToast(t('hr.baseSalaryPositive'), 'error'); return; }
    try {
      const { createPayrollEntry } = await import('@/lib/services/payroll-service');
      await createPayrollEntry({
        userId: user._id, userName: user.name, role: user.role,
        facilityId: user.hospitalId || facilityId || '',
        facilityName: user.hospitalName || facilityName,
        period,
        baseSalary: form.baseSalary,
        allowances: form.allowances,
        deductions: form.deductions,
        currency: form.currency,
        notes: form.notes || undefined,
        orgId: user.orgId,
      });
      showToast(t('hr.payrollEntryCreatedFor', { name: user.name }), 'success');
      setOpen(false);
      setForm({ userId: '', baseSalary: 0, allowances: 0, deductions: 0, currency: 'SSP', notes: '' });
      reload();
    } catch (err) {
      console.error(err);
      showToast(t('hr.payrollCreateFailed'), 'error');
    }
  };

  const setPayStatus = async (id: string, status: PayrollEntryDoc['status']) => {
    if (!currentUser) return;
    try {
      const { setPayrollStatus } = await import('@/lib/services/payroll-service');
      await setPayrollStatus(id, status, {
        id: currentUser._id || currentUser.username || 'unknown',
        name: currentUser.name,
      });
      reload();
    } catch {
      showToast(t('hr.payrollStatusFailed'), 'error');
    }
  };

  return (
    <HrPageShell>
      <div className="dash-card overflow-hidden flex flex-col" style={{ flex: 1, minHeight: 0 }}>
        <EhrListHeader
          title="Payroll register"
          stats={summary ? [
            { label: t('hr.pillEntries'), value: summary.total, color: 'var(--text-muted)' },
            { label: t('hr.pillGross'), value: formatMoney(summary.totalGross), color: '#2191D0' },
            { label: t('hr.pillDeductions'), value: formatMoney(summary.totalDeductions), color: '#B8741C' },
            { label: t('hr.pillNet'), value: formatMoney(summary.totalNet), color: 'var(--color-success)' },
            { label: t('hr.pillPaid'), value: `${summary.paid}/${summary.total}`, color: 'var(--color-success)' },
          ] : [{ label: t('hr.pillEntries'), value: payroll.length, color: 'var(--text-muted)' }]}
          actions={
            <>
              <input
                type="month"
                value={period}
                onChange={e => setPeriod(e.target.value)}
                aria-label={t('hr.period')}
                className="listpage-toolbar-date"
                style={{ flex: 1, minWidth: 0 }}
              />
              <button type="button" className="listpage-icon-btn listpage-icon-btn-primary" onClick={() => setOpen(true)} title={t('hr.addPayrollEntry')} aria-label={t('hr.addPayrollEntry')}>
                <Plus className="w-4 h-4" color="#fff" />
              </button>
            </>
          }
        />
        <div className="show-scrollbar" style={{ overflowX: 'auto', overflowY: 'auto', flex: '1 1 0%', minHeight: 0 }}>
          <table className="w-full" style={{ minWidth: 840 }}>
            <thead>
              <tr>
                <Th>{t('hr.colStaff')}</Th>
                <Th right>{t('hr.colBase')}</Th>
                <Th right>{t('hr.colAllowances')}</Th>
                <Th right>{t('hr.colDeductions')}</Th>
                <Th right>{t('hr.colNetPay')}</Th>
                <Th>{t('hr.colStatus')}</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {payroll.map(e => {
                const tok = PAYROLL_STATUS_TOKENS[e.status];
                return (
                  <tr key={e._id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <td className="px-4 py-2.5"><StaffCell name={e.userName} sub={e.role.replace(/_/g, ' ')} /></td>
                    <td className="px-4 py-2.5 text-[13px] text-right font-mono" style={{ color: 'var(--ehr-muted, var(--text-secondary))' }}>{formatMoney(e.baseSalary, { currency: e.currency })}</td>
                    <td className="px-4 py-2.5 text-[13px] text-right font-mono" style={{ color: 'var(--accent-primary)' }}>+{formatMoney(e.allowances, { currency: e.currency })}</td>
                    <td className="px-4 py-2.5 text-[13px] text-right font-mono" style={{ color: 'var(--color-warning-text)' }}>-{formatMoney(e.deductions, { currency: e.currency })}</td>
                    <td className="px-4 py-2.5 text-[13px] text-right font-mono font-bold" style={{ color: 'var(--color-success-text)' }}>{formatMoney(e.netPay, { currency: e.currency })}</td>
                    <td className="px-4 py-2.5">
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-md" style={{ background: tok.bg, color: tok.color, border: `1px solid ${tok.color}40` }}>
                        {t(`hr.payrollStatus_${e.status}`)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end">
                        <RowActionsMenu
                          actions={[
                            ...(e.status === 'draft' && isApprover ? [{ key: 'approve', label: t('hr.approve'), tone: 'success' as const, onClick: () => setPayStatus(e._id, 'approved') }] : []),
                            ...(e.status === 'approved' && isApprover ? [{ key: 'paid', label: t('hr.markPaid'), tone: 'success' as const, onClick: () => setPayStatus(e._id, 'paid') }] : []),
                            ...(e.status === 'paid' && isApprover ? [{ key: 'reverse', label: t('hr.reverse'), onClick: () => setPayStatus(e._id, 'reversed') }] : []),
                          ]}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {payroll.length === 0 && (
            <EmptyState
              icon={Wallet}
              title="No payroll entries"
              message={`${t('hr.noPayrollEntries', { period })} ${t('hr.addPayrollEntry')} ${t('hr.aboveToStartRegister')}`}
              action={{ label: t('hr.addPayrollEntry'), onClick: () => setOpen(true) }}
            />
          )}
        </div>
      </div>

      {open && (
        <Modal onClose={() => setOpen(false)}>
          <div className="modal-content card-elevated p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold">{t('hr.addPayrollEntryPeriod', { period })}</h3>
              <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }} title="Close" aria-label="Close">
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
                <div className="flex justify-between text-[12px]"><span style={{ color: 'var(--text-muted)' }}>{t('hr.netPay')}</span><span className="font-bold font-mono" style={{ color: 'var(--color-success-text)' }}>{formatMoney(form.baseSalary + form.allowances - form.deductions, { currency: form.currency })}</span></div>
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelNotes')}</label>
                <textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>
            <hr className="section-divider" />
            <div className="flex gap-2 mt-2">
              <button onClick={() => setOpen(false)} className="btn btn-secondary flex-1">{t('hr.cancel')}</button>
              <button onClick={handleAddPayroll} className="btn btn-primary flex-1">{t('hr.addEntry')}</button>
            </div>
          </div>
        </Modal>
      )}
    </HrPageShell>
  );
}
