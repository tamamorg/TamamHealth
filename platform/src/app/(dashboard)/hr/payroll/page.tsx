'use client';

/**
 * Payroll — one of the four independent Staff & HR routes (see
 * ../hr-shared.tsx). Owns one period's register and its status transitions.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Plus, Wallet } from '@/components/icons/lucide';
import AddPayrollEntryDialog from '@/components/create-dialogs/AddPayrollEntryDialog';
import EhrListHeader, { EhrListHeaderButton } from '@/components/ehr/EhrListHeader';
import RowStatusSelect from '@/components/ehr/RowStatusSelect';
import EmptyState from '@/components/EmptyState';
import { formatMoney } from '@/lib/format-utils';
import type { PayrollEntryDoc } from '@/lib/db-types-hr';
import type { PayrollSummary } from '@/lib/services/payroll-service';
import {
  HrPageShell, PAYROLL_STATUS_TOKENS, StaffIdentity, formatHrDate,
  statusPillStyle, useHrContext, useUrlParams,
} from '../hr-shared';

// Columns: Staff · Earnings · Deductions · Net pay · Status — five, matching
// the patient registry exactly, so the template comes from
// `.appointment-card-flow` and is never restated here. Base salary and
// allowances share the Earnings column (value + subline) rather than taking a
// track each: the register keeps every figure, the row keeps the registry's
// shape.

/** Money columns right-align, so their head labels do too. */
const MONEY_HEAD = { justifySelf: 'end' } as const;
const MONEY_CELL = { textAlign: 'right' } as const;

/** What share of gross the deductions take. Gross can legitimately be zero on
 *  a scaffolded entry, so guard the divide rather than printing NaN%. */
const deductionShare = (e: PayrollEntryDoc) => {
  const gross = e.baseSalary + e.allowances;
  return gross > 0 ? `${Math.round((e.deductions / gross) * 100)}% of gross` : 'No gross pay';
};

/** Where an entry sits in the register, for the cue under the status pill —
 *  the pill names the state, this says what it means for the payment. */
const PAYROLL_CUE: Record<PayrollEntryDoc['status'], string> = {
  draft: 'Not yet approved',
  approved: 'Awaiting payment',
  paid: 'Paid',
  reversed: 'Payment reversed',
};

export default function HrPayrollPage() {
  const { t, currentUser, isApprover, showToast } = useHrContext();
  const searchParams = useSearchParams();
  const updateUrlParams = useUrlParams('/hr/payroll');

  const [payroll, setPayroll] = useState<PayrollEntryDoc[]>([]);
  const [summary, setSummary] = useState<PayrollSummary | null>(null);
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [open, setOpen] = useState(false);

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
      <div className="card-elevated overflow-hidden flex flex-col" style={{ flex: 1, minHeight: 0 }}>
        <EhrListHeader
          title="Payroll register"
          stats={summary ? [
            { label: t('hr.pillEntries'), value: summary.total, color: 'var(--text-muted)' },
            { label: t('hr.pillGross'), value: formatMoney(summary.totalGross), color: 'var(--accent-primary)' },
            { label: t('hr.pillDeductions'), value: formatMoney(summary.totalDeductions), color: 'var(--color-warning-text)' },
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
              <EhrListHeaderButton primary onClick={() => setOpen(true)} ariaLabel={t('hr.addPayrollEntry')}>
                <Plus className="w-4 h-4" color="#fff" />
              </EhrListHeaderButton>
            </>
          }
        />
        {/* The patient registry's list, exactly: the same surface + flow
            wrappers, so the column template, 14px gutters and 16px side inset
            all come from `.appointment-card-flow` rather than being restated
            here. Five columns and no actions gutter — the row's actions live
            in its status pill. */}
        <div className="appointment-card-surface patients-list-surface">
          <div className="appointment-card-flow">
            {/* The column head is the register's frame, not a label for the
                rows that happen to be loaded: it stays put for a period with
                no entries, so the list never collapses into a bare message. */}
            <div className="appointment-card-head" aria-hidden="true">
              <span>{t('hr.colStaff')}</span>
              <span style={MONEY_HEAD}>{t('hr.pillGross')}</span>
              <span style={MONEY_HEAD}>{t('hr.colDeductions')}</span>
              <span style={MONEY_HEAD}>{t('hr.colNetPay')}</span>
              <span>{t('hr.colStatus')}</span>
            </div>
            {payroll.length === 0 && (
              <EmptyState
                icon={Wallet}
                title="No payroll entries"
                message={`${t('hr.noPayrollEntries', { period })} ${t('hr.addPayrollEntry')} ${t('hr.aboveToStartRegister')}`}
                action={{ label: t('hr.addPayrollEntry'), onClick: () => setOpen(true) }}
              />
            )}
            {payroll.map(e => {
              const tok = PAYROLL_STATUS_TOKENS[e.status];
              return (
                <div key={e._id} className="ehr-appointment-row appointment-card-row" style={{ cursor: 'default' }}>
                  <StaffIdentity name={e.userName} sub={e.role.replace(/_/g, ' ')} capitalizeSub />

                  {/* Earnings — base salary, with the allowances that top it
                      up on the subline, so both survive the five-column
                      shape. Signs and colour coding are the register's. */}
                  <div className="appointment-card-provider tabular-nums" style={MONEY_CELL}>
                    <strong>{formatMoney(e.baseSalary, { currency: e.currency })}</strong>
                    <span style={{ color: 'var(--accent-primary)' }}>+{formatMoney(e.allowances, { currency: e.currency })} {t('hr.colAllowances').toLowerCase()}</span>
                  </div>
                  {/* Sublines carry what the column heading doesn't: the bite
                      deductions take, and which period the entry belongs to. */}
                  <div className="appointment-card-provider tabular-nums" style={MONEY_CELL}>
                    <strong style={{ color: 'var(--color-warning-text)' }}>−{formatMoney(e.deductions, { currency: e.currency })}</strong>
                    <span>{deductionShare(e)}</span>
                  </div>
                  <div className="appointment-card-provider tabular-nums" style={MONEY_CELL}>
                    <strong style={{ color: 'var(--color-success-text)' }}>{formatMoney(e.netPay, { currency: e.currency })}</strong>
                    <span>{formatHrDate(`${e.period}-01`, { month: 'short', year: 'numeric' })}</span>
                  </div>

                  {/* Approve / mark paid / reverse are all status moves, so
                      the pill carries them. A non-approver gets the plain
                      read-only pill. */}
                  <div className="appointment-card-status">
                    <RowStatusSelect
                      label={t(`hr.payrollStatus_${e.status}`)}
                      value={e.status}
                      ariaLabel={`Payroll status for ${e.userName}`}
                      style={statusPillStyle(tok)}
                      options={!isApprover ? [] : [
                        ...(e.status === 'draft' ? [{ value: 'approved', label: t('hr.approve') }] : []),
                        ...(e.status === 'approved' ? [{ value: 'paid', label: t('hr.markPaid') }] : []),
                        ...(e.status === 'paid' ? [{ value: 'reversed', label: t('hr.reverse') }] : []),
                      ]}
                      onSelect={next => setPayStatus(e._id, next as PayrollEntryDoc['status'])}
                    />
                    <small title={e.notes || undefined}>
                      {e.paidAt
                        ? `Paid ${formatHrDate(e.paidAt, { month: 'short', day: 'numeric' })}`
                        : e.notes || PAYROLL_CUE[e.status]}
                    </small>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {open && (
        <AddPayrollEntryDialog
          onClose={() => setOpen(false)}
          period={period}
          onCreated={() => { setOpen(false); reload(); }}
        />
      )}
    </HrPageShell>
  );
}
