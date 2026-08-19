'use client';

import { useState, useEffect, useMemo, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import { useHospitals } from '@/lib/hooks/useHospitals';
import type { UserDoc, UserRole } from '@/lib/db-types';
import {
  UserX, UserCheck, UserPlus, Shield,
  KeyRound, RefreshCw, ShieldCheck, Eye, EyeOff,
} from '@/components/icons/lucide';
import RowActionsMenu from '@/components/RowActionsMenu';
import CredentialHandoffModal from '@/components/admin/CredentialHandoffModal';
import { generateTempPassword } from '@/lib/temp-password';
import { avatarTint } from '@/lib/patient-utils';
import Select from '@/components/Select';
import Modal from '@/components/Modal';
import { SadbPage, SadbCard, SadbKpiTile, SadbSearch, SadbChip, SadbConfirmModal } from '@/components/admin/sadb-ui';
import AccountRequestQueue from '@/components/admin/AccountRequestQueue';

// Column template for the user list header + rows:
// User · Role · Organization · Facility · Status · Actions
// The first five tracks match .appointment-card-row's shared grid
// (minmax(320px, 1.6fr) + minmax(150px, 1fr) columns) so this list lines up
// with the clinical worklist and patient registry; only the trailing actions
// gutter is narrower, since it holds a lone kebab instead of a data column.
const USER_GRID = 'minmax(320px, 1.6fr) repeat(4, minmax(150px, 1fr)) 44px';

const MIN_PASSWORD_LENGTH = 8;

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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [changeRoleUser, setChangeRoleUser] = useState<UserDoc | null>(null);
  const [newRole, setNewRole] = useState<UserRole>('nurse');
  const [changingRole, setChangingRole] = useState(false);
  // "Add user" modal — super_admin can create users directly here instead of
  // detouring to /settings or /org-admin/users.
  const { hospitals } = useHospitals();
  const emptyAddForm = { name: '', username: '', password: '', role: 'nurse' as UserRole, orgId: '', hospitalId: '' };
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
  const [handoff, setHandoff] = useState<{ username: string; password: string; kind: 'created' | 'reset' } | null>(null);
  // Reset-password modal
  const [resetUser, setResetUser] = useState<UserDoc | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  // Deactivate confirm — deactivation used to fire straight off the row menu
  // with no confirmation at all; it now goes through the same danger-confirm
  // pattern as every other destructive admin action.
  const [deactivateTarget, setDeactivateTarget] = useState<UserDoc | null>(null);
  const [deactivating, setDeactivating] = useState(false);

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
      setExpandedId(user);
    }
    // ?new=1 — the facility dashboards' "Add user" buttons deep-link straight
    // into the create form with a temporary password already generated.
    if (params.has('new')) {
      setAddForm({ ...emptyAddForm, password: generateTempPassword() });
      setShowAddUserPassword(true);
      setShowAddUser(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load all users
  useEffect(() => {
    const loadUsers = async () => {
      try {
        const { getAllUsers } = await import('@/lib/services/user-service');
        const data = await getAllUsers();
        setUsers(data);
      } catch (err) {
        console.error('Failed to load users:', err);
      } finally {
        setLoading(false);
      }
    };
    loadUsers();
  }, []);

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
    setAddSaving(true);
    setAddError(null);
    try {
      const { createUser } = await import('@/lib/services/user-service');
      const hospital = hospitals.find(h => h._id === addForm.hospitalId);
      const created = await createUser({
        name: addForm.name.trim(),
        username: addForm.username.trim(),
        password: addForm.password,
        role: addForm.role,
        orgId: addForm.orgId || undefined,
        hospitalId: addForm.hospitalId || undefined,
        hospitalName: hospital?.name,
      }, currentUser._id, currentUser.username);
      setUsers(prev => [created, ...prev]);
      setShowAddUser(false);
      showToast(`User ${created.username} created.`, 'success');
      // Hand the credentials to the admin exactly once — the password is
      // never retrievable again (only its hash is stored), and the user must
      // replace it at first login.
      setHandoff({ username: created.username, password: addForm.password, kind: 'created' });
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
      if (currentlyActive) {
        const { deactivateUser } = await import('@/lib/services/user-service');
        await deactivateUser(userId, currentUser._id, currentUser.username);
      } else {
        const { updateUser } = await import('@/lib/services/user-service');
        await updateUser(userId, { isActive: true }, currentUser._id, currentUser.username);
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

      {/* ═══ Account requests ═══ */}
      {/* Above the roster, not on a page of its own: approving a request IS
          creating a user, so it belongs where users are managed. A separate
          screen would be one nobody thinks to open, and a request that nobody
          opens is a person who never gets access. */}
      <SadbCard title="Requests">
        <AccountRequestQueue viewerRole="super_admin" />
      </SadbCard>

      {/* ═══ Roster ═══ */}
      <SadbCard title={t('adminUsers.title')} meta={`${filteredUsers.length} of ${users.length}`}>
        <div className="sadb-search-row">
          <SadbSearch value={search} onChange={setSearch} placeholder={t('adminUsers.searchPlaceholder')} />
          <Select value={filterRole} onChange={e => setFilterRole(e.target.value)} style={{ ...selectStyle, width: 'auto', minWidth: 180, height: 38 }}>
            <option value="all">{t('adminUsers.allRoles')}</option>
            {ALL_ROLES.map(value => (
              <option key={value} value={value}>{roleLabel(value)} ({roleCounts[value] || 0})</option>
            ))}
          </Select>
          <Select value={filterOrg} onChange={e => setFilterOrg(e.target.value)} style={{ ...selectStyle, width: 'auto', minWidth: 200, height: 38 }}>
            <option value="all">{t('adminUsers.allOrganizations')}</option>
            {organizations.map(o => <option key={o._id} value={o._id}>{o.name}</option>)}
          </Select>
          <button
            type="button"
            className="btn btn-primary btn-sm flex-shrink-0"
            onClick={() => { setAddForm({ ...emptyAddForm, password: generateTempPassword() }); setShowAddUserPassword(true); setAddError(null); setShowAddUser(true); }}
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
                so its label right-aligns too — the last-child rule only
                covers the empty actions gutter here. */}
            <span style={{ justifySelf: 'end', paddingInlineEnd: 6 }}>{t('adminUsers.colStatus')}</span>
            <span />
          </div>
          {loading && (
            <div className="appointment-card-empty">{t('adminUsers.loadingUsers')}</div>
          )}
          {!loading && filteredUsers.length === 0 && (
            <div className="appointment-card-empty">{t('adminUsers.noUsersFound')}</div>
          )}
          {!loading && filteredUsers.map(u => {
            const isExpanded = expandedId === u._id;
            return (
              <Fragment key={u._id}>
                <div
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
                  onClick={() => setExpandedId(isExpanded ? null : u._id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setExpandedId(isExpanded ? null : u._id);
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
                        ? { borderColor: 'rgba(25,158,112,0.45)', background: 'rgba(25,158,112,0.10)', color: 'var(--color-success-text)' }
                        : { borderColor: 'rgba(227,73,72,0.45)', background: 'rgba(227,73,72,0.10)', color: 'var(--color-danger-text)' }}
                    >
                      {u.isActive ? t('adminUsers.statusActive') : t('adminUsers.statusInactive')}
                    </span>
                    <small>{u.mustChangePassword ? 'Password reset required' : 'Credentials current'}</small>
                  </div>

                  {/* Row actions */}
                  <div className="flex justify-end" onClick={e => e.stopPropagation()}>
                    <RowActionsMenu
                      ariaLabel={t('adminUsers.colActions')}
                      actions={[
                        {
                          key: 'change-role',
                          label: 'Change Role',
                          icon: <Shield className="w-4 h-4" />,
                          onClick: () => { setChangeRoleUser(u); setNewRole(u.role); },
                        },
                        {
                          key: 'reset-password',
                          label: 'Reset Password',
                          icon: <KeyRound className="w-4 h-4" style={{ color: 'var(--color-warning)' }} />,
                          onClick: () => { setResetUser(u); setResetPasswordValue(generateTempPassword()); setResetError(null); setShowResetPassword(true); },
                        },
                        {
                          key: 'toggle',
                          label: u.isActive ? t('adminUsers.deactivate') : t('adminUsers.activate'),
                          tone: u.isActive ? 'danger' : 'success',
                          icon: u.isActive ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />,
                          // Deactivating is destructive — route it through the
                          // confirm modal. Reactivating is reversible with one
                          // click, so it stays immediate as before.
                          onClick: () => u.isActive ? setDeactivateTarget(u) : handleToggleActive(u._id, false, u.name),
                        },
                      ]}
                    />
                  </div>
                </div>
                {isExpanded && (
                  <div className="px-4 py-3 rounded-xl" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-xs">
                      <div><span style={{ color: 'var(--text-muted)' }}>{t('adminUsers.colRole')}: </span><span style={{ color: 'var(--text-primary)' }}>{roleLabel(u.role)}</span></div>
                      <div><span style={{ color: 'var(--text-muted)' }}>Department: </span><span style={{ color: 'var(--text-primary)' }}>{u.department || '--'}</span></div>
                      <div><span style={{ color: 'var(--text-muted)' }}>Specialty: </span><span style={{ color: 'var(--text-primary)' }}>{u.specialty || '--'}</span></div>
                      <div><span style={{ color: 'var(--text-muted)' }}>Phone: </span><span style={{ color: 'var(--text-primary)' }}>{u.phone || '--'}</span></div>
                      <div><span style={{ color: 'var(--text-muted)' }}>{t('adminUsers.colOrganization')}: </span><span style={{ color: 'var(--text-primary)' }}>{u.orgId ? (orgNameMap[u.orgId] || u.orgId) : '--'}</span></div>
                      <div><span style={{ color: 'var(--text-muted)' }}>{t('adminUsers.colHospital')}: </span><span style={{ color: 'var(--text-primary)' }}>{u.hospitalName || '--'}</span></div>
                      <div><span style={{ color: 'var(--text-muted)' }}>Created: </span><span style={{ color: 'var(--text-primary)' }}>{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '--'}</span></div>
                      <div><span style={{ color: 'var(--text-muted)' }}>User ID: </span><code style={{ color: 'var(--text-secondary)' }}>{u._id}</code></div>
                    </div>
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
      </SadbCard>

      {/* ═══ Role distribution ═══ */}
      <SadbCard title={t('adminUsers.roleDistribution')}>
        <div className="flex flex-wrap gap-2" style={{ padding: '12px 14px' }}>
          {ALL_ROLES.map(role => {
            const count = roleCounts[role] || 0;
            if (count === 0) return null;
            return <SadbChip key={role} tone="neutral">{roleLabel(role)} · {count}</SadbChip>;
          })}
        </div>
      </SadbCard>

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
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold block" style={{ color: 'var(--text-muted)' }}>Temporary password</label>
                  <button
                    type="button"
                    onClick={() => { setAddForm(f => ({ ...f, password: generateTempPassword() })); setShowAddUserPassword(true); }}
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
                <Select value={addForm.role} onChange={e => setAddForm(f => ({ ...f, role: e.target.value as UserRole }))} style={selectStyle}>
                  {ALL_ROLES.filter(r => r !== 'super_admin').map(r => (
                    <option key={r} value={r}>{roleLabel(r)}</option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="text-xs font-semibold block mb-1.5" style={{ color: 'var(--text-muted)' }}>Organization</label>
                <Select value={addForm.orgId} onChange={e => setAddForm(f => ({ ...f, orgId: e.target.value, hospitalId: '' }))} style={selectStyle}>
                  <option value="">— None (platform-level role) —</option>
                  {organizations.map(o => <option key={o._id} value={o._id}>{o.name}</option>)}
                </Select>
              </div>
              <div>
                <label className="text-xs font-semibold block mb-1.5" style={{ color: 'var(--text-muted)' }}>Facility</label>
                <Select value={addForm.hospitalId} onChange={e => setAddForm(f => ({ ...f, hospitalId: e.target.value }))} style={selectStyle}>
                  <option value="">— None —</option>
                  {hospitals.filter(h => !addForm.orgId || h.orgId === addForm.orgId).map(h => (
                    <option key={h._id} value={h._id}>{h.name}</option>
                  ))}
                </Select>
              </div>
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

      {/* Credential hand-off — shown once after a create or reset */}
      {handoff && (
        <CredentialHandoffModal
          title={handoff.kind === 'created' ? t('adminUsers.handoffCreatedTitle') : t('adminUsers.handoffResetTitle')}
          description={t('adminUsers.handoffDescription')}
          username={handoff.username}
          password={handoff.password}
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
                onClick={() => { setResetPasswordValue(generateTempPassword()); setShowResetPassword(true); }}
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
