'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Modal from '@/components/Modal';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Users, Plus, X, Trash2, Download, ClipboardList, CalendarClock, Wallet,
} from '@/components/icons/lucide';
import RowActionsMenu from '@/components/RowActionsMenu';
import EhrListHeader, { EhrListHeaderButton, EhrListFilters } from '@/components/ehr/EhrListHeader';
import { useAuth } from '@/lib/context';
import { useUsers } from '@/lib/hooks/useUsers';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { LeaveRequestDoc, LeaveType, PayrollEntryDoc } from '@/lib/db-types-hr';
import type { LeaveSummary } from '@/lib/services/leave-service';
import type { PayrollSummary } from '@/lib/services/payroll-service';
import type { StaffScheduleDoc } from '@/lib/db-types';
import { formatMoney } from '@/lib/format-utils';
import Select from '@/components/Select';

const LEAVE_TYPES: { id: LeaveType; label: string }[] = [
  { id: 'annual', label: 'Annual' },
  { id: 'sick', label: 'Sick' },
  { id: 'maternity', label: 'Maternity' },
  { id: 'paternity', label: 'Paternity' },
  { id: 'compassionate', label: 'Compassionate' },
  { id: 'study', label: 'Study' },
  { id: 'unpaid', label: 'Unpaid' },
];

const STATUS_TOKENS: Record<LeaveRequestDoc['status'], { label: string; color: string; bg: string }> = {
  pending:   { label: 'Pending',   color: 'var(--color-warning-text)', bg: 'rgba(228, 168, 75, 0.16)' },
  approved:  { label: 'Approved',  color: 'var(--color-success-text)', bg: 'rgba(27, 158, 119, 0.12)' },
  rejected:  { label: 'Rejected',  color: 'var(--color-danger-500)', bg: 'rgba(196, 69, 54, 0.14)' },
  cancelled: { label: 'Cancelled', color: '#5A7370', bg: 'rgba(90, 115, 112, 0.14)' },
  taken:     { label: 'Taken',     color: 'var(--accent-primary)', bg: 'rgba(33, 145, 208, 0.14)' },
};

const PAYROLL_STATUS_TOKENS: Record<PayrollEntryDoc['status'], { label: string; color: string; bg: string }> = {
  draft:    { label: 'Draft',    color: '#5A7370', bg: 'rgba(90, 115, 112, 0.14)' },
  approved: { label: 'Approved', color: 'var(--accent-primary)', bg: 'rgba(33, 145, 208, 0.14)' },
  paid:     { label: 'Paid',     color: 'var(--color-success-text)', bg: 'rgba(27, 158, 119, 0.14)' },
  reversed: { label: 'Reversed', color: 'var(--color-danger-500)', bg: 'rgba(196, 69, 54, 0.14)' },
};

const SHIFT_TYPES: StaffScheduleDoc['shiftType'][] = ['morning', 'afternoon', 'night', 'on_call'];

type TabId = 'roster' | 'leave' | 'schedule' | 'payroll';

const staffInitials = (name: string) =>
  name.split(' ').filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?';

function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return (
    <th className={`${right ? 'text-right' : 'text-left'} px-4 py-2.5`} style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-light)', background: 'var(--bg-card-solid)' }}>
      <span className="text-[11px] font-bold uppercase tracking-wider whitespace-nowrap">{children}</span>
    </th>
  );
}

/** Staff table cell — 40px square avatar + 14/800 name + muted subline.
 *  `capitalizeSub` for role sublines ("front desk" → "Front Desk"); off for
 *  usernames, which must keep their exact casing. */
function StaffCell({ name, sub, capitalizeSub = false }: { name: string; sub?: string; capitalizeSub?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <div className="ehr-patient-icon">{staffInitials(name)}</div>
      <div className="min-w-0">
        <div className="text-[14px] truncate" style={{ color: 'var(--ehr-text, var(--text-primary))', fontWeight: 800 }}>{name}</div>
        {sub && <div className={`text-[11px] truncate ${capitalizeSub ? 'capitalize' : ''}`.trim()} style={{ color: 'var(--text-muted)' }}>{sub}</div>}
      </div>
    </div>
  );
}

export default function HRPage() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { users } = useUsers();
  const { showToast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialTab = (searchParams?.get('tab') as TabId) || 'roster';
  const [tab, setTab] = useState<TabId>(initialTab);

  // Roster search + role filter
  const [rosterSearch, setRosterSearch] = useState('');
  const [rosterRole, setRosterRole] = useState('all');
  // Leave-request search (same toolbar pattern as the roster).
  const [leaveSearch, setLeaveSearch] = useState('');

  // Sync tab → URL so deep links from dashboard work both ways
  useEffect(() => { setTab((searchParams?.get('tab') as TabId) || 'roster'); }, [searchParams]);

  const setTabAndUrl = (next: TabId) => {
    setTab(next);
    const params = new URLSearchParams(searchParams?.toString() || '');
    params.set('tab', next);
    router.replace(`/hr?${params.toString()}`, { scroll: false });
  };

  // ── Leave state ─────────────────────────────────────────────────────
  const [leave, setLeave] = useState<LeaveRequestDoc[]>([]);
  const [leaveSummary, setLeaveSummary] = useState<LeaveSummary | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveForm, setLeaveForm] = useState({
    userId: '', leaveType: 'annual' as LeaveType,
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    reason: '',
  });

  // ── Schedule state ──────────────────────────────────────────────────
  const [schedules, setSchedules] = useState<StaffScheduleDoc[]>([]);
  const [scheduleDate, setScheduleDate] = useState(new Date().toISOString().slice(0, 10));
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    userId: '',
    shiftType: 'morning' as StaffScheduleDoc['shiftType'],
    shiftDate: new Date().toISOString().slice(0, 10),
    startTime: '08:00',
    endTime: '16:00',
    department: '',
    isOnCall: false,
    notes: '',
  });

  // ── Payroll state ───────────────────────────────────────────────────
  const [payroll, setPayroll] = useState<PayrollEntryDoc[]>([]);
  const [payrollSummary, setPayrollSummary] = useState<PayrollSummary | null>(null);
  const [payrollPeriod, setPayrollPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [payrollOpen, setPayrollOpen] = useState(false);
  const [payrollForm, setPayrollForm] = useState({
    userId: '', baseSalary: 0, allowances: 0, deductions: 0, currency: 'SSP', notes: '',
  });

  const facilityId = currentUser?.hospitalId;
  const facilityName = currentUser?.hospitalName || t('hr.defaultFacility');
  const isApprover = currentUser?.role && ['org_admin', 'medical_superintendent', 'hospital_manager', 'super_admin'].includes(currentUser.role);
  // Account creation is restricted to the two admin roles (WRITE_ROLES in
  // /api/users) — showing the button to anyone else would just 403.
  const canCreateUsers = currentUser?.role === 'super_admin' || currentUser?.role === 'org_admin';

  // ── Loaders ─────────────────────────────────────────────────────────
  const reloadLeave = useCallback(async () => {
    const { getAllLeaveRequests, getLeaveSummary } = await import('@/lib/services/leave-service');
    const [list, sum] = await Promise.all([getAllLeaveRequests(), getLeaveSummary()]);
    setLeave(list);
    setLeaveSummary(sum);
  }, []);

  const reloadSchedules = useCallback(async () => {
    const { getSchedulesByDate } = await import('@/lib/services/staff-scheduling-service');
    setSchedules(await getSchedulesByDate(scheduleDate, facilityId));
  }, [scheduleDate, facilityId]);

  const reloadPayroll = useCallback(async () => {
    const { getPayrollByPeriod, getPayrollSummary } = await import('@/lib/services/payroll-service');
    const [list, sum] = await Promise.all([
      getPayrollByPeriod(payrollPeriod),
      getPayrollSummary(payrollPeriod),
    ]);
    setPayroll(list);
    setPayrollSummary(sum);
  }, [payrollPeriod]);

  useEffect(() => { reloadLeave(); }, [reloadLeave]);
  useEffect(() => { reloadSchedules(); }, [reloadSchedules]);
  useEffect(() => { reloadPayroll(); }, [reloadPayroll]);

  const facilityUsers = useMemo(
    () => facilityId ? users.filter(u => u.hospitalId === facilityId) : users,
    [users, facilityId],
  );

  const roleCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const u of facilityUsers) counts[u.role] = (counts[u.role] || 0) + 1;
    return counts;
  }, [facilityUsers]);

  const filteredRosterUsers = useMemo(() => {
    const q = rosterSearch.trim().toLowerCase();
    return facilityUsers.filter(u => {
      if (rosterRole !== 'all' && u.role !== rosterRole) return false;
      if (!q) return true;
      return (
        u.name.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q) ||
        u.role.replace(/_/g, ' ').toLowerCase().includes(q) ||
        (u.hospitalName || '').toLowerCase().includes(q)
      );
    });
  }, [facilityUsers, rosterSearch, rosterRole]);

  // Export the currently filtered roster to CSV.
  const handleDownloadCsv = () => {
    const header = ['Name', 'Role', 'Username', 'Facility', 'Status'];
    const rows = filteredRosterUsers.map(u => [
      u.name,
      u.role.replace(/_/g, ' '),
      u.username,
      u.hospitalName || '',
      u.isActive === false ? 'Inactive' : 'Active',
    ]);
    const csv = [header, ...rows]
      .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'staff-roster.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  // ── Handlers ────────────────────────────────────────────────────────
  const handleRequestLeave = async () => {
    if (!leaveForm.userId) { showToast(t('hr.selectStaffMember'), 'error'); return; }
    if (leaveForm.endDate < leaveForm.startDate) { showToast(t('hr.endDateAfterStart'), 'error'); return; }
    const user = users.find(u => u._id === leaveForm.userId);
    if (!user) return;
    try {
      const { requestLeave } = await import('@/lib/services/leave-service');
      await requestLeave({
        userId: user._id, userName: user.name, role: user.role,
        facilityId: user.hospitalId || facilityId || '',
        facilityName: user.hospitalName || facilityName,
        leaveType: leaveForm.leaveType,
        startDate: leaveForm.startDate, endDate: leaveForm.endDate,
        reason: leaveForm.reason.trim() || undefined,
        orgId: user.orgId,
      });
      showToast(t('hr.leaveSubmittedFor', { name: user.name }), 'success');
      setLeaveOpen(false);
      setLeaveForm({ userId: '', leaveType: 'annual', startDate: new Date().toISOString().slice(0, 10), endDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10), reason: '' });
      reloadLeave();
    } catch (err) {
      console.error(err);
      showToast(t('hr.leaveSubmitFailed'), 'error');
    }
  };

  const decideLeave = async (id: string, status: 'approved' | 'rejected') => {
    if (!currentUser) return;
    try {
      const { decideLeave } = await import('@/lib/services/leave-service');
      await decideLeave(id, {
        status,
        decidedBy: currentUser._id || currentUser.username || 'unknown',
        decidedByName: currentUser.name,
      });
      showToast(status === 'approved' ? t('hr.leaveApproved') : t('hr.leaveRejected'), 'success');
      reloadLeave();
    } catch (err) {
      console.error(err);
      showToast(status === 'approved' ? t('hr.leaveApproveFailed') : t('hr.leaveRejectFailed'), 'error');
    }
  };

  const handleAddShift = async () => {
    const user = users.find(u => u._id === scheduleForm.userId);
    if (!user) { showToast(t('hr.selectStaffMember'), 'error'); return; }
    try {
      const { createSchedule } = await import('@/lib/services/staff-scheduling-service');
      await createSchedule({
        userId: user._id, userName: user.name, role: user.role,
        facilityId: user.hospitalId || facilityId || '',
        facilityName: user.hospitalName || facilityName,
        shiftType: scheduleForm.shiftType,
        shiftDate: scheduleForm.shiftDate,
        startTime: scheduleForm.startTime,
        endTime: scheduleForm.endTime,
        department: scheduleForm.department || undefined,
        isOnCall: scheduleForm.isOnCall,
        notes: scheduleForm.notes || undefined,
        status: 'scheduled',
        orgId: user.orgId,
      });
      showToast(t('hr.shiftScheduledFor', { name: user.name, shift: scheduleForm.shiftType }), 'success');
      setScheduleOpen(false);
      setScheduleForm({ ...scheduleForm, userId: '', notes: '' });
      reloadSchedules();
    } catch (err) {
      console.error(err);
      showToast(t('hr.scheduleCreateFailed'), 'error');
    }
  };

  const removeShift = async (id: string) => {
    try {
      const { deleteSchedule } = await import('@/lib/services/staff-scheduling-service');
      await deleteSchedule(id);
      reloadSchedules();
    } catch {
      showToast(t('hr.shiftRemoveFailed'), 'error');
    }
  };

  const handleAddPayroll = async () => {
    const user = users.find(u => u._id === payrollForm.userId);
    if (!user) { showToast(t('hr.selectStaffMember'), 'error'); return; }
    if (payrollForm.baseSalary <= 0) { showToast(t('hr.baseSalaryPositive'), 'error'); return; }
    try {
      const { createPayrollEntry } = await import('@/lib/services/payroll-service');
      await createPayrollEntry({
        userId: user._id, userName: user.name, role: user.role,
        facilityId: user.hospitalId || facilityId || '',
        facilityName: user.hospitalName || facilityName,
        period: payrollPeriod,
        baseSalary: payrollForm.baseSalary,
        allowances: payrollForm.allowances,
        deductions: payrollForm.deductions,
        currency: payrollForm.currency,
        notes: payrollForm.notes || undefined,
        orgId: user.orgId,
      });
      showToast(t('hr.payrollEntryCreatedFor', { name: user.name }), 'success');
      setPayrollOpen(false);
      setPayrollForm({ userId: '', baseSalary: 0, allowances: 0, deductions: 0, currency: 'SSP', notes: '' });
      reloadPayroll();
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
      reloadPayroll();
    } catch {
      showToast(t('hr.payrollStatusFailed'), 'error');
    }
  };

  const activeStaffCount = facilityUsers.filter(u => u.isActive !== false).length;
  const inactiveStaffCount = facilityUsers.filter(u => u.isActive === false).length;

  const sectionTitles: Record<TabId, string> = {
    roster: 'All staff',
    leave: 'Leave requests',
    schedule: 'Shift schedule',
    payroll: 'Payroll register',
  };

  return (
    <>
      <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0, alignItems: 'stretch' }}>
          {/* ── Section rail — Staff & HR areas as a sidebar (settings-rail style),
              replacing the old pill-tab strip. ── */}
          <aside style={{ width: 224, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="dash-card" style={{ padding: '14px 16px' }}>
              <div className="flex items-center gap-2.5">
                <div className="listpage-header-icon"><Users size={20} /></div>
                <div style={{ minWidth: 0 }}>
                  <p className="listpage-eyebrow" style={{ margin: 0 }}>{currentUser?.hospitalName || 'Clinic'}</p>
                  <h1 style={{ fontSize: 16, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>Staff &amp; HR</h1>
                </div>
              </div>
            </div>
            <nav className="ehr-set-nav" aria-label="Staff & HR sections">
              {([
                { id: 'roster', label: t('hr.staffRoster'), icon: Users },
                { id: 'leave', label: t('hr.leaveRequests'), icon: ClipboardList },
                { id: 'schedule', label: t('hr.shiftSchedule'), icon: CalendarClock },
                { id: 'payroll', label: t('hr.payrollTab'), icon: Wallet },
              ] as { id: TabId; label: string; icon: typeof Users }[]).map(item => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={tab === item.id ? 'active' : undefined}
                    onClick={() => setTabAndUrl(item.id)}
                  >
                    <Icon />
                    <em>{item.label}</em>
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* ── Section content — full-height card in the patients-list layout ── */}
          <section style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0, gap: 12 }}>

        {/* ── ROSTER ──────────────────────────────────────── */}
        {tab === 'roster' && (
          <div className="dash-card overflow-hidden flex flex-col" style={{ flex: 1, minHeight: 0 }}>
            <EhrListHeader
              title={sectionTitles[tab]}
              stats={[
                { label: 'Total staff', value: facilityUsers.length, color: 'var(--text-muted)' },
                { label: 'Active', value: activeStaffCount, color: 'var(--color-success)' },
                { label: 'Inactive', value: inactiveStaffCount, color: 'var(--color-danger)' },
                { label: 'Pending leave requests', value: leaveSummary?.pending ?? 0, color: '#B8741C' },
                { label: 'Shifts scheduled today', value: schedules.length, color: '#2191D0' },
              ]}
              search={{ value: rosterSearch, onChange: setRosterSearch, placeholder: t('hr.searchStaffPlaceholder'), ariaLabel: t('hr.searchStaffPlaceholder') }}
              actions={
                <>
                  <EhrListFilters activeCount={rosterRole !== 'all' ? 1 : 0} onClear={() => setRosterRole('all')}>
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.colRole')}</label>
                      <Select
                        value={rosterRole}
                        onChange={e => setRosterRole(e.target.value)}
                        aria-label={t('hr.colRole')}
                      >
                        <option value="all">{t('hr.allRoles')} ({facilityUsers.length})</option>
                        {Object.entries(roleCounts).sort((a, b) => a[0].localeCompare(b[0])).map(([role, count]) => (
                          <option key={role} value={role} className="capitalize">
                            {role.replace(/_/g, ' ')} ({count})
                          </option>
                        ))}
                      </Select>
                    </div>
                  </EhrListFilters>
                  <EhrListHeaderButton onClick={handleDownloadCsv} ariaLabel="Download">
                    <Download className="w-4 h-4" />
                  </EhrListHeaderButton>
                  {canCreateUsers && (
                    <button
                      type="button"
                      className="listpage-icon-btn listpage-icon-btn-primary"
                      // Same role-aware target as the facility dashboard: a
                      // platform super_admin creates accounts in /admin/users;
                      // an org_admin in their org-scoped page.
                      onClick={() => router.push(currentUser?.role === 'super_admin' ? '/admin/users?new=1' : '/org-admin/users?new=1')}
                      title="Add staff"
                      aria-label="Add staff"
                    >
                      <Plus size={16} color="#fff" />
                    </button>
                  )}
                </>
              }
            />
            <div className="show-scrollbar" style={{ overflowX: 'auto', overflowY: 'auto', flex: '1 1 0%', minHeight: 0 }}>
            <table className="w-full" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  {[t('hr.colStaff'), t('hr.colRole'), t('hr.colUsername'), t('hr.colFacility'), t('hr.colStatus')].map(h => (
                    <Th key={h}>{h}</Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRosterUsers.length === 0 && (
                  <tr><td colSpan={5} className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>
                    {facilityUsers.length === 0 ? t('hr.noStaffForFacility') : t('hr.noStaffMatchFilters')}
                  </td></tr>
                )}
                {filteredRosterUsers.map(u => {
                  return (
                    <tr key={u._id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                      <td className="px-4 py-2.5"><StaffCell name={u.name} sub={`@${u.username}`} /></td>
                      <td className="px-4 py-2.5 text-[13px] capitalize" style={{ color: 'var(--ehr-muted, var(--text-secondary))' }}>{u.role.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-2.5 text-[13px] font-mono" style={{ color: 'var(--ehr-muted, var(--text-secondary))' }}>@{u.username}</td>
                      <td className="px-4 py-2.5 text-[13px]" style={{ color: 'var(--ehr-muted, var(--text-secondary))' }}>{u.hospitalName || '—'}</td>
                      <td className="px-4 py-2.5">
                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-md" style={{
                          background: u.isActive === false ? 'rgba(196, 69, 54, 0.14)' : 'rgba(27, 158, 119, 0.12)',
                          color: u.isActive === false ? 'var(--color-danger-text)' : 'var(--color-success-text)',
                        }}>
                          {u.isActive === false ? t('hr.inactive') : t('hr.active')}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>
        )}

        {/* ── LEAVE ──────────────────────────────────────── */}
        {tab === 'leave' && (() => {
          const q = leaveSearch.trim().toLowerCase();
          const visibleLeave = q
            ? leave.filter(r => `${r.userName} ${r.role} ${r.leaveType} ${r.status}`.toLowerCase().includes(q))
            : leave;
          return (
          <div className="dash-card overflow-hidden flex flex-col" style={{ flex: 1, minHeight: 0 }}>
            <EhrListHeader
              title={sectionTitles.leave}
              stats={[
                { label: 'Total', value: leave.length, color: 'var(--text-muted)' },
                { label: 'Pending', value: leave.filter(r => r.status === 'pending').length, color: '#B8741C' },
                { label: 'Approved', value: leave.filter(r => r.status === 'approved').length, color: 'var(--color-success)' },
                { label: 'Rejected', value: leave.filter(r => r.status === 'rejected').length, color: 'var(--color-danger)' },
              ]}
              search={{ value: leaveSearch, onChange: setLeaveSearch, placeholder: 'Search leave requests…', ariaLabel: 'Search leave requests' }}
              actions={
                <button type="button" className="listpage-icon-btn listpage-icon-btn-primary" onClick={() => setLeaveOpen(true)} title={t('hr.requestLeave')} aria-label={t('hr.requestLeave')}>
                  <Plus className="w-4 h-4" color="#fff" />
                </button>
              }
            />
            {leave.length === 0 ? (
              <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>
                {t('hr.noLeaveRequestsYet')} <strong>{t('hr.requestLeave')}</strong> {t('hr.above')}
              </div>
            ) : (
              <div className="show-scrollbar" style={{ overflowX: 'auto', overflowY: 'auto', flex: '1 1 0%', minHeight: 0 }}>
                <table className="w-full" style={{ minWidth: 760 }}>
                  <thead>
                    <tr>
                      <Th>{t('hr.colStaff')}</Th>
                      <Th>{t('hr.labelType')}</Th>
                      <Th>Dates</Th>
                      <Th right>Days</Th>
                      <Th>{t('hr.colStatus')}</Th>
                      {isApprover && <Th />}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleLeave.length === 0 && (
                      <tr><td colSpan={6} className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>No leave requests match “{leaveSearch}”.</td></tr>
                    )}
                    {visibleLeave.map(r => {
                      const tok = STATUS_TOKENS[r.status];
                      return (
                        <tr key={r._id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                          <td className="px-4 py-2.5"><StaffCell name={r.userName} sub={r.role.replace(/_/g, ' ')} /></td>
                          <td className="px-4 py-2.5">
                            <div className="text-[13px] capitalize" style={{ color: 'var(--ehr-muted, var(--text-secondary))' }}>{t(`hr.leaveType_${r.leaveType}`)}</div>
                            {r.reason && <div className="text-[11px] truncate" style={{ color: 'var(--text-muted)', maxWidth: 220 }} title={r.reason}>“{r.reason}”</div>}
                          </td>
                          <td className="px-4 py-2.5 text-[13px] whitespace-nowrap" style={{ color: 'var(--ehr-muted, var(--text-secondary))' }}>{r.startDate} → {r.endDate}</td>
                          <td className="px-4 py-2.5 text-[13px] text-right tabular-nums" style={{ color: 'var(--ehr-muted, var(--text-secondary))' }}>{r.days}</td>
                          <td className="px-4 py-2.5">
                            <span
                              className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-md whitespace-nowrap"
                              style={{ background: tok.bg, color: tok.color, border: `1px solid ${tok.color}40` }}
                              title={r.decisionNotes ? t('hr.noteLabel', { note: r.decisionNotes }) : undefined}
                            >
                              {t(`hr.leaveStatus_${r.status}`)}
                            </span>
                          </td>
                          {isApprover && (
                            <td className="px-4 py-2.5">
                              <div className="flex justify-end">
                                {r.status === 'pending' && (
                                  <RowActionsMenu
                                    actions={[
                                      { key: 'approve', label: t('hr.approve'), tone: 'success', onClick: () => decideLeave(r._id, 'approved') },
                                      { key: 'reject', label: t('hr.reject'), tone: 'danger', onClick: () => decideLeave(r._id, 'rejected') },
                                    ]}
                                  />
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          );
        })()}

        {/* ── SCHEDULE ───────────────────────────────────── */}
        {tab === 'schedule' && (
          <div className="dash-card overflow-hidden flex flex-col" style={{ flex: 1, minHeight: 0 }}>
            <EhrListHeader
              title={sectionTitles.schedule}
              stats={[
                { label: 'Shifts', value: schedules.length, color: 'var(--text-muted)' },
                { label: t('hr.shiftType_morning'), value: schedules.filter(s => s.shiftType === 'morning').length, color: 'var(--color-success)' },
                { label: t('hr.shiftType_afternoon'), value: schedules.filter(s => s.shiftType === 'afternoon').length, color: '#B8741C' },
                { label: t('hr.shiftType_night'), value: schedules.filter(s => s.shiftType === 'night').length, color: '#015697' },
                { label: t('hr.shiftType_on_call'), value: schedules.filter(s => s.shiftType === 'on_call').length, color: '#2191D0' },
              ]}
              actions={
                <>
                  <input
                    type="date"
                    value={scheduleDate}
                    onChange={e => setScheduleDate(e.target.value)}
                    aria-label={t('hr.date')}
                    className="listpage-toolbar-date"
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <button type="button" className="listpage-icon-btn listpage-icon-btn-primary" onClick={() => setScheduleOpen(true)} title={t('hr.scheduleShift')} aria-label={t('hr.scheduleShift')}>
                    <Plus className="w-4 h-4" color="#fff" />
                  </button>
                </>
              }
            />
            {schedules.length === 0 ? (
              <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>
                {t('hr.noShiftsScheduled', { date: scheduleDate })} <strong>{t('hr.scheduleShift')}</strong> {t('hr.aboveToAddOne')}
              </div>
            ) : (
              <div className="show-scrollbar" style={{ overflowX: 'auto', overflowY: 'auto', flex: '1 1 0%', minHeight: 0 }}>
                <table className="w-full" style={{ minWidth: 720 }}>
                  <thead>
                    <tr>
                      <Th>{t('hr.colStaff')}</Th>
                      <Th>{t('hr.labelShift')}</Th>
                      <Th>Time</Th>
                      <Th>{t('hr.labelDepartment')}</Th>
                      <Th />
                    </tr>
                  </thead>
                  <tbody>
                    {SHIFT_TYPES.flatMap(shift => schedules.filter(s => s.shiftType === shift)).map(s => {
                      const shiftColor = s.shiftType === 'morning' ? 'var(--color-success-text)' : s.shiftType === 'afternoon' ? '#B8741C' : s.shiftType === 'night' ? '#015697' : 'var(--accent-primary)';
                      return (
                        <tr key={s._id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                          <td className="px-4 py-2.5"><StaffCell name={s.userName} sub={s.role.replace(/_/g, ' ')} /></td>
                          <td className="px-4 py-2.5">
                            <span className="inline-flex items-center gap-1.5 text-[13px] capitalize" style={{ color: 'var(--ehr-muted, var(--text-secondary))' }}>
                              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: shiftColor }} />
                              {t(`hr.shiftType_${s.shiftType}`)}
                              {s.isOnCall && <span className="ml-1 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: 'rgba(59, 130, 246, 0.16)', color: 'var(--accent-primary)' }}>{t('hr.onCall')}</span>}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-[13px] whitespace-nowrap tabular-nums" style={{ color: 'var(--ehr-muted, var(--text-secondary))' }}>{s.startTime}–{s.endTime}</td>
                          <td className="px-4 py-2.5 text-[13px]" style={{ color: 'var(--ehr-muted, var(--text-secondary))' }}>{s.department || '—'}</td>
                          <td className="px-4 py-2.5">
                            <div className="flex justify-end">
                              <RowActionsMenu
                                actions={[
                                  { key: 'remove', label: t('hr.removeShift'), tone: 'danger', icon: <Trash2 className="w-4 h-4" />, onClick: () => removeShift(s._id) },
                                ]}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── PAYROLL ───────────────────────────────────── */}
        {tab === 'payroll' && (
          <div className="dash-card overflow-hidden flex flex-col" style={{ flex: 1, minHeight: 0 }}>
            <EhrListHeader
              title={sectionTitles.payroll}
              stats={payrollSummary ? [
                { label: t('hr.pillEntries'), value: payrollSummary.total, color: 'var(--text-muted)' },
                { label: t('hr.pillGross'), value: formatMoney(payrollSummary.totalGross), color: '#2191D0' },
                { label: t('hr.pillDeductions'), value: formatMoney(payrollSummary.totalDeductions), color: '#B8741C' },
                { label: t('hr.pillNet'), value: formatMoney(payrollSummary.totalNet), color: 'var(--color-success)' },
                { label: t('hr.pillPaid'), value: `${payrollSummary.paid}/${payrollSummary.total}`, color: 'var(--color-success)' },
              ] : [{ label: t('hr.pillEntries'), value: payroll.length, color: 'var(--text-muted)' }]}
              actions={
                <>
                  <input
                    type="month"
                    value={payrollPeriod}
                    onChange={e => setPayrollPeriod(e.target.value)}
                    aria-label={t('hr.period')}
                    className="listpage-toolbar-date"
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <button type="button" className="listpage-icon-btn listpage-icon-btn-primary" onClick={() => setPayrollOpen(true)} title={t('hr.addPayrollEntry')} aria-label={t('hr.addPayrollEntry')}>
                    <Plus className="w-4 h-4" color="#fff" />
                  </button>
                </>
              }
            />
            {payroll.length === 0 ? (
              <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>
                {t('hr.noPayrollEntries', { period: payrollPeriod })} <strong>{t('hr.addPayrollEntry')}</strong> {t('hr.aboveToStartRegister')}
              </div>
            ) : (
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
              </div>
            )}
          </div>
        )}
          </section>
        </div>

        {/* ── Modals ────────────────────────────────────── */}
        {leaveOpen && (
          <Modal onClose={() => setLeaveOpen(false)}>
            <div className="modal-content card-elevated p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold">{t('hr.requestLeave')}</h3>
                <button onClick={() => setLeaveOpen(false)} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelStaffRequired')}</label>
                  <Select value={leaveForm.userId} onChange={e => setLeaveForm({ ...leaveForm, userId: e.target.value })}>
                    <option value="">{t('hr.selectStaffOption')}</option>
                    {(isApprover ? users : users.filter(u => u._id === currentUser?._id)).map(u => (
                      <option key={u._id} value={u._id}>{u.name} ({u.role.replace(/_/g, ' ')})</option>
                    ))}
                  </Select>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelType')}</label>
                    <Select value={leaveForm.leaveType} onChange={e => setLeaveForm({ ...leaveForm, leaveType: e.target.value as LeaveType })}>
                      {LEAVE_TYPES.map(lt => <option key={lt.id} value={lt.id}>{t(`hr.leaveType_${lt.id}`)}</option>)}
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelStart')}</label>
                    <input type="date" value={leaveForm.startDate} onChange={e => setLeaveForm({ ...leaveForm, startDate: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelEnd')}</label>
                    <input type="date" value={leaveForm.endDate} onChange={e => setLeaveForm({ ...leaveForm, endDate: e.target.value })} />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelReason')}</label>
                  <textarea rows={2} value={leaveForm.reason} onChange={e => setLeaveForm({ ...leaveForm, reason: e.target.value })} placeholder={t('hr.optional')} />
                </div>
              </div>
              <hr className="section-divider" />
              <div className="flex gap-2 mt-2">
                <button onClick={() => setLeaveOpen(false)} className="btn btn-secondary flex-1">{t('hr.cancel')}</button>
                <button onClick={handleRequestLeave} className="btn btn-primary flex-1">{t('hr.submit')}</button>
              </div>
            </div>
          </Modal>
        )}

        {scheduleOpen && (
          <Modal onClose={() => setScheduleOpen(false)}>
            <div className="modal-content card-elevated p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold">{t('hr.scheduleShift')}</h3>
                <button onClick={() => setScheduleOpen(false)} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelStaffRequired')}</label>
                  <Select value={scheduleForm.userId} onChange={e => setScheduleForm({ ...scheduleForm, userId: e.target.value })}>
                    <option value="">{t('hr.selectStaffOption')}</option>
                    {facilityUsers.map(u => (
                      <option key={u._id} value={u._id}>{u.name} ({u.role.replace(/_/g, ' ')})</option>
                    ))}
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelShift')}</label>
                    <Select value={scheduleForm.shiftType} onChange={e => setScheduleForm({ ...scheduleForm, shiftType: e.target.value as StaffScheduleDoc['shiftType'] })}>
                      {SHIFT_TYPES.map(s => <option key={s} value={s} className="capitalize">{t(`hr.shiftType_${s}`)}</option>)}
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.date')}</label>
                    <input type="date" value={scheduleForm.shiftDate} onChange={e => setScheduleForm({ ...scheduleForm, shiftDate: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelStart')}</label>
                    <input type="time" value={scheduleForm.startTime} onChange={e => setScheduleForm({ ...scheduleForm, startTime: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelEnd')}</label>
                    <input type="time" value={scheduleForm.endTime} onChange={e => setScheduleForm({ ...scheduleForm, endTime: e.target.value })} />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelDepartment')}</label>
                  <input value={scheduleForm.department} onChange={e => setScheduleForm({ ...scheduleForm, department: e.target.value })} placeholder={t('hr.departmentPlaceholder')} />
                </div>
                <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-primary)' }}>
                  <input type="checkbox" checked={scheduleForm.isOnCall} onChange={e => setScheduleForm({ ...scheduleForm, isOnCall: e.target.checked })} />
                  {t('hr.onCallShift')}
                </label>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelNotes')}</label>
                  <textarea rows={2} value={scheduleForm.notes} onChange={e => setScheduleForm({ ...scheduleForm, notes: e.target.value })} />
                </div>
              </div>
              <hr className="section-divider" />
              <div className="flex gap-2 mt-2">
                <button onClick={() => setScheduleOpen(false)} className="btn btn-secondary flex-1">{t('hr.cancel')}</button>
                <button onClick={handleAddShift} className="btn btn-primary flex-1">{t('hr.saveShift')}</button>
              </div>
            </div>
          </Modal>
        )}

        {payrollOpen && (
          <Modal onClose={() => setPayrollOpen(false)}>
            <div className="modal-content card-elevated p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold">{t('hr.addPayrollEntryPeriod', { period: payrollPeriod })}</h3>
                <button onClick={() => setPayrollOpen(false)} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelStaffRequired')}</label>
                  <Select value={payrollForm.userId} onChange={e => setPayrollForm({ ...payrollForm, userId: e.target.value })}>
                    <option value="">{t('hr.selectStaffOption')}</option>
                    {facilityUsers.map(u => (
                      <option key={u._id} value={u._id}>{u.name} ({u.role.replace(/_/g, ' ')})</option>
                    ))}
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelCurrency')}</label>
                    <Select value={payrollForm.currency} onChange={e => setPayrollForm({ ...payrollForm, currency: e.target.value })}>
                      <option value="SSP">SSP</option><option value="USD">USD</option><option value="KES">KES</option>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelBaseSalary')}</label>
                    <input type="number" min={0} value={payrollForm.baseSalary || ''} onChange={e => setPayrollForm({ ...payrollForm, baseSalary: parseFloat(e.target.value) || 0 })} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelAllowances')}</label>
                    <input type="number" min={0} value={payrollForm.allowances || ''} onChange={e => setPayrollForm({ ...payrollForm, allowances: parseFloat(e.target.value) || 0 })} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelDeductions')}</label>
                    <input type="number" min={0} value={payrollForm.deductions || ''} onChange={e => setPayrollForm({ ...payrollForm, deductions: parseFloat(e.target.value) || 0 })} />
                  </div>
                </div>
                <div className="px-3 py-2 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
                  <div className="flex justify-between text-[12px]"><span style={{ color: 'var(--text-muted)' }}>{t('hr.netPay')}</span><span className="font-bold font-mono" style={{ color: 'var(--color-success-text)' }}>{formatMoney(payrollForm.baseSalary + payrollForm.allowances - payrollForm.deductions, { currency: payrollForm.currency })}</span></div>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('hr.labelNotes')}</label>
                  <textarea rows={2} value={payrollForm.notes} onChange={e => setPayrollForm({ ...payrollForm, notes: e.target.value })} />
                </div>
              </div>
              <hr className="section-divider" />
              <div className="flex gap-2 mt-2">
                <button onClick={() => setPayrollOpen(false)} className="btn btn-secondary flex-1">{t('hr.cancel')}</button>
                <button onClick={handleAddPayroll} className="btn btn-primary flex-1">{t('hr.addEntry')}</button>
              </div>
            </div>
          </Modal>
        )}
      </main>
    </>
  );
}

