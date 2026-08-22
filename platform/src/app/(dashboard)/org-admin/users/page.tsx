'use client';

/**
 * The organization's user roster + account requests, on the shared admin
 * console kit (sadb-*) — the org-scoped sibling of /admin/users, which now
 * shares its exact anatomy: KPI tile row, one card with People/Requests
 * pill tabs in the head, a sadb search row, and the shared
 * appointment-card-list rows (unchanged — they were already the same list
 * grammar both pages use). Restyled 2026-08-21; the raw fixed-inset create
 * and reset overlays became shared-Modal sadb dialogs, the hand-off panel
 * became the shared CredentialHandoffModal, and banners became toasts.
 *
 * Read and write diverge here: medical_superintendent and hospital_manager
 * read this list as their staff roster, but /api/users' WRITE_ROLES is
 * super_admin + org_admin, so the create button and the Requests tab are
 * gated on canCreateUsers, not on reaching the page.
 */

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useToast } from '@/components/Toast';
import type { InvitationOutcome } from '@/lib/user-invite';
import {
  Plus, KeyRound, UserX, UserCheck, Eye, EyeOff, RefreshCw, ShieldCheck, Building2,
} from '@/components/icons/lucide';
import RowActionsPopup, { rowActionsAt, rowActionsFromElement, isRowActivationKey, type RowActionsPopupState } from '@/components/RowActionsPopup';
import type { RowAction } from '@/components/RowActionsMenu';
import { avatarTint } from '@/lib/patient-utils';
import Modal from '@/components/Modal';
import Select from '@/components/Select';
import { generateTempPassword } from '@/lib/temp-password';
import { canCreateUsers, canCreateFacilities } from '@/lib/people-nav';
import { roleNeedsFacility } from '@/lib/user-scope-rules';
import CreateFacilityModal from '@/components/admin/CreateFacilityModal';
import CredentialHandoffModal from '@/components/admin/CredentialHandoffModal';
import { activeFacilities } from '@/lib/services/hospital-service';
import { getRoleConfig, labelRolesDistinctly } from '@/lib/permissions';
import AccountRequestQueue from '@/components/admin/AccountRequestQueue';
import {
  SadbPage, SadbCard, SadbKpiTile, SadbSearch, SadbTabs,
} from '@/components/admin/sadb-ui';

const MIN_PASSWORD_LENGTH = 8;
import type { UserDoc, HospitalDoc, UserRole } from '@/lib/db-types';
import type { DataScope } from '@/lib/services/data-scope';

// Column template for the user list header + rows:
// User · Role · Facility · Status
// The tracks match .appointment-card-row's shared grid so this list lines up
// with the clinical worklist, the patient registry, and /admin/users.
// No trailing action gutter — the row opens the actions popup itself.
const USER_GRID = 'minmax(320px, 1.6fr) repeat(3, minmax(150px, 1fr))';

export default function OrgUsersPage() {
  const { currentUser, globalSearch } = useApp();
  const router = useRouter();
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [users, setUsers] = useState<UserDoc[]>([]);
  const [hospitals, setHospitals] = useState<HospitalDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  // Registering the organization's first facility without leaving the
  // half-filled account form.
  const [showAddFacility, setShowAddFacility] = useState(false);
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
  // Modal-scoped error copy (create / reset dialogs render it inline; list
  // actions report through toasts).
  const [error, setError] = useState('');
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
      // Only facilities still in service can be staffed. A retired site keeps
      // its history and its existing people; it just stops taking new ones.
      setHospitals(activeFacilities(h));

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

  // The facility requirement is `lib/user-scope-rules.ts`'s to state — this
  // page used to keep its own list, and it had drifted: it omitted
  // `county_health_director`, so that role was shown a facility picker the
  // server strips on save.
  const needsHospital = roleNeedsFacility(formRole);

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
      showToast(t('orgUsers.successUserDeactivated'), 'success');
      await loadData();
    } catch (err: unknown) {
      const e = err as Error;
      showToast(e.message || t('orgUsers.errorDeactivateFailed'), 'error');
    }
  };

  const handleReactivate = async (userId: string) => {
    try {
      const { reactivateUser } = await import('@/lib/services/user-service');
      await reactivateUser(userId, currentUser?._id, currentUser?.username);
      showToast(t('orgUsers.successUserReactivated'), 'success');
      await loadData();
    } catch (err: unknown) {
      const e = err as Error;
      showToast(e.message || t('orgUsers.errorReactivateFailed'), 'error');
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

  // Filter users — the header's role/status selects, plus the header's own
  // search box combined with any lingering platform-wide search (same merge
  // pattern as the hospitals list).
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
    <SadbPage roles={['org_admin', 'super_admin', 'medical_superintendent', 'hospital_manager']}>
      {/* ═══ KPI strip ═══ */}
      <div className="sadb-kpi-row">
        <SadbKpiTile label={t('orgUsers.heading')} value={users.length.toLocaleString()} />
        <SadbKpiTile label={t('orgUsers.statusActive')} value={activeUserCount.toLocaleString()} />
        <SadbKpiTile label={t('orgUsers.statusInactive')} value={(users.length - activeUserCount).toLocaleString()} />
        {canReviewRequests && (
          <SadbKpiTile
            label="Pending requests"
            value={requestCounts.pending.toLocaleString()}
            onClick={() => setActiveTab('requests')}
          />
        )}
      </div>

      {/* ═══ Roster + account requests ═══ */}
      {/* One card, two tabs, not a page of its own: a request that nobody
          thinks to open is a person who never gets access. */}
      <SadbCard
        title={t('orgUsers.pageTitle')}
        meta={showRoster ? `${filteredUsers.length} of ${users.length}` : `${requestCounts.pending} pending`}
        action={canReviewRequests ? (
          <SadbTabs
            tabs={[
              { key: 'people', label: 'People', count: users.length },
              { key: 'requests', label: 'Account requests', count: requestCounts.pending },
            ]}
            active={activeTab}
            onChange={key => setActiveTab(key as 'people' | 'requests')}
            ariaLabel="User management views"
          />
        ) : undefined}
      >
        <div style={{ display: showRoster ? undefined : 'none' }}>
          <div className="sadb-search-row">
            <SadbSearch value={search} onChange={setSearch} placeholder="Search by name or username…" />
            <Select value={filterRole} onChange={e => setFilterRole(e.target.value)} style={{ ...selectStyle, width: 'auto', minWidth: 180 }}>
              <option value="all">{t('orgUsers.allRoles')}</option>
              {roleOptions.map(o => (
                <option key={o.role} value={o.role}>{o.label}</option>
              ))}
            </Select>
            <Select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ ...selectStyle, width: 'auto', minWidth: 150 }}>
              <option value="all">{t('orgUsers.allStatus')}</option>
              <option value="active">{t('orgUsers.statusActive')}</option>
              <option value="inactive">{t('orgUsers.statusInactive')}</option>
            </Select>
            {/* Read and write diverge here: the facility roles read this
                list as their staff roster, but /api/users' WRITE_ROLES is
                super_admin + org_admin, so anyone else would just 403. */}
            {canCreateUsers(currentUser?.role || '') && (
              <button
                type="button"
                className="btn btn-primary btn-sm flex-shrink-0"
                data-tour="org-users-create-btn"
                onClick={() => { setError(''); setFormPassword(generateTempPassword()); setShowPassword(true); setShowCreateModal(true); }}
              >
                <Plus className="w-4 h-4" /> {t('orgUsers.createUser')}
              </button>
            )}
          </div>

          {/* Same list anatomy as the clinical worklist, the patient registry
              and /admin/users: card-list wrapper, compact column head, card
              rows. */}
          <div className="appointment-card-list" data-tour="org-users-list">
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
            {loading && (
              <div className="appointment-card-empty">{t('adminUsers.loadingUsers')}</div>
            )}
            {!loading && filteredUsers.length === 0 && (
              <div className="appointment-card-empty">{t('orgUsers.noUsersFound')}</div>
            )}
            {!loading && filteredUsers.map(user => (
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
        </div>

        {/* Mounted for approvers whichever tab is showing, so the tab's
            pending badge is honest before anyone opens it. */}
        {canReviewRequests && (
          <div style={{ display: showRoster ? 'none' : 'block', padding: '4px 14px 14px' }}>
            <AccountRequestQueue viewerRole="org_admin" embedded onCountsChange={setRequestCounts} />
          </div>
        )}
      </SadbCard>

      {/* Create User Modal */}
      {showCreateModal && (
        <Modal onClose={() => setShowCreateModal(false)} width={440} labelledBy="org-create-user-title">
          <div className="sadb-modal">
            <div className="sadb-modal-copy">
              <h2 id="org-create-user-title" className="sadb-modal-title">{t('orgUsers.createNewUser')}</h2>
            </div>
            <div className="space-y-3">
              {/* Name */}
              <div>
                <label className="text-xs font-semibold block mb-1.5" style={{ color: 'var(--text-muted)' }}>{t('orgUsers.fieldFullName')}</label>
                <input type="text" value={formName} onChange={e => setFormName(e.target.value)} placeholder={t('orgUsers.fullNamePlaceholder')} style={inputStyle} />
              </div>

              {/* Email — optional. Present means the new user gets an invitation
                  link and chooses their own password; absent means the admin
                  reads them the temporary one. */}
              <div>
                <label className="text-xs font-semibold block mb-1.5" style={{ color: 'var(--text-muted)' }}>{t('orgUsers.fieldEmail')}</label>
                <input type="email" value={formEmail} onChange={e => setFormEmail(e.target.value)} placeholder={t('orgUsers.emailPlaceholder')} style={inputStyle} autoComplete="off" />
                <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {t('orgUsers.emailHint')}
                </p>
              </div>

              {/* Username */}
              <div>
                <label className="text-xs font-semibold block mb-1.5" style={{ color: 'var(--text-muted)' }}>{t('orgUsers.fieldUsername')}</label>
                <input type="text" value={formUsername} onChange={e => setFormUsername(e.target.value)} placeholder={t('orgUsers.usernamePlaceholder')} style={inputStyle} autoComplete="off" />
              </div>

              {/* Password */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold block" style={{ color: 'var(--text-muted)' }}>{t('orgUsers.fieldPassword')}</label>
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
                    style={{ ...inputStyle, paddingInlineEnd: 40, fontFamily: showPassword ? 'var(--font-mono, monospace)' : undefined }}
                    autoComplete="new-password"
                  />
                  <button type="button" onClick={() => setShowPassword(v => !v)} className="absolute end-3 top-1/2 -translate-y-1/2">
                    {showPassword
                      ? <EyeOff className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                      : <Eye className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />}
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                  <ShieldCheck className="w-3 h-3" /> Temporary — the user must set their own password at first login.
                </p>
              </div>

              {/* Role */}
              <div>
                <label className="text-xs font-semibold block mb-1.5" style={{ color: 'var(--text-muted)' }}>{t('orgUsers.fieldRole')}</label>
                <Select value={formRole} onChange={e => setFormRole(e.target.value as UserRole)} style={selectStyle}>
                  {roleOptions.map(o => (
                    <option key={o.role} value={o.role}>{o.label}</option>
                  ))}
                </Select>
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
                  className="rounded-lg px-3 py-2.5 text-xs"
                  style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)', color: 'var(--text-secondary)' }}
                  data-field="no-facilities"
                >
                  <p className="mb-1.5" style={{ color: 'var(--text-primary)' }}>{t('orgUsers.noFacilitiesTitle')}</p>
                  <p className="mb-2">{t('orgUsers.noFacilitiesBody')}</p>
                  <button
                    type="button"
                    onClick={() => {
                      // Create it here. Routing away used to discard the
                      // half-filled account — including its generated
                      // temporary password — and there was no route back.
                      if (canCreateFacilities(currentUser?.role ?? '')) setShowAddFacility(true);
                      else router.push('/hospitals');
                    }}
                    className="btn btn-secondary btn-sm"
                    data-action="add-facility-inline"
                  >
                    <Building2 className="w-4 h-4" /> {t('orgUsers.noFacilitiesAction')}
                  </button>
                </div>
              )}
              {needsHospital && hospitals.length > 0 && (
                <div>
                  <label className="text-xs font-semibold block mb-1.5" style={{ color: 'var(--text-muted)' }}>{t('orgUsers.fieldAssignedHospital')}</label>
                  <Select value={formHospitalId} onChange={e => setFormHospitalId(e.target.value)} style={selectStyle}>
                    <option value="">{t('orgUsers.selectHospitalOption')}</option>
                    {hospitals.map(h => (
                      <option key={h._id} value={h._id}>{h.name}</option>
                    ))}
                  </Select>
                </div>
              )}

              {error && (
                <p className="text-xs" style={{ color: 'var(--color-danger-text)' }}>{error}</p>
              )}
            </div>

            <div className="sadb-modal-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowCreateModal(false)} disabled={creating}>
                {t('action.cancel')}
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={handleCreate} disabled={creating}>
                {creating ? t('orgHospitals.creating') : t('orgUsers.createUser')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Credential hand-off — shown after create or reset. The password is
          unrecoverable once this closes, so it's the shared hard-to-dismiss
          modal, byte-identical with /admin/users. */}
      {handoff && (
        <CredentialHandoffModal
          title={handoff.kind === 'created' ? 'User created' : 'Password reset'}
          description="Share these credentials securely. The user must change the password at first login."
          username={handoff.username}
          password={handoff.password}
          invitation={handoff.invitation}
          onClose={() => setHandoff(null)}
        />
      )}

      {/* Reset Password Modal */}
      {showResetModal && (
        <Modal onClose={() => setShowResetModal(null)} width={400} labelledBy="org-reset-pw-title">
          <div className="sadb-modal sadb-modal--danger">
            <div className="sadb-modal-copy">
              <h2 id="org-reset-pw-title" className="sadb-modal-title sadb-modal-title--danger">{t('orgUsers.resetPassword')}</h2>
              <p className="sadb-modal-sub">
                {t('orgUsers.resetPasswordPrompt')}{' '}
                <strong style={{ color: 'var(--text-primary)' }}>{users.find(u => u._id === showResetModal)?.username}</strong>
              </p>
            </div>

            {error && (
              <p className="text-xs mb-2" style={{ color: 'var(--color-danger-text)' }}>{error}</p>
            )}

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
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={resetPassword}
                onChange={e => setResetPassword(e.target.value)}
                placeholder={t('orgUsers.newPasswordPlaceholder')}
                style={{ ...inputStyle, paddingInlineEnd: 40, fontFamily: showPassword ? 'var(--font-mono, monospace)' : undefined }}
                autoComplete="new-password"
              />
              <button type="button" onClick={() => setShowPassword(v => !v)} className="absolute end-3 top-1/2 -translate-y-1/2">
                {showPassword
                  ? <EyeOff className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                  : <Eye className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />}
              </button>
            </div>

            <div className="sadb-modal-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowResetModal(null)} disabled={resetting}>
                {t('action.cancel')}
              </button>
              <button type="button" className="btn btn-sm sadb-btn-danger" onClick={handleResetPassword} disabled={resetting}>
                {resetting ? t('orgUsers.resetting') : t('orgUsers.resetPassword')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showAddFacility && canCreateFacilities(currentUser?.role ?? '') && (
        <CreateFacilityModal
          onClose={() => setShowAddFacility(false)}
          onCreated={async hospital => {
            setShowAddFacility(false);
            await loadData();
            // Preselect it — the operator opened this dialog precisely so the
            // account they were filling in has somewhere to be assigned.
            setFormHospitalId(hospital._id);
          }}
          orgId={currentUser?.orgId}
          actor={{ _id: currentUser?._id, username: currentUser?.username }}
        />
      )}
    </SadbPage>
  );
}
