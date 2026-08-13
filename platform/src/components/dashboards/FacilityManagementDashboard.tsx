'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardGreetingHeader from '@/components/dashboard/DashboardGreetingHeader';
import { useAuth } from '@/lib/context';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useUsers } from '@/lib/hooks/useUsers';
import { usePatients } from '@/lib/hooks/usePatients';
import { useWards } from '@/lib/hooks/useWards';
import { useAppointments } from '@/lib/hooks/useAppointments';
import dynamic from 'next/dynamic';
import ChartCard from '@/components/ChartCard';

// recharts (~80–100 KB) is deferred behind a dynamic boundary so it is fetched
// only when these charts render (KAN-66). ssr:false because recharts measures
// the DOM to size itself. The surrounding stat cards and totals render without
// it, so the dashboard is useful before the chart chunk lands.
const CashFlowDonut = dynamic(() => import('./_FacilityCharts').then(m => m.CashFlowDonut), {
  ssr: false,
  loading: () => <div style={{ width: '100%', height: '100%' }} />,
});
const WeeklyActivityChart = dynamic(() => import('./_FacilityCharts').then(m => m.WeeklyActivityChart), {
  ssr: false,
  loading: () => <div style={{ width: '100%', height: 208 }} />,
});
import {
  Stethoscope, Users, HeartPulse, BedDouble, ChevronRight,
  Eye, Pencil, Trash2, Plus,
} from '@/components/icons/lucide';
import EhrListHeader, { LIST_STAT_COLORS } from '@/components/ehr/EhrListHeader';
import { formatMoney } from '@/lib/format-utils';
import type { MessageDoc, UserDoc } from '@/lib/db-types';
import { ROLE_LABEL } from '@/lib/role-display';

const TEAL = 'var(--color-brand-400)';
const PURPLE = 'var(--accent-primary)';
const CORAL = '#FB923C';

// Chart palette — validated against the dataviz six-checks on the light
// surface. The weekly triple passes outright; the cash-flow green/amber pair
// sits in the CVD warn band, which is legal only because the labeled amount
// tiles + slice gap carry identity — keep those if you retint.
const CHART_BLUE = '#2a78d6';   // appointments
const CHART_GREEN = '#199e70';  // new patients
const CHART_RED = '#e34948';    // canceled
const CASH_RECEIVED = '#0ca30c';
const CASH_PENDING = '#eda100';
const CASH_PENDING_TEXT = '#a16207'; // legible amber for text on light cards

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** JS getDay() (0=Sun..6=Sat) → our Mon-first index (0=Mon..6=Sun). */
function weekdayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

interface BillingSummary {
  totalRevenue: number;
  totalOutstanding: number;
  currency: string;
}

export default function FacilityManagementDashboard() {
  const { currentUser } = useAuth();
  const router = useRouter();
  const scope = useDataScope();
  const currentUserId = currentUser?._id;

  const { users } = useUsers();
  const { patients } = usePatients();
  const { availableBeds } = useWards();
  const { appointments } = useAppointments();

  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [enquiries, setEnquiries] = useState<MessageDoc[]>([]);
  const [availableProviderIds, setAvailableProviderIds] = useState<Set<string>>(new Set());

  // Manage-user popup (org/super admins get reset-password, deactivate, delete).
  // localEdits overlays API writes onto the list immediately — the users DB is
  // pull-only, so the change feed only catches up after the next sync cycle.
  const [selectedUser, setSelectedUser] = useState<UserDoc | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [localEdits, setLocalEdits] = useState<Record<string, Partial<UserDoc> | 'deleted'>>({});
  const [userSearch, setUserSearch] = useState('');

  const canManageUsers = currentUser?.role === 'org_admin' || currentUser?.role === 'super_admin';

  // Billing (cash flow), enquiries (inbound patient messages) and provider
  // availability are loaded from services — all real data, scope-filtered.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getBillingSummary } = await import('@/lib/services/billing-service');
        const s = await getBillingSummary(scope);
        if (!cancelled) setBilling({ totalRevenue: s.totalRevenue, totalOutstanding: s.totalOutstanding, currency: s.currency });
      } catch { /* leave null */ }
      try {
        const { getInboundPatientMessages } = await import('@/lib/services/message-service');
        const m = await getInboundPatientMessages(scope);
        if (!cancelled) setEnquiries(m.slice(0, 5));
      } catch { /* leave empty */ }
      try {
        // Recurrence-aware: a clinic that runs every Monday has no row dated
        // today, so matching on `a.date === today` showed every provider as
        // unavailable the moment availability became a weekly pattern.
        const { getAllAvailability, appliesOnDate } = await import('@/lib/services/availability-service');
        const { jubaDate, jubaTime } = await import('@/lib/time-juba');
        const av = await getAllAvailability(scope);
        const today = jubaDate();
        const now = jubaTime();
        const ids = new Set(
          av.filter(a => appliesOnDate(a, today) && a.startTime <= now && a.endTime >= now)
            .map(a => a.providerId),
        );
        if (!cancelled) setAvailableProviderIds(ids);
      } catch { /* leave empty */ }
    })();
    return () => { cancelled = true; };
  }, [scope]);

  // ─── Derived counts ───
  const visibleUsers = useMemo(() => users
    .filter(u => localEdits[u._id] !== 'deleted')
    .map(u => {
      const edit = localEdits[u._id];
      return edit && edit !== 'deleted' ? { ...u, ...edit } : u;
    }), [users, localEdits]);
  const doctors = useMemo(() => visibleUsers.filter(u => u.role === 'doctor' || u.role === 'clinical_officer' || u.role === 'clinician'), [visibleUsers]);
  const nurses = useMemo(() => visibleUsers.filter(u => u.role === 'nurse' || u.role === 'midwife'), [visibleUsers]);

  const received = billing?.totalRevenue ?? 0;
  const pending = billing?.totalOutstanding ?? 0;
  const totalInvoice = received + pending;
  const cashData = [
    { name: 'Received', value: received, color: CASH_RECEIVED },
    { name: 'Pending', value: pending, color: CASH_PENDING },
  ].filter(d => d.value > 0);

  // ─── Weekly patient activity (real: registrations, appointments, cancellations) ───
  const weekly = useMemo(() => {
    const rows = WEEKDAYS.map(d => ({ day: d, newPatients: 0, appointments: 0, canceled: 0 }));
    const start = new Date(); start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - weekdayIndex(start)); // Monday of this week
    const end = new Date(start); end.setDate(end.getDate() + 7);
    const inWeek = (iso?: string) => {
      if (!iso) return -1;
      const dt = new Date(iso);
      if (dt < start || dt >= end) return -1;
      return weekdayIndex(dt);
    };
    for (const p of patients) {
      const i = inWeek((p as { createdAt?: string }).createdAt);
      if (i >= 0) rows[i].newPatients += 1;
    }
    for (const a of appointments) {
      const i = inWeek(a.appointmentDate);
      if (i < 0) continue;
      if (a.status === 'cancelled') rows[i].canceled += 1;
      else rows[i].appointments += 1;
    }
    return rows;
  }, [patients, appointments]);

  const unreadEnquiries = useMemo(
    () => enquiries.filter(message => !currentUserId || !message.readBy?.includes(currentUserId)),
    [currentUserId, enquiries],
  );

  const lastInquiryLabel = useMemo(() => {
    const latest = enquiries[0];
    if (!latest?.sentAt && !latest?.createdAt) return 'No inquiries';
    const timestamp = latest.sentAt || latest.createdAt;
    return new Date(timestamp).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }, [enquiries]);

  const userInquiryRows = useMemo(() => {
    const priorityRoles = new Set(['front_desk', 'clinic_clerk', 'central_registration_clerk', 'doctor', 'clinician', 'clinical_officer', 'nurse', 'pharmacist', 'lab_tech']);
    const q = userSearch.trim().toLowerCase();
    return visibleUsers
      .filter(user => priorityRoles.has(user.role) || user.isActive)
      .filter(user => !q
        || user.name.toLowerCase().includes(q)
        || user.username.toLowerCase().includes(q)
        || (ROLE_LABEL[user.role] || user.role).toLowerCase().includes(q))
      .sort((a, b) => {
        const activeDelta = Number(b.isActive !== false) - Number(a.isActive !== false);
        if (activeDelta) return activeDelta;
        const availableDelta = Number(availableProviderIds.has(b._id)) - Number(availableProviderIds.has(a._id));
        if (availableDelta) return availableDelta;
        return a.name.localeCompare(b.name);
      })
      // While searching, show the full match list; the idle view stays a top-5 digest.
      .slice(0, q ? 20 : 5)
      .map(user => ({
        user,
        available: availableProviderIds.has(user._id),
        active: user.isActive !== false,
      }));
  }, [availableProviderIds, visibleUsers, userSearch]);

  const openUser = (user: UserDoc) => {
    setSelectedUser(user);
    setNewPassword('');
    setConfirmingDelete(false);
    setActionError(null);
    setActionNotice(null);
  };

  const handleResetPassword = async () => {
    if (!selectedUser || !currentUser) return;
    if (newPassword.length < 8) {
      setActionError('Temporary password must be at least 8 characters.');
      return;
    }
    setActionBusy(true); setActionError(null); setActionNotice(null);
    try {
      const { resetPassword } = await import('@/lib/services/user-service');
      await resetPassword(selectedUser._id, newPassword, currentUser._id, currentUser.username);
      setNewPassword('');
      setActionNotice(`Temporary password set — ${selectedUser.name} must choose a new one at next sign-in.`);
    } catch (err) {
      setActionError((err as Error).message || 'Failed to reset password');
    } finally {
      setActionBusy(false);
    }
  };

  const handleToggleActive = async () => {
    if (!selectedUser || !currentUser) return;
    const makeActive = selectedUser.isActive === false;
    setActionBusy(true); setActionError(null); setActionNotice(null);
    try {
      if (makeActive) {
        const { updateUser } = await import('@/lib/services/user-service');
        await updateUser(selectedUser._id, { isActive: true }, currentUser._id, currentUser.username);
      } else {
        const { deactivateUser } = await import('@/lib/services/user-service');
        await deactivateUser(selectedUser._id, currentUser._id, currentUser.username);
      }
      setLocalEdits(prev => ({
        ...prev,
        [selectedUser._id]: { ...(prev[selectedUser._id] as Partial<UserDoc> | undefined), isActive: makeActive },
      }));
      setSelectedUser({ ...selectedUser, isActive: makeActive });
      setActionNotice(makeActive ? 'Account reactivated.' : 'Account deactivated — the user can no longer sign in.');
    } catch (err) {
      setActionError((err as Error).message || 'Failed to update account');
    } finally {
      setActionBusy(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!selectedUser || !currentUser) return;
    setActionBusy(true); setActionError(null);
    try {
      const { deleteUser } = await import('@/lib/services/user-service');
      await deleteUser(selectedUser._id, currentUser._id, currentUser.username);
      setLocalEdits(prev => ({ ...prev, [selectedUser._id]: 'deleted' }));
      setSelectedUser(null);
    } catch (err) {
      setActionError((err as Error).message || 'Failed to delete user');
    } finally {
      setActionBusy(false);
    }
  };

  if (!currentUser) return null;

  const statusPill = (status: string) => {
    const ok = /approved|confirmed|scheduled|booked|available|active/i.test(status);
    const bad = /cancel|inactive/i.test(status);
    const color = bad ? 'var(--color-danger)' : ok ? 'var(--color-success)' : 'var(--text-muted)';
    const bg = bad ? 'rgba(229,46,66,0.10)' : ok ? 'rgba(21,121,92,0.10)' : 'var(--overlay-subtle)';
    return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full capitalize" style={{ color, background: bg }}>{status}</span>;
  };

  const stat = (icon: React.ReactNode, label: React.ReactNode, value: number) => (
    <div className="flex items-center gap-3 py-2.5" style={{ borderBottom: '1px solid var(--border-light)' }}>
      <div className="icon-box-sm">{icon}</div>
      <span className="text-sm flex-1" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{value}</span>
    </div>
  );

  return (
    <>
      <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <DashboardGreetingHeader />
        {/* flex:1 so the card rows stretch to fill the viewport — the Users &
            Inquiries row absorbs the leftover height (its table scrolls). */}
        <div className="flex flex-col gap-3" style={{ flex: 1, minHeight: 0 }}>

          {/* ═══ ROW 1 — Cash Flow · Stat cards · Weekly activity ═══ */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">

            {/* Cash Flow */}
            <div className="dash-card overflow-hidden">
              <div className="px-5 py-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Cash Flow</h3>
              </div>
              <div className="flex items-center gap-4 p-4">
                <div className="relative flex-shrink-0" style={{ width: 128, height: 128 }}>
                  <CashFlowDonut data={cashData} />
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>{formatMoney(totalInvoice)}</span>
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Total invoice</span>
                  </div>
                </div>
                <div className="flex-1 space-y-2">
                  <div className="rounded-xl p-2.5" style={{ background: 'rgba(12,163,12,0.10)', border: '1px solid rgba(12,163,12,0.28)' }}>
                    <p className="text-[11px] flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                      Received Amount
                    </p>
                    <p className="text-base font-bold" style={{ color: CASH_RECEIVED }}>{formatMoney(received)}</p>
                  </div>
                  <div className="rounded-xl p-2.5" style={{ background: 'rgba(237,161,0,0.12)', border: '1px solid rgba(237,161,0,0.35)' }}>
                    <p className="text-[11px] flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                      Pending Amount
                    </p>
                    <p className="text-base font-bold" style={{ color: CASH_PENDING_TEXT }}>{formatMoney(pending)}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Stat cards — no header, matching the reference layout */}
            <div className="dash-card overflow-hidden">
              <div className="p-5 flex flex-col justify-center h-full">
                {stat(<Stethoscope className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />, <>Total <b>Doctors</b></>, doctors.length)}
                {stat(<Users className="w-4 h-4" style={{ color: PURPLE }} />, <>Total <b>Patients</b></>, patients.length)}
                {stat(<HeartPulse className="w-4 h-4" style={{ color: CORAL }} />, <>Total <b>Nurses</b></>, nurses.length)}
                <div className="flex items-center gap-3 pt-2.5">
                  <div className="icon-box-sm"><BedDouble className="w-4 h-4" style={{ color: TEAL }} /></div>
                  <span className="text-sm flex-1" style={{ color: 'var(--text-secondary)' }}>Available <b>Beds</b></span>
                  <span className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{availableBeds}</span>
                </div>
              </div>
            </div>

            {/* Weekly patient activity — registrations, appointments, cancellations */}
            <ChartCard
              title="Weekly Patient Activity"
              defaultType="bar"
              defaultPeriod="week"
            >
              {({ chartType }) => {
                const series = [
                  { key: 'appointments', name: 'Appointments', color: CHART_BLUE },
                  { key: 'newPatients', name: 'New Patients', color: CHART_GREEN },
                  { key: 'canceled', name: 'Canceled', color: CHART_RED },
                ];
                return <WeeklyActivityChart data={weekly} chartType={chartType} series={series} />;
              }}
            </ChartCard>
          </div>

          {/* ═══ ROW 2 — Users & Inquiries ═══ */}
          <div className="dash-card overflow-hidden flex flex-col" style={{ flex: 1, minHeight: 0 }}>
            {/* Appointments-style list header: stats, search bar, icon actions. */}
            <EhrListHeader
              title="Users & Inquiries"
              stats={[
                { label: 'Users', value: visibleUsers.length, color: LIST_STAT_COLORS.muted },
                { label: 'Open inquiries', value: unreadEnquiries.length, color: LIST_STAT_COLORS.amber },
                { label: 'Last inquiry', value: lastInquiryLabel, color: LIST_STAT_COLORS.blue },
              ]}
              search={{ value: userSearch, onChange: setUserSearch, placeholder: 'Search users by name, username, or role…' }}
              actions={
                <>
                  {canManageUsers && (
                    <button
                      type="button"
                      className="listpage-icon-btn listpage-icon-btn-primary"
                      // A platform super_admin has no organization, so the
                      // org-scoped page can't serve them — their create form
                      // lives in the platform-wide user management screen.
                      onClick={() => router.push(currentUser?.role === 'super_admin' ? '/admin/users?new=1' : '/org-admin/users?new=1')}
                      title="Add user"
                      aria-label="Add user"
                    >
                      {/* The icon shim defaults to brand blue — invisible on the
                          blue primary button, so force white. */}
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
                    {['User', 'Role', 'Department', 'Availability', 'Action'].map(h => (
                      <th key={h} className={`px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider ${h === 'Action' ? 'text-right' : 'text-left'}`} style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-light)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {userInquiryRows.length === 0 && (
                    <tr><td colSpan={5} className="px-5 py-8 text-center text-[12px]" style={{ color: 'var(--text-muted)' }}>No users available for this facility.</td></tr>
                  )}
                  {userInquiryRows.map(({ user, available, active }) => (
                    <tr key={user._id} role="button" tabIndex={0}
                      className="cursor-pointer hover:bg-[var(--table-row-hover)]"
                      onClick={() => openUser(user)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openUser(user); } }}
                      style={{ borderBottom: '1px solid var(--border-light)' }}>
                      <td className="px-5 py-2">
                        <div className="flex items-center gap-3">
                          <span className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0" style={{ background: active ? 'var(--accent-primary)' : 'var(--text-muted)' }}>
                            {(user.name || '?').split(' ').map(part => part[0]).slice(0, 2).join('')}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[12px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{user.name}</span>
                            <span className="block text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>{user.username}</span>
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-2 text-[12px]" style={{ color: 'var(--text-secondary)' }}>{ROLE_LABEL[user.role] || user.role}</td>
                      <td className="px-5 py-2 text-[12px]" style={{ color: 'var(--text-secondary)' }}>{user.department || user.specialty || user.hospitalName || 'General'}</td>
                      <td className="px-5 py-2">{statusPill(!active ? 'Inactive' : available ? 'Available' : 'Active')}</td>
                      <td className="px-5 py-2">
                        <div className="flex items-center justify-end gap-1.5">
                          {canManageUsers ? (
                            <>
                              <button
                                onClick={(e) => { e.stopPropagation(); openUser(user); }}
                                className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--overlay-medium)]"
                                title="Edit user"
                                aria-label="Edit user"
                              >
                                <Pencil className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                              </button>
                              {user._id !== currentUser?._id && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); openUser(user); setConfirmingDelete(true); }}
                                  className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--overlay-medium)]"
                                  title="Delete user"
                                  aria-label="Delete user"
                                >
                                  <Trash2 className="w-4 h-4" style={{ color: 'var(--color-danger)' }} />
                                </button>
                              )}
                            </>
                          ) : (
                            <button
                              onClick={(e) => { e.stopPropagation(); openUser(user); }}
                              className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--overlay-medium)]"
                              title="View user"
                              aria-label="View user"
                            >
                              <Eye className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ═══ ROW 3 — Enquiries · Doctors ═══ */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">

            {/* Enquiries (inbound patient messages) */}
            <div className="dash-card overflow-hidden">
              <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-light)' }}>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Enquiries</h3>
                <button onClick={() => router.push('/messages')} className="text-[12px] font-medium inline-flex items-center gap-0.5" style={{ color: 'var(--accent-primary)' }}>View all <ChevronRight className="w-3 h-3" /></button>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="w-full" style={{ minWidth: 460 }}>
                  <thead>
                    <tr>
                      {['Full Name', 'Type', 'Date', 'Status', 'Action'].map(h => (
                        <th key={h} className={`px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider ${h === 'Status' || h === 'Action' ? 'text-center' : 'text-left'}`} style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-light)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {enquiries.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-6 text-center text-[12px]" style={{ color: 'var(--text-muted)' }}>No patient enquiries.</td></tr>
                    ) : enquiries.map(m => {
                      // Real per-row status from the message's own `readBy` list
                      // (scoped to this user when known), not a hardcoded pill —
                      // it used to render "on"/green for every row regardless.
                      const isRead = currentUserId ? !!m.readBy?.includes(currentUserId) : (m.readBy?.length ?? 0) > 0;
                      return (
                      <tr key={m._id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                        <td className="px-4 py-2.5 text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>{m.patientName || 'Patient'}</td>
                        <td className="px-4 py-2.5 text-[12px]" style={{ color: 'var(--text-secondary)' }}>{m.subject || 'General Inquiry'}</td>
                        <td className="px-4 py-2.5 text-[12px] whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{(m.sentAt || m.createdAt || '').slice(0, 10)}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex justify-center">
                            <span
                              className="inline-flex items-center w-9 h-5 rounded-full px-0.5"
                              style={{ background: isRead ? 'var(--color-success)' : 'var(--overlay-medium)' }}
                              title={isRead ? 'Read' : 'Unread'}
                            >
                              <span className={`w-4 h-4 rounded-full bg-white ${isRead ? 'ml-auto' : 'mr-auto'}`} />
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex justify-center">
                            <button onClick={() => router.push('/messages')} className="w-7 h-7 rounded-lg inline-flex items-center justify-center transition-colors hover:bg-[var(--overlay-medium)]" title="View enquiry" aria-label="View enquiry">
                              <Eye className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                            </button>
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Doctors + availability */}
            <div className="dash-card overflow-hidden">
              <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-light)' }}>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Doctors</h3>
                <button onClick={() => router.push('/hr')} className="text-[12px] font-medium inline-flex items-center gap-0.5" style={{ color: 'var(--accent-primary)' }}>View all <ChevronRight className="w-3 h-3" /></button>
              </div>
              <div className="p-2">
                {/* Column header (No / Name / Status) */}
                <div className="flex items-center gap-3 px-3 py-2" style={{ borderBottom: '1px solid var(--border-light)' }}>
                  <span className="w-6 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>No</span>
                  <span className="w-8" aria-hidden />
                  <span className="flex-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Name</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Status</span>
                </div>
                {doctors.length === 0 ? (
                  <p className="px-3 py-6 text-center text-[12px]" style={{ color: 'var(--text-muted)' }}>No doctors on record.</p>
                ) : doctors.slice(0, 5).map((d, i) => {
                  const available = availableProviderIds.has(d._id);
                  return (
                    <div key={d._id} className="flex items-center gap-3 px-3 py-2.5" style={{ borderBottom: '1px solid var(--border-light)' }}>
                      <span className="text-[11px] font-mono w-6" style={{ color: 'var(--text-muted)' }}>{String(i + 1).padStart(2, '0')}</span>
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0" style={{ background: 'var(--accent-primary)' }}>
                        {(d.name || '?').split(' ').map(s => s[0]).slice(0, 2).join('')}
                      </div>
                      <span className="text-[13px] font-medium flex-1 truncate" style={{ color: 'var(--text-primary)' }}>{d.name}</span>
                      <span className="text-[11px] font-semibold" style={{ color: available ? 'var(--color-success)' : 'var(--text-muted)' }}>
                        {available ? 'Available' : 'Unavailable'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

        </div>
      </main>

      {/* Manage-user popup — details for everyone; reset-password, activate/
          deactivate, and delete only for org/super admins. */}
      {selectedUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => { if (!actionBusy) setSelectedUser(null); }}
        >
          <div
            className="rounded-2xl shadow-2xl w-full max-w-md"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 flex items-center gap-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
              <span className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0" style={{ background: selectedUser.isActive !== false ? 'var(--accent-primary)' : 'var(--text-muted)' }}>
                {(selectedUser.name || '?').split(' ').map(part => part[0]).slice(0, 2).join('')}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{selectedUser.name}</h2>
                <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                  {selectedUser.username} · {ROLE_LABEL[selectedUser.role] || selectedUser.role}
                </p>
              </div>
              {statusPill(selectedUser.isActive === false ? 'Inactive' : 'Active')}
            </div>

            <div className="px-5 py-4 grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
              <div><span style={{ color: 'var(--text-muted)' }}>Department: </span><span style={{ color: 'var(--text-primary)' }}>{selectedUser.department || '--'}</span></div>
              <div><span style={{ color: 'var(--text-muted)' }}>Specialty: </span><span style={{ color: 'var(--text-primary)' }}>{selectedUser.specialty || '--'}</span></div>
              <div><span style={{ color: 'var(--text-muted)' }}>Facility: </span><span style={{ color: 'var(--text-primary)' }}>{selectedUser.hospitalName || '--'}</span></div>
              <div><span style={{ color: 'var(--text-muted)' }}>Phone: </span><span style={{ color: 'var(--text-primary)' }}>{selectedUser.phone || '--'}</span></div>
            </div>

            {canManageUsers && (
              <div className="px-5 pb-4 space-y-3">
                <div>
                  <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-muted)' }}>Reset password</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      placeholder="New temporary password"
                      autoComplete="off"
                      className="flex-1 rounded px-3 py-2 text-sm outline-none"
                      style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                    />
                    <button
                      onClick={handleResetPassword}
                      className="btn btn-secondary whitespace-nowrap"
                      disabled={actionBusy || !newPassword}
                    >
                      Reset
                    </button>
                  </div>
                  <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                    The user will be asked to choose their own password at next sign-in.
                  </p>
                </div>

                {actionNotice && <p className="text-xs" style={{ color: 'var(--color-success)' }}>{actionNotice}</p>}
                {actionError && <p className="text-xs" style={{ color: 'var(--color-danger)' }}>{actionError}</p>}

                {confirmingDelete && (
                  <div className="rounded-lg p-3 text-xs" style={{ background: 'rgba(229,46,66,0.08)', border: '1px solid rgba(229,46,66,0.25)', color: 'var(--color-danger)' }}>
                    This permanently removes {selectedUser.name}&apos;s account. This cannot be undone.
                  </div>
                )}
              </div>
            )}

            <div className="px-5 py-3 flex items-center gap-2" style={{ borderTop: '1px solid var(--border-light)' }}>
              {canManageUsers && selectedUser._id !== currentUser._id && (
                <>
                  <button onClick={handleToggleActive} className="btn btn-secondary" disabled={actionBusy}>
                    {selectedUser.isActive === false ? 'Activate' : 'Deactivate'}
                  </button>
                  {confirmingDelete ? (
                    <>
                      <button onClick={handleDeleteUser} className="btn" style={{ background: 'var(--color-danger)', color: '#fff' }} disabled={actionBusy}>
                        {actionBusy ? 'Deleting…' : 'Confirm delete'}
                      </button>
                      <button onClick={() => setConfirmingDelete(false)} className="btn btn-secondary" disabled={actionBusy}>Keep user</button>
                    </>
                  ) : (
                    <button onClick={() => { setConfirmingDelete(true); setActionNotice(null); setActionError(null); }} className="btn btn-secondary" style={{ color: 'var(--color-danger)' }} disabled={actionBusy}>
                      Delete
                    </button>
                  )}
                </>
              )}
              <button onClick={() => setSelectedUser(null)} className="btn btn-secondary ml-auto" disabled={actionBusy}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
