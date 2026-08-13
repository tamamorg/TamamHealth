'use client';

/**
 * Patient Inquiries — front-desk triage view over `/inquiries`.
 *
 * There is no dedicated enquiry document; every row here is a `MessageDoc`
 * with `direction === 'patient_to_staff'` (see `enquiry-service.ts`, which
 * this page treats as its only API onto that data). Triage state always goes
 * through `deriveEnquiryStatus` — never read `doc.enquiryStatus` directly —
 * and `MessageDoc.status` is delivery status, not triage, so it never appears
 * on screen here.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import EmptyState from '@/components/EmptyState';
import AddInquiryDialog from '@/components/create-dialogs/AddInquiryDialog';
import RowActionsMenu, { type RowAction } from '@/components/RowActionsMenu';
import Select from '@/components/Select';
import EhrListHeader, { EhrListFilters, LIST_STAT_COLORS } from '@/components/ehr/EhrListHeader';
import {
  MessageSquarePlus, Phone, CalendarClock, XCircle, UserCheck, UserX,
} from '@/components/icons/lucide';
import { useAuth } from '@/lib/context';
import { useUsers } from '@/lib/hooks/useUsers';
import { avatarTint, initials } from '@/lib/patient-utils';
import { formatCompactDateTime } from '@/lib/format-utils';
import { useToast } from '@/components/Toast';
import type { MessageDoc } from '@/lib/db-types';
import {
  ENQUIRY_STATUSES,
  ENQUIRY_STATUS_LABELS,
  type EnquiryStatus,
  deriveEnquiryStatus,
  enquiryType,
  enquiryAssignee,
  getPatientEnquiries,
  summariseEnquiries,
  filterEnquiries,
  setEnquiryStatus,
  assignEnquiry,
} from '@/lib/services/enquiry-service';

/** Flat status-pill palette — always paired with the text label, never color alone. */
const STATUS_TOKENS: Record<EnquiryStatus, { color: string; bg: string }> = {
  new: { color: '#B8741C', bg: 'rgba(228, 168, 75, 0.16)' },
  contacted: { color: 'var(--accent-primary)', bg: 'rgba(33, 145, 208, 0.14)' },
  appointment_scheduled: { color: 'var(--accent-purple)', bg: 'rgba(124, 58, 237, 0.12)' },
  closed: { color: 'var(--color-success-text)', bg: 'rgba(27, 158, 119, 0.12)' },
};

/** Unique, sorted enquiry "types" (subject lines) present in the list — feeds the type filter. */
export function buildTypeOptions(messages: MessageDoc[]): string[] {
  const set = new Set<string>();
  for (const m of messages) set.add(enquiryType(m));
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export interface InquiryActionSpec {
  key: 'contacted' | 'appointment' | 'closed' | 'assign-me' | 'unassign';
  label: string;
  disabled: boolean;
}

/**
 * Pure derivation of the row action-menu contents (label + enabled state) for
 * one enquiry. Kept free of handlers/JSX so it can be unit-tested without a
 * DOM — the component below maps each spec onto a live `RowAction`.
 */
export function buildInquiryActions(
  message: Pick<MessageDoc, 'enquiryStatus' | 'enquiryAssignedToId'>,
  currentUserId?: string,
): InquiryActionSpec[] {
  const status = deriveEnquiryStatus(message);
  const isAssignedToMe = !!currentUserId && message.enquiryAssignedToId === currentUserId;
  return [
    { key: 'contacted', label: 'Mark contacted', disabled: status === 'contacted' },
    { key: 'appointment', label: 'Appointment scheduled', disabled: status === 'appointment_scheduled' },
    { key: 'closed', label: 'Close', disabled: status === 'closed' },
    { key: 'assign-me', label: 'Assign to me', disabled: isAssignedToMe },
    { key: 'unassign', label: 'Unassign', disabled: !message.enquiryAssignedToId },
  ];
}

const ACTION_ICON: Record<InquiryActionSpec['key'], React.ReactNode> = {
  contacted: <Phone className="w-4 h-4" />,
  appointment: <CalendarClock className="w-4 h-4" />,
  closed: <XCircle className="w-4 h-4" />,
  'assign-me': <UserCheck className="w-4 h-4" />,
  unassign: <UserX className="w-4 h-4" />,
};

export default function InquiriesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentUser } = useAuth();
  const { users } = useUsers();
  const { showToast } = useToast();

  const [messages, setMessages] = useState<MessageDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const initialStatus = (searchParams?.get('status') as EnquiryStatus) || 'all';
  const [statusFilter, setStatusFilter] = useState<EnquiryStatus | 'all'>(
    (ENQUIRY_STATUSES as readonly string[]).includes(initialStatus) ? initialStatus : 'all',
  );
  const [typeFilter, setTypeFilter] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [assignedFilter, setAssignedFilter] = useState(searchParams?.get('assigned') || 'all');

  const [addOpen, setAddOpen] = useState(false);

  // Keep status/assigned synced both ways with the URL — same pattern as the
  // HR page's tab param — so a sidebar/dashboard link (?status=new) applies
  // and a filter change here is itself deep-linkable.
  useEffect(() => {
    const qStatus = searchParams?.get('status');
    setStatusFilter((ENQUIRY_STATUSES as readonly string[]).includes(qStatus || '') ? (qStatus as EnquiryStatus) : 'all');
    setAssignedFilter(searchParams?.get('assigned') || 'all');
  }, [searchParams]);

  const writeFilterParams = useCallback((next: { status?: EnquiryStatus | 'all'; assigned?: string }) => {
    const params = new URLSearchParams(searchParams?.toString() || '');
    if (next.status !== undefined) {
      if (next.status === 'all') params.delete('status'); else params.set('status', next.status);
    }
    if (next.assigned !== undefined) {
      if (next.assigned === 'all') params.delete('assigned'); else params.set('assigned', next.assigned);
    }
    const qs = params.toString();
    router.replace(`/inquiries${qs ? `?${qs}` : ''}`, { scroll: false });
  }, [searchParams, router]);

  const setStatusFilterAndUrl = (next: EnquiryStatus | 'all') => {
    setStatusFilter(next);
    writeFilterParams({ status: next });
  };
  const setAssignedFilterAndUrl = (next: string) => {
    setAssignedFilter(next);
    writeFilterParams({ assigned: next });
  };

  // ?new=1 — open the Add-inquiry modal once, then strip the param so it
  // doesn't reopen on subsequent filter-driven URL updates.
  const [newParamHandled, setNewParamHandled] = useState(false);
  useEffect(() => {
    if (newParamHandled) return;
    if (searchParams?.get('new') === '1') {
      setNewParamHandled(true);
      setAddOpen(true);
      const params = new URLSearchParams(searchParams.toString());
      params.delete('new');
      const qs = params.toString();
      router.replace(`/inquiries${qs ? `?${qs}` : ''}`, { scroll: false });
    }
  }, [searchParams, newParamHandled, router]);

  const loadEnquiries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const scope = currentUser
        ? { orgId: currentUser.orgId, hospitalId: currentUser.hospitalId, role: currentUser.role }
        : undefined;
      const data = await getPatientEnquiries(scope);
      setMessages(data);
    } catch (err) {
      console.error('[inquiries] failed to load:', err);
      setError('Failed to load patient inquiries.');
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => { loadEnquiries(); }, [loadEnquiries]);

  const facilityUsers = useMemo(
    () => (currentUser?.hospitalId ? users.filter(u => u.hospitalId === currentUser.hospitalId) : users),
    [users, currentUser?.hospitalId],
  );

  const typeOptions = useMemo(() => buildTypeOptions(messages), [messages]);
  const summary = useMemo(() => summariseEnquiries(messages), [messages]);

  const filtered = useMemo(
    () => filterEnquiries(messages, {
      search, status: statusFilter, type: typeFilter, from: fromDate || undefined, to: toDate || undefined, assignedTo: assignedFilter,
    }),
    [messages, search, statusFilter, typeFilter, fromDate, toDate, assignedFilter],
  );

  const activeFilterCount = [
    statusFilter !== 'all', typeFilter !== 'all', !!fromDate, !!toDate, assignedFilter !== 'all',
  ].filter(Boolean).length;

  const clearFilters = () => {
    setTypeFilter('all');
    setFromDate('');
    setToDate('');
    setStatusFilterAndUrl('all');
    setAssignedFilterAndUrl('all');
  };

  // ── Row action handlers — patch the row in place; no full refetch. ──────
  const handleSetStatus = async (id: string, status: EnquiryStatus) => {
    try {
      const updated = await setEnquiryStatus(id, status);
      if (updated) setMessages(prev => prev.map(m => (m._id === id ? updated : m)));
    } catch (err) {
      console.error('[inquiries] status update failed:', err);
      showToast('Could not update the inquiry status.', 'error');
    }
  };
  const handleAssignToMe = async (id: string) => {
    if (!currentUser) return;
    try {
      const updated = await assignEnquiry(id, { id: currentUser._id, name: currentUser.name });
      if (updated) setMessages(prev => prev.map(m => (m._id === id ? updated : m)));
    } catch (err) {
      console.error('[inquiries] assign failed:', err);
      showToast('Could not assign the inquiry.', 'error');
    }
  };
  const handleUnassign = async (id: string) => {
    try {
      const updated = await assignEnquiry(id, null);
      if (updated) setMessages(prev => prev.map(m => (m._id === id ? updated : m)));
    } catch (err) {
      console.error('[inquiries] unassign failed:', err);
      showToast('Could not unassign the inquiry.', 'error');
    }
  };

  const rowActions = (m: MessageDoc): RowAction[] =>
    buildInquiryActions(m, currentUser?._id).map(spec => ({
      key: spec.key,
      label: spec.label,
      disabled: spec.disabled,
      tone: spec.key === 'closed' ? 'danger' : spec.key === 'contacted' || spec.key === 'appointment' ? 'success' : 'default',
      icon: ACTION_ICON[spec.key],
      onClick: () => {
        if (spec.key === 'contacted') handleSetStatus(m._id, 'contacted');
        else if (spec.key === 'appointment') handleSetStatus(m._id, 'appointment_scheduled');
        else if (spec.key === 'closed') handleSetStatus(m._id, 'closed');
        else if (spec.key === 'assign-me') handleAssignToMe(m._id);
        else handleUnassign(m._id);
      },
    }));

  const filterFieldStyle = { background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)', borderRadius: 8, minWidth: 0 } as const;

  return (
    <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div className="dash-card overflow-hidden flex flex-col" style={{ flex: 1, minHeight: 0 }}>
        <EhrListHeader
          title="Patient Inquiries"
          stats={[
            { label: 'Total', value: summary.total, color: LIST_STAT_COLORS.muted },
            { label: ENQUIRY_STATUS_LABELS.new, value: summary.byStatus.new, color: LIST_STAT_COLORS.amber },
            { label: ENQUIRY_STATUS_LABELS.contacted, value: summary.byStatus.contacted, color: LIST_STAT_COLORS.blue },
            { label: ENQUIRY_STATUS_LABELS.appointment_scheduled, value: summary.byStatus.appointment_scheduled, color: LIST_STAT_COLORS.purple },
            { label: ENQUIRY_STATUS_LABELS.closed, value: summary.byStatus.closed, color: LIST_STAT_COLORS.green },
          ]}
          search={{ value: search, onChange: setSearch, placeholder: 'Search inquiries by patient, subject, or message…', ariaLabel: 'Search inquiries' }}
          actions={
            <>
              <EhrListFilters activeCount={activeFilterCount} onClear={clearFilters} panelWidth={300}>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>Status</span>
                  <Select value={statusFilter} onChange={e => setStatusFilterAndUrl(e.target.value as EnquiryStatus | 'all')} className="w-full text-sm py-2 px-3" style={filterFieldStyle} aria-label="Filter by status">
                    <option value="all">All statuses</option>
                    {ENQUIRY_STATUSES.map(s => <option key={s} value={s}>{ENQUIRY_STATUS_LABELS[s]}</option>)}
                  </Select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>Type</span>
                  <Select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="w-full text-sm py-2 px-3" style={filterFieldStyle} aria-label="Filter by type">
                    <option value="all">All types</option>
                    {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
                  </Select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>Assigned to</span>
                  <Select value={assignedFilter} onChange={e => setAssignedFilterAndUrl(e.target.value)} className="w-full text-sm py-2 px-3" style={filterFieldStyle} aria-label="Filter by assigned staff">
                    <option value="all">Everyone</option>
                    <option value="unassigned">Unassigned</option>
                    {facilityUsers.map(u => <option key={u._id} value={u._id}>{u.name}</option>)}
                  </Select>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>From</span>
                    <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} aria-label="From date" className="listpage-toolbar-date" style={{ width: '100%' }} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>To</span>
                    <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} aria-label="To date" className="listpage-toolbar-date" style={{ width: '100%' }} />
                  </label>
                </div>
              </EhrListFilters>
              <button
                type="button"
                className="listpage-icon-btn listpage-icon-btn-primary"
                onClick={() => setAddOpen(true)}
                title="Add inquiry"
                aria-label="Add inquiry"
              >
                <MessageSquarePlus size={16} color="#fff" />
              </button>
            </>
          }
        />

        <div className="show-scrollbar" style={{ overflowX: 'auto', overflowY: 'auto', flex: '1 1 0%', minHeight: 0 }}>
          <table className="w-full" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                {['Patient', 'Type', 'Date', 'Status', 'Assigned to', ''].map(h => (
                  <th
                    key={h || 'actions'}
                    className={`${h ? 'text-left' : ''} px-4 py-2.5`}
                    style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-light)', background: 'var(--bg-card-solid)' }}
                  >
                    {h && <span className="text-[11px] font-bold uppercase tracking-wider whitespace-nowrap">{h}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>Loading inquiries…</td></tr>
              )}
              {!loading && error && (
                <tr><td colSpan={6} className="p-8 text-center">
                  <p className="mb-2" style={{ color: 'var(--color-danger)' }}>{error}</p>
                  <button type="button" className="btn btn-secondary" onClick={loadEnquiries}>Retry</button>
                </td></tr>
              )}
              {!loading && !error && messages.length === 0 && (
                <tr><td colSpan={6} className="p-0">
                  <EmptyState
                    icon={MessageSquarePlus}
                    title="No patient inquiries yet"
                    message="Inbound messages from the patient portal land here for triage. You can also log a call or walk-in inquiry manually."
                    action={{ label: 'Add inquiry', onClick: () => setAddOpen(true) }}
                  />
                </td></tr>
              )}
              {!loading && !error && messages.length > 0 && filtered.length === 0 && (
                <tr><td colSpan={6} className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>No inquiries match your filters.</td></tr>
              )}
              {!loading && !error && filtered.map(m => {
                const status = deriveEnquiryStatus(m);
                const tok = STATUS_TOKENS[status];
                const assignee = enquiryAssignee(m);
                return (
                  <tr key={m._id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="ehr-patient-icon" style={avatarTint(m.patientName || m._id)}>
                          {initials(m.patientName)}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[14px] truncate" style={{ color: 'var(--ehr-text, var(--text-primary))', fontWeight: 800 }}>{m.patientName || 'Unknown patient'}</div>
                          {m.patientPhone && <div className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{m.patientPhone}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-[13px]" style={{ color: 'var(--ehr-muted, var(--text-secondary))' }}>{enquiryType(m)}</td>
                    <td className="px-4 py-2.5 text-[13px] whitespace-nowrap" style={{ color: 'var(--ehr-muted, var(--text-secondary))' }}>{formatCompactDateTime(m.sentAt || m.createdAt)}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-md whitespace-nowrap"
                        style={{ background: tok.bg, color: tok.color, border: `1px solid ${tok.color}40` }}
                      >
                        {ENQUIRY_STATUS_LABELS[status]}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[13px]" style={{ color: assignee ? 'var(--ehr-muted, var(--text-secondary))' : 'var(--text-muted)' }}>
                      {assignee || 'Unassigned'}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end">
                        <RowActionsMenu ariaLabel={`Actions for ${m.patientName || 'this inquiry'}`} actions={rowActions(m)} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {addOpen && (
        <AddInquiryDialog
          onClose={() => setAddOpen(false)}
          onCreated={created => {
            setMessages(prev => [created, ...prev]);
            setAddOpen(false);
            showToast('Inquiry logged.', 'success');
          }}
        />
      )}
    </main>
  );
}
