'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/lib/context';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import { useHospitals } from '@/lib/hooks/useHospitals';
import type { UserDoc, UserRole } from '@/lib/db-types';
import {
  UserX, UserCheck, UserPlus, Shield, Building2,
  KeyRound, RefreshCw, ShieldCheck, Eye, EyeOff, Mail, Upload,
} from '@/components/icons/lucide';
import { isRowActivationKey } from '@/components/RowActionsPopup';
import CredentialHandoffModal from '@/components/admin/CredentialHandoffModal';
import { generateTempPassword } from '@/lib/temp-password';
import { avatarTint } from '@/lib/patient-utils';
import { roleNeedsFacility, roleNeedsOrganization, validateUserScope } from '@/lib/user-scope-rules';
import type { InvitationOutcome } from '@/lib/user-invite';
import { canCreateFacilities } from '@/lib/people-nav';
import CreateFacilityModal from '@/components/admin/CreateFacilityModal';
import { activeFacilities } from '@/lib/services/hospital-service';
import Select from '@/components/Select';
import Modal from '@/components/Modal';
import { SadbPage, SadbCard, SadbKpiTile, SadbSearch, SadbConfirmModal, SadbTabs } from '@/components/admin/sadb-ui';
import { describeAccountState, canResendInvite } from '@/lib/account-state';
import { describeInvitationOutcome } from '@/lib/invitation-copy';
import { usePasswordPolicy } from '@/lib/hooks/usePasswordPolicy';
import AccountRequestQueue from '@/components/admin/AccountRequestQueue';
import BulkUserImportModal from '@/components/admin/BulkUserImportModal';

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
  const [changeRoleUser, setChangeRoleUser] = useState<UserDoc | null>(null);
  const [newRole, setNewRole] = useState<UserRole>('nurse');
  const [changingRole, setChangingRole] = useState(false);
  // "Add user" modal — super_admin can create users directly here instead of
  // detouring to /settings or /org-admin/users.
  const { hospitals, reload: reloadHospitals } = useHospitals();
  // Registering a facility from inside the user dialog. A facility-bound role
  // cannot be saved without one, and telling an operator to leave, create it
  // elsewhere, and start the form again is the dead end this whole flow had.
  const [showAddFacility, setShowAddFacility] = useState(false);
  const emptyAddForm = { name: '', username: '', email: '', password: '', role: 'nurse' as UserRole, orgId: '', hospitalId: '' };
  const [showAddUser, setShowAddUser] = useState(false);
  const [addForm, setAddForm] = useState(emptyAddForm);
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  // Password visibility is tracked separately per dialog — Add user and
  // Reset password used to share one `showAddPassword` boolean, so toggling
  // visibility in one silently flipped the other the next time it opened.
  const [showAddUserPassword, setShowAddUserPassword] = useState(true);
  const [showResetPassword, setShowResetPassword] = useState(true);
  // Credential hand-off — shown exactly once after a create or reset so the
  // admin can copy the temporary password before it is unrecoverable.
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
  const [detailUserId, setDetailUserId] = useState<string | null>(null);
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
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);

  // Deep-link support: /admin/users?q=<name> arrives pre-filtered (the audit
  // log's "View in User Management" action), while ?user=<id> isolates and
  // expands the exact account opened from a dashboard preview. window.location
  // keeps this page out of a Suspense boundary.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    if (q) setSearch(q);
    const user = params.get('user');
    if (user) {
      setFocusedUserId(user);
      setDetailUserId(user);
    }
    // ?new=1 — the facility dashboards' "Add user" buttons deep-link straight
    // into the create form with a temporary password already generated.
    if (params.has('new')) {
      setAddForm({ ...emptyAddForm, password: generateTempPassword(tempLength) });
      setShowAddUserPassword(true);
      setShowAddUser(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load all users. Hoisted out of the effect so a bulk import can ask for a
  // fresh roster when it finishes — two hundred new rows are not something to
  // patch in one at a time.
  const reloadUsers = useCallback(async () => {
    try {
      const { getAllUsers } = await import('@/lib/services/user-service');
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
      const q = search.toLowerCase();
      const matchSearch = !q || u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q) || (u.hospitalName || '').toLowerCase().includes(q);
      const matchRole = filterRole === 'all' || u.role === filterRole;
      const matchOrg = filterOrg === 'all' || u.orgId === filterOrg;
      return matchSearch && matchRole && matchOrg;
    });
  }, [users, search, filterRole, filterOrg, focusedUserId]);

  const handleChangeRole = async () => {
    if (!changeRoleUser || !currentUser) return;
    setChangingRole(true);
    try {
      const { updateUser } = await import('@/lib/services/user-service');
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
  const needsOrg = roleNeedsOrganization(addForm.role);
  const needsFacility = roleNeedsFacility(addForm.role);
  const addFacilityChoices = useMemo(
    // Retired facilities keep their records and stay readable, but nothing new
    // is assigned to them — staffing a closed site is what retiring it stops.
    () => (addForm.orgId ? activeFacilities(hospitals.filter(h => h.orgId === addForm.orgId)) : []),
    [hospitals, addForm.orgId],
  );

  /**
   * Changing the role changes what scope is required, so a stale facility from
   * a previous selection must not ride along — an org_admin carrying a
   * hospitalId is exactly the mismatch the server strips server-side, and
   * leaving it in the form makes the dialog disagree with what gets saved.
   */
  const changeAddRole = (role: UserRole) => {
    setAddError(null);
    setAddForm(f => ({ ...f, role, hospitalId: roleNeedsFacility(role) ? f.hospitalId : '' }));
  };

  const handleAddUser = async () => {
    if (!currentUser) return;
    if (!addForm.name.trim() || !addForm.username.trim() || !addForm.password) {
      setAddError('Name, username, and password are required');
      return;
    }
    if (addForm.password.length < MIN_PASSWORD_LENGTH) {
      setAddError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    // The organization and facility a role REQUIRES, checked with the same
    // rules /api/users enforces. Without this the dialog cheerfully accepted
    // "Organization: none / Facility: — None —" for a facility-bound role and
    // only surfaced the problem as a 400 after the operator had typed
    // everything, with the temporary password lost on the way back.
    const scopeError = validateUserScope({
      role: addForm.role,
      orgId: addForm.orgId,
      hospitalId: addForm.hospitalId,
    });
    if (scopeError) {
      setAddError(scopeError);
      return;
    }
    setAddSaving(true);
    setAddError(null);
    try {
      // `createUserWithInvitation` is the same POST /api/users, kept whole:
      // the route ALWAYS attempts an invitation and returns what happened, and
      // this page used to discard that. An operator was shown a temporary
      // password with no way to know a link had already been mailed — or, with
      // no email field at all, that one never could be.
      const { createUserWithInvitation } = await import('@/lib/services/user-service');
      const hospital = hospitals.find(h => h._id === addForm.hospitalId);
      const { user: created, invitation } = await createUserWithInvitation({
        name: addForm.name.trim(),
        username: addForm.username.trim(),
        email: addForm.email.trim() || undefined,
        password: addForm.password,
        role: addForm.role,
        orgId: addForm.orgId || undefined,
        hospitalId: addForm.hospitalId || undefined,
        hospitalName: hospital?.name,
      });
      setUsers(prev => [created, ...prev]);
      setShowAddUser(false);
      showToast(`User ${created.username} created.`, 'success');
      // Hand the credentials to the admin exactly once — the password is
      // never retrievable again (only its hash is stored), and the user must
      // replace it at first login.
      setHandoff({ username: created.username, password: addForm.password, kind: 'created', invitation });
      setAddForm(emptyAddForm);
    } catch (err) {
      setAddError((err as Error).message || 'Failed to create user');
      showToast(err instanceof Error ? err.message : 'Failed to create user.', 'error');
    } finally {
      setAddSaving(false);
    }
  };

  const handleResetPassword = async () => {
    if (!currentUser || !resetUser) return;
    if (resetPasswordValue.length < MIN_PASSWORD_LENGTH) {
      setResetError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    setResetting(true);
    setResetError(null);
    try {
      const { resetPassword } = await import('@/lib/services/user-service');
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
        const { deactivateUserReportingOpenWork } = await import('@/lib/services/user-service');
        const { openWork } = await deactivateUserReportingOpenWork(userId);
        if (openWork?.hasOpenWork) {
          const { describeOpenWork } = await import('@/lib/services/offboarding-service');
          setOpenWorkNotice(describeOpenWork(openWork));
        }
      } else {
        const { reactivateUser } = await import('@/lib/services/user-service');
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
  const handleResendInvite = async (user: UserDoc) => {
    setResendingId(user._id);
    try {
      const { resendUserInvite } = await import('@/lib/services/user-service');
      const invitation = await resendUserInvite(user._id);
      showToast(
        describeInvitationOutcome(invitation).message,
        invitation.sent ? 'success' : 'error',
      );
      // The document now carries a fresh invite window; reflect it in the row
      // so the state line stops saying the old invitation expired.
      setUsers(prev => prev.map(u => u._id === user._id
        ? { ...u, inviteTokenHash: 'pending', inviteExpiresAt: invitation.sent ? invitation.expiresAt : u.inviteExpiresAt }
        : u));
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not send the invitation.', 'error');
    } finally {
      setResendingId(null);
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

  const detailUser = detailUserId ? users.find(u => u._id === detailUserId) ?? null : null;
  const closeDetail = () => setDetailUserId(null);

  // Role stats
  const roleCounts: Record<string, number> = {};
  users.forEach(u => { roleCounts[u.role] = (roleCounts[u.role] || 0) + 1; });

  const kpis = [
    { label: t('adminUsers.statTotalUsers'), value: users.length },
    { label: t('adminUsers.statActiveUsers'), value: users.filter(u => u.isActive).length },
    { label: t('adminUsers.statInactiveUsers'), value: users.filter(u => !u.isActive).length },
    { label: t('adminUsers.statAdminUsers'), value: users.filter(u => u.role === 'super_admin' || u.role === 'org_admin').length },
  ];

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
      {/* ═══ KPI strip ═══ */}
      <div className="sadb-kpi-row">
        {kpis.map(k => <SadbKpiTile key={k.label} label={k.label} value={k.value} />)}
      </div>

      {/* ═══ Roster + account requests ═══ */}
      {/* One card, two tabs, not a page of its own: a request that nobody
          thinks to open is a person who never gets access. */}
      <SadbCard
        title={t('adminUsers.title')}
        meta={activeTab === 'people' ? `${filteredUsers.length} of ${users.length}` : `${requestCounts.pending} pending`}
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
            <Select value={filterRole} onChange={e => setFilterRole(e.target.value)} style={{ ...selectStyle, width: 'auto', minWidth: 200 }}>
              <option value="all">{t('adminUsers.allRoles')}</option>
              {ALL_ROLES.map(value => (
                <option key={value} value={value}>{roleLabel(value)} ({roleCounts[value] || 0})</option>
              ))}
            </Select>
            <Select value={filterOrg} onChange={e => setFilterOrg(e.target.value)} style={{ ...selectStyle, width: 'auto', minWidth: 200 }}>
              <option value="all">{t('adminUsers.allOrganizations')}</option>
              {organizations.map(o => <option key={o._id} value={o._id}>{o.name}</option>)}
            </Select>
            {/* A facility going live has two hundred people and one dialog.
                See lib/bulk-user-import.ts. */}
            <button
              type="button"
              className="btn btn-secondary btn-sm flex-shrink-0"
              onClick={() => setShowImport(true)}
            >
              <Upload className="w-4 h-4" /> Import list
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm flex-shrink-0"
              onClick={() => { setAddForm({ ...emptyAddForm, password: generateTempPassword(tempLength) }); setShowAddUserPassword(true); setAddError(null); setShowAddUser(true); }}
            >
              <UserPlus className="w-4 h-4" /> Add user
            </button>
          </div>

          {/* Same list anatomy as the clinical worklist and patient registry:
              card-list wrapper, compact column head, card rows. */}
          <div className="appointment-card-list">
            {/* The column head is the table's frame, not a label for the
                rows that happen to be loaded: it stays put while users
                load and when a filter matches nothing, so the list never
                collapses into a bare message. */}
            <div className="appointment-card-head" aria-hidden="true" style={{ gridTemplateColumns: USER_GRID }}>
              <span>{t('adminUsers.colName')}</span>
              <span>{t('adminUsers.colRole')}</span>
              <span>{t('adminUsers.colOrganization')}</span>
              <span>{t('adminUsers.colHospital')}</span>
              {/* Status values right-align (shared .appointment-card-status),
                  so its label right-aligns to the same edge. */}
              <span style={{ justifySelf: 'end', paddingInlineEnd: 6 }}>{t('adminUsers.colStatus')}</span>
            </div>
            {loading && (
              <div className="appointment-card-empty">{t('adminUsers.loadingUsers')}</div>
            )}
            {!loading && filteredUsers.length === 0 && (
              <div className="appointment-card-empty">{t('adminUsers.noUsersFound')}</div>
            )}
            {!loading && filteredUsers.map(u => (
                  <div
                    key={u._id}
                    id={`admin-user-${u._id}`}
                    className="ehr-appointment-row appointment-card-row"
                    style={{
                      gridTemplateColumns: USER_GRID,
                      background: focusedUserId === u._id ? 'var(--overlay-subtle)' : undefined,
                      outline: focusedUserId === u._id ? '2px solid var(--accent-primary)' : undefined,
                      outlineOffset: focusedUserId === u._id ? -2 : undefined,
                    }}
                    aria-current={focusedUserId === u._id ? 'true' : undefined}
                    role="button"
                    tabIndex={0}
                    aria-haspopup="dialog"
                    onClick={() => setDetailUserId(u._id)}
                    onKeyDown={e => {
                      if (isRowActivationKey(e.key)) {
                        e.preventDefault();
                        setDetailUserId(u._id);
                      }
                    }}
                  >
                    {/* User: square avatar + name/username */}
                    <div className="ehr-appointment-identity">
                      <div className="ehr-patient-icon" style={avatarTint(u.name)}>
                        {u.name.split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?'}
                      </div>
                      <div className="ehr-appointment-main appointment-card-patient">
                        <strong>{u.name}</strong>
                        <p>{u.username}</p>
                      </div>
                    </div>

                    {/* Role — value + scope, matching the shared row hierarchy. */}
                    <div className="appointment-card-provider">
                      <strong>{roleLabel(u.role)}</strong>
                      <span>{u.department || u.specialty || 'Access role'}</span>
                    </div>

                    <div className="appointment-card-provider">
                      <strong>{u.orgId ? (orgNameMap[u.orgId] || u.orgId) : 'Platform-level'}</strong>
                      <span>{t('adminUsers.colOrganization')}</span>
                    </div>

                    <div className="appointment-card-provider">
                      <strong>{u.hospitalName || 'Facility unassigned'}</strong>
                      <span>{t('adminUsers.colHospital')}</span>
                    </div>

                    {/* Status pill — shared appointment pill metrics */}
                    <div className="appointment-card-status">
                      <span
                        className="appointment-status-pill"
                        style={u.isActive
                          ? { borderColor: 'rgba(15, 160, 106,0.45)', background: 'rgba(15, 160, 106,0.10)', color: 'var(--color-success-text)' }
                          : { borderColor: 'rgba(224, 49, 39,0.45)', background: 'rgba(224, 49, 39,0.10)', color: 'var(--color-danger-text)' }}
                      >
                        {u.isActive ? t('adminUsers.statusActive') : t('adminUsers.statusInactive')}
                      </span>
                      {/* One line that can tell an unopened invitation from a
                          never-used account from an abandoned one — see
                          lib/account-state.ts for why those are three states
                          and not one. */}
                      <small style={describeAccountState(u).needsAttention
                        ? { color: 'var(--color-warning-text, var(--text-secondary))' }
                        : undefined}>
                        {describeAccountState(u).label}
                      </small>
                    </div>

                  </div>
                ))}
          </div>
        </div>

        {/* Mounted on both tabs, so the Requests badge is honest before anyone
            opens it. */}
        <div style={{ display: activeTab === 'requests' ? 'block' : 'none', padding: '4px 14px 14px' }}>
          <AccountRequestQueue viewerRole="super_admin" embedded onCountsChange={setRequestCounts} />
        </div>
      </SadbCard>

      {/* ── Account card — everything the row knows, and everything you can
             do to it, in one surface. Actions hand off to their own dialogs,
             so the card closes as each one opens rather than stacking. ── */}
      {detailUser && (
        <Modal onClose={closeDetail} width={520} labelledBy="admin-user-card-title">
          <div className="sadb-modal">
            <div className="sadb-usercard-head">
              <div className="ehr-patient-icon" style={avatarTint(detailUser.name)}>
                {detailUser.name.split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?'}
              </div>
              <div className="sadb-usercard-id">
                <h2 id="admin-user-card-title" className="sadb-modal-title">{detailUser.name}</h2>
                <p className="sadb-modal-sub">{detailUser.username} · {roleLabel(detailUser.role)}</p>
              </div>
            </div>

            <div className="sadb-usercard-rows">
              <div className="sadb-usercard-row">
                <span>{t('adminUsers.colStatus')}</span>
                <span>
                  <span
                    className="appointment-status-pill"
                    style={detailUser.isActive
                      ? { borderColor: 'rgba(15, 160, 106,0.45)', background: 'rgba(15, 160, 106,0.10)', color: 'var(--color-success-text)' }
                      : { borderColor: 'rgba(224, 49, 39,0.45)', background: 'rgba(224, 49, 39,0.10)', color: 'var(--color-danger-text)' }}
                  >
                    {detailUser.isActive ? t('adminUsers.statusActive') : t('adminUsers.statusInactive')}
                  </span>
                </span>
              </div>
              <div className="sadb-usercard-row"><span>{t('adminUsers.colRole')}</span><span>{roleLabel(detailUser.role)}</span></div>
              <div className="sadb-usercard-row"><span>Department</span><span>{detailUser.department || '—'}</span></div>
              <div className="sadb-usercard-row"><span>Specialty</span><span>{detailUser.specialty || '—'}</span></div>
              <div className="sadb-usercard-row"><span>Email</span><span>{detailUser.email || '—'}</span></div>
              <div className="sadb-usercard-row"><span>Phone</span><span>{detailUser.phone || '—'}</span></div>
              <div className="sadb-usercard-row">
                <span>{t('adminUsers.colOrganization')}</span>
                <span>{detailUser.orgId ? (orgNameMap[detailUser.orgId] || detailUser.orgId) : 'Platform-level'}</span>
              </div>
              <div className="sadb-usercard-row">
                <span>{t('adminUsers.colHospital')}</span>
                <span>{detailUser.hospitalName || 'Facility unassigned'}</span>
              </div>
              <div className="sadb-usercard-row">
                <span>Credentials</span>
                <span>{describeAccountState(detailUser).label}</span>
              </div>
              <div className="sadb-usercard-row">
                <span>Two-factor</span>
                <span>{detailUser.totpEnabledAt ? 'On' : 'Not set up'}</span>
              </div>
              <div className="sadb-usercard-row">
                <span>Last sign-in</span>
                <span>
                  {detailUser.lastLoginAt
                    ? new Date(detailUser.lastLoginAt).toLocaleString()
                    : 'Never'}
                </span>
              </div>
              <div className="sadb-usercard-row">
                <span>Created</span>
                <span>{detailUser.createdAt ? new Date(detailUser.createdAt).toLocaleDateString() : '—'}</span>
              </div>
              {detailUser.deactivatedAt && (
                <div className="sadb-usercard-row">
                  <span>Deactivated</span>
                  <span>
                    {new Date(detailUser.deactivatedAt).toLocaleDateString()}
                    {detailUser.deactivatedBy ? ` by ${detailUser.deactivatedBy}` : ''}
                  </span>
                </div>
              )}
              <div className="sadb-usercard-row"><span>User ID</span><span><code>{detailUser._id}</code></span></div>
            </div>

            <div className="sadb-usercard-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={closeDetail}>Close</button>
              <div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => { const u = detailUser; closeDetail(); setChangeRoleUser(u); setNewRole(u.role); }}
                >
                  <Shield className="w-4 h-4" /> Change role
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    const u = detailUser;
                    closeDetail();
                    setResetUser(u);
                    setResetPasswordValue(generateTempPassword(tempLength));
                    setResetError(null);
                    setShowResetPassword(true);
                  }}
                >
                  <KeyRound className="w-4 h-4" /> Reset password
                </button>
                {/* Preferred over a reset: the person sets their own password
                    from a single-use link, so no plaintext credential has to
                    be relayed. Offered only when there is an address to send
                    it to. */}
                {canResendInvite(detailUser) && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={resendingId === detailUser._id}
                    onClick={() => { const u = detailUser; closeDetail(); void handleResendInvite(u); }}
                  >
                    <Mail className="w-4 h-4" />
                    {resendingId === detailUser._id ? 'Sending…' : 'Send invitation again'}
                  </button>
                )}
                {/* Deactivating is destructive — it routes through the confirm
                    dialog. Reactivating is one reversible click, so it runs. */}
                {detailUser.isActive ? (
                  <button
                    type="button"
                    className="btn btn-sm sadb-btn-danger"
                    onClick={() => { const u = detailUser; closeDetail(); setDeactivateTarget(u); }}
                  >
                    <UserX className="w-4 h-4" /> {t('adminUsers.deactivate')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => { const u = detailUser; closeDetail(); handleToggleActive(u._id, false, u.name); }}
                  >
                    <UserCheck className="w-4 h-4" /> {t('adminUsers.activate')}
                  </button>
                )}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Add User Modal */}
      {showAddUser && (
        <Modal onClose={() => setShowAddUser(false)} width={440} labelledBy="add-user-title">
          <div className="sadb-modal">
            <div className="sadb-modal-copy">
              <h2 id="add-user-title" className="sadb-modal-title">Add user</h2>
              <p className="sadb-modal-sub">Create a platform account and hand the credentials to the staff member.</p>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold block mb-1.5" style={{ color: 'var(--text-muted)' }}>Full name</label>
                <input type="text" value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <label className="text-xs font-semibold block mb-1.5" style={{ color: 'var(--text-muted)' }}>Username</label>
                <input type="text" value={addForm.username} onChange={e => setAddForm(f => ({ ...f, username: e.target.value }))} style={inputStyle} autoComplete="off" />
              </div>
              {/* Optional, but it is the difference between the new user
                  choosing their own password from a single-use link and an
                  administrator reading a temporary one out to them. */}
              <div>
                <label className="text-xs font-semibold block mb-1.5" style={{ color: 'var(--text-muted)' }}>Email (for the invitation)</label>
                <input type="email" value={addForm.email} onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))} style={inputStyle} autoComplete="off" data-field="user-email" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold block" style={{ color: 'var(--text-muted)' }}>Temporary password</label>
                  <button
                    type="button"
                    onClick={() => { setAddForm(f => ({ ...f, password: generateTempPassword(tempLength) })); setShowAddUserPassword(true); }}
                    className="flex items-center gap-1 text-xs font-semibold"
                    style={{ color: 'var(--accent-text)' }}
                  >
                    <RefreshCw className="w-3 h-3" /> Generate
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showAddUserPassword ? 'text' : 'password'}
                    value={addForm.password}
                    onChange={e => setAddForm(f => ({ ...f, password: e.target.value }))}
                    style={{ ...inputStyle, paddingInlineEnd: 40, fontFamily: showAddUserPassword ? 'var(--font-mono, monospace)' : undefined }}
                    autoComplete="new-password"
                  />
                  <button type="button" onClick={() => setShowAddUserPassword(v => !v)} className="absolute end-3 top-1/2 -translate-y-1/2">
                    {showAddUserPassword
                      ? <EyeOff className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                      : <Eye className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />}
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                  <ShieldCheck className="w-3 h-3" /> Temporary — the user must set their own password at first login.
                </p>
              </div>
              <div>
                <label className="text-xs font-semibold block mb-1.5" style={{ color: 'var(--text-muted)' }}>Role</label>
                <Select value={addForm.role} onChange={e => changeAddRole(e.target.value as UserRole)} style={selectStyle}>
                  {ALL_ROLES.filter(r => r !== 'super_admin').map(r => (
                    <option key={r} value={r}>{roleLabel(r)}</option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="text-xs font-semibold block mb-1.5" style={{ color: 'var(--text-muted)' }}>
                  Organization{needsOrg ? ' *' : ''}
                </label>
                <Select value={addForm.orgId} onChange={e => setAddForm(f => ({ ...f, orgId: e.target.value, hospitalId: '' }))} style={selectStyle}>
                  {/* "None" is only an option for the platform and national
                      roles that genuinely have no tenant — offering it to a
                      facility role is how an unscoped account gets made. */}
                  <option value="">{needsOrg ? '— Select an organization —' : '— None (platform-level role) —'}</option>
                  {organizations.filter(o => o.isActive !== false).map(o => <option key={o._id} value={o._id}>{o.name}</option>)}
                </Select>
              </div>
              {/* Organisation-wide roles (org_admin, government, county health
                  director) are not bound to a facility, so the picker is not
                  shown for them at all rather than shown and ignored. */}
              {needsFacility && (
                <div>
                  <label className="text-xs font-semibold block mb-1.5" style={{ color: 'var(--text-muted)' }}>Facility *</label>
                  {addFacilityChoices.length > 0 ? (
                    <Select value={addForm.hospitalId} onChange={e => setAddForm(f => ({ ...f, hospitalId: e.target.value }))} style={selectStyle}>
                      <option value="">— Select a facility —</option>
                      {addFacilityChoices.map(h => (
                        <option key={h._id} value={h._id}>{h.name}</option>
                      ))}
                    </Select>
                  ) : (
                    <div
                      className="rounded-lg px-3 py-2.5 text-xs"
                      data-field="no-facilities"
                      style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)', color: 'var(--text-secondary)' }}
                    >
                      <p className="mb-1.5" style={{ color: 'var(--text-primary)' }}>
                        {addForm.orgId ? 'This organization has no facilities yet.' : 'Select an organization first.'}
                      </p>
                      {addForm.orgId && (
                        <>
                          <p className="mb-2">A {roleLabel(addForm.role).toLowerCase()} works at a facility, so one has to exist before the account can be created.</p>
                          {canCreateFacilities(currentUser?.role ?? '') && (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => setShowAddFacility(true)}
                              data-action="add-facility-inline"
                            >
                              <Building2 className="w-4 h-4" /> Add a facility
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
              {addError && (
                <p className="text-xs" style={{ color: 'var(--color-danger-text)' }}>{addError}</p>
              )}
            </div>
            <div className="sadb-modal-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowAddUser(false)} disabled={addSaving}>Cancel</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={handleAddUser} disabled={addSaving}>
                {addSaving ? 'Creating…' : 'Create user'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Registering a facility without leaving the half-filled user form. */}
      {showAddFacility && canCreateFacilities(currentUser?.role ?? '') && (
        <CreateFacilityModal
          onClose={() => setShowAddFacility(false)}
          onCreated={async hospital => {
            setShowAddFacility(false);
            await reloadHospitals();
            // Select what was just created — it is the only reason the
            // operator opened this dialog mid-form.
            setAddForm(f => ({ ...f, orgId: hospital.orgId || f.orgId, hospitalId: hospital._id }));
            showToast(`Facility ${hospital.name} created.`, 'success');
          }}
          orgId={addForm.orgId || undefined}
          organizations={addForm.orgId ? undefined : organizations}
          actor={{ _id: currentUser?._id, username: currentUser?.username }}
        />
      )}

      {/* Credential hand-off — shown once after a create or reset */}
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
      {showImport && (
        <BulkUserImportModal
          onClose={() => setShowImport(false)}
          onImported={() => { void reloadUsers(); }}
          // A platform operator belongs to no organization, so the roster's own
          // filter is what says which tenant these accounts are for.
          orgId={filterOrg === 'all' ? undefined : filterOrg}
          orgName={organizations.find(o => o._id === filterOrg)?.name}
        />
      )}

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
