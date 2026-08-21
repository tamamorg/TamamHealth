'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { InvitationOutcome } from '@/lib/user-invite';
import {
  Plus, KeyRound, Users,
  UserX, UserCheck, X, Eye, EyeOff, ChevronDown, AlertCircle,
  Copy, Check, RefreshCw, ShieldCheck,
} from '@/components/icons/lucide';
import RowActionsPopup, { rowActionsAt, rowActionsFromElement, isRowActivationKey, type RowActionsPopupState } from '@/components/RowActionsPopup';
import type { RowAction } from '@/components/RowActionsMenu';
import { avatarTint } from '@/lib/patient-utils';
import EhrListHeader, { EhrListFilters, LIST_STAT_COLORS, ehrTabId, ehrTabPanelId } from '@/components/ehr/EhrListHeader';
import { FilterSelect } from '@/components/filters';
import EmptyState from '@/components/EmptyState';
import Select from '@/components/Select';
import { generateTempPassword } from '@/lib/temp-password';
import { canCreateUsers } from '@/lib/people-nav';
import { getRoleConfig, labelRolesDistinctly } from '@/lib/permissions';
import AccountRequestQueue from '@/components/admin/AccountRequestQueue';

const MIN_PASSWORD_LENGTH = 8;
import type { UserDoc, HospitalDoc, UserRole } from '@/lib/db-types';
import type { DataScope } from '@/lib/services/data-scope';

// Column template for the user list header + rows:
// User · Role · Facility · Status · Actions
// The first four tracks match .appointment-card-row's shared grid
// (minmax(320px, 1.6fr) + minmax(150px, 1fr) columns) so this list lines up
// with the clinical worklist and patient registry; only the trailing actions
// gutter is narrower, since it holds a lone kebab instead of a data column.
// No trailing action gutter — the row opens the actions, so the 44px it held
// goes back to the data columns.
const USER_GRID = 'minmax(320px, 1.6fr) repeat(3, minmax(150px, 1fr))';

export default function OrgUsersPage() {
  const { currentUser, globalSearch } = useApp();
  const router = useRouter();
  const { t } = useTranslation();
  const [users, setUsers] = useState<UserDoc[]>([]);
  const [hospitals, setHospitals] = useState<HospitalDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState<string | null>(null);
  // One popup for the list; the clicked row supplies its actions and position.
  const [rowMenu, setRowMenu] = useState<RowActionsPopupState | null>(null);

  /** What a row offers. Deactivate is hidden for your own account — locking
   *  yourself out of the console is never the intent behind that click. */
  const actionsFor = (user: UserDoc): RowAction[] => [
    {
      key: 'reset',
      label: t('orgUsers.resetPassword'),
      icon: <KeyRound className="w-4 h-4" style={{ color: 'var(--color-warning)' }} />,
      onClick: () => { setError(''); setShowResetModal(user._id); setResetPassword(''); },
    },
    ...(user.isActive && user._id !== currentUser?._id
      ? [{ key: 'deactivate', label: t('orgUsers.deactivate'), tone: 'danger' as const, icon: <UserX className="w-4 h-4" />, onClick: () => handleDeactivate(user._id) }]
      : []),
    ...(!user.isActive
      ? [{ key: 'reactivate', label: t('orgUsers.reactivate'), tone: 'success' as const, icon: <UserCheck className="w-4 h-4" />, onClick: () => handleReactivate(user._id) }]
      : []),
  ];
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [availableRoles, setAvailableRoles] = useState<UserRole[]>([]);
  const [filterRole, setFilterRole] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [focusedUserId, setFocusedUserId] = useState<string | null>(null);
  // The roster and the requests to join it are one screen with two views:
  // approving a request IS creating a user, so it belongs where users are
  // managed rather than on a panel of its own that nobody thinks to open.
  const [activeTab, setActiveTab] = useState<'people' | 'requests'>('people');
  const [requestCounts, setRequestCounts] = useState({ pending: 0, decided: 0 });

  // Create form state
  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formName, setFormName] = useState('');
  // Optional on purpose: plenty of staff here have no work address, and an
  // account must not be blocked on one. With an address the person is
  // emailed a link to set their own password; without one the admin hands
  // over the temporary password shown after creation, exactly as before.
  const [formEmail, setFormEmail] = useState('');
  const [formRole, setFormRole] = useState<UserRole>('doctor');
  const [formHospitalId, setFormHospitalId] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [creating, setCreating] = useState(false);

  // Reset password state
  const [resetPassword, setResetPassword] = useState('');
  const [resetting, setResetting] = useState(false);

  // Credential hand-off panel — shown after create/reset so the admin can copy
  // the temporary password to give to the new user.
  const [handoff, setHandoff] = useState<{
    username: string;
    password: string;
    kind: 'created' | 'reset';
    /** What actually happened to the invitation email, straight from the
     *  server. Absent for a password reset, which sends nothing. */
    invitation?: InvitationOutcome;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const brandColor = currentUser?.branding?.primaryColor || 'var(--accent-primary)';

  const loadData = useCallback(async () => {
    // Still hydrating the session — a later run (currentUser dependency)
    // does the real load, so keep the spinner.
    if (!currentUser) return;
    // Signed in but no organization: this page has nothing to scope to.
    // Returning while `loading` stayed true left the spinner up FOREVER for
    // the platform super_admin (who has no orgId) — stop loading so the
    // redirect below (or an empty list) can render instead.
    if (!currentUser.orgId) {
      setLoading(false);
      return;
    }
    try {
      // `userId` matters here: filterByScope hides peer org_admin accounts from
      // an org admin, and this is what keeps their OWN account in the roster.
      const scope: DataScope = {
        orgId: currentUser.orgId,
        role: currentUser.role as UserRole,
        userId: currentUser._id,
      };
      const [{ getAllUsers }, { getAllHospitals }, { assignableRolesForOrgAdmin }] = await Promise.all([
        import('@/lib/services/user-service'),
        import('@/lib/services/hospital-service'),
        import('@/lib/permissions'),
      ]);

      const [u, h] = await Promise.all([
        getAllUsers(scope),
        getAllHospitals(scope),
      ]);

      setUsers(u);
      setHospitals(h);

      // Which roles this admin may hand out.
      //
      // `orgType` only chooses between the full list and the private-sector
      // subset, and `getAvailableRoles` already treats anything that is not
      // 'private' as public — so an organization document that has not loaded
      // should narrow nothing. Gating the whole computation on
      // `currentUser.organization` instead left `availableRoles` at its initial
      // `[]` whenever the org record was missing from the local replica: the
      // Role picker rendered with no options at all, the org admin could not
      // create a single user, and nothing on screen said why.
      // `enabledRoles` is the roster the platform super-admin picked for this
      // organization (Organizations → Staff roles). Absent narrows nothing.
      setAvailableRoles(assignableRolesForOrgAdmin(
        currentUser.organization?.orgType,
        currentUser.organization?.enabledRoles,
      ));
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => { loadData(); }, [loadData]);

  // A platform-level super_admin has no orgId to scope this page to — their
  // user management lives at /admin/users. Forward the ?new deep-link so an
  // "Add user" button that lands here still opens a create form there.
  useEffect(() => {
    if (currentUser && !currentUser.orgId && currentUser.role === 'super_admin') {
      const wantsNew = new URLSearchParams(window.location.search).has('new');
      router.replace(wantsNew ? '/admin/users?new=1' : '/admin/users');
    }
  }, [currentUser, router]);

  // Deep link: /org-admin/users?new=1 opens the create-user modal directly
  // (used by the facility dashboard's Add-user button).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setFocusedUserId(params.get('user'));
    if (params.has('new')) {
      setFormPassword(generateTempPassword());
      setShowPassword(true);
      setShowCreateModal(true);
    }
  }, []);

  const ROLES_WITHOUT_HOSPITAL: UserRole[] = ['super_admin', 'org_admin', 'government'];
  const needsHospital = !ROLES_WITHOUT_HOSPITAL.includes(formRole);

  const handleCreate = async () => {
    setError('');
    if (!formUsername.trim() || !formPassword.trim() || !formName.trim()) {
      setError(t('orgUsers.errorRequiredFields'));
      return;
    }
    if (needsHospital && !formHospitalId) {
      setError(t('orgUsers.errorSelectHospital'));
      return;
    }
    if (formPassword.length < MIN_PASSWORD_LENGTH) {
      setError(t('orgUsers.errorPasswordLength'));
      return;
    }

    setCreating(true);
    try {
      const { createUserWithInvitation } = await import('@/lib/services/user-service');
      const selectedHospital = hospitals.find(h => h._id === formHospitalId);
      const newUsername = formUsername.trim().toLowerCase();
      const tempPassword = formPassword;
      const { invitation } = await createUserWithInvitation({
        username: newUsername,
        password: tempPassword,
        name: formName.trim(),
        role: formRole,
        hospitalId: needsHospital ? formHospitalId : undefined,
        hospitalName: needsHospital ? selectedHospital?.name : undefined,
        orgId: currentUser?.orgId,
        email: formEmail.trim() || undefined,
      });
      setShowCreateModal(false);
      // Surface the credentials so the admin can hand them off. The new user
      // will be forced to change this temporary password at first login.
      setHandoff({ username: newUsername, password: tempPassword, kind: 'created', invitation });
      setFormUsername('');
      setFormPassword('');
      setFormName('');
      setFormEmail('');
      setFormRole('doctor');
      setFormHospitalId('');
      await loadData();
    } catch (err: unknown) {
      const e = err as Error;
      setError(e.message || t('orgUsers.errorCreateFailed'));
    } finally {
      setCreating(false);
    }
  };

  const handleDeactivate = async (userId: string) => {
    try {
      const { deactivateUser } = await import('@/lib/services/user-service');
      await deactivateUser(userId, currentUser?._id, currentUser?.username);
      setSuccess(t('orgUsers.successUserDeactivated'));
      await loadData();
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: unknown) {
      const e = err as Error;
      setError(e.message || t('orgUsers.errorDeactivateFailed'));
      setTimeout(() => setError(''), 4000);
    }
  };

  const handleReactivate = async (userId: string) => {
    try {
      const { reactivateUser } = await import('@/lib/services/user-service');
      await reactivateUser(userId, currentUser?._id, currentUser?.username);
      setSuccess(t('orgUsers.successUserReactivated'));
      await loadData();
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: unknown) {
      const e = err as Error;
      setError(e.message || t('orgUsers.errorReactivateFailed'));
      setTimeout(() => setError(''), 4000);
    }
  };

  const handleResetPassword = async () => {
    if (!showResetModal || !resetPassword.trim()) return;
    if (resetPassword.length < MIN_PASSWORD_LENGTH) {
      setError(t('orgUsers.errorPasswordLength'));
      return;
    }
    setResetting(true);
    try {
      const { resetPassword: resetPw } = await import('@/lib/services/user-service');
      const targetUser = users.find(u => u._id === showResetModal);
      const tempPassword = resetPassword;
      await resetPw(showResetModal, tempPassword, currentUser?._id, currentUser?.username);
      setShowResetModal(null);
      setResetPassword('');
      if (targetUser) {
        setHandoff({ username: targetUser.username, password: tempPassword, kind: 'reset' });
      }
    } catch (err: unknown) {
      const e = err as Error;
      setError(e.message || t('orgUsers.errorResetFailed'));
    } finally {
      setResetting(false);
    }
  };

  const roleLabel = (role: string) => {
    const map: Record<string, string> = {
      super_admin: t('orgUsers.roleSuperAdmin'),
      org_admin: t('orgUsers.roleOrgAdmin'),
      doctor: t('orgUsers.roleDoctor'),
      clinical_officer: t('orgUsers.roleClinicalOfficer'),
      nurse: t('orgUsers.roleNurse'),
      lab_tech: t('orgUsers.roleLabTech'),
      pharmacist: t('orgUsers.rolePharmacist'),
      front_desk: t('orgUsers.roleFrontDesk'),
      government: t('orgUsers.roleGovernment'),
      data_entry_clerk: t('orgUsers.roleDataEntryClerk'),
      medical_superintendent: t('orgUsers.roleMedicalSuperintendent'),
      hrio: t('orgUsers.roleHrio'),
      nutritionist: t('orgUsers.roleNutritionist'),
      radiologist: t('orgUsers.roleRadiologist'),
      hospital_manager: t('orgUsers.roleHospitalManager'),
      medical_biller: t('orgUsers.roleMedicalBiller'),
    };
    // The map above is translated but partial — roles added since it was
    // written (midwife, cashier, county_health_director, the clinical-flow
    // stations) fell through to the raw enum, so the Role picker listed
    // "midwife" and "county_health_director" beside "Clinical Officer".
    // ROLE_PERMISSIONS carries a written label for every role; use it before
    // giving up and showing the identifier.
    return map[role] || getRoleConfig(role as UserRole)?.label || role;
  };

  // Options for the Role pickers. `doctor` and `clinician` share the label
  // "Doctor", which listed two identical options with no way to tell them
  // apart; labelRolesDistinctly appends the identifier to just those.
  const roleOptions = labelRolesDistinctly(availableRoles).map(({ role, label }) => ({
    role,
    // The translated map still wins where it has an entry — this only supplies
    // the labels it never covered, and the disambiguation where it is needed.
    label: label.includes('(') ? label : roleLabel(role),
  }));

  // Filter users — role/status pills from the header's Filters popover, plus
  // the header's own search box combined with any lingering platform-wide
  // search (same merge pattern as the hospitals list).
  const filteredUsers = users.filter(u => {
    if (focusedUserId) return u._id === focusedUserId;
    if (filterRole !== 'all' && u.role !== filterRole) return false;
    if (filterStatus === 'active' && !u.isActive) return false;
    if (filterStatus === 'inactive' && u.isActive) return false;
    const combined = [search, globalSearch].filter(Boolean).join(' ').toLowerCase().trim();
    if (combined) {
      const terms = combined.split(/\s+/);
      const haystack = `${u.name} ${u.username} ${u.role} ${u.hospitalName || ''}`.toLowerCase();
      if (!terms.every(term => haystack.includes(term))) return false;
    }
    return true;
  });

  // Deciding a request creates an account, so the tab only exists for the
  // roles that may create one — everyone else would get a 403 panel.
  const canReviewRequests = canCreateUsers(currentUser?.role || '');
  const showRoster = activeTab === 'people' || !canReviewRequests;

  const activeUserCount = users.filter(u => u.isActive).length;
  const activeFilterCount = (filterRole !== 'all' ? 1 : 0) + (filterStatus !== 'all' ? 1 : 0);
  const clearUserFilters = () => { setFilterRole('all'); setFilterStatus('all'); };

  if (loading) {
    return (
      <main className="page-container flex items-center justify-center page-enter">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: brandColor }} />
      </main>
    );
  }

  return (
    <>
      <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {/* Success/Error banners */}
        {success && (
          <div className="mb-4 p-3 rounded-lg text-sm font-medium flex-shrink-0" style={{ background: 'var(--accent-light)', color: 'var(--accent-primary)', border: '1px solid var(--accent-border)' }}>
            {success}
          </div>
        )}
        {error && !showCreateModal && !showResetModal && (
          <div className="mb-4 p-3 rounded-lg text-sm font-medium flex-shrink-0" style={{ background: 'rgba(224, 49, 39,0.1)', color: 'var(--color-danger-text)', border: '1px solid rgba(224, 49, 39,0.2)' }}>
            {error}
          </div>
        )}

        <div className="dash-card overflow-hidden flex flex-col" style={{ flex: 1, minHeight: 0 }}>
          <EhrListHeader
            title={t('orgUsers.pageTitle')}
            tabs={canReviewRequests ? [
              { key: 'people', label: 'People', count: users.length },
              { key: 'requests', label: 'Account requests', count: requestCounts.pending },
            ] : []}
            activeTab={activeTab}
            onTabChange={key => setActiveTab(key as 'people' | 'requests')}
            tabsAriaLabel="User management views"
            stats={showRoster ? [
              { label: 'Total', value: users.length, color: LIST_STAT_COLORS.muted },
              { label: t('orgUsers.statusActive'), value: activeUserCount, color: LIST_STAT_COLORS.blue },
              { label: t('orgUsers.statusInactive'), value: users.length - activeUserCount, color: LIST_STAT_COLORS.amber },
            ] : [
              { label: 'Pending', value: requestCounts.pending, color: LIST_STAT_COLORS.amber },
              { label: 'Decided', value: requestCounts.decided, color: LIST_STAT_COLORS.muted },
            ]}
            search={showRoster ? { value: search, onChange: setSearch, placeholder: 'Search by name or username…' } : undefined}
            actions={showRoster ? (
              <>
                <EhrListFilters activeCount={activeFilterCount} onClear={clearUserFilters}>
                  <FilterSelect
                    label={t('orgUsers.fieldRole')}
                    value={filterRole}
                    onChange={setFilterRole}
                    neutralValue="all"
                    size="sm"
                    options={[{ value: 'all', label: t('orgUsers.allRoles') }, ...roleOptions.map(o => ({ value: o.role, label: o.label }))]}
                  />
                  <FilterSelect
                    label={t('orgUsers.colStatus')}
                    value={filterStatus}
                    onChange={setFilterStatus}
                    neutralValue="all"
                    size="sm"
                    options={[
                      { value: 'all', label: t('orgUsers.allStatus') },
                      { value: 'active', label: t('orgUsers.statusActive') },
                      { value: 'inactive', label: t('orgUsers.statusInactive') },
                    ]}
                  />
                </EhrListFilters>
                {/* Read and write diverge here: the facility roles read this
                    list as their staff roster, but /api/users' WRITE_ROLES is
                    super_admin + org_admin, so anyone else would just 403. */}
                {canCreateUsers(currentUser?.role || '') && (
                  <button
                    onClick={() => { setError(''); setFormPassword(generateTempPassword()); setShowPassword(true); setShowCreateModal(true); }}
                    data-tour="org-users-create-btn"
                    style={{ display: 'flex', alignItems: 'center', gap: 6, height: 38, padding: '0 16px', borderRadius: 999, background: brandColor, color: '#fff', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
                  >
                    <Plus className="w-4 h-4" /> {t('orgUsers.createUser')}
                  </button>
                )}
              </>
            ) : undefined}
          />

          {/* Same list anatomy as the appointments page: card-list wrapper,
              compact column head, card rows. */}
          <div
            className="appointment-card-list"
            data-tour="org-users-list"
            role={canReviewRequests ? 'tabpanel' : undefined}
            id={ehrTabPanelId('people')}
            aria-labelledby={canReviewRequests ? ehrTabId('people') : undefined}
            style={{ display: showRoster ? undefined : 'none' }}
          >
                {/* The column head is the table's frame, not a label for the
                    rows that happen to be loaded: it stays put when a filter
                    matches nothing, so the list never collapses into a bare
                    message. */}
                <div className="appointment-card-head" aria-hidden="true" style={{ gridTemplateColumns: USER_GRID }}>
                  <span>{t('orgUsers.colName')}</span>
                  <span>{t('orgUsers.colRole')}</span>
                  <span>{t('orgUsers.colHospital')}</span>
                  {/* Status values right-align (shared .appointment-card-status),
                      so its label right-aligns to the same edge. */}
                  <span style={{ justifySelf: 'end', paddingInlineEnd: 6 }}>{t('orgUsers.colStatus')}</span>
                </div>
                {filteredUsers.length === 0 && (
                  <EmptyState icon={Users} title={t('orgUsers.heading')} message={t('orgUsers.noUsersFound')} />
                )}
                {filteredUsers.map(user => (
                    <div
                      key={user._id}
                      id={`org-user-${user._id}`}
                      // Every row is a tab stop now that the row itself is the
                      // control; the roving tabindex went with the pencil button.
                      tabIndex={0}
                      aria-current={focusedUserId === user._id ? 'true' : undefined}
                      className="ehr-appointment-row appointment-card-row"
                      role="button"
                      onClick={e => setRowMenu(rowActionsAt(e, actionsFor(user)))}
                      onKeyDown={e => { if (isRowActivationKey(e.key)) { e.preventDefault(); setRowMenu(rowActionsFromElement(e.currentTarget, actionsFor(user))); } }}
                      style={{
                        gridTemplateColumns: USER_GRID,
                        background: focusedUserId === user._id ? 'var(--overlay-subtle)' : undefined,
                        outline: focusedUserId === user._id ? '2px solid var(--accent-primary)' : undefined,
                        outlineOffset: focusedUserId === user._id ? -2 : undefined,
                      }}
                    >
                      {/* User: square avatar + name/username, on the shared
                          identity classes so type and spacing match the other
                          card lists. */}
                      <div className="ehr-appointment-identity">
                        <div className="ehr-patient-icon" style={avatarTint(user.name)}>
                          {user.name.split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?'}
                        </div>
                        <div className="ehr-appointment-main appointment-card-patient">
                          <strong>{user.name}</strong>
                          <p>{user.username}</p>
                        </div>
                      </div>

                      {/* Role — value + scope, matching the shared row hierarchy. */}
                      <div className="appointment-card-provider">
                        <strong>{roleLabel(user.role)}</strong>
                        <span>{user.department || user.specialty || 'Access role'}</span>
                      </div>

                      {/* Facility — value + label, like the Context column. */}
                      <div className="appointment-card-provider">
                        <strong>{user.hospitalName || 'Facility unassigned'}</strong>
                        <span>{t('orgUsers.colHospital')}</span>
                      </div>

                      {/* Status pill — shared appointment pill metrics */}
                      <div className="appointment-card-status">
                        <span
                          className="appointment-status-pill"
                          style={user.isActive
                            ? { borderColor: 'rgba(15, 160, 106,0.45)', background: 'rgba(15, 160, 106,0.10)', color: 'var(--color-success-text)' }
                            : { borderColor: 'rgba(224, 49, 39,0.45)', background: 'rgba(224, 49, 39,0.10)', color: 'var(--color-danger-text)' }}
                        >
                          {user.isActive ? t('orgUsers.statusActive') : t('orgUsers.statusInactive')}
                        </span>
                        <small>{user.mustChangePassword ? 'Password reset required' : 'Credentials current'}</small>
                      </div>

                    </div>
                ))}
          </div>

          <RowActionsPopup state={rowMenu} onClose={() => setRowMenu(null)} />

          {/* Mounted for approvers whichever tab is showing, so the tab's
              pending badge is honest before anyone opens it. */}
          {canReviewRequests && (
            <div
              role="tabpanel"
              id={ehrTabPanelId('requests')}
              aria-labelledby={ehrTabId('requests')}
              style={{ display: showRoster ? 'none' : 'block', minHeight: 0, overflowY: 'auto', padding: '4px 16px 16px' }}
            >
              <AccountRequestQueue viewerRole="org_admin" embedded onCountsChange={setRequestCounts} />
            </div>
          )}
        </div>
      </main>

      {/* Create User Modal */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={() => setShowCreateModal(false)}
        >
          <div
            className="w-full max-w-lg mx-4 rounded-xl shadow-2xl p-6"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{t('orgUsers.createNewUser')}</h2>
              <button onClick={() => setShowCreateModal(false)} className="p-1 rounded-lg hover:opacity-80">
                <X className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>

            {error && (
              <div className="mb-4 p-3 rounded-lg text-sm flex items-center gap-2" style={{ background: 'rgba(224, 49, 39,0.1)', color: 'var(--color-danger-text)', border: '1px solid rgba(224, 49, 39,0.2)' }}>
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}

            <div className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t('orgUsers.fieldFullName')}</label>
                <input
                  type="text"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder={t('orgUsers.fullNamePlaceholder')}
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                />
              </div>

              {/* Email — optional. Present means the new user gets an invitation
                  link and chooses their own password; absent means the admin
                  reads them the temporary one. */}
              <div>
                <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  {t('orgUsers.fieldEmail')}
                </label>
                <input
                  type="email"
                  value={formEmail}
                  onChange={e => setFormEmail(e.target.value)}
                  placeholder={t('orgUsers.emailPlaceholder')}
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                />
                <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {t('orgUsers.emailHint')}
                </p>
              </div>

              {/* Username */}
              <div>
                <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t('orgUsers.fieldUsername')}</label>
                <input
                  type="text"
                  value={formUsername}
                  onChange={e => setFormUsername(e.target.value)}
                  placeholder={t('orgUsers.usernamePlaceholder')}
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                />
              </div>

              {/* Password */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t('orgUsers.fieldPassword')}</label>
                  <button
                    type="button"
                    onClick={() => { setFormPassword(generateTempPassword()); setShowPassword(true); }}
                    className="flex items-center gap-1 text-xs font-semibold"
                    style={{ color: 'var(--accent-text)' }}
                  >
                    <RefreshCw className="w-3 h-3" /> Generate
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={formPassword}
                    onChange={e => setFormPassword(e.target.value)}
                    placeholder={t('orgUsers.passwordPlaceholder')}
                    className="w-full px-3 py-2 pe-10 rounded-lg text-sm"
                    style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute end-3 top-1/2 -translate-y-1/2"
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                    ) : (
                      <Eye className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                    )}
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                  <ShieldCheck className="w-3 h-3" /> Temporary — the user must set their own password at first login.
                </p>
              </div>

              {/* Role */}
              <div>
                <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t('orgUsers.fieldRole')}</label>
                <div className="relative">
                  <Select
                    value={formRole}
                    onChange={e => setFormRole(e.target.value as UserRole)}
                    className="w-full appearance-none px-3 py-2 pe-8 rounded-lg text-sm"
                    style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                  >
                    {roleOptions.map(o => (
                      <option key={o.role} value={o.role}>{o.label}</option>
                    ))}
                  </Select>
                  <ChevronDown className="absolute end-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                </div>
              </div>

              {/* Hospital (conditional) */}
              {needsHospital && hospitals.length === 0 && (
                /* A facility-scoped role with no facility to scope it to. The
                   picker used to render empty here and the submit answered
                   "Please select a hospital for this role" — an instruction the
                   admin had no way to follow. An organisation's first facility
                   has to exist before its clinical staff can, so say that and
                   point at the page that creates one. */
                <div
                  className="rounded-lg px-3 py-2.5 text-sm"
                  style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)', color: 'var(--text-secondary)' }}
                  data-field="no-facilities"
                >
                  <p className="mb-1.5" style={{ color: 'var(--text-primary)' }}>{t('orgUsers.noFacilitiesTitle')}</p>
                  <p className="mb-2">{t('orgUsers.noFacilitiesBody')}</p>
                  <button
                    type="button"
                    onClick={() => router.push('/org-admin/hospitals')}
                    className="text-sm font-semibold"
                    style={{ color: 'var(--accent-primary)' }}
                  >
                    {t('orgUsers.noFacilitiesAction')}
                  </button>
                </div>
              )}
              {needsHospital && hospitals.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t('orgUsers.fieldAssignedHospital')}</label>
                  <div className="relative">
                    <Select
                      value={formHospitalId}
                      onChange={e => setFormHospitalId(e.target.value)}
                      className="w-full appearance-none px-3 py-2 pe-8 rounded-lg text-sm"
                      style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                    >
                      <option value="">{t('orgUsers.selectHospitalOption')}</option>
                      {hospitals.map(h => (
                        <option key={h._id} value={h._id}>{h.name}</option>
                      ))}
                    </Select>
                    <ChevronDown className="absolute end-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 mt-6">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 rounded-lg text-sm font-semibold transition-all"
                style={{ background: 'var(--overlay-subtle)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' }}
              >
                {t('action.cancel')}
              </button>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50"
                style={{ background: brandColor }}
              >
                {creating ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
                {t('orgUsers.createUser')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Credential hand-off panel — shown after create or reset */}
      {handoff && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={() => { setHandoff(null); setCopied(false); }}
        >
          <div
            className="w-full max-w-md mx-4 rounded-xl shadow-2xl p-6"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'transparent', color: 'var(--color-success-text)' }}>
                <Check className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
                  {handoff.kind === 'created' ? 'User created' : 'Password reset'}
                </h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {handoff.invitation?.sent
                    ? `An invitation was emailed to ${handoff.invitation.to}. They choose their own password from it — you only need to share the one below if the email does not arrive.`
                    : handoff.invitation?.reason === 'not_configured'
                      ? 'Email is not configured on this deployment, so no invitation was sent. Share these credentials securely — the user must change the password at first login.'
                      : handoff.invitation?.reason === 'send_failed'
                        ? 'The invitation email could not be sent. Share these credentials securely — the user must change the password at first login.'
                        : 'Share these credentials securely. The user must change the password at first login.'}
                </p>
              </div>
            </div>

            <div className="rounded-lg p-3 mb-3 space-y-2" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Username</span>
                <span className="text-sm font-mono" style={{ color: 'var(--text-primary)' }}>{handoff.username}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Temporary password</span>
                <span className="text-sm font-mono" style={{ color: 'var(--text-primary)' }}>{handoff.password}</span>
              </div>
            </div>

            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(`Username: ${handoff.username}\nTemporary password: ${handoff.password}`);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch { /* clipboard unavailable — user can read the values above */ }
              }}
              className="btn btn-secondary w-full justify-center mb-2"
            >
              {copied ? <><Check className="w-4 h-4" /> Copied</> : <><Copy className="w-4 h-4" /> Copy credentials</>}
            </button>
            <button
              onClick={() => { setHandoff(null); setCopied(false); }}
              className="btn btn-primary w-full justify-center"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {showResetModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={() => setShowResetModal(null)}
        >
          <div
            className="w-full max-w-sm mx-4 rounded-xl shadow-2xl p-6"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <KeyRound className="w-5 h-5" style={{ color: 'var(--color-warning)' }} />
                <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>{t('orgUsers.resetPassword')}</h2>
              </div>
              <button onClick={() => setShowResetModal(null)} className="p-1">
                <X className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>

            {error && (
              <div className="mb-3 p-2 rounded-lg text-xs" style={{ background: 'rgba(224, 49, 39,0.1)', color: 'var(--color-danger-text)' }}>
                {error}
              </div>
            )}

            <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
              {t('orgUsers.resetPasswordPrompt')} <strong style={{ color: 'var(--text-primary)' }}>{users.find(u => u._id === showResetModal)?.username}</strong>
            </p>

            <div className="flex justify-end mb-1.5">
              <button
                type="button"
                onClick={() => { setResetPassword(generateTempPassword()); setShowPassword(true); }}
                className="flex items-center gap-1 text-xs font-semibold"
                style={{ color: 'var(--accent-text)' }}
              >
                <RefreshCw className="w-3 h-3" /> Generate
              </button>
            </div>
            <div className="relative mb-2">
              <input
                type={showPassword ? 'text' : 'password'}
                value={resetPassword}
                onChange={e => setResetPassword(e.target.value)}
                placeholder={t('orgUsers.newPasswordPlaceholder')}
                className="w-full px-3 py-2 pe-10 rounded-lg text-sm"
                style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute end-3 top-1/2 -translate-y-1/2"
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                ) : (
                  <Eye className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                )}
              </button>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowResetModal(null)}
                className="px-3 py-1.5 rounded-lg text-sm"
                style={{ background: 'var(--overlay-subtle)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' }}
              >
                {t('action.cancel')}
              </button>
              <button
                onClick={handleResetPassword}
                disabled={resetting}
                className="px-3 py-1.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: 'var(--color-warning)' }}
              >
                {resetting ? t('orgUsers.resetting') : t('orgUsers.resetPassword')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
