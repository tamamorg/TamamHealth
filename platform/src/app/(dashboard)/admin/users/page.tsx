'use client';

import { AccountRequestQueue, CredentialHandoffModal, describeAccountState, generateTempPassword, usePasswordPolicy } from '@/modules/identity/client';
import type { InvitationOutcome } from '@/modules/identity/client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import type { UserDoc, UserRole } from '@/lib/db-types';
import { UserPlus, RefreshCw, Eye, EyeOff, Maximize2, X } from '@/components/icons/lucide';


import Select from '@/components/Select';
import Modal from '@/components/Modal';
import { UserForm } from '@/components/admin/UserForm';
import {
  SadbPage, SadbCard, SadbSearch, SadbConfirmModal, SadbTabs,
  SadbGridList, SadbGridRow, SadbChip, SadbKpiTile,
} from '@/components/admin/sadb-ui';
import { EhrListFilters } from '@/components/ehr/EhrListHeader';
import { FilterSelect } from '@/components/filters';

// Column template for the user list header + rows:
// User · Role · Organization · Facility · Status · Actions
// The first five tracks match .appointment-card-row's shared grid
// (minmax(320px, 1.6fr) + minmax(150px, 1fr) columns) so this list lines up
// with the clinical worklist and patient registry; only the trailing actions
// gutter is narrower, since it holds a lone kebab instead of a data column.
// Five tracks, no trailing action gutter: the row itself opens the actions,
// so the 44px that column used to hold goes back to the data.
const USER_GRID = 'minmax(320px, 1.6fr) repeat(4, minmax(150px, 1fr))';

// Every UserRole, in the order the role selects/distribution render them.
// roleLabel() (below) is the single source of display text — this array only
// enumerates the keys, so there is no longer a second label map to drift
// out of sync with the locale files.
const ALL_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'nurse', 'midwife',
  'lab_tech', 'pharmacist', 'front_desk', 'cashier', 'government', 'county_health_director',
  'data_entry_clerk', 'medical_superintendent', 'hrio', 'nutritionist', 'radiologist',
  'hospital_manager', 'medical_biller', 'central_registration_clerk', 'clinic_clerk',
  'triage_nurse', 'rooming_nurse', 'clinician', 'records_hmis_officer',
];

export default function AdminUsersPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const roleLabel = (role: string) => t(`adminUsers.role_${role}`);
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const { organizations } = useOrganizations();
  const [users, setUsers] = useState<UserDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [focusedUserId, setFocusedUserId] = useState<string | null>(null);
  const [filterRole, setFilterRole] = useState<string>('all');
  const [filterOrg, setFilterOrg] = useState<string>('all');
  const [filterReview, setFilterReview] = useState(false);
  const [changeRoleUser, setChangeRoleUser] = useState<UserDoc | null>(null);
  const [newRole, setNewRole] = useState<UserRole>('nurse');
  const [changingRole, setChangingRole] = useState(false);
  // "Add user" modal — super_admin can create users directly here instead of
  // detouring to /settings or /org-admin/users.
  // Registering a facility from inside the user dialog. A facility-bound role
  // cannot be saved without one, and telling an operator to leave, create it
  // elsewhere, and start the form again is the dead end this whole flow had.
  const [showResetPassword, setShowResetPassword] = useState(true);
  // Credential hand-off — shown exactly once after a create or reset so the
  // admin can copy the temporary password before it is unrecoverable.
  const activeCount = users.filter(u => u.isActive).length;
  const adminCount = users.filter(u => u.role === 'super_admin' || u.role === 'org_admin').length;
  // Invitations never opened, accounts never used, credentials still temporary
  // — the three states `describeAccountState` separates, counted together
  // because they all mean "somebody has to do something about this account".
  const attentionCount = users.filter(u => u.isActive && describeAccountState(u).needsAttention).length;
  const [showAddUser, setShowAddUser] = useState(false);
  const [handoff, setHandoff] = useState<{
    username: string;
    password: string;
    kind: 'created' | 'reset';
    /** What became of the invitation email — absent on a reset. */
    invitation?: InvitationOutcome;
  } | null>(null);
  // Reset-password modal
  const [resetUser, setResetUser] = useState<UserDoc | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  // Deactivate confirm — deactivation used to fire straight off the row menu
  // with no confirmation at all; it now goes through the same danger-confirm
  // pattern as every other destructive admin action.
  const [deactivateTarget, setDeactivateTarget] = useState<UserDoc | null>(null);
  // Deletion, which deactivation is not: the account document goes, and with
  // it the ability to sign in under that username ever again. Deactivate is
  // the reversible answer and stays the default; this is for the account that
  // should never have existed (a typo, a test, a duplicate).
  const [deleteTarget, setDeleteTarget] = useState<UserDoc | null>(null);
  const [deleting, setDeleting] = useState(false);
  // One popup for the whole list — the row that was clicked supplies its own
  // actions and the pointer position, so a hundred rows cost one portal.
  // Opening a row opens its card: the account's full record and everything
  // you can do to it in one surface, rather than a menu whose first item
  // expanded a strip the menu was then covering.
  //
  // Held by id, not by document: the roster updates rows in place (activating
  // an account rewrites its `isActive` without a refetch), and a card holding
  // its own copy would go on showing the state the row had when it opened. It
  // also lets ?user=<id> open a card before the roster has finished loading.
  const [deactivating, setDeactivating] = useState(false);
  // Roster and account requests are two views of one card: approving a request
  // IS creating a user, so it belongs where users are managed rather than in a
  // panel of its own above the list.
  const [activeTab, setActiveTab] = useState<'people' | 'requests'>('people');
  const [requestCounts, setRequestCounts] = useState({ pending: 0, decided: 0 });
  // Security settings → Password minimum. This page carried its own literal 8.
  const { minLength: MIN_PASSWORD_LENGTH, tempLength } = usePasswordPolicy();
  // Open work the just-deactivated account still owned, shown after the fact —
  // revoking access is never held up by it.
  const [openWorkNotice, setOpenWorkNotice] = useState<string | null>(null);

  // Deep-link support: /admin/users?q=<name> arrives pre-filtered (the audit
  // log's "View in User Management" action), while ?user=<id> isolates and
  // expands the exact account opened from a dashboard preview. window.location
  // keeps this page out of a Suspense boundary.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    if (q) setSearch(q);
    // Both deep links used to open a dialog over this roster; they now go to
    // the page that replaced it, so an inbound link lands on the account (or
    // the create form) rather than on a list with something floating over it.
    const user = params.get('user');
    if (user) {
      setFocusedUserId(user);
      router.replace(`/admin/users/${encodeURIComponent(user)}`);
      return;
    }
    // ?new=1 — the facility dashboards' "Add user" buttons deep-link straight
    // into the create form.
    if (params.has('new')) router.replace('/admin/users/new');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load all users. Hoisted out of the effect so a bulk import can ask for a
  // fresh roster when it finishes — two hundred new rows are not something to
  // patch in one at a time.
  const reloadUsers = useCallback(async () => {
    try {
      const { getAllUsers } = await import('@/modules/identity/services/user-service');
      setUsers(await getAllUsers());
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reloadUsers(); }, [reloadUsers]);

  const filteredUsers = useMemo(() => {
    if (focusedUserId) return users.filter(u => u._id === focusedUserId);
    return users.filter(u => {
    // Platform operators are not staff of any tenant, and a roster is a
    // staffing list: a super_admin sitting in it invited role changes and
    // deactivations from a screen that exists to run a facility. The account
    // stays reachable by its ?user= deep link (that branch runs first), so
    // nothing became unmanageable — it just stopped being listed here.
    if (u.role === 'super_admin') return false;
      const q = search.toLowerCase();
      const matchSearch = !q || u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q) || (u.hospitalName || '').toLowerCase().includes(q);
      const matchRole = filterRole === 'all' || u.role === filterRole;
      const matchOrg = filterOrg === 'all' || u.orgId === filterOrg;
      // "Needs attention" is the access review: everything a roster row is
      // already flagging, gathered into one list.
      if (filterReview && !(u.isActive !== false && describeAccountState(u).needsAttention)) return false;
      return matchSearch && matchRole && matchOrg;
    });
  }, [users, search, filterRole, filterOrg, filterReview, focusedUserId]);

  const handleChangeRole = async () => {
    if (!changeRoleUser || !currentUser) return;
    setChangingRole(true);
    try {
      const { updateUser } = await import('@/modules/identity/services/user-service');
      await updateUser(changeRoleUser._id, { role: newRole } as Partial<UserDoc>, currentUser._id, currentUser.username);
      setUsers(prev => prev.map(u => u._id === changeRoleUser._id ? { ...u, role: newRole } : u));
      showToast(`${changeRoleUser.name}'s role changed to ${roleLabel(newRole)}.`, 'success');
      setChangeRoleUser(null);
    } catch (err) {
      console.error(err);
      showToast(err instanceof Error ? err.message : 'Failed to change role.', 'error');
    } finally {
      setChangingRole(false);
    }
  };

  // What the SELECTED role requires, and which facilities can satisfy it.
  // A facility only counts when it belongs to the chosen organization —
  // offering one from another tenant would produce a cross-tenant account
  // that /api/users rejects ("Assigned hospital does not belong to the
  // selected organization").
  const handleResetPassword = async () => {
    if (!currentUser || !resetUser) return;
    if (resetPasswordValue.length < MIN_PASSWORD_LENGTH) {
      setResetError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    setResetting(true);
    setResetError(null);
    try {
      const { resetPassword } = await import('@/modules/identity/services/user-service');
      await resetPassword(resetUser._id, resetPasswordValue, currentUser._id, currentUser.username);
      setUsers(prev => prev.map(u => u._id === resetUser._id ? { ...u, mustChangePassword: true } : u));
      showToast(`Password reset for ${resetUser.username}.`, 'success');
      setHandoff({ username: resetUser.username, password: resetPasswordValue, kind: 'reset' });
      setResetUser(null);
      setResetPasswordValue('');
    } catch (err) {
      setResetError((err as Error).message || 'Failed to reset password');
      showToast(err instanceof Error ? err.message : 'Failed to reset password.', 'error');
    } finally {
      setResetting(false);
    }
  };

  const handleToggleActive = async (userId: string, currentlyActive: boolean, userLabel: string) => {
    if (!currentUser) return;
    try {
      // Both directions go through their own dedicated action. Activation used
      // to call `updateUser({ isActive: true })`, which lands on the generic
      // `update` handler — and that re-validates the account's organization and
      // hospital before saving anything. Re-activating someone whose org had
      // since been deactivated (or deleted) therefore failed with "Assigned
      // organization was not found or is inactive", a check that has nothing to
      // do with turning a login back on. Deactivation never had the problem
      // because it always used its own action; this makes the pair symmetric.
      if (currentlyActive) {
        const { deactivateUserReportingOpenWork } = await import('@/modules/identity/services/user-service');
        const { openWork } = await deactivateUserReportingOpenWork(userId);
        if (openWork?.hasOpenWork) {
          const { describeOpenWork } = await import('@/modules/identity/services/offboarding-service');
          setOpenWorkNotice(describeOpenWork(openWork));
        }
      } else {
        const { reactivateUser } = await import('@/modules/identity/services/user-service');
        await reactivateUser(userId, currentUser._id, currentUser.username);
      }
      // Update the row in place — refetching the entire user list after every
      // toggle is wasteful and causes flicker. The service has already
      // persisted the change at this point.
      setUsers(prev => prev.map(u => u._id === userId ? { ...u, isActive: !currentlyActive } : u));
      showToast(currentlyActive ? `${userLabel} deactivated.` : `${userLabel} activated.`, 'success');
    } catch (err) {
      console.error(err);
      showToast(err instanceof Error ? err.message : 'Failed to update user status.', 'error');
    }
  };

  /**
   * Send the invitation again.
   *
   * The alternative — and until now the only option — was an admin password
   * reset, which puts a plaintext credential back into the room. Re-issuing
   * kills the previous link, which is what "send it again" means.
   */
  const confirmDelete = async () => {
    if (!deleteTarget || !currentUser) return;
    setDeleting(true);
    try {
      const { deleteUser } = await import('@/modules/identity/services/user-service');
      await deleteUser(deleteTarget._id, currentUser._id, currentUser.username);
      showToast(`${deleteTarget.name} deleted`, 'success');
      setDeleteTarget(null);
      await reloadUsers();
    } catch (err: unknown) {
      showToast((err as Error).message || 'Could not delete this account', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const confirmDeactivate = async () => {
    if (!deactivateTarget) return;
    setDeactivating(true);
    try {
      await handleToggleActive(deactivateTarget._id, true, deactivateTarget.name);
    } finally {
      setDeactivating(false);
      setDeactivateTarget(null);
    }
  };

  const orgNameMap: Record<string, string> = {};
  organizations.forEach(o => { orgNameMap[o._id] = o.name; });

  // The roster row opens the account's own page. It used to open a dialog
  // that had to close itself before any of its six actions could run, so every
  // consequential action began by destroying the record it was about.
  const openUser = (id: string) => router.push(`/admin/users/${encodeURIComponent(id)}`);

  // Role stats
  const roleCounts: Record<string, number> = {};
  users.forEach(u => { roleCounts[u.role] = (roleCounts[u.role] || 0) + 1; });

  // The access-review list, derived from the same `describeAccountState` the
  // rows show — an unopened invitation, an account still on a temporary
  // password, one nobody has used in 90 days. One definition, two surfaces.
  const needsAttention = useMemo(
    () => users.filter(u => u.isActive !== false && describeAccountState(u).needsAttention),
    [users],
  );

  const inputStyle: React.CSSProperties = {
    background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)',
    borderRadius: '4px', padding: '10px 14px', color: 'var(--text-primary)',
    fontSize: '14px', width: '100%', outline: 'none',
  };
  // No custom chevron artwork here — the global `select` rule already draws
  // one (globals.css); this only reserves room for it, since inline padding
  // would otherwise override the stylesheet's own padding-right.
  const selectStyle: React.CSSProperties = { ...inputStyle, paddingInlineEnd: 40 };

  return (
    <SadbPage>
      {/* ═══ Roster vitals — the same tile strip /admin/organizations opens
          with. The tiles are the ONLY place these figures render: the head's
          legend chips said the same four numbers again and are gone
          (2026-08-23). ═══ */}
      <div className="sadb-kpi-row">
        <SadbKpiTile
          label={t('adminUsers.statTotalUsers')}
          value={users.length}
          delta={t('adminUsers.acrossPlatform')}
        />
        <SadbKpiTile
          label={t('adminUsers.statActiveUsers')}
          value={activeCount}
          delta={t('adminUsers.ofTotal', { total: users.length })}
          deltaTone={activeCount > 0 ? 'up' : undefined}
        />
        <SadbKpiTile
          label={t('adminUsers.needsAttention')}
          value={attentionCount}
          delta={attentionCount > 0 ? t('adminUsers.attentionNote') : t('adminUsers.allSettled')}
          deltaTone={attentionCount > 0 ? 'warn' : undefined}
        />
        <SadbKpiTile
          label={t('adminUsers.statAdminUsers')}
          value={adminCount}
          delta={t('adminUsers.adminNote')}
        />
      </div>

      {/* ═══ Roster + account requests — one card, organizations-style ═══
          The two filter selects and the review toggle live in a Filters
          popover, so the toolbar is search · Filters · Add rather than six
          controls fighting for one row. */}
      <SadbCard
        title={t('adminUsers.title')}
        action={
          <SadbTabs
            tabs={[
              { key: 'people', label: 'People', count: users.length },
              { key: 'requests', label: 'Requests', count: requestCounts.pending },
            ]}
            active={activeTab}
            onChange={key => setActiveTab(key as 'people' | 'requests')}
            ariaLabel="User management views"
          />
        }
      >
        <div style={{ display: activeTab === 'people' ? undefined : 'none' }}>
          <div className="sadb-search-row">
            <SadbSearch value={search} onChange={setSearch} placeholder={t('adminUsers.searchPlaceholder')} />
            <EhrListFilters
              activeCount={(filterRole !== 'all' ? 1 : 0) + (filterOrg !== 'all' ? 1 : 0) + (filterReview ? 1 : 0)}
              onClear={() => { setFilterRole('all'); setFilterOrg('all'); setFilterReview(false); }}
            >
              <FilterSelect
                label={t('adminUsers.colRole')}
                value={filterRole}
                onChange={setFilterRole}
                neutralValue="all"
                size="sm"
                options={[
                  { value: 'all', label: t('adminUsers.allRoles') },
                  ...ALL_ROLES.map(value => ({ value, label: `${roleLabel(value)} (${roleCounts[value] || 0})` })),
                ]}
              />
              <FilterSelect
                label={t('adminUsers.colOrganization')}
                value={filterOrg}
                onChange={setFilterOrg}
                neutralValue="all"
                size="sm"
                options={[
                  { value: 'all', label: t('adminUsers.allOrganizations') },
                  ...organizations.map(o => ({ value: o._id, label: o.name })),
                ]}
              />
              <button
                type="button"
                className={`btn btn-sm ${filterReview ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setFilterReview(v => !v)}
                aria-pressed={filterReview}
                title="Invitations nobody opened, accounts still on a temporary password, and accounts unused for 90 days"
              >
                Needs attention{needsAttention.length ? ` (${needsAttention.length})` : ''}
              </button>
            </EhrListFilters>
                        <button
              type="button"
              className="btn btn-primary btn-sm flex-shrink-0"
              onClick={() => setShowAddUser(true)}
            >
              <UserPlus className="w-4 h-4" /> Add user
            </button>
          </div>

          {/* The registry's own grid — one row, one account, the same
              anatomy /admin/organizations uses. It was the clinical worklist's
              card list, which carried an initials plate per row and repeated
              the column name UNDER every value ("Access role", "Organization",
              "Hospital"): a header row and then the same words again, thirty
              times down the page. */}
          <SadbGridList
            template={USER_GRID}
            minWidth={880}
            head={[
              t('adminUsers.colName'), t('adminUsers.colRole'),
              t('adminUsers.colOrganization'), t('adminUsers.colHospital'),
              t('adminUsers.colStatus'),
            ]}
            alignEndLast
            empty={loading ? t('adminUsers.loadingUsers') : t('adminUsers.noUsersFound')}
          >
            {!loading && filteredUsers.map(u => {
              const account = describeAccountState(u);
              return (
                <SadbGridRow
                  key={u._id}
                  template={USER_GRID}
                  onClick={() => openUser(u._id)}
                >
                  <span className="min-w-0">
                    <span className="sadb-tenant-name truncate" style={{ color: u.isActive ? undefined : 'var(--text-muted)' }}>
                      {u.name}
                    </span>
                    <span className="sadb-tenant-sub truncate">{u.username}</span>
                  </span>
                  <span className="truncate">{roleLabel(u.role)}</span>
                  <span className="truncate">
                    {u.orgId ? (orgNameMap[u.orgId] || u.orgId) : t('adminUsers.platformLevel')}
                  </span>
                  <span className="truncate">{u.hospitalName || t('adminUsers.facilityUnassigned')}</span>
                  <span style={{ textAlign: 'end' }}>
                    <SadbChip tone={u.isActive ? 'green' : 'red'}>
                      {u.isActive ? t('adminUsers.statusActive') : t('adminUsers.statusInactive')}
                    </SadbChip>
                    {/* One line that can tell an unopened invitation from a
                        never-used account from an abandoned one — see
                        lib/account-state.ts for why those are three states. */}
                    <span className="sadb-tenant-sub" style={account.needsAttention
                      ? { color: 'var(--color-warning-text, var(--text-secondary))' }
                      : undefined}>
                      {account.label}
                    </span>
                  </span>
                </SadbGridRow>
              );
            })}
          </SadbGridList>
        </div>

        {/* Mounted on both tabs, so the Requests badge is honest before anyone
            opens it. */}
        <div style={{ display: activeTab === 'requests' ? 'block' : 'none', padding: '4px 14px 14px' }}>
          <AccountRequestQueue viewerRole="super_admin" embedded onCountsChange={setRequestCounts} />
        </div>
      </SadbCard>

      {/* Credential hand-off — shown once after a create or reset */}
      {/* Create user — dialog first, with an expand to the full page. The
          same shape the organization form has: most accounts are four fields
          and a role, which is a dialog's worth of work; the page is for when
          the scope section needs room (a facility that has to be registered
          before the account can be assigned to it). */}
      {showAddUser && (
        <Modal onClose={() => setShowAddUser(false)} width={560} labelledBy="add-user-title">
          <div className="sadb-modal" style={{ minHeight: 0, overflowY: 'auto', maxHeight: 'min(78vh, 720px)' }}>
            <div className="flex items-start justify-between gap-3 sadb-modal-copy">
              <h2 id="add-user-title" className="sadb-modal-title">{t('adminUsers.createUser')}</h2>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => { setShowAddUser(false); router.push('/admin/users/new'); }}
                  className="p-1.5 rounded-lg"
                  style={{ background: 'var(--overlay-subtle)' }}
                  aria-label={t('orgAdmin.openFullPage')}
                  title={t('orgAdmin.openFullPage')}
                  data-action="user-create-expand"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddUser(false)}
                  className="p-1.5 rounded-lg"
                  style={{ background: 'var(--overlay-subtle)' }}
                  aria-label={t('action.close')}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <UserForm
              onCancel={() => setShowAddUser(false)}
              onSaved={({ user, handoff: h }) => {
                setShowAddUser(false);
                setUsers(prev => [user, ...prev]);
                showToast(t('adminUsers.createdToast', { name: user.username }), 'success');
                // The one-time password outlives the form that produced it, so
                // the panel belongs to this page — the form unmounts with the
                // dialog it was in.
                setHandoff({ username: h.username, password: h.password, kind: 'created', invitation: h.invitation });
              }}
            />
          </div>
        </Modal>
      )}

      {handoff && (
        <CredentialHandoffModal
          title={handoff.kind === 'created' ? t('adminUsers.handoffCreatedTitle') : t('adminUsers.handoffResetTitle')}
          description={t('adminUsers.handoffDescription')}
          username={handoff.username}
          password={handoff.password}
          invitation={handoff.invitation}
          onClose={() => setHandoff(null)}
        />
      )}

      {/* Reset Password Modal — danger treatment: resetting credentials ends
          every other signed-in session for the account immediately. */}
      {resetUser && (
        <Modal onClose={() => setResetUser(null)} width={400} labelledBy="reset-pw-title">
          <div className="sadb-modal sadb-modal--danger">
            <div className="sadb-modal-copy">
              <h2 id="reset-pw-title" className="sadb-modal-title sadb-modal-title--danger">Reset password</h2>
              <p className="sadb-modal-sub">
                Set a temporary password for <strong style={{ color: 'var(--text-primary)' }}>{resetUser.username}</strong>. Every other signed-in session for this account ends immediately. This action is written to the audit log with your identity.
              </p>
            </div>

            {resetError && (
              <p className="text-xs mb-2" style={{ color: 'var(--color-danger-text)' }}>{resetError}</p>
            )}

            <div className="flex justify-end mb-1.5">
              <button
                type="button"
                onClick={() => { setResetPasswordValue(generateTempPassword(tempLength)); setShowResetPassword(true); }}
                className="flex items-center gap-1 text-xs font-semibold"
                style={{ color: 'var(--accent-text)' }}
              >
                <RefreshCw className="w-3 h-3" /> Generate
              </button>
            </div>
            <div className="relative">
              <input
                type={showResetPassword ? 'text' : 'password'}
                value={resetPasswordValue}
                onChange={e => setResetPasswordValue(e.target.value)}
                style={{ ...inputStyle, paddingInlineEnd: 40, fontFamily: showResetPassword ? 'var(--font-mono, monospace)' : undefined }}
                autoComplete="new-password"
              />
              <button type="button" onClick={() => setShowResetPassword(v => !v)} className="absolute end-3 top-1/2 -translate-y-1/2">
                {showResetPassword
                  ? <EyeOff className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                  : <Eye className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />}
              </button>
            </div>

            <div className="sadb-modal-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setResetUser(null)} disabled={resetting}>Cancel</button>
              <button type="button" className="btn btn-sm sadb-btn-danger" onClick={handleResetPassword} disabled={resetting}>
                {resetting ? 'Resetting…' : 'Reset password'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Change Role Modal */}
      {changeRoleUser && (
        <Modal onClose={() => setChangeRoleUser(null)} width={400} labelledBy="change-role-title">
          <div className="sadb-modal">
            <div className="sadb-modal-copy">
              <h2 id="change-role-title" className="sadb-modal-title">Change role — {changeRoleUser.name}</h2>
              <p className="sadb-modal-sub">Current: {roleLabel(changeRoleUser.role)}</p>
            </div>
            <label className="text-xs font-semibold block mb-1.5" style={{ color: 'var(--text-muted)' }}>New role</label>
            <Select value={newRole} onChange={e => setNewRole(e.target.value as UserRole)} style={selectStyle}>
              {ALL_ROLES.filter(r => r !== 'super_admin').map(r => (
                <option key={r} value={r}>{roleLabel(r)}</option>
              ))}
            </Select>
            <div className="sadb-modal-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setChangeRoleUser(null)} disabled={changingRole}>Cancel</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={handleChangeRole} disabled={changingRole || newRole === changeRoleUser.role}>
                {changingRole ? 'Saving…' : 'Save role'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Deactivate confirm — the destructive path off the row menu. */}

      {/* Shown after the account is closed, never as a gate on closing it. */}
      {openWorkNotice && (
        <SadbConfirmModal
          title="Reassign this person's work"
          body={openWorkNotice}
          confirmLabel="I will reassign it"
          onCancel={() => setOpenWorkNotice(null)}
          onConfirm={() => setOpenWorkNotice(null)}
        />
      )}

      {deleteTarget && (
        <SadbConfirmModal
          title={`Delete ${deleteTarget.name}?`}
          body={`The account @${deleteTarget.username} is removed permanently. Their record of past activity stays in the audit log, but the account itself cannot be restored — deactivate instead if they may return.`}
          confirmLabel={deleting ? 'Deleting…' : 'Delete account'}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
          busy={deleting}
        />
      )}
      {deactivateTarget && (
        <SadbConfirmModal
          title={`Deactivate ${deactivateTarget.name}?`}
          body={`${deactivateTarget.name} will immediately lose access to the platform.`}
          confirmLabel={deactivating ? 'Deactivating…' : 'Deactivate user'}
          onCancel={() => setDeactivateTarget(null)}
          onConfirm={confirmDeactivate}
          busy={deactivating}
        />
      )}
    </SadbPage>
  );
}
