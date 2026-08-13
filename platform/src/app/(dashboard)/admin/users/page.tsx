'use client';

import { useState, useEffect, useMemo, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import { useHospitals } from '@/lib/hooks/useHospitals';
import type { UserDoc, UserRole } from '@/lib/db-types';
import {
  Users, UserX, UserCheck, UserPlus, Shield, Filter,
  KeyRound, Copy, Check, RefreshCw, ShieldCheck, Eye, EyeOff, X,
} from '@/components/icons/lucide';
import RowActionsMenu from '@/components/RowActionsMenu';
import { generateTempPassword } from '@/lib/temp-password';
import EhrListHeader from '@/components/ehr/EhrListHeader';
import { avatarTint } from '@/lib/patient-utils';
import Select from '@/components/Select';

// Column template for the user list header + rows:
// User · Role · Organization · Facility · Status · Actions
// The first five tracks match .appointment-card-row's shared grid
// (minmax(320px, 1.6fr) + minmax(150px, 1fr) columns) so this list lines up
// with the clinical worklist and patient registry; only the trailing actions
// gutter is narrower, since it holds a lone kebab instead of a data column.
const USER_GRID = 'minmax(320px, 1.6fr) repeat(4, minmax(150px, 1fr)) 44px';

const MIN_PASSWORD_LENGTH = 8;

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  org_admin: 'Org Admin',
  doctor: 'Doctor',
  clinical_officer: 'Clinical Officer',
  nurse: 'Nurse',
  midwife: 'Midwife',
  lab_tech: 'Lab Technician',
  pharmacist: 'Pharmacist',
  front_desk: 'Medical Receptionist',
  cashier: 'Cashier',
  government: 'Government',
  county_health_director: 'County Health Director',
  data_entry_clerk: 'Data Entry Clerk',
  medical_superintendent: 'Medical Superintendent',
  hrio: 'Health Records Officer',
  nutritionist: 'Nutritionist',
  radiologist: 'Radiologist',
  hospital_manager: 'Hospital Manager',
  medical_biller: 'Medical Biller',
  central_registration_clerk: 'Registration Clerk',
  clinic_clerk: 'Clinic Clerk',
  triage_nurse: 'Triage Nurse',
  rooming_nurse: 'Rooming Nurse',
  clinician: 'Doctor',
  records_hmis_officer: 'Records / HMIS Officer',
};

const ROLE_COLORS: Record<string, string> = {
  super_admin: 'var(--accent-primary)',
  org_admin: 'var(--accent-primary)',
  doctor: 'var(--accent-primary)',
  clinical_officer: 'var(--accent-primary)',
  nurse: 'var(--accent-primary)',
  lab_tech: 'var(--accent-primary)',
  pharmacist: 'var(--accent-primary)',
  front_desk: 'var(--accent-primary)',
  government: 'var(--accent-primary)',
  data_entry_clerk: 'var(--accent-primary)',
  medical_superintendent: 'var(--accent-primary)',
  hrio: 'var(--accent-primary)',
  nutritionist: 'var(--color-success)',
  radiologist: 'var(--accent-primary)',
  hospital_manager: 'var(--accent-primary)',
  medical_biller: 'var(--accent-primary)',
};

export default function AdminUsersPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const roleLabel = (role: string) => t(`adminUsers.role_${role}`);
  const { currentUser } = useAuth();
  const { organizations } = useOrganizations();
  const [users, setUsers] = useState<UserDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  // Deep-link support: /admin/users?q=<name> arrives pre-filtered (the audit
  // log's "View in User Management" action). window.location instead of
  // useSearchParams so the page needs no Suspense boundary.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('q');
    if (q) setSearch(q);
  }, []);
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
  const [showAddPassword, setShowAddPassword] = useState(true);
  // Credential hand-off — shown exactly once after a create or reset so the
  // admin can copy the temporary password before it is unrecoverable.
  const [handoff, setHandoff] = useState<{ username: string; password: string; kind: 'created' | 'reset' } | null>(null);
  const [copied, setCopied] = useState(false);
  // Reset-password modal
  const [resetUser, setResetUser] = useState<UserDoc | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  // Access control
  useEffect(() => {
    if (currentUser && currentUser.role !== 'super_admin') {
      router.push('/dashboard');
    }
  }, [currentUser, router]);

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
    return users.filter(u => {
      const q = search.toLowerCase();
      const matchSearch = !q || u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q) || (u.hospitalName || '').toLowerCase().includes(q);
      const matchRole = filterRole === 'all' || u.role === filterRole;
      const matchOrg = filterOrg === 'all' || u.orgId === filterOrg;
      return matchSearch && matchRole && matchOrg;
    });
  }, [users, search, filterRole, filterOrg]);

  const handleChangeRole = async () => {
    if (!changeRoleUser || !currentUser) return;
    setChangingRole(true);
    try {
      const { updateUser } = await import('@/lib/services/user-service');
      await updateUser(changeRoleUser._id, { role: newRole } as Partial<UserDoc>, currentUser._id, currentUser.username);
      setUsers(prev => prev.map(u => u._id === changeRoleUser._id ? { ...u, role: newRole } : u));
      setChangeRoleUser(null);
    } catch (err) {
      console.error(err);
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
      // Hand the credentials to the admin exactly once — the password is
      // never retrievable again (only its hash is stored), and the user must
      // replace it at first login.
      setHandoff({ username: created.username, password: addForm.password, kind: 'created' });
      setAddForm(emptyAddForm);
    } catch (err) {
      setAddError((err as Error).message || 'Failed to create user');
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
      setHandoff({ username: resetUser.username, password: resetPasswordValue, kind: 'reset' });
      setResetUser(null);
      setResetPasswordValue('');
    } catch (err) {
      setResetError((err as Error).message || 'Failed to reset password');
    } finally {
      setResetting(false);
    }
  };

  const handleToggleActive = async (userId: string, currentlyActive: boolean) => {
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
    } catch (err) {
      console.error(err);
    }
  };

  if (!currentUser || currentUser.role !== 'super_admin') return null;

  const orgNameMap: Record<string, string> = {};
  organizations.forEach(o => { orgNameMap[o._id] = o.name; });

  // Role stats
  const roleCounts: Record<string, number> = {};
  users.forEach(u => { roleCounts[u.role] = (roleCounts[u.role] || 0) + 1; });

  const inputStyle: React.CSSProperties = {
    background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)',
    borderRadius: '4px', padding: '10px 14px', color: 'var(--text-primary)',
    fontSize: '14px', width: '100%', outline: 'none',
  };
  const selectStyle: React.CSSProperties = {
    ...inputStyle, appearance: 'none' as const, paddingRight: '36px',
    backgroundImage: `url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%238A9E9A' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center',
  };

  return (
    <>
      <main className="page-container page-enter admin-detail-page">

        {/* Header stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
          {[
            { label: t('adminUsers.statTotalUsers'), value: users.length, icon: Users, color: 'var(--accent-primary)' },
            { label: t('adminUsers.statActiveUsers'), value: users.filter(u => u.isActive).length, icon: UserCheck, color: 'var(--color-success)' },
            { label: t('adminUsers.statInactiveUsers'), value: users.filter(u => !u.isActive).length, icon: UserX, color: 'var(--color-danger)' },
            { label: t('adminUsers.statAdminUsers'), value: users.filter(u => u.role === 'super_admin' || u.role === 'org_admin').length, icon: Shield, color: 'var(--accent-primary)' },
          ].map(stat => (
            <div key={stat.label} className="dash-card" style={{ padding: '14px 16px' }}>
              <div className="flex items-center gap-2 mb-2">
                <div className="icon-box-sm">
                  <stat.icon className="w-3.5 h-3.5" style={{ color: stat.color }} />
                </div>
                <span className="kpi-card-title">{stat.label}</span>
              </div>
              <div className="stat-value text-3xl" style={{ color: 'var(--text-primary)', lineHeight: 1, fontWeight: 800 }}>{stat.value}</div>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="dash-card overflow-hidden">
          <EhrListHeader
            title={t('adminUsers.title')}
            search={{ value: search, onChange: setSearch, placeholder: t('adminUsers.searchPlaceholder') }}
            actions={
              <>
                <Select value={filterRole} onChange={e => setFilterRole(e.target.value)} style={{ ...selectStyle, width: 'auto', minWidth: '180px', height: 38 }}>
                  <option value="all">{t('adminUsers.allRoles')}</option>
                  {Object.keys(ROLE_LABELS).map((value) => (
                    <option key={value} value={value}>{roleLabel(value)} ({roleCounts[value] || 0})</option>
                  ))}
                </Select>
                <Select value={filterOrg} onChange={e => setFilterOrg(e.target.value)} style={{ ...selectStyle, width: 'auto', minWidth: '200px', height: 38 }}>
                  <option value="all">{t('adminUsers.allOrganizations')}</option>
                  {organizations.map(o => <option key={o._id} value={o._id}>{o.name}</option>)}
                </Select>
                <div className="flex items-center gap-1.5 px-3 rounded-lg text-xs flex-shrink-0" style={{ height: 38, color: 'var(--text-muted)', background: 'var(--overlay-subtle)' }}>
                  <Filter className="w-3.5 h-3.5" />
                  {filteredUsers.length} of {users.length}
                </div>
                <button type="button" className="btn btn-primary" style={{ gap: 6, height: 38, whiteSpace: 'nowrap' }} onClick={() => { setAddForm({ ...emptyAddForm, password: generateTempPassword() }); setShowAddPassword(true); setAddError(null); setShowAddUser(true); }}>
                  <UserPlus className="w-4 h-4" /> Add user
                </button>
              </>
            }
          />
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
                  <span style={{ justifySelf: 'end', paddingRight: 6 }}>{t('adminUsers.colStatus')}</span>
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
                        className="ehr-appointment-row appointment-card-row"
                        style={{ gridTemplateColumns: USER_GRID }}
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
                              ? { borderColor: 'rgba(25,158,112,0.45)', background: 'rgba(25,158,112,0.10)', color: '#167755' }
                              : { borderColor: 'rgba(227,73,72,0.45)', background: 'rgba(227,73,72,0.10)', color: '#C24135' }}
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
                                onClick: () => { setResetUser(u); setResetPasswordValue(generateTempPassword()); setResetError(null); setShowAddPassword(true); },
                              },
                              {
                                key: 'toggle',
                                label: u.isActive ? t('adminUsers.deactivate') : t('adminUsers.activate'),
                                tone: u.isActive ? 'danger' : 'success',
                                icon: u.isActive ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />,
                                onClick: () => handleToggleActive(u._id, u.isActive),
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
        </div>

        {/* Role Distribution */}
        <div className="dash-card overflow-hidden mt-4">
          <div className="flex items-center gap-2 p-4 pb-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <Shield className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('adminUsers.roleDistribution')}</h3>
          </div>
          <div className="p-4 flex flex-wrap gap-2">
            {Object.keys(ROLE_LABELS).map((role) => {
              const count = roleCounts[role] || 0;
              if (count === 0) return null;
              return (
                <span key={role} className="text-[11px] font-medium px-2.5 py-1 rounded-full" style={{ background: 'var(--overlay-subtle)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' }}>
                  {roleLabel(role)} · {count}
                </span>
              );
            })}
          </div>
        </div>
      </main>

      {/* Add User Modal */}
      {showAddUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="rounded-2xl shadow-2xl w-full max-w-md" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
            <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--border-light)' }}>
              <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Add user</h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Create a platform account and hand the credentials to the staff member.</p>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-muted)' }}>Full name</label>
                <input type="text" value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-muted)' }}>Username</label>
                <input type="text" value={addForm.username} onChange={e => setAddForm(f => ({ ...f, username: e.target.value }))} style={inputStyle} autoComplete="off" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium block" style={{ color: 'var(--text-muted)' }}>Temporary password</label>
                  <button
                    type="button"
                    onClick={() => { setAddForm(f => ({ ...f, password: generateTempPassword() })); setShowAddPassword(true); }}
                    className="flex items-center gap-1 text-xs font-semibold"
                    style={{ color: 'var(--accent-text)' }}
                  >
                    <RefreshCw className="w-3 h-3" /> Generate
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showAddPassword ? 'text' : 'password'}
                    value={addForm.password}
                    onChange={e => setAddForm(f => ({ ...f, password: e.target.value }))}
                    style={{ ...inputStyle, paddingRight: 40, fontFamily: showAddPassword ? 'var(--font-mono, monospace)' : undefined }}
                    autoComplete="new-password"
                  />
                  <button type="button" onClick={() => setShowAddPassword(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2">
                    {showAddPassword
                      ? <EyeOff className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                      : <Eye className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />}
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                  <ShieldCheck className="w-3 h-3" /> Temporary — the user must set their own password at first login.
                </p>
              </div>
              <div>
                <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-muted)' }}>Role</label>
                <Select value={addForm.role} onChange={e => setAddForm(f => ({ ...f, role: e.target.value as UserRole }))} style={selectStyle}>
                  {(Object.keys(ROLE_LABELS) as UserRole[]).filter(r => r !== 'super_admin').map(r => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-muted)' }}>Organization</label>
                <Select value={addForm.orgId} onChange={e => setAddForm(f => ({ ...f, orgId: e.target.value, hospitalId: '' }))} style={selectStyle}>
                  <option value="">— None (platform-level role) —</option>
                  {organizations.map(o => <option key={o._id} value={o._id}>{o.name}</option>)}
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-muted)' }}>Facility</label>
                <Select value={addForm.hospitalId} onChange={e => setAddForm(f => ({ ...f, hospitalId: e.target.value }))} style={selectStyle}>
                  <option value="">— None —</option>
                  {hospitals.filter(h => !addForm.orgId || h.orgId === addForm.orgId).map(h => (
                    <option key={h._id} value={h._id}>{h.name}</option>
                  ))}
                </Select>
              </div>
              {addError && (
                <p className="text-xs" style={{ color: 'var(--color-danger)' }}>{addError}</p>
              )}
            </div>
            <div className="px-5 py-3 border-t flex justify-end gap-2" style={{ borderColor: 'var(--border-light)' }}>
              <button onClick={() => setShowAddUser(false)} className="btn btn-secondary" disabled={addSaving}>Cancel</button>
              <button onClick={handleAddUser} className="btn btn-primary" disabled={addSaving}>
                {addSaving ? 'Creating…' : 'Create user'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Credential hand-off — shown once after a create or reset */}
      {handoff && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => { setHandoff(null); setCopied(false); }}
        >
          <div
            className="rounded-2xl shadow-2xl w-full max-w-md p-6"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ color: 'var(--color-success)' }}>
                <Check className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
                  {handoff.kind === 'created' ? 'User created' : 'Password reset'}
                </h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  Share these credentials securely. The user must change the password at first login.
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
      {resetUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => setResetUser(null)}
        >
          <div
            className="rounded-2xl shadow-2xl w-full max-w-sm p-6"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <KeyRound className="w-5 h-5" style={{ color: 'var(--color-warning)' }} />
                <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Reset Password</h2>
              </div>
              <button onClick={() => setResetUser(null)} className="p-1">
                <X className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>

            {resetError && (
              <div className="mb-3 p-2 rounded-lg text-xs" style={{ background: 'rgba(229,46,66,0.1)', color: 'var(--color-danger)' }}>
                {resetError}
              </div>
            )}

            <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
              Set a temporary password for <strong style={{ color: 'var(--text-primary)' }}>{resetUser.username}</strong>. Every other signed-in session for this account ends immediately.
            </p>

            <div className="flex justify-end mb-1.5">
              <button
                type="button"
                onClick={() => { setResetPasswordValue(generateTempPassword()); setShowAddPassword(true); }}
                className="flex items-center gap-1 text-xs font-semibold"
                style={{ color: 'var(--accent-text)' }}
              >
                <RefreshCw className="w-3 h-3" /> Generate
              </button>
            </div>
            <div className="relative mb-3">
              <input
                type={showAddPassword ? 'text' : 'password'}
                value={resetPasswordValue}
                onChange={e => setResetPasswordValue(e.target.value)}
                style={{ ...inputStyle, paddingRight: 40, fontFamily: showAddPassword ? 'var(--font-mono, monospace)' : undefined }}
                autoComplete="new-password"
              />
              <button type="button" onClick={() => setShowAddPassword(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2">
                {showAddPassword
                  ? <EyeOff className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                  : <Eye className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />}
              </button>
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={() => setResetUser(null)} className="btn btn-secondary" disabled={resetting}>Cancel</button>
              <button
                onClick={handleResetPassword}
                disabled={resetting}
                className="px-3 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                style={{ background: 'var(--color-warning)' }}
              >
                {resetting ? 'Resetting…' : 'Reset Password'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change Role Modal */}
      {changeRoleUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="rounded-2xl shadow-2xl w-full max-w-sm" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
            <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--border-light)' }}>
              <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Change Role — {changeRoleUser.name}</h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Current: {ROLE_LABELS[changeRoleUser.role] || changeRoleUser.role}</p>
            </div>
            <div className="px-5 py-4">
              <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-muted)' }}>New Role</label>
              <Select
                value={newRole}
                onChange={e => setNewRole(e.target.value as UserRole)}
                className="w-full px-3 py-2 rounded-lg text-sm"
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
              >
                {(Object.keys(ROLE_LABELS) as UserRole[]).filter(r => r !== 'super_admin').map(r => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </Select>
            </div>
            <div className="px-5 py-3 border-t flex justify-end gap-2" style={{ borderColor: 'var(--border-light)' }}>
              <button onClick={() => setChangeRoleUser(null)} className="btn btn-secondary" disabled={changingRole}>Cancel</button>
              <button onClick={handleChangeRole} className="btn btn-primary" disabled={changingRole || newRole === changeRoleUser.role}>
                {changingRole ? 'Saving…' : 'Save Role'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
