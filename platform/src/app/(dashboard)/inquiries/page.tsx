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
import Select from '@/components/Select';
import EhrListHeader, { EhrListHeaderButton, LIST_STAT_COLORS } from '@/components/ehr/EhrListHeader';
import RowStatusSelect, { type RowStatusOption } from '@/components/ehr/RowStatusSelect';
import { MessageSquarePlus } from '@/components/icons/lucide';
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

/** Flat status-pill palette — always paired with the text label, never color
 *  alone. `border` is carried explicitly rather than derived as `${color}40`,
 *  which produces invalid CSS for the `var(--…)` entries. */
const STATUS_TOKENS: Record<EnquiryStatus, { color: string; bg: string; border: string }> = {
  new: { color: 'var(--color-warning-text)', bg: 'rgba(254, 230, 151, 0.16)', border: 'rgba(254, 230, 151, 0.45)' },
  contacted: { color: 'var(--accent-primary)', bg: 'rgba(33, 145, 208, 0.14)', border: 'rgba(33, 145, 208, 0.40)' },
  appointment_scheduled: { color: 'var(--accent-purple)', bg: 'rgba(166, 83, 0, 0.12)', border: 'rgba(166, 83, 0, 0.35)' },
  closed: { color: 'var(--color-success-text)', bg: 'rgba(15, 160, 106, 0.12)', border: 'rgba(15, 160, 106, 0.40)' },
};

// Column template for the inquiry list head + rows:
// Patient · Type · Received · Assigned to · Status · actions
// Same tracks as the patient registry and User Accounts — identity column at
// minmax(320px, 1.6fr), four equal data columns — plus the 44px kebab gutter.
const CHANNEL_LABELS: Record<MessageDoc['channel'], string> = {
  app: 'Patient app',
  sms: 'SMS',
  both: 'App + SMS',
};

/** Unique, sorted enquiry "types" (subject lines) present in the list — feeds the type filter. */
function buildTypeOptions(messages: MessageDoc[]): string[] {
  const set = new Set<string>();
  for (const m of messages) set.add(enquiryType(m));
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/** Assignment moves aren't triage states, so they ride the status pill under
 *  their own heading with these sentinel values. */
const ASSIGN_TO_ME = '__assign-me' as const;
const UNASSIGN = '__unassign' as const;

interface InquiryActionSpec {
  value: EnquiryStatus | typeof ASSIGN_TO_ME | typeof UNASSIGN;
  label: string;
  group?: string;
}

/**
 * Pure derivation of the options a row's status pill offers. Kept free of
 * handlers/JSX so it can be unit-tested without a DOM. The current triage
 * state and any no-op assignment move are omitted rather than shown disabled:
 * a native select's disabled options are still announced, and the pill already
 * displays the current state.
 */
function buildInquiryActions(
  message: Pick<MessageDoc, 'enquiryStatus' | 'enquiryAssignedToId'>,
  currentUserId?: string,
): InquiryActionSpec[] {
  const status = deriveEnquiryStatus(message);
  const isAssignedToMe = !!currentUserId && message.enquiryAssignedToId === currentUserId;
  return [
    ...(status !== 'contacted' ? [{ value: 'contacted' as const, label: 'Mark contacted' }] : []),
    ...(status !== 'appointment_scheduled' ? [{ value: 'appointment_scheduled' as const, label: 'Appointment scheduled' }] : []),
    ...(status !== 'closed' ? [{ value: 'closed' as const, label: 'Close' }] : []),
    ...(!isAssignedToMe ? [{ value: ASSIGN_TO_ME, label: 'Assign to me', group: 'Assignment' }] : []),
    ...(message.enquiryAssignedToId ? [{ value: UNASSIGN, label: 'Unassign', group: 'Assignment' }] : []),
  ];
}

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
  const focusedInquiryId = searchParams?.get('inquiry') || null;

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
    () => focusedInquiryId
      ? messages.filter(message => message._id === focusedInquiryId)
      : filterEnquiries(messages, {
          search, status: statusFilter, type: typeFilter, from: fromDate || undefined, to: toDate || undefined, assignedTo: assignedFilter,
        }),
    [messages, focusedInquiryId, search, statusFilter, typeFilter, fromDate, toDate, assignedFilter],
  );

  useEffect(() => {
    if (!focusedInquiryId || loading) return;
    const row = document.getElementById(`inquiry-${focusedInquiryId}`);
    row?.scrollIntoView({ block: 'nearest' });
    row?.focus({ preventScroll: true });
  }, [focusedInquiryId, loading, filtered.length]);

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

  const rowOptions = (m: MessageDoc): RowStatusOption[] =>
    buildInquiryActions(m, currentUser?._id).map(spec => ({ value: spec.value, label: spec.label, group: spec.group }));

  const applyRowAction = (id: string, value: string) => {
    if (value === ASSIGN_TO_ME) handleAssignToMe(id);
    else if (value === UNASSIGN) handleUnassign(id);
    else handleSetStatus(id, value as EnquiryStatus);
  };

  const filterFieldStyle = { background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)', borderRadius: 8, minWidth: 0 } as const;

  return (
    <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div className="card-elevated overflow-hidden flex flex-col" style={{ flex: 1, minHeight: 0 }} data-tour="inquiries-list">
        <EhrListHeader
          title="Patient Inquiries"
          stats={[
            { label: 'Total', value: summary.total, color: LIST_STAT_COLORS.muted },
            { label: ENQUIRY_STATUS_LABELS.new, value: summary.byStatus.new, color: LIST_STAT_COLORS.amber },
            { label: ENQUIRY_STATUS_LABELS.contacted, value: summary.byStatus.contacted, color: LIST_STAT_COLORS.blue },
            { label: ENQUIRY_STATUS_LABELS.appointment_scheduled, value: summary.byStatus.appointment_scheduled, color: LIST_STAT_COLORS.purple },
            { label: ENQUIRY_STATUS_LABELS.closed, value: summary.byStatus.closed, color: LIST_STAT_COLORS.green },
          ]}
          search={{
            value: search, onChange: setSearch,
            placeholder: 'Search inquiries by patient, subject, or message…', ariaLabel: 'Search inquiries',
            filters: {
              activeCount: activeFilterCount,
              onClear: clearFilters,
              panelWidth: 320,
              children: (
                <>
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
                </>
              ),
            },
          }}
          actions={
            <>
              <EhrListHeaderButton primary onClick={() => setAddOpen(true)} ariaLabel="Add inquiry">
                <MessageSquarePlus size={16} color="#fff" />
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
            {/* The column head is the queue's frame, not a label for the rows
                that happen to be loaded: it stays put while loading and when a
                filter matches nothing, so the list never collapses into a bare
                message. */}
            <div className="appointment-card-head" aria-hidden="true">
              <span>Patient</span>
              <span>Type</span>
              <span>Received</span>
              <span>Assigned to</span>
              <span>Status</span>
            </div>

            {loading && <div className="appointment-card-empty">Loading inquiries…</div>}
            {!loading && error && (
              <div className="appointment-card-empty" style={{ gap: 10 }}>
                <p style={{ color: 'var(--color-danger-text)' }}>{error}</p>
                <button type="button" className="btn btn-secondary btn-sm" onClick={loadEnquiries}>Retry</button>
              </div>
            )}
            {!loading && !error && messages.length === 0 && (
              <EmptyState
                icon={MessageSquarePlus}
                title="No patient inquiries yet"
                message="Inbound messages from the patient portal land here for triage. You can also log a call or walk-in inquiry manually."
                action={{ label: 'Add inquiry', onClick: () => setAddOpen(true) }}
              />
            )}
            {!loading && !error && messages.length > 0 && filtered.length === 0 && (
              <div className="appointment-card-empty">No inquiries match your filters.</div>
            )}
            {!loading && !error && filtered.map(m => {
              const status = deriveEnquiryStatus(m);
              const tok = STATUS_TOKENS[status];
              const assignee = enquiryAssignee(m);
              return (
                <div
                  key={m._id}
                  id={`inquiry-${m._id}`}
                  tabIndex={focusedInquiryId === m._id ? 0 : undefined}
                  aria-current={focusedInquiryId === m._id ? 'true' : undefined}
                  className="ehr-appointment-row appointment-card-row"
                  style={{
                    cursor: 'default',
                    background: focusedInquiryId === m._id ? 'var(--overlay-subtle)' : undefined,
                    outline: focusedInquiryId === m._id ? '2px solid var(--accent-primary)' : undefined,
                    outlineOffset: focusedInquiryId === m._id ? -2 : undefined,
                  }}
                >
                  <div className="ehr-appointment-identity">
                    <div className="ehr-patient-icon" style={avatarTint(m.patientName || m._id)}>
                      {initials(m.patientName)}
                    </div>
                    <div className="ehr-appointment-main appointment-card-patient">
                      <strong>{m.patientName || 'Unknown patient'}</strong>
                      <p>{m.patientPhone || 'No phone on file'}</p>
                    </div>
                  </div>

                  {/* Type — the subject line, with the message itself beneath
                      it so a row can be triaged without opening anything. */}
                  <div className="appointment-card-provider">
                    <strong>{enquiryType(m)}</strong>
                    <span title={m.body || undefined}>{m.body?.trim() || 'No message body'}</span>
                  </div>

                  <div className="ehr-appointment-time">
                    <strong>{formatCompactDateTime(m.sentAt || m.createdAt)}</strong>
                    <span>{CHANNEL_LABELS[m.channel] || 'Patient app'}</span>
                  </div>

                  <div className="appointment-card-provider">
                    <strong>{assignee || 'Unassigned'}</strong>
                    <span>{assignee ? 'Front desk owner' : 'Needs an owner'}</span>
                  </div>

                  {/* Triage and ownership both move from the pill: the status
                      rungs first, then assignment in its own group. */}
                  <div className="appointment-card-status">
                    <RowStatusSelect
                      label={ENQUIRY_STATUS_LABELS[status]}
                      value={status}
                      ariaLabel={`Triage ${m.patientName || 'this inquiry'}`}
                      style={{ borderColor: tok.border, background: tok.bg, color: tok.color }}
                      options={rowOptions(m)}
                      onSelect={value => applyRowAction(m._id, value)}
                    />
                    <small>{m.fromHospitalName || 'Patient portal'}</small>
                  </div>
                </div>
              );
            })}
          </div>
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
