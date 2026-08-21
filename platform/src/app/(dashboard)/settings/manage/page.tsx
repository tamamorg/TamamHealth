'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/context';
import { useUsers } from '@/lib/hooks/useUsers';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { SUPPORTED_LOCALES } from '@/lib/i18n';
import { hasLockPin, setLockPin, clearLockPin } from '@/lib/hooks/useAutoLock';
import { getUserPrefs, setUserPrefs, DEFAULT_USER_PREFS, type UserPrefs } from '@/lib/user-prefs';
import { useToast } from '@/components/Toast';
import { getAvailableRoles, getRoleConfig } from '@/lib/permissions';
import { generateTempPassword } from '@/lib/temp-password';
import { statesAndCounties } from '@/lib/data/south-sudan-reference';
// The facility-type vocabulary is shared: this form used to offer three types
// while /org-admin/hospitals offered five, so a PHCC or PHCU — the two
// commonest facilities in South Sudan — could never be created from Settings.
import { FACILITY_TYPES, DEFAULT_FACILITY_TYPE, type FacilityType } from '@/lib/facility-types';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import type { UserRole, UserDoc } from '@/lib/db-types';
import FilterBar from '@/components/filters/FilterBar';
import FilterSelect from '@/components/filters/FilterSelect';
import {
  Users, Building2, Plus, Edit3, KeyRound, UserX, UserCheck,
  X, Eye, EyeOff, RefreshCw, Check, Bell, LayoutDashboard, Trash2,
  Settings as SettingsIcon, Globe, Lock, Save, User as UserIcon,
} from '@/components/icons/lucide';
import RowActionsPopup, { rowActionsAt, rowActionsFromElement, isRowActivationKey, type RowActionsPopupState } from '@/components/RowActionsPopup';
import type { RowAction } from '@/components/RowActionsMenu';
import EhrListHeader from '@/components/ehr/EhrListHeader';
import { FacilitySettingsView } from '@/components/settings/FacilitySettingsView';
import {
  getDhis2SyncLog, recordDhis2SyncResult, recordDhis2SyncFailure, isDhis2Configured,
  groupDhis2DataValues, type Dhis2SyncLogDoc,
} from '@/lib/services/dhis2-sync-log-service';
import type { DHIS2ExportScope } from '@/lib/services/dhis2-export-service';
import Select from '@/components/Select';
import StaffPhotoField from '@/components/staff/StaffPhotoField';

const ALL_SERVICES = [
  'Surgery', 'Maternity', 'Pediatrics', 'Laboratory', 'X-ray', 'Ultrasound',
  'Pharmacy', 'Emergency', 'ICU', 'Cardiology', 'Orthopedics', 'Dentistry',
  'Ophthalmology', 'Physiotherapy', 'Mental Health', 'TB Treatment', 'HIV/AIDS',
];

const states = Object.keys(statesAndCounties);

// Temporary passwords come from `lib/temp-password.ts`, the one CSPRNG-backed
// generator every other admin surface already uses (/admin/users,
// /org-admin/users, /admin/organizations, and the account-request approval
// API). This page used to carry its own `Math.random()` version — a
// non-cryptographic PRNG whose internal state is recoverable from a short run
// of outputs — for exactly the credentials a facility admin hands to new staff.

export default function SettingsPage() {
  const { currentUser, isOnline, syncPaused, toggleOnline, syncNow, lastSync, refreshCurrentUser } = useApp();
  const { users, loading: usersLoading, create: createUser, update: updateUser, resetPassword, deactivate, reactivate } = useUsers();
  const { hospitals, loading: hospitalsLoading, create: createHospital, reload: reloadHospitals } = useHospitals();
  const { canManageUsers, canAccess } = usePermissions();
  const router = useRouter();
  // Personal settings live at /settings — this page is management only.
  useEffect(() => {
    if (currentUser && !canManageUsers && !canAccess('/facility-settings')) router.replace('/settings');
  }, [currentUser, canManageUsers, canAccess, router]);
  const { locale, setLocale } = useTranslation();
  const { showToast } = useToast();

  type SettingsTab = 'facility' | 'users' | 'hospitals' | 'sync';
  const [activeTab, setActiveTab] = useState<SettingsTab>('users');
  const visibleTabs = useMemo<Array<{ key: SettingsTab; label: string; icon: typeof Building2 }>>(() => [
    ...(canAccess('/facility-settings') ? [
      { key: 'facility' as const, label: 'Facility Settings', icon: Building2 },
    ] : []),
    ...(canManageUsers ? [
      { key: 'users' as const, label: 'User Management', icon: Users },
      { key: 'hospitals' as const, label: 'Hospital Management', icon: Building2 },
    ] : []),
    { key: 'sync' as const, label: 'Facility Sync', icon: RefreshCw },
  ], [canAccess, canManageUsers]);

  useEffect(() => {
    if (!visibleTabs.some(tab => tab.key === activeTab)) {
      setActiveTab(visibleTabs[0]?.key || 'sync');
    }
  }, [activeTab, visibleTabs]);

  // ── Facility Sync (DHIS2) ──
  const [syncRunning, setSyncRunning] = useState(false);
  const [dhis2Log, setDhis2Log] = useState<Dhis2SyncLogDoc | null>(null);
  const [dhis2LogLoaded, setDhis2LogLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getDhis2SyncLog().then(log => { if (!cancelled) { setDhis2Log(log); setDhis2LogLoaded(true); } });
    return () => { cancelled = true; };
  }, []);

  const dhis2Configured = isDhis2Configured();
  const lastPush = dhis2Log?.lastPush;
  const overallStatus: 'synced' | 'error' | 'pending' =
    !lastPush ? 'pending'
    : lastPush.status === 'pushed' ? 'synced'
    : lastPush.status === 'failed' ? 'error'
    : 'pending';
  const elementGroups = useMemo(
    () => dhis2Log?.lastDataset ? groupDhis2DataValues(dhis2Log.lastDataset.dataValues) : [],
    [dhis2Log]
  );
  const lastSyncedLabel = dhis2Log?.lastSyncedAt
    ? new Date(dhis2Log.lastSyncedAt).toLocaleString()
    : 'Never synced';

  const handleRunSync = async () => {
    if (!currentUser) return;
    setSyncRunning(true);
    try {
      const { generateDHIS2Export, pushDataSetToDHIS2 } = await import('@/lib/services/dhis2-export-service');
      const period = new Date().toISOString().slice(0, 7);
      const scope: DHIS2ExportScope = { role: currentUser.role, orgId: currentUser.orgId, hospitalId: currentUser.hospitalId };
      const dataset = await generateDHIS2Export(period, scope);
      const push = await pushDataSetToDHIS2(dataset);
      const log = await recordDhis2SyncResult({ dataset, push });
      setDhis2Log(log);
    } catch (err) {
      // Mark the attempt failed (not just a log line) so the Facility Sync
      // banner shows "error" instead of a stale "synced" from a prior success.
      const log = await recordDhis2SyncFailure((err as Error).message || 'Sync failed');
      setDhis2Log(log);
    } finally {
      setSyncRunning(false);
    }
  };

  // ── My account / preferences ──
  const [profileForm, setProfileForm] = useState<{ name: string; phone: string; photoUrl?: string }>({ name: '', phone: '' });
  const [profileSaving, setProfileSaving] = useState(false);
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [pwSaving, setPwSaving] = useState(false);
  const [showSelfPw, setShowSelfPw] = useState(false);

  // ── Screen-lock PIN (per device — for shared workstations) ──
  const [pinForm, setPinForm] = useState({ next: '', confirm: '' });
  const [pinSaving, setPinSaving] = useState(false);
  const [pinIsSet, setPinIsSet] = useState(false);
  useEffect(() => { setPinIsSet(hasLockPin()); }, []);

  const handleSetPin = async () => {
    if (!/^\d{4,6}$/.test(pinForm.next)) { showToast('PIN must be 4–6 digits', 'error'); return; }
    if (pinForm.next !== pinForm.confirm) { showToast('PINs do not match', 'error'); return; }
    setPinSaving(true);
    try {
      await setLockPin(pinForm.next);
      setPinIsSet(true);
      setPinForm({ next: '', confirm: '' });
      showToast('Screen-lock PIN set', 'success');
    } finally {
      setPinSaving(false);
    }
  };

  const handleClearPin = () => {
    clearLockPin();
    setPinIsSet(false);
    setPinForm({ next: '', confirm: '' });
    showToast('Screen-lock PIN removed', 'success');
  };

  // ── Sync & connectivity ──
  const [syncing, setSyncing] = useState(false);
  const handleSyncNow = async () => {
    setSyncing(true);
    try { await syncNow(); showToast('Sync started', 'success'); }
    catch { showToast('Could not start sync', 'error'); }
    finally { setSyncing(false); }
  };

  // ── Workspace + notification preferences (per device) ──
  const [prefs, setPrefsState] = useState<UserPrefs>(DEFAULT_USER_PREFS);
  useEffect(() => { setPrefsState(getUserPrefs()); }, []);
  const updatePref = (patch: Partial<UserPrefs>) => setPrefsState(setUserPrefs(patch));

  const handleToggleNotifications = async () => {
    if (!prefs.messageNotifications) {
      if (typeof Notification === 'undefined') { showToast('This browser does not support notifications', 'error'); return; }
      if (Notification.permission !== 'granted') {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') { showToast('Allow notifications in your browser to enable this', 'error'); return; }
      }
      updatePref({ messageNotifications: true });
      showToast('Desktop notifications on', 'success');
    } else {
      updatePref({ messageNotifications: false });
      showToast('Desktop notifications off', 'success');
    }
  };

  useEffect(() => {
    if (currentUser) {
      setProfileForm({
        name: currentUser.name || '',
        phone: (currentUser as { phone?: string }).phone || '',
        photoUrl: (currentUser as { photoUrl?: string }).photoUrl,
      });
    }
  }, [currentUser]);

  const handleSaveProfile = async () => {
    if (!currentUser?._id || !profileForm.name.trim()) { showToast('Name is required', 'error'); return; }
    setProfileSaving(true);
    try {
      await updateUser(
        currentUser._id,
        {
          name: profileForm.name.trim(),
          phone: profileForm.phone.trim(),
          // `null` clears it; `undefined` would read as "leave unchanged".
          photoUrl: profileForm.photoUrl ?? null,
        },
        currentUser._id, currentUser.username,
      );
      // This is the signed-in user's own profile — refresh the session so the
      // header, avatar, and clinical signatures pick the new name/photo up now.
      await refreshCurrentUser();
      showToast('Profile updated', 'success');
    } catch {
      showToast('Failed to update profile', 'error');
    } finally {
      setProfileSaving(false);
    }
  };

  const handleChangeOwnPassword = async () => {
    if (!currentUser?._id) return;
    if (!pwForm.current) { showToast('Enter your current password', 'error'); return; }
    // Match the server (/api/auth/change-password) and every other surface —
    // an 8-char minimum, so a 6–7 char password no longer passes here only to
    // be rejected by the API.
    if (pwForm.next.length < 8) { showToast('Password must be at least 8 characters', 'error'); return; }
    if (pwForm.next !== pwForm.confirm) { showToast('Passwords do not match', 'error'); return; }
    setPwSaving(true);
    try {
      // Self-service change goes through the auth route: it verifies the
      // CURRENT password and clears mustChangePassword centrally. (The old
      // resetPassword() path here was an admin-reset — it skipped verification
      // and re-flagged the account for a forced change at next login.)
      const { apiFetch } = await import('@/lib/api-fetch');
      const res = await apiFetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: pwForm.current, newPassword: pwForm.next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(body.error || 'Failed to change password', 'error');
        return;
      }
      setPwForm({ current: '', next: '', confirm: '' });
      showToast('Password changed', 'success');
    } catch {
      showToast('Failed to change password — check your connection', 'error');
    } finally {
      setPwSaving(false);
    }
  };

  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState<string>('all');
  const [filterHospital, setFilterHospital] = useState<string>('all');
  const [filterFacilityType, setFilterFacilityType] = useState<string>('all');

  // User form state
  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [userForm, setUserForm] = useState<{
    name: string; username: string; password: string; role: UserRole;
    hospitalId: string; hospitalName: string; photoUrl?: string;
  }>({
    name: '', username: '', password: '', role: 'doctor' as UserRole,
    hospitalId: '', hospitalName: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [userFormLoading, setUserFormLoading] = useState(false);

  // Reset password state
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  // One popup for the users table; the clicked row supplies its actions and position.
  const [rowMenu, setRowMenu] = useState<RowActionsPopupState | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);

  // Hospital form state
  const [showHospitalForm, setShowHospitalForm] = useState(false);
  const [hospitalForm, setHospitalForm] = useState({
    name: '', facilityType: DEFAULT_FACILITY_TYPE as FacilityType,
    state: '', town: '',
    totalBeds: 0, icuBeds: 0, maternityBeds: 0, pediatricBeds: 0,
    doctors: 0, clinicalOfficers: 0, nurses: 0, labTechnicians: 0, pharmacists: 0,
    hasElectricity: false, electricityHours: 0, hasGenerator: false, hasSolar: false,
    hasInternet: false, internetType: '', hasAmbulance: false, emergency24hr: false,
    services: [] as string[],
    lat: 0, lng: 0,
  });
  const [hospitalFormLoading, setHospitalFormLoading] = useState(false);
  // The owning tenant. A tenant admin has one; a platform operator does not,
  // and `createHospital` refuses a facility with no orgId — which is why this
  // form failed for a super_admin on every single attempt before.
  const [hospitalOrgId, setHospitalOrgId] = useState('');
  const { organizations } = useOrganizations();
  const orgChoices = useMemo(
    () => organizations.filter(o => o.isActive !== false),
    [organizations],
  );
  const needsHospitalOrgChoice = !currentUser?.orgId;

  // Access: every authenticated user can open Settings for their own
  // Preferences (theme, language, profile, password, screen-lock, sync,
  // workspace, notifications). The User/Hospital management tabs are gated
  // separately by `canManageUsers`, so no page-level role redirect is needed.

  // Filtered users
  const filteredUsers = useMemo(() => {
    return users.filter(u => {
      const q = search.toLowerCase();
      const matchSearch = !q || u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q);
      const matchRole = filterRole === 'all' || u.role === filterRole;
      const matchHosp = filterHospital === 'all' || u.hospitalId === filterHospital;
      return matchSearch && matchRole && matchHosp;
    });
  }, [users, search, filterRole, filterHospital]);

  if (!currentUser) return null;

  const roleOptions = getAvailableRoles('public', currentUser.role === 'super_admin')
    .filter(role => currentUser.role === 'super_admin' || role !== 'super_admin')
    .map(role => ({ value: role, label: getRoleConfig(role).label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const roleLabel = (role: UserRole) => getRoleConfig(role).label || role;

  // ─── User Handlers ────────────────────────────────────────
  const openCreateUser = () => {
    setEditingUser(null);
    const pw = generateTempPassword();
    setUserForm({ name: '', username: '', password: pw, role: 'doctor', hospitalId: '', hospitalName: '' });
    setShowPassword(true);
    setShowUserForm(true);
  };

  const openEditUser = (userId: string) => {
    const u = users.find(x => x._id === userId);
    if (!u) return;
    setEditingUser(userId);
    setUserForm({
      name: u.name, username: u.username, password: '',
      role: u.role, hospitalId: u.hospitalId || '', hospitalName: u.hospitalName || '',
    });
    setShowUserForm(true);
  };

  const handleUserSubmit = async () => {
    setUserFormLoading(true);
    try {
      if (editingUser) {
        await updateUser(editingUser, {
          name: userForm.name,
          role: userForm.role,
          hospitalId: userForm.role !== 'government' ? userForm.hospitalId : undefined,
          hospitalName: userForm.role !== 'government' ? userForm.hospitalName : undefined,
          photoUrl: userForm.photoUrl ?? null,
        }, currentUser._id, currentUser.username);
        // An admin editing their own row is editing the live session too.
        if (editingUser === currentUser._id) await refreshCurrentUser();
        showToast('User updated successfully', 'success');
      } else {
        await createUser({
          name: userForm.name,
          username: userForm.username,
          password: userForm.password,
          role: userForm.role,
          hospitalId: userForm.role !== 'government' ? userForm.hospitalId : undefined,
          hospitalName: userForm.role !== 'government' ? userForm.hospitalName : undefined,
          photoUrl: userForm.photoUrl,
        }, currentUser._id, currentUser.username);
        showToast('User created successfully', 'success');
      }
      setShowUserForm(false);
    } catch (err: unknown) {
      const e = err as Error;
      showToast(e.message || 'Failed to save user', 'error');
    } finally {
      setUserFormLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetUserId || !newPassword) return;
    try {
      await resetPassword(resetUserId, newPassword, currentUser._id, currentUser.username);
      showToast('Password reset successfully', 'success');
      setResetUserId(null);
      setNewPassword('');
    } catch {
      showToast('Failed to reset password', 'error');
    }
  };

  const handleToggleActive = async (userId: string, currentlyActive: boolean) => {
    try {
      if (currentlyActive) {
        await deactivate(userId, currentUser._id, currentUser.username);
        showToast('User deactivated', 'success');
      } else {
        // Not `updateUser({ isActive: true })` — see the note on `reactivate`.
        await reactivate(userId, currentUser._id, currentUser.username);
        showToast('User activated', 'success');
      }
    } catch {
      showToast('Failed to update user status', 'error');
    }
  };

  /** What a user row offers — opened by clicking the row itself. */
  const userActions = (u: UserDoc): RowAction[] => [
    { key: 'edit', label: 'Edit', icon: <Edit3 className="w-4 h-4" />, onClick: () => openEditUser(u._id) },
    { key: 'reset', label: 'Reset Password', icon: <KeyRound className="w-4 h-4" />, onClick: () => { setResetUserId(u._id); setNewPassword(generateTempPassword()); setShowNewPassword(true); } },
    { key: 'toggle', label: u.isActive ? 'Deactivate' : 'Activate', tone: u.isActive ? 'danger' : 'default', icon: u.isActive ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />, onClick: () => handleToggleActive(u._id, u.isActive) },
  ];

  // ─── Hospital Handlers ────────────────────────────────────
  const openCreateHospital = () => {
    setHospitalOrgId('');
    setHospitalForm({
      name: '', facilityType: DEFAULT_FACILITY_TYPE, state: '', town: '',
      totalBeds: 0, icuBeds: 0, maternityBeds: 0, pediatricBeds: 0,
      doctors: 0, clinicalOfficers: 0, nurses: 0, labTechnicians: 0, pharmacists: 0,
      hasElectricity: false, electricityHours: 0, hasGenerator: false, hasSolar: false,
      hasInternet: false, internetType: '', hasAmbulance: false, emergency24hr: false,
      services: [], lat: 0, lng: 0,
    });
    setShowHospitalForm(true);
  };

  const handleHospitalSubmit = async () => {
    if (!hospitalForm.name || !hospitalForm.state) {
      showToast('Hospital name and state are required', 'error');
      return;
    }
    // Stamp the owning tenant. Without it the facility is written with no
    // `orgId`: CouchDB's tenant validator rejects it on push and
    // `filterByScope` hides it from every role but super_admin, so the org
    // that just created a hospital keeps reading "Active Facilities 0".
    // `createHospital` refuses the write outright when this is missing — which
    // is what a super_admin (who has no org of their own) used to hit here on
    // every attempt, because this form had no way to name an organization.
    const orgId = currentUser.orgId || hospitalOrgId;
    if (!orgId) {
      showToast('Select the organization this facility belongs to', 'error');
      return;
    }
    setHospitalFormLoading(true);
    try {
      await createHospital(
        { ...hospitalForm, orgId },
        currentUser._id,
        currentUser.username,
      );
      showToast('Hospital created successfully', 'success');
      setShowHospitalForm(false);
      await reloadHospitals();
    } catch (err: unknown) {
      const e = err as Error;
      showToast(e.message || 'Failed to create hospital', 'error');
    } finally {
      setHospitalFormLoading(false);
    }
  };

  const toggleService = (svc: string) => {
    setHospitalForm(prev => ({
      ...prev,
      services: prev.services.includes(svc)
        ? prev.services.filter(s => s !== svc)
        : [...prev.services, svc],
    }));
  };

  const handleHospitalSelect = (hospId: string) => {
    const h = hospitals.find(x => x._id === hospId);
    setUserForm(prev => ({ ...prev, hospitalId: hospId, hospitalName: h?.name || '' }));
  };

  // ─── Styles ─────────────────────────────────────────────
  const card: React.CSSProperties = {
    background: '#fff', border: '1px solid var(--ehr-border)',
    borderRadius: '12px', overflow: 'hidden',
  };
  const inputStyle: React.CSSProperties = {
    background: '#fff', border: '1px solid var(--ehr-border)',
    borderRadius: '8px', padding: '9px 12px', color: 'var(--text-primary)',
    fontSize: '14px', width: '100%', outline: 'none',
  };
  const selectStyle: React.CSSProperties = {
    ...inputStyle, appearance: 'none' as const, paddingInlineEnd: '36px',
    backgroundImage: `url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%238A9E9A' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center',
  };
  const btnPrimary: React.CSSProperties = {
    background: '#015697', color: 'white',
    border: '1px solid #015697', borderRadius: '8px', padding: '9px 16px',
    fontFamily: 'var(--font-condensed)', fontSize: '13.5px', fontWeight: 600,
    letterSpacing: '0.02em', cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: '8px',
  };
  const btnSecondary: React.CSSProperties = {
    background: '#fff', color: '#113055',
    border: '1px solid #ECEEF1', borderRadius: '8px', padding: '9px 16px',
    fontFamily: 'var(--font-condensed)', fontSize: '13.5px', fontWeight: 600,
    letterSpacing: '0.02em', cursor: 'pointer',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)',
    textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px', display: 'block',
  };
  const overlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
    zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
  };
  const modalStyle: React.CSSProperties = {
    background: 'var(--card-bg)', border: '1px solid var(--border-light)',
    borderRadius: '6px', width: '100%', maxWidth: '600px', maxHeight: '90vh',
    overflow: 'auto', padding: '28px',
  };

  return (
    <>
      <main className="page-container page-enter settings-manage-shell">
        <section className="ehr-set-section">
          <div className="ehr-set-section-head">
            <span><SettingsIcon /></span>
            <div style={{ minWidth: 0, flex: '1 1 auto' }}>
              <h3>User &amp; hospital management</h3>
              <small>Facility setup, account administration, and sync controls</small>
            </div>
          </div>
        </section>

        {/* Tab bar */}
        <div className="settings-tab-strip">
          {[
            ...visibleTabs,
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); setSearch(''); setFilterFacilityType('all'); }}
              className={activeTab === tab.key ? 'active' : undefined}
              data-tour={`settings-tab-${tab.key}`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* ═══════════════ FACILITY SETTINGS TAB ═══════════════ */}
        {activeTab === 'facility' && <FacilitySettingsView embedded />}

        {/* ═══════════════ USER MANAGEMENT TAB ═══════════════ */}
        {activeTab === 'users' && (
          <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-3">
              <Select value={filterRole} onChange={e => setFilterRole(e.target.value)} style={selectStyle}>
                <option value="all">All Roles</option>
                {roleOptions.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </Select>
              <Select value={filterHospital} onChange={e => setFilterHospital(e.target.value)} style={{ ...selectStyle, maxWidth: '220px' }}>
                <option value="all">All Hospitals</option>
                {hospitals.map(h => <option key={h._id} value={h._id}>{h.name}</option>)}
              </Select>
              <div className="flex-1" />
              <button onClick={openCreateUser} style={btnPrimary}>
                <Plus className="w-4 h-4" /> Add User
              </button>
            </div>

            {/* Users table */}
            <div style={card}>
              <div style={{ overflowX: 'auto' }}>
                <table className="w-full" style={{ borderCollapse: 'collapse', minWidth: 840 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-light)' }}>
                      {['Name', 'Username', 'Role', 'Hospital', 'Status', 'Created'].map(h => (
                        <th key={h} className="text-start px-4 py-3" style={{
                          fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)',
                          textTransform: 'uppercase', letterSpacing: '0.05em',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {usersLoading ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center" style={{ color: 'var(--text-muted)' }}>Loading users...</td></tr>
                    ) : filteredUsers.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center" style={{ color: 'var(--text-muted)' }}>No users found</td></tr>
                    ) : filteredUsers.map(u => (
                      <tr key={u._id} style={{ borderBottom: '1px solid var(--border-light)', cursor: 'pointer' }}
                          tabIndex={0}
                          onClick={e => setRowMenu(rowActionsAt(e, userActions(u)))}
                          onKeyDown={e => { if (isRowActivationKey(e.key)) { e.preventDefault(); setRowMenu(rowActionsFromElement(e.currentTarget, userActions(u))); } }}
                          className="hover:bg-[rgba(17, 116, 180,0.03)] transition-colors">
                        <td className="px-4 py-3">
                          <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>{u.name}</span>
                        </td>
                        <td className="px-4 py-3">
                          <code className="text-xs px-2 py-1 rounded" style={{ background: 'var(--input-bg)', color: 'var(--text-secondary)' }}>{u.username}</code>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs font-semibold px-2 py-1 rounded-full" style={{
                            background: u.role === 'government' ? 'rgba(17, 116, 180,0.12)' : 'rgba(17, 116, 180,0.12)',
                            color: u.role === 'government' ? 'var(--accent-primary)' : 'var(--accent-primary)',
                          }}>{roleLabel(u.role)}</span>
                        </td>
                        <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                          {u.hospitalName || '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-1.5 text-xs font-semibold">
                            <span className="w-2 h-2 rounded-full" style={{ background: u.isActive ? 'var(--accent-primary)' : 'var(--text-muted)' }} />
                            <span style={{ color: u.isActive ? 'var(--accent-primary)' : 'var(--text-muted)' }}>{u.isActive ? 'Active' : 'Inactive'}</span>
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                          {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <RowActionsPopup state={rowMenu} onClose={() => setRowMenu(null)} />
            </div>
          </div>
        )}

        {/* ═══════════════ HOSPITAL MANAGEMENT TAB ═══════════════ */}
        {activeTab === 'hospitals' && (
          <div className="space-y-4">
            {/* Toolbar */}
            <FilterBar>
              <FilterSelect
                value={filterFacilityType}
                onChange={setFilterFacilityType}
                options={[
                  { value: 'all', label: 'All Types' },
                  ...FACILITY_TYPES,
                ]}
                aria-label="Filter by facility type"
              />
              <FilterBar.Spacer />
              <button onClick={openCreateHospital} style={btnPrimary}>
                <Plus className="w-4 h-4" /> Add Hospital
              </button>
            </FilterBar>

            {/* Hospitals table */}
            <div style={card}>
              <div style={{ overflowX: 'auto' }}>
                <table className="w-full" style={{ borderCollapse: 'collapse', minWidth: 720 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-light)' }}>
                      {['Name', 'State', 'Type', 'Beds', 'Staff', 'Status'].map(h => (
                        <th key={h} className="text-start px-4 py-3" style={{
                          fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)',
                          textTransform: 'uppercase', letterSpacing: '0.05em',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {hospitalsLoading ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center" style={{ color: 'var(--text-muted)' }}>Loading hospitals...</td></tr>
                    ) : hospitals.filter(h => {
                      const q = search.toLowerCase();
                      const matchSearch = !q || h.name.toLowerCase().includes(q) || h.state.toLowerCase().includes(q);
                      const matchType = filterFacilityType === 'all' || h.facilityType === filterFacilityType;
                      return matchSearch && matchType;
                    }).map(h => (
                      <tr key={h._id} style={{ borderBottom: '1px solid var(--border-light)' }}
                          className="hover:bg-[rgba(17, 116, 180,0.03)] transition-colors">
                        <td className="px-4 py-3">
                          <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>{h.name}</span>
                        </td>
                        <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>{h.state}</td>
                        <td className="px-4 py-3">
                          <span className="text-xs font-semibold px-2 py-1 rounded-full" style={{
                            background: h.facilityType === 'national_referral' ? 'rgba(17, 116, 180,0.12)' : h.facilityType === 'state_hospital' ? 'rgba(17, 116, 180,0.12)' : 'rgba(17, 116, 180,0.12)',
                            color: h.facilityType === 'national_referral' ? 'var(--accent-primary)' : h.facilityType === 'state_hospital' ? 'var(--accent-primary)' : 'var(--accent-primary)',
                          }}>
                            {FACILITY_TYPES.find(f => f.value === h.facilityType)?.label || h.facilityType}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>{h.totalBeds}</td>
                        <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                          {h.doctors + h.nurses + h.clinicalOfficers + h.labTechnicians + h.pharmacists}
                        </td>
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-1.5 text-xs font-semibold">
                            <span className="w-2 h-2 rounded-full" style={{
                              background: h.syncStatus === 'online' ? 'var(--accent-primary)' : h.syncStatus === 'syncing' ? 'var(--color-warning)' : 'var(--text-muted)',
                            }} />
                            <span style={{
                              color: h.syncStatus === 'online' ? 'var(--accent-primary)' : h.syncStatus === 'syncing' ? 'var(--color-warning-text)' : 'var(--text-muted)',
                            }}>{h.syncStatus === 'online' ? 'Online' : h.syncStatus === 'syncing' ? 'Syncing' : 'Offline'}</span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════ FACILITY SYNC TAB ═══════════════ */}
        {activeTab === 'sync' && (
          <div className="max-w-2xl space-y-5" data-tour="settings-sync-panel">
            {/* Header card */}
            <div className="card-elevated p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>Facility Sync</h2>
                  <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                    Push facility data to the national HMIS (DHIS2). Last synced: {lastSyncedLabel}.
                  </p>
                  {!dhis2Configured && (
                    <p style={{ fontSize: 12, color: 'var(--color-warning-text)', marginTop: 4 }}>
                      DHIS2 not configured — Sync Now prepares the export locally but won&apos;t reach a server until NEXT_PUBLIC_DHIS2_BASE_URL is set.
                    </p>
                  )}
                </div>
                <button
                  onClick={handleRunSync}
                  disabled={syncRunning}
                  className="flex items-center gap-2 btn btn-primary flex-shrink-0"
                  style={{ opacity: syncRunning ? 0.7 : 1 }}
                >
                  <RefreshCw className={`w-4 h-4 ${syncRunning ? 'animate-spin' : ''}`} />
                  {syncRunning ? 'Syncing…' : 'Sync Now'}
                </button>
              </div>

              {/* Status message */}
              {syncRunning ? (
                <div className="mt-4 flex items-center gap-3 px-4 py-3 rounded-xl" style={{ background: 'rgba(33,145,208,0.07)', border: '1px solid rgba(33,145,208,0.2)' }}>
                  <RefreshCw className="w-4 h-4 animate-spin flex-shrink-0" style={{ color: 'var(--tamamhealth-blue)' }} />
                  <span style={{ fontSize: 13, color: 'var(--tamamhealth-blue)', fontWeight: 500 }}>Syncing data to DHIS2…</span>
                </div>
              ) : lastPush && (
                <div
                  className="mt-4 flex items-center gap-2 px-4 py-3 rounded-xl"
                  style={
                    overallStatus === 'synced' ? { background: 'rgba(14, 148, 99,0.08)', border: '1px solid rgba(14, 148, 99,0.2)' }
                    : overallStatus === 'error' ? { background: 'rgba(224, 49, 39,0.08)', border: '1px solid rgba(224, 49, 39,0.2)' }
                    : { background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }
                  }
                >
                  {overallStatus === 'synced'
                    ? <Check className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--color-success-text)' }} />
                    : <RefreshCw className="w-4 h-4 flex-shrink-0" style={{ color: overallStatus === 'error' ? 'var(--color-danger)' : 'var(--text-muted)' }} />}
                  <span style={{ fontSize: 13, fontWeight: 500, color: overallStatus === 'synced' ? 'var(--color-success-text)' : overallStatus === 'error' ? 'var(--color-danger-text)' : 'var(--text-secondary)' }}>
                    {lastPush.message}
                  </span>
                </div>
              )}
            </div>

            {/* Progress overview */}
            <div className="card-elevated p-5 space-y-1">
              {!dhis2LogLoaded ? (
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading sync status…</p>
              ) : elementGroups.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  No sync has been run yet on this device. Click Sync Now to push this facility&apos;s data to DHIS2.
                </p>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {elementGroups.length} data groups from last sync ({dhis2Log?.lastDataset?.period})
                    </span>
                    <span style={{ fontSize: 12, color: overallStatus === 'error' ? 'var(--color-danger-text)' : 'var(--text-muted)' }}>
                      {overallStatus === 'synced' ? 'All pushed' : overallStatus === 'error' ? 'Push failed' : 'Prepared, not pushed'}
                    </span>
                  </div>
                  {/* Progress bar — one atomic push covers every group, so it's all-or-nothing */}
                  <div style={{ height: 6, borderRadius: 3, background: 'var(--border-light)', overflow: 'hidden', marginBottom: 16 }}>
                    <div style={{ height: '100%', width: overallStatus === 'synced' ? '100%' : '0%', background: overallStatus === 'error' ? 'var(--color-danger)' : 'var(--color-success)', borderRadius: 3, transition: 'width 0.6s ease' }} />
                  </div>

                  {elementGroups.map(g => {
                    const s =
                      overallStatus === 'synced' ? { bg: 'rgba(14, 148, 99,0.1)', fg: 'var(--color-success-text)', label: 'Synced' }
                      : overallStatus === 'error' ? { bg: 'rgba(224, 49, 39,0.1)', fg: 'var(--color-danger-text)', label: 'Error' }
                      : { bg: 'rgba(255, 127, 0,0.1)', fg: 'var(--color-warning-text)', label: 'Pending' };
                    return (
                      <div key={g.label} className="flex items-start justify-between py-2.5" style={{ borderBottom: '1px solid var(--border-light)' }}>
                        <div className="min-w-0">
                          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{g.label}</span>
                          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{g.elements.length} indicator{g.elements.length > 1 ? 's' : ''}</p>
                          {overallStatus === 'error' && lastPush && (
                            <p style={{ fontSize: 11, color: 'var(--color-danger-text)', marginTop: 2 }}>{lastPush.message}</p>
                          )}
                        </div>
                        <span className="flex-shrink-0 ms-3 text-[11px] font-semibold px-2.5 py-0.5 rounded-full" style={{ background: s.bg, color: s.fg }}>
                          {s.label}
                        </span>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        )}
      </main>

      {/* ═══════════════ CREATE/EDIT USER MODAL ═══════════════ */}
      {showUserForm && (
        <div style={overlayStyle} onClick={() => setShowUserForm(false)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                {editingUser ? 'Edit User' : 'Create New User'}
              </h3>
              <button onClick={() => setShowUserForm(false)} className="p-1 rounded-lg hover:bg-[rgba(93, 114, 139,0.1)]" style={{ color: 'var(--text-muted)' }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Captured at registration rather than left for later: a staff
                  directory that starts empty tends to stay empty, and the
                  worklists, schedule grid and booking pages all read this. */}
              <StaffPhotoField
                name={userForm.name}
                value={userForm.photoUrl}
                onChange={next => setUserForm(p => ({ ...p, photoUrl: next ?? undefined }))}
              />
              <div>
                <label style={labelStyle}>Full Name</label>
                <input type="text" value={userForm.name} onChange={e => setUserForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Dr. Mary Ayen" style={inputStyle} />
              </div>

              {!editingUser && (
                <div>
                  <label style={labelStyle}>Username</label>
                  <input type="text" value={userForm.username}
                    onChange={e => setUserForm(p => ({ ...p, username: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '') }))}
                    placeholder="e.g. mary.ayen" style={inputStyle} />
                </div>
              )}

              {!editingUser && (
                <div>
                  <label style={labelStyle}>Password</label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={userForm.password}
                        onChange={e => setUserForm(p => ({ ...p, password: e.target.value }))}
                        style={inputStyle}
                      />
                      <button type="button" onClick={() => setShowPassword(!showPassword)}
                        className="absolute end-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }}>
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <button type="button" onClick={() => setUserForm(p => ({ ...p, password: generateTempPassword() }))}
                      style={btnSecondary} className="flex items-center gap-1.5 whitespace-nowrap">
                      <RefreshCw className="w-3.5 h-3.5" /> Generate
                    </button>
                  </div>
                  {showPassword && userForm.password && (
                    <div className="mt-2 p-3 rounded-lg" style={{ background: 'var(--accent-light)', border: '1px solid var(--accent-border)' }}>
                      <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Share this password with the staff member:</p>
                      <p className="text-sm font-mono font-bold mt-1" style={{ color: 'var(--text-primary)', userSelect: 'all' }}>{userForm.password}</p>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label style={labelStyle}>Role</label>
                <Select value={userForm.role} onChange={e => setUserForm(p => ({ ...p, role: e.target.value as UserRole }))} style={selectStyle}>
                  {roleOptions.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </Select>
              </div>

              {userForm.role !== 'government' && (
                <div>
                  <label style={labelStyle}>Hospital</label>
                  <Select value={userForm.hospitalId} onChange={e => handleHospitalSelect(e.target.value)} style={selectStyle}>
                    <option value="">Select a hospital...</option>
                    {hospitals.map(h => <option key={h._id} value={h._id}>{h.name} — {h.state}</option>)}
                  </Select>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4" style={{ borderTop: '1px solid var(--border-light)' }}>
                <button onClick={() => setShowUserForm(false)} style={btnSecondary}>Cancel</button>
                <button onClick={handleUserSubmit} disabled={userFormLoading} style={{
                  ...btnPrimary, opacity: userFormLoading ? 0.6 : 1,
                }}>
                  {userFormLoading ? 'Saving...' : editingUser ? 'Update User' : 'Create User'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ RESET PASSWORD MODAL ═══════════════ */}
      {resetUserId && (
        <div style={overlayStyle} onClick={() => setResetUserId(null)}>
          <div style={{ ...modalStyle, maxWidth: '440px' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Reset Password</h3>
              <button onClick={() => setResetUserId(null)} className="p-1 rounded-lg hover:bg-[rgba(93, 114, 139,0.1)]" style={{ color: 'var(--text-muted)' }}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
              Set a new password for <strong>{users.find(u => u._id === resetUserId)?.name}</strong>
            </p>
            <div>
              <label style={labelStyle}>New Password</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    style={inputStyle}
                  />
                  <button type="button" onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute end-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }}>
                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <button type="button" onClick={() => setNewPassword(generateTempPassword())}
                  style={btnSecondary} className="flex items-center gap-1.5 whitespace-nowrap">
                  <RefreshCw className="w-3.5 h-3.5" /> Generate
                </button>
              </div>
              {showNewPassword && newPassword && (
                <div className="mt-2 p-3 rounded-lg" style={{ background: 'rgba(253, 217, 95,0.1)', border: '1px solid rgba(253, 217, 95,0.2)' }}>
                  <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Share this with the user:</p>
                  <p className="text-sm font-mono font-bold mt-1" style={{ color: 'var(--text-primary)', userSelect: 'all' }}>{newPassword}</p>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 pt-4 mt-4" style={{ borderTop: '1px solid var(--border-light)' }}>
              <button onClick={() => setResetUserId(null)} style={btnSecondary}>Cancel</button>
              <button onClick={handleResetPassword} style={btnPrimary}>
                <KeyRound className="w-4 h-4" /> Reset Password
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ CREATE HOSPITAL MODAL ═══════════════ */}
      {showHospitalForm && (
        <div style={overlayStyle} onClick={() => setShowHospitalForm(false)}>
          <div style={{ ...modalStyle, maxWidth: '720px' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Add New Hospital</h3>
              <button onClick={() => setShowHospitalForm(false)} className="p-1 rounded-lg hover:bg-[rgba(93, 114, 139,0.1)]" style={{ color: 'var(--text-muted)' }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-5">
              {/* Basic Info */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--accent-primary)' }}>Basic Information</h4>
                <div className="grid grid-cols-2 gap-3">
                  {needsHospitalOrgChoice && (
                    <div className="sm:col-span-2">
                      <label style={labelStyle}>Organization</label>
                      <Select value={hospitalOrgId}
                        onChange={e => setHospitalOrgId(e.target.value)}
                        style={selectStyle}>
                        <option value="">Select an organization...</option>
                        {orgChoices.map(o => <option key={o._id} value={o._id}>{o.name}</option>)}
                      </Select>
                    </div>
                  )}
                  <div className="sm:col-span-2">
                    <label style={labelStyle}>Hospital Name</label>
                    <input type="text" value={hospitalForm.name}
                      onChange={e => setHospitalForm(p => ({ ...p, name: e.target.value }))}
                      placeholder="e.g. Rumbek State Hospital" style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Facility Type</label>
                    <Select value={hospitalForm.facilityType}
                      onChange={e => setHospitalForm(p => ({ ...p, facilityType: e.target.value as typeof p.facilityType }))}
                      style={selectStyle}>
                      {FACILITY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </Select>
                  </div>
                  <div>
                    <label style={labelStyle}>State</label>
                    <Select value={hospitalForm.state}
                      onChange={e => setHospitalForm(p => ({ ...p, state: e.target.value }))}
                      style={selectStyle}>
                      <option value="">Select state...</option>
                      {states.map(s => <option key={s} value={s}>{s}</option>)}
                    </Select>
                  </div>
                  <div>
                    <label style={labelStyle}>Town</label>
                    <input type="text" value={hospitalForm.town}
                      onChange={e => setHospitalForm(p => ({ ...p, town: e.target.value }))}
                      placeholder="e.g. Rumbek" style={inputStyle} />
                  </div>
                </div>
              </div>

              {/* Beds */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--accent-primary)' }}>Bed Capacity</h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { key: 'totalBeds', label: 'Total Beds' },
                    { key: 'icuBeds', label: 'ICU Beds' },
                    { key: 'maternityBeds', label: 'Maternity' },
                    { key: 'pediatricBeds', label: 'Pediatric' },
                  ].map(f => (
                    <div key={f.key}>
                      <label style={labelStyle}>{f.label}</label>
                      <input type="number" min="0"
                        value={hospitalForm[f.key as keyof typeof hospitalForm] as number}
                        onChange={e => setHospitalForm(p => ({ ...p, [f.key]: parseInt(e.target.value) || 0 }))}
                        style={inputStyle} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Staff */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--accent-primary)' }}>Staff Numbers</h4>
                <div className="grid grid-cols-5 gap-3">
                  {[
                    { key: 'doctors', label: 'Doctors' },
                    { key: 'clinicalOfficers', label: 'Clinical Off.' },
                    { key: 'nurses', label: 'Nurses' },
                    { key: 'labTechnicians', label: 'Lab Techs' },
                    { key: 'pharmacists', label: 'Pharmacists' },
                  ].map(f => (
                    <div key={f.key}>
                      <label style={labelStyle}>{f.label}</label>
                      <input type="number" min="0"
                        value={hospitalForm[f.key as keyof typeof hospitalForm] as number}
                        onChange={e => setHospitalForm(p => ({ ...p, [f.key]: parseInt(e.target.value) || 0 }))}
                        style={inputStyle} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Infrastructure */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--accent-primary)' }}>Infrastructure</h4>
                <div className="grid grid-cols-2 gap-x-6 gap-y-3 keep-cols">
                  {[
                    { key: 'hasElectricity', label: 'Has Electricity' },
                    { key: 'hasGenerator', label: 'Has Generator' },
                    { key: 'hasSolar', label: 'Has Solar' },
                    { key: 'hasInternet', label: 'Has Internet' },
                    { key: 'hasAmbulance', label: 'Has Ambulance' },
                    { key: 'emergency24hr', label: '24hr Emergency' },
                  ].map(f => (
                    <label key={f.key} className="flex items-center gap-3 cursor-pointer text-sm" style={{ color: 'var(--text-primary)' }}>
                      <input type="checkbox"
                        checked={hospitalForm[f.key as keyof typeof hospitalForm] as boolean}
                        onChange={e => setHospitalForm(p => ({ ...p, [f.key]: e.target.checked }))}
                        className="w-4 h-4 rounded accent-[var(--accent-primary)]"
                      />
                      {f.label}
                    </label>
                  ))}
                </div>
                {hospitalForm.hasElectricity && (
                  <div className="mt-3" style={{ maxWidth: '200px' }}>
                    <label style={labelStyle}>Electricity Hours/Day</label>
                    <input type="number" min="0" max="24"
                      value={hospitalForm.electricityHours}
                      onChange={e => setHospitalForm(p => ({ ...p, electricityHours: parseInt(e.target.value) || 0 }))}
                      style={inputStyle} />
                  </div>
                )}
                {hospitalForm.hasInternet && (
                  <div className="mt-3" style={{ maxWidth: '300px' }}>
                    <label style={labelStyle}>Internet Type</label>
                    <input type="text" value={hospitalForm.internetType}
                      onChange={e => setHospitalForm(p => ({ ...p, internetType: e.target.value }))}
                      placeholder="e.g. 4G Mobile, Satellite" style={inputStyle} />
                  </div>
                )}
              </div>

              {/* Services */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--accent-primary)' }}>Services Offered</h4>
                <div className="flex flex-wrap gap-2">
                  {ALL_SERVICES.map(svc => (
                    <button key={svc} type="button" onClick={() => toggleService(svc)}
                      className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer"
                      style={{
                        background: hospitalForm.services.includes(svc) ? 'rgba(17, 116, 180,0.15)' : 'var(--input-bg)',
                        color: hospitalForm.services.includes(svc) ? 'var(--accent-primary)' : 'var(--text-muted)',
                        border: `1px solid ${hospitalForm.services.includes(svc) ? 'rgba(17, 116, 180,0.3)' : 'var(--border-light)'}`,
                      }}>
                      {hospitalForm.services.includes(svc) && <Check className="w-3 h-3 inline me-1" />}
                      {svc}
                    </button>
                  ))}
                </div>
              </div>

              {/* Coordinates */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--accent-primary)' }}>Location Coordinates</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label style={labelStyle}>Latitude</label>
                    <input type="number" step="0.0001"
                      value={hospitalForm.lat}
                      onChange={e => setHospitalForm(p => ({ ...p, lat: parseFloat(e.target.value) || 0 }))}
                      style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Longitude</label>
                    <input type="number" step="0.0001"
                      value={hospitalForm.lng}
                      onChange={e => setHospitalForm(p => ({ ...p, lng: parseFloat(e.target.value) || 0 }))}
                      style={inputStyle} />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4" style={{ borderTop: '1px solid var(--border-light)' }}>
                <button onClick={() => setShowHospitalForm(false)} style={btnSecondary}>Cancel</button>
                <button onClick={handleHospitalSubmit} disabled={hospitalFormLoading} style={{
                  ...btnPrimary, opacity: hospitalFormLoading ? 0.6 : 1,
                }}>
                  {hospitalFormLoading ? 'Creating...' : 'Create Hospital'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
