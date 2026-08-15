'use client';

/**
 * Settings (designs 10 + 11) — nav-driven, per-role.
 *
 * The grouped sidebar (design 10) decides what the body shows: exactly one
 * panel at a time. Every user gets their own role's personal panels (design
 * 11 sections — account, role defaults, notifications, security); users with
 * management rights additionally get the design-10 facility panels backed by
 * real functionality: the live Users & roles table, the real facility
 * settings editor, integration/sync status, and restricted actions.
 * There is no role switcher — each user sees only their own settings.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Modal from '@/components/Modal';
import { useApp } from '@/lib/context';
import { useToast } from '@/components/Toast';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { useUsers } from '@/lib/hooks/useUsers';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { SUPPORTED_LOCALES } from '@/lib/i18n';
import { getUserPrefs, setUserPrefs } from '@/lib/user-prefs';
import { hasLockPin, setLockPin, clearLockPin } from '@/lib/hooks/useAutoLock';
import { getRoleConfig } from '@/lib/permissions';
import { isPathAllowed } from '@/lib/role-routes';
import {
  specForRole, getStoredRoleSettings, saveStoredRoleSettings,
  type RoleSettingsValues, type RoleSettingRow, type RoleSettingSection,
} from '@/lib/role-settings';
import { initials, avatarTint } from '@/lib/patient-utils';
import { FacilitySettingsView } from '@/components/settings/FacilitySettingsView';
import OrganizationSettingsPanel, { type OrganizationSettingsSection } from '@/components/settings/OrganizationSettingsPanel';
import OrgBrandingPage from '@/app/(dashboard)/org-admin/branding/page';
import OrgHospitalsPage from '@/app/(dashboard)/org-admin/hospitals/page';
import OrgUsersPage from '@/app/(dashboard)/org-admin/users/page';
import ServicePricingPage from '@/app/(dashboard)/org-admin/pricing/page';
import ManagementSettingsPage from '@/app/(dashboard)/settings/manage/page';
import ItOperationsPanel, { IT_OPERATIONS_JOB_COUNT } from '@/components/admin/ItOperationsPanel';
import { SettingsHostProvider } from '@/components/settings/SettingsHost';
import {
  SYSTEM_ADMIN_SECTIONS_META,
  systemAdminSectionCount,
  useSystemAdminConfig,
  SystemAdminSectionContent,
  SystemAdminEditorModal,
  SystemAdminStyles,
} from '@/components/settings/SystemAdminSections';
import { getDhis2SyncLog, isDhis2Configured, type Dhis2SyncLogDoc } from '@/lib/services/dhis2-sync-log-service';
import {
  AlertTriangle, ArrowLeft, Bell, BedDouble, Building2, Check, ChevronRight, Clock,
  CreditCard, FileText, FlaskConical, KeyRound, List, Lock, Palette, Pencil, Pill, Plus,
  RefreshCw, Server, Settings, Shield, Stethoscope, Trash2, User, Users, Zap, type LucideIcon,
} from '@/components/icons/lucide';
import Select from '@/components/Select';

const SECTION_ICONS: Record<string, LucideIcon> = {
  user: User, bell: Bell, shield: Shield, steth: Stethoscope, pill: Pill,
  flask: FlaskConical, card: CreditCard, bed: BedDouble, clock: Clock,
  list: List, doc: FileText, users: Users, sync: RefreshCw, building: Building2,
};

/** Default value for a row, resolving the app-wired specials. */
function rowDefault(row: RoleSettingRow, wired: { language: string; density: string; displayName: string }): boolean | string | null {
  if (row.kind === 'toggle') return row.def;
  if (row.kind === 'select') {
    if (row.key === 'account.language') return wired.language;
    if (row.key === 'account.density') return wired.density;
    return row.def;
  }
  if (row.kind === 'text') return row.key === 'account.displayName' ? wired.displayName : row.def;
  return null;
}

/** Sidebar group heading for a role's own (non-personal) sections. */
function roleGroupTitle(role: string): string {
  if (role === 'doctor' || role === 'clinical_officer' || role === 'clinician') return 'Clinical';
  if (role === 'nurse' || role === 'midwife' || role === 'triage_nurse' || role === 'rooming_nurse') return 'Nursing';
  if (role === 'pharmacist') return 'Pharmacy';
  if (role === 'lab_tech' || role === 'radiologist') return 'Laboratory';
  return 'Workstation';
}

const PERSONAL_IDS = new Set(['account', 'notifications', 'security']);
/** Admin-spec sections replaced by real design-10 panels. */
const ADMIN_REPLACED_IDS = new Set(['facility', 'users', 'integrations']);
const ORG_SETTINGS_PANEL_IDS = new Set([
  'org-profile',
  'org-subscription',
  'org-security',
  'org-modules',
  'org-branding',
  'org-facilities',
  'org-people',
  'org-billing',
]);

type NavItem = { id: string; label: string; icon: LucideIcon; badge?: string };
type NavGroup = { title: string; items: NavItem[] };

export default function RoleSettingsView() {
  const { currentUser, isOnline, syncPaused, lastSync } = useApp();
  const { showToast } = useToast();
  const { canManageUsers, canAccess } = usePermissions();
  const { users, update: updateUser } = useUsers();
  const { hospitals } = useHospitals();
  const { locale, setLocale } = useTranslation();

  const spec = useMemo(() => (currentUser ? specForRole(currentUser.role) : null), [currentUser]);
  const roleConfig = currentUser ? getRoleConfig(currentUser.role) : null;

  const wired = useMemo(() => ({
    language: SUPPORTED_LOCALES.find(l => l.code === locale)?.nativeName
      || SUPPORTED_LOCALES.find(l => l.code === locale)?.name || 'English',
    density: getUserPrefs().density === 'compact' ? 'Compact' : 'Comfortable',
    displayName: currentUser?.name || '',
  }), [locale, currentUser?.name]);

  // Baseline = stored values over defaults; draft = what's on screen.
  const buildBaseline = useMemo(() => {
    if (!spec || !currentUser) return {} as RoleSettingsValues;
    const stored = getStoredRoleSettings(currentUser._id);
    const map: RoleSettingsValues = {};
    for (const section of spec.sections) {
      for (const row of section.rows) {
        if (row.kind !== 'toggle' && row.kind !== 'select' && row.kind !== 'text') continue;
        const def = rowDefault(row, wired);
        const isWiredRow = row.key === 'account.language' || row.key === 'account.density' || row.key === 'account.displayName';
        map[row.key] = (!isWiredRow && stored[row.key] !== undefined ? stored[row.key] : def) as boolean | string;
      }
    }
    return map;
  }, [spec, currentUser, wired]);

  const [draft, setDraft] = useState<RoleSettingsValues>({});
  const [baseline, setBaseline] = useState<RoleSettingsValues>({});
  useEffect(() => { setDraft(buildBaseline); setBaseline(buildBaseline); }, [buildBaseline]);

  const dirty = useMemo(
    () => Object.keys(draft).some(key => draft[key] !== baseline[key]),
    [draft, baseline],
  );

  const buildDefaultSettings = (): RoleSettingsValues => {
    if (!spec || !currentUser) return {};
    const defaults: RoleSettingsValues = {};
    for (const section of spec.sections) {
      for (const row of section.rows) {
        if (row.kind !== 'toggle' && row.kind !== 'select' && row.kind !== 'text') continue;
        defaults[row.key] = rowDefault(row, wired) as boolean | string;
      }
    }
    return defaults;
  };

  // The panel history. The last entry is what's on screen; everything before
  // it is where Back goes. A stack rather than a single id because embedded
  // consoles link to each other (IT Operations → Workflow settings → …) and
  // without one there'd be no way out except the rail, which loses your place.
  const [panelStack, setPanelStack] = useState<string[]>(['account']);
  const activePanel = panelStack[panelStack.length - 1];
  // Rail clicks REPLACE the stack (you picked a destination, not a detour);
  // in-panel links PUSH onto it, so Back returns to where you came from.
  const setActivePanel = useCallback((id: string) => setPanelStack([id]), []);

  // `?panel=` picks the panel to open on arrival — /system-admin redirects
  // here with it, and it makes any panel deep-linkable. Applied in an effect
  // rather than as the initial state because a client-side `router.replace`
  // can render this component before `window.location` carries the new query,
  // which silently dropped the param and landed everyone on My account.
  // `useSearchParams` would read it correctly but would put this route behind
  // a Suspense boundary. The ref makes it strictly a first-paint concern, so
  // a later rail click is never yanked back to the deep-linked panel.
  const panelParamRef = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined' || panelParamRef.current) return;
    const panel = new URLSearchParams(window.location.search).get('panel');
    panelParamRef.current = true;
    if (panel) setPanelStack([panel]);
  }, []);
  const pushPanel = useCallback((id: string) => {
    setPanelStack(stack => (stack[stack.length - 1] === id ? stack : [...stack, id]));
  }, []);
  const goBack = useCallback(() => setPanelStack(stack => (stack.length > 1 ? stack.slice(0, -1) : stack)), []);
  const settingsHost = useMemo(() => ({ openPanel: pushPanel }), [pushPanel]);
  const [saving, setSaving] = useState(false);

  // ── Password + PIN popups (real account actions) ──
  const [pwOpen, setPwOpen] = useState(false);
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [pwSaving, setPwSaving] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinForm, setPinForm] = useState({ next: '', confirm: '' });
  const [pinIsSet, setPinIsSet] = useState(false);
  const [pinSaving, setPinSaving] = useState(false);

  // ── Update-account popup (gear on the My account header) ──
  const [acctOpen, setAcctOpen] = useState(false);
  const [acctName, setAcctName] = useState('');
  const [acctSaving, setAcctSaving] = useState(false);
  useEffect(() => { setPinIsSet(hasLockPin()); }, [pinOpen]);

  // ── Integration status (real: DHIS2 push log + offline sync state) ──
  const [dhis2Log, setDhis2Log] = useState<Dhis2SyncLogDoc | null>(null);
  useEffect(() => {
    let cancelled = false;
    getDhis2SyncLog().then(log => { if (!cancelled) setDhis2Log(log); });
    return () => { cancelled = true; };
  }, []);

  const showFacility = canAccess('/facility-settings');
  const isAdminSpec = useMemo(
    () => Boolean(spec?.sections.some(section => section.id === 'clinical' && section.title === 'Clinical policy')),
    [spec],
  );

  // ── System administration (design-10 console, embedded lean) ──
  // Reachable both from the main nav (the standalone /system-admin console)
  // and here — same shared components (SystemAdminSections.tsx), so there's
  // one source of truth for the apps/extensions/privileges/metadata/
  // properties logic. Gated on the role's real route table, same as the
  // console itself, not a separate permission check.
  const showSystemAdmin = Boolean(currentUser && isPathAllowed(currentUser.role, '/system-admin'));
  const sysAdminData = useSystemAdminConfig(showSystemAdmin);

  const navGroups = useMemo<NavGroup[]>(() => {
    if (!spec || !currentUser) return [];
    const bySection = (id: string): NavItem | null => {
      const section = spec.sections.find(s => s.id === id);
      return section ? { id: section.id, label: section.title, icon: SECTION_ICONS[section.icon] || User } : null;
    };
    const personal: NavItem[] = ['account', 'notifications', 'security']
      .map(bySection).filter((item): item is NavItem => !!item);
    const groups: NavGroup[] = [{ title: 'My settings', items: personal }];

    const roleItems = spec.sections
      .filter(section => !PERSONAL_IDS.has(section.id) && !(isAdminSpec && ADMIN_REPLACED_IDS.has(section.id)))
      .filter(section => !(isAdminSpec && (section.id === 'clinical' || section.id === 'reporting')))
      .map(section => ({ id: section.id, label: section.title, icon: SECTION_ICONS[section.icon] || User }));
    if (roleItems.length > 0) groups.push({ title: roleGroupTitle(currentUser.role), items: roleItems });

    // Org admins manage org-level preferences here instead of a separate
    // nav destination (the old /org-admin/settings page redirects here).
    if (currentUser.role === 'org_admin') {
      groups.push({
        title: 'Organization',
        items: [
          { id: 'org-profile', label: 'Profile', icon: Building2 },
          { id: 'org-subscription', label: 'Subscription & limits', icon: CreditCard },
          { id: 'org-branding', label: 'Branding', icon: Palette },
          { id: 'org-modules', label: 'Modules & features', icon: Zap },
        ],
      });
      groups.push({
        title: 'Operations setup',
        items: [
          { id: 'org-facilities', label: 'Facilities', icon: Building2, badge: hospitals.length ? String(hospitals.length) : undefined },
          ...(showFacility ? [{ id: 'facility-config', label: 'Facility configuration', icon: Stethoscope }] : []),
          { id: 'org-people', label: 'People & access', icon: Users, badge: users.length ? String(users.length) : undefined },
        ],
      });
      groups.push({
        title: 'Finance setup',
        items: [
          { id: 'org-billing', label: 'Billing & pricing', icon: CreditCard },
        ],
      });
      groups.push({
        title: 'Security & policy',
        items: [
          { id: 'org-security', label: 'Security policy', icon: Shield },
          { id: 'restricted', label: 'Restricted actions', icon: AlertTriangle },
        ],
      });
      groups.push({
        title: 'System',
        items: [
          { id: 'integrations-live', label: 'Integrations & sync', icon: RefreshCw },
        ],
      });
    }

    if (isAdminSpec || showFacility || canManageUsers) {
      const facilityItems: NavItem[] = [];
      if (showFacility && currentUser.role !== 'org_admin') facilityItems.push({ id: 'facility-editor', label: 'Facility settings', icon: Building2 });
      const clinical = spec.sections.find(s => s.id === 'clinical');
      if (isAdminSpec && clinical) facilityItems.push({ id: 'clinical', label: clinical.title, icon: Stethoscope });
      const reporting = spec.sections.find(s => s.id === 'reporting');
      if (isAdminSpec && reporting) facilityItems.push({ id: 'reporting', label: reporting.title, icon: FileText });
      if (facilityItems.length > 0) groups.push({ title: 'Facility', items: facilityItems });

      if (canManageUsers && currentUser.role !== 'org_admin') {
        groups.push({
          title: 'People & access',
          items: [
            { id: 'users-roles', label: 'Users & roles', icon: Users, badge: users.length ? String(users.length) : undefined },
            { id: 'manage-link', label: 'User & hospital management', icon: KeyRound },
          ],
        });
      }
      if (isAdminSpec && currentUser.role !== 'org_admin') {
        groups.push({
          title: 'System',
          items: [
            { id: 'integrations-live', label: 'Integrations & sync', icon: RefreshCw },
            { id: 'restricted', label: 'Restricted actions', icon: AlertTriangle },
          ],
        });
      }
    }

    if (showSystemAdmin) {
      groups.push({
        title: 'System administration',
        items: [
          // IT Operations leads the group, the same position it held as the
          // console's first sidebar section. Several roles (org_admin among
          // them) have no /it nav entry, so this is their only way in.
          { id: 'sysadmin-itops', label: 'IT Operations', icon: Server, badge: String(IT_OPERATIONS_JOB_COUNT) },
          ...SYSTEM_ADMIN_SECTIONS_META.map(section => ({
            id: `sysadmin-${section.id}`,
            label: section.label,
            icon: section.icon,
            badge: String(systemAdminSectionCount(section.id, sysAdminData)),
          })),
        ],
      });
    }
    return groups;
  }, [spec, currentUser, isAdminSpec, showFacility, canManageUsers, users.length, hospitals.length, showSystemAdmin, sysAdminData]);

  if (!currentUser || !spec) return null;

  const identityRows = [
    { label: 'Role', value: roleConfig?.label || spec.title },
    { label: 'Facility', value: currentUser.hospitalName || 'All facilities' },
    { label: 'Username', value: currentUser.username },
  ];

  const setValue = (key: string, value: boolean | string) => setDraft(prev => ({ ...prev, [key]: value }));
  const handleDiscard = () => setDraft(baseline);

  const handleSave = async () => {
    setSaving(true);
    try {
      const langName = draft['account.language'];
      const langCode = SUPPORTED_LOCALES.find(l => l.nativeName === langName || l.name === langName)?.code;
      if (langCode && langCode !== locale) setLocale(langCode);

      const density = draft['account.density'] === 'Compact' ? 'compact' : 'comfortable';
      if (density !== getUserPrefs().density) setUserPrefs({ density });

      const nextName = String(draft['account.displayName'] || '').trim();
      if (nextName && nextName !== currentUser.name) {
        await updateUser(currentUser._id, { name: nextName }, currentUser._id, currentUser.username);
      }

      saveStoredRoleSettings(currentUser._id, draft);
      setBaseline(draft);
      showToast('Settings saved', 'success');
    } catch {
      showToast('Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleResetSettings = () => {
    if (!window.confirm('Reset all settings on this device to their defaults?')) return;
    const defaults = buildDefaultSettings();
    saveStoredRoleSettings(currentUser._id, {});
    setDraft(defaults);
    setBaseline(defaults);
    showToast('Settings reset', 'success');
  };

  const handleChangePassword = async () => {
    if (!pwForm.current) { showToast('Enter your current password', 'error'); return; }
    if (pwForm.next.length < 6) { showToast('Password must be at least 6 characters', 'error'); return; }
    if (pwForm.next !== pwForm.confirm) { showToast('Passwords do not match', 'error'); return; }
    setPwSaving(true);
    try {
      const { apiFetch } = await import('@/lib/api-fetch');
      const res = await apiFetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: pwForm.current, newPassword: pwForm.next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { showToast(body.error || 'Failed to change password', 'error'); return; }
      setPwForm({ current: '', next: '', confirm: '' });
      setPwOpen(false);
      showToast('Password changed', 'success');
    } catch {
      showToast('Failed to change password — check your connection', 'error');
    } finally {
      setPwSaving(false);
    }
  };

  const handleSetPin = async () => {
    if (!/^\d{4,6}$/.test(pinForm.next)) { showToast('PIN must be 4–6 digits', 'error'); return; }
    if (pinForm.next !== pinForm.confirm) { showToast('PINs do not match', 'error'); return; }
    setPinSaving(true);
    try {
      await setLockPin(pinForm.next);
      setPinIsSet(true);
      setPinForm({ next: '', confirm: '' });
      setPinOpen(false);
      showToast('Screen-lock PIN set', 'success');
    } finally {
      setPinSaving(false);
    }
  };

  const handleNav = (id: string) => {
    if (id === 'manage-link') { setActivePanel('manage-screen'); return; }
    setActivePanel(id);
  };

  const renderControl = (row: RoleSettingRow): ReactNode => {
    if (row.kind === 'toggle') {
      const on = Boolean(draft[row.key]);
      return (
        <button
          type="button"
          className={`ehr-set-toggle ${on ? 'is-on' : ''}`.trim()}
          role="switch"
          aria-checked={on}
          aria-label={row.label}
          onClick={() => setValue(row.key, !on)}
        >
          <b>{on ? 'On' : 'Off'}</b>
          <span><i /></span>
        </button>
      );
    }
    if (row.kind === 'select') {
      const options = row.key === 'account.language'
        ? SUPPORTED_LOCALES.map(l => l.nativeName || l.name)
        : row.options;
      const value = String(draft[row.key] ?? row.def);
      return (
        <Select
          className="ehr-set-select"
          value={value}
          aria-label={row.label}
          onChange={event => setValue(row.key, event.target.value)}
        >
          {(options.includes(value) ? options : [value, ...options]).map(option => (
            <option key={option} value={option}>{option}</option>
          ))}
        </Select>
      );
    }
    if (row.kind === 'text') {
      return (
        <input
          className="ehr-set-input"
          value={String(draft[row.key] ?? '')}
          aria-label={row.label}
          onChange={event => setValue(row.key, event.target.value)}
        />
      );
    }
    if (row.kind === 'action') {
      return (
        <button
          type="button"
          className="ehr-queue-action-pill"
          onClick={() => (row.action === 'password' ? setPwOpen(true) : setPinOpen(true))}
        >
          {row.action === 'pin' && pinIsSet ? 'Change PIN' : row.buttonLabel}
        </button>
      );
    }
    return (
      <span className="ehr-set-locked">
        <Lock /> {row.value}
      </span>
    );
  };

  const renderSection = (section: RoleSettingSection) => {
    const Icon = SECTION_ICONS[section.icon] || User;
    return (
      <section key={section.id} className="ehr-set-section">
        <div className="ehr-set-section-head">
          <span><Icon /></span>
          <div style={{ minWidth: 0, flex: '1 1 auto' }}>
            <h3>{section.title}</h3>
            <small>{section.note}</small>
          </div>
        </div>
        {section.rows.map(row => (
          <div key={`${section.id}-${row.label}`} className="ehr-set-row">
            <div className="ehr-set-row-label">
              <b>{row.label}</b>
              <span>{row.hint}</span>
            </div>
            {renderControl(row)}
          </div>
        ))}
      </section>
    );
  };

  // ── Users & roles panel (real accounts; full editing lives in /settings/manage) ──
  const renderUsersPanel = () => (
    <section className="ehr-set-section">
      <div className="ehr-set-section-head">
        <span><Users /></span>
        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
          <h3>Users &amp; roles</h3>
          <small>{users.filter(u => u.isActive).length} active · {users.filter(u => !u.isActive).length} inactive</small>
        </div>
        <button type="button" className="ehr-set-btn primary" style={{ minHeight: 30, padding: '0 13px', fontSize: 12 }} onClick={() => setActivePanel('manage-screen')}>
          <Plus /> Invite user
        </button>
      </div>
      <div className="ehr-set-users-scroll">
        <div className="ehr-set-users-head" aria-hidden="true">
          {['User', 'Role', 'Facility', 'Status', 'Action'].map(head => <span key={head}>{head}</span>)}
        </div>
        {users.map(user => {
          const userSpec = specForRole(user.role);
          return (
            <div key={user._id} className="ehr-set-user-row">
              <div className="ehr-set-user-id">
                <span style={avatarTint(user.name)}>{initials(user.name)}</span>
                <div>
                  <b>{user.name}</b>
                  <small>{user.username}</small>
                </div>
              </div>
              <span className="ehr-set-user-role">{getRoleConfig(user.role)?.label || user.role}</span>
              <span className="ehr-set-user-dept">{user.hospitalName || '—'}</span>
              <span>
                <i className={`ehr-set-user-status ${user.isActive ? 'is-active' : 'is-off'}`.trim()}>
                  {user.isActive ? 'Active' : 'Suspended'}
                </i>
              </span>
              <span className="ehr-set-user-actions">
                <button type="button" className="ehr-queue-action" title="Edit in user management" onClick={() => setActivePanel('manage-screen')}>
                  <Pencil className="w-4 h-4" />
                </button>
                <button type="button" className="ehr-queue-action" title="Reset password in user management" onClick={() => setActivePanel('manage-screen')}>
                  <KeyRound className="w-4 h-4" />
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );

  // ── Integrations & sync panel (real status where the app has it) ──
  const renderIntegrationsPanel = () => {
    const lastPush = dhis2Log?.lastPush;
    const dhis2Status = !isDhis2Configured()
      ? { label: 'Not set up', tone: 'neutral', detail: 'Set NEXT_PUBLIC_DHIS2_BASE_URL to enable national reporting.' }
      : lastPush?.status === 'pushed'
        ? { label: 'Connected', tone: 'green', detail: `HMIS + IDSR datasets. Last push ${dhis2Log?.lastSyncedAt ? new Date(dhis2Log.lastSyncedAt).toLocaleString() : '—'}.` }
        : lastPush?.status === 'failed'
          ? { label: 'Error', tone: 'red', detail: lastPush.message || 'Last push failed — retry from Facility Sync.' }
          : { label: 'Pending', tone: 'yellow', detail: 'Configured — no push recorded yet on this device.' };
    const replicationStatus = syncPaused
      ? { label: 'Pending', tone: 'yellow', detail: 'Sync paused on this device.' }
      : isOnline
        ? { label: 'Connected', tone: 'green', detail: `Offline-first queue. Last sync ${lastSync ? new Date(lastSync).toLocaleString() : '—'}.` }
        : { label: 'Error', tone: 'red', detail: 'Offline — changes queue locally until connectivity returns.' };
    const cells = [
      { name: 'DHIS2 national reporting', ...dhis2Status },
      { name: 'Country node replication', ...replicationStatus },
      {
        name: 'm-Gurush mobile money',
        label: draft['int.mgurush'] ? 'Connected' : 'Not set up', tone: draft['int.mgurush'] ? 'green' : 'neutral',
        detail: draft['int.mgurush'] ? 'Payment confirmations posted to billing.' : 'Enable in Integrations policy to post confirmations.',
      },
      {
        name: 'SMS gateway',
        label: draft['int.sms'] ? 'Pending' : 'Not set up', tone: draft['int.sms'] ? 'yellow' : 'neutral',
        detail: draft['int.sms'] ? 'Sender ID awaiting regulator approval.' : 'No sender ID requested.',
      },
    ];
    const integrationsSection = spec.sections.find(s => s.id === 'integrations');
    return (
      <>
        <section className="ehr-set-section">
          <div className="ehr-set-section-head">
            <span><RefreshCw /></span>
            <div style={{ minWidth: 0, flex: '1 1 auto' }}>
              <h3>Integrations &amp; offline sync</h3>
              <small>Live status on this device</small>
            </div>
          </div>
          <div className="ehr-set-integrations">
            {cells.map(cell => (
              <div key={cell.name}>
                <i className="ehr-set-int-pill" data-tone={cell.tone}>{cell.label}</i>
                <b>{cell.name}</b>
                <p>{cell.detail}</p>
              </div>
            ))}
          </div>
        </section>
        {integrationsSection && renderSection(integrationsSection)}
      </>
    );
  };

  // ── Restricted actions (danger zone) ──
  const renderRestrictedPanel = () => (
    <section className="ehr-set-section ehr-set-danger">
      <div className="ehr-set-section-head">
        <span><AlertTriangle /></span>
        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
          <h3>Restricted actions</h3>
          <small>Audited — changes here affect the whole facility</small>
        </div>
      </div>
      {[
        {
          label: 'Merge duplicate patient records',
          hint: 'Review suspected duplicates in the patient registry. Merges are audited and cannot be undone.',
          action: 'Not available here',
          onClick: () => showToast('Patient merge review opens from the patient registry, not from Settings.', 'error'),
        },
        {
          label: 'Export the full patient database',
          hint: 'Requires facility admin plus a Ministry authorisation code.',
          action: 'Request export',
          onClick: () => showToast('Full export requires a Ministry authorisation code.', 'error'),
        },
        {
          label: 'Reset settings on this device',
          hint: 'Restores every preference on this page to its default. Facility data is untouched.',
          action: 'Reset',
          onClick: handleResetSettings,
        },
      ].map(row => (
        <div key={row.label} className="ehr-set-row">
          <div className="ehr-set-row-label">
            <b>{row.label}</b>
            <span>{row.hint}</span>
          </div>
          <button type="button" className="ehr-set-danger-btn" onClick={row.onClick}>{row.action}</button>
        </div>
      ))}
    </section>
  );

  const renderPanel = (): ReactNode => {
    if (activePanel === 'facility-editor' || activePanel === 'facility-config') {
      return (
        <section className="ehr-set-section ehr-set-embed">
          <FacilitySettingsView embedded />
        </section>
      );
    }
    if (ORG_SETTINGS_PANEL_IDS.has(activePanel)) {
      const section = activePanel.replace(/^org-/, '') as OrganizationSettingsSection;
      return (
        <section className="ehr-set-section org-set-wrapper">
          <OrganizationSettingsPanel section={section} users={users} hospitals={hospitals} onNavigate={setActivePanel} />
        </section>
      );
    }
    if (activePanel === 'org-branding-editor') {
      return (
        <section className="ehr-set-section settings-embedded-page">
          <OrgBrandingPage />
        </section>
      );
    }
    if (activePanel === 'org-facilities-editor') {
      return (
        <section className="ehr-set-section settings-embedded-page">
          <OrgHospitalsPage />
        </section>
      );
    }
    if (activePanel === 'org-people-editor') {
      return (
        <section className="ehr-set-section settings-embedded-page">
          <OrgUsersPage />
        </section>
      );
    }
    if (activePanel === 'org-billing-editor') {
      return (
        <section className="ehr-set-section settings-embedded-page">
          <ServicePricingPage />
        </section>
      );
    }
    if (activePanel === 'manage-screen') {
      return (
        <section className="ehr-set-section settings-embedded-page">
          <ManagementSettingsPage />
        </section>
      );
    }
    if (activePanel === 'sysadmin-itops') {
      return (
        <section className="ehr-set-section ehr-set-embed">
          <ItOperationsPanel embedded />
        </section>
      );
    }
    if (activePanel.startsWith('sysadmin-')) {
      const sectionId = activePanel.slice('sysadmin-'.length) as typeof SYSTEM_ADMIN_SECTIONS_META[number]['id'];
      return (
        <section className="ehr-set-section ehr-set-embed">
          <SystemAdminSectionContent sectionId={sectionId} data={sysAdminData} showLocalFilter />
        </section>
      );
    }
    if (activePanel === 'users-roles') return renderUsersPanel();
    if (activePanel === 'integrations-live') return renderIntegrationsPanel();
    if (activePanel === 'restricted') return renderRestrictedPanel();
    const section = spec.sections.find(s => s.id === activePanel) || spec.sections[0];
    return (
      <>
        {section.id === 'account' && (
          <section className="ehr-set-section">
            <div className="ehr-set-account-head">
              <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                <b>{currentUser.name}</b>
                <small>{currentUser.username}</small>
              </div>
              <button
                type="button"
                className="ehr-set-account-gear"
                title="Update account"
                aria-label="Update account"
                onClick={() => { setAcctName(currentUser.name || ''); setAcctOpen(true); }}
              >
                <Settings />
              </button>
            </div>
            <div className="ehr-set-account-rows">
              {identityRows.map(row => (
                <div key={row.label}>
                  <span>{row.label}</span>
                  <b title={row.value}>{row.value}</b>
                </div>
              ))}
            </div>
          </section>
        )}
        {section.id === 'account' && (
          <div className="ehr-set-scope-grid">
            <div className="ehr-set-scope">
              <b>{spec.subtitle}</b>
              <p>{spec.scope}</p>
            </div>
            <div className="ehr-set-chips">
              <span>You control</span>
              <div>
                {spec.chips.map(chip => <span key={chip}>{chip}</span>)}
              </div>
            </div>
          </div>
        )}
        {renderSection(section)}
      </>
    );
  };

  const userInitials = initials(currentUser.name || spec.title);
  // Label of the panel Back returns to, resolved from the rail so it reads
  // the same as the item the user originally clicked.
  const backLabel = panelStack.length > 1
    ? navGroups.flatMap(g => g.items).find(item => item.id === panelStack[panelStack.length - 2])?.label
      ?? spec.sections.find(s => s.id === panelStack[panelStack.length - 2])?.title
      ?? null
    : null;
  const isNavActive = (id: string) => {
    if (activePanel === id) return true;
    const editorParent: Record<string, string> = {
      'org-branding-editor': 'org-branding',
      'org-facilities-editor': 'org-facilities',
      'org-people-editor': 'org-people',
      'org-billing-editor': 'org-billing',
      'manage-screen': 'manage-link',
    };
    return editorParent[activePanel] === id;
  };

  return (
    <div className="ehr-schedule-shell ehr-set-shell">
      {/* ── Page header: breadcrumb + role chip · saved state + actions ── */}
      <section className="ehr-set-header">
        <div className="ehr-set-header-left">
          {/* Back appears only once there's somewhere to go back TO — a
              permanently-present control that sometimes does nothing is worse
              than one that arrives when it means something. */}
          {panelStack.length > 1 && (
            <button
              type="button"
              className="ehr-set-back"
              onClick={goBack}
              aria-label={backLabel ? `Back to ${backLabel}` : 'Back'}
              title={backLabel ? `Back to ${backLabel}` : 'Back'}
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <h1>Settings</h1>
          <ChevronRight className="w-3.5 h-3.5" />
          <span
            className="ehr-set-role-chip"
            style={{ background: 'rgba(33,145,208,0.10)', color: 'var(--tb-blue-800, #012C4E)' }}
          >
            <i style={{ background: spec.accent }}>{userInitials}</i>
            {spec.title}
          </span>
          {/* The trail only shows the panel you'd return to, not the whole
              stack: it's an escape hatch, not a site map. */}
          {backLabel && (
            <>
              <ChevronRight className="w-3.5 h-3.5" />
              <button type="button" className="ehr-set-crumb" onClick={goBack}>{backLabel}</button>
            </>
          )}
        </div>
        <div className="ehr-set-header-actions">
          <span className={`ehr-set-saved ${dirty ? 'is-dirty' : ''}`.trim()}>
            <i /> {dirty ? 'Unsaved changes' : 'All changes saved'}
          </span>
          {dirty && (
            <>
              <button type="button" className="ehr-set-btn" disabled={saving} onClick={handleDiscard}>
                Discard
              </button>
              <button type="button" className="ehr-set-btn primary" disabled={saving} onClick={() => void handleSave()}>
                <Check /> {saving ? 'Saving…' : 'Save changes'}
              </button>
            </>
          )}
        </div>
      </section>

      <section className="ehr-set-grid">
        {/* ── Left rail: grouped nav only — identity lives in My account ── */}
        <aside className="ehr-set-rail">
          <nav className="ehr-set-nav" aria-label="Settings sections">
            {navGroups.map(group => (
              <div key={group.title} className="ehr-set-nav-group">
                <span className="ehr-set-nav-group-title">{group.title}</span>
                {group.items.map(item => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={isNavActive(item.id) ? 'active' : undefined}
                      onClick={() => handleNav(item.id)}
                    >
                      <Icon />
                      <em>{item.label}</em>
                      {item.badge ? <b className="is-badge">{item.badge}</b> : item.id === 'manage-link' ? <b><ChevronRight className="w-3 h-3" /></b> : null}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>

        {/* ── Right: exactly the panel the sidebar selected. Wrapped in the
               host so anything embedded here (IT Operations, the sysadmin
               sections, the org editors) opens hosted destinations as another
               Settings panel instead of navigating out of the page. ── */}
        <main className="ehr-set-main">
          <SettingsHostProvider value={settingsHost}>
            {renderPanel()}
          </SettingsHostProvider>
        </main>
      </section>

      {/* ── Update-account popup: edit the display name, then jump to the
             password / screen-lock actions without leaving Settings. ── */}
      {acctOpen && (
        <Modal onClose={() => setAcctOpen(false)} width={420}>
          <div className="ehr-handoff-modal" role="dialog" aria-modal="true" aria-label="Update account">
            <div className="ehr-handoff-head">
              <div className="ehr-handoff-head-title">
                <User />
                <div>
                  <h2>Update account</h2>
                  <p>{currentUser.username}</p>
                </div>
              </div>
              <div className="ehr-handoff-head-actions">
                <button type="button" className="ehr-handoff-close" aria-label="Close" onClick={() => setAcctOpen(false)}>✕</button>
              </div>
            </div>
            <div className="ehr-handoff-body">
              <div>
                <label className="ehr-handoff-label">Display name</label>
                <input
                  type="text"
                  className="ehr-handoff-input"
                  autoComplete="name"
                  value={acctName}
                  onChange={e => setAcctName(e.target.value)}
                />
              </div>
              {identityRows.filter(row => row.label !== 'Username').map(row => (
                <div key={row.label} className="ehr-set-acct-readonly">
                  <span>{row.label}</span>
                  <b title={row.value}>{row.value}</b>
                </div>
              ))}
              <p className="ehr-set-acct-note">
                Role and facility are assigned by an administrator and can&rsquo;t be changed here.
              </p>
              <button
                type="button"
                className="ehr-handoff-btn primary"
                disabled={acctSaving || !acctName.trim() || acctName.trim() === currentUser.name}
                onClick={async () => {
                  const next = acctName.trim();
                  setAcctSaving(true);
                  try {
                    await updateUser(currentUser._id, { name: next }, currentUser._id, currentUser.username);
                    // Keep the settings draft in step so the name row doesn't
                    // show the old value or read as an unsaved change.
                    setDraft(prev => ({ ...prev, 'account.displayName': next }));
                    setBaseline(prev => ({ ...prev, 'account.displayName': next }));
                    showToast('Account updated', 'success');
                    setAcctOpen(false);
                  } catch {
                    showToast('Failed to update account', 'error');
                  } finally {
                    setAcctSaving(false);
                  }
                }}
              >
                {acctSaving ? 'Saving…' : 'Save changes'}
              </button>
              <div className="ehr-set-acct-actions">
                <button type="button" className="ehr-handoff-btn" onClick={() => { setAcctOpen(false); setPwOpen(true); }}>
                  <KeyRound /> Change password
                </button>
                <button type="button" className="ehr-handoff-btn" onClick={() => { setAcctOpen(false); setPinOpen(true); }}>
                  <Lock /> {pinIsSet ? 'Change screen-lock PIN' : 'Set screen-lock PIN'}
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Change password popup ── */}
      {pwOpen && (
        <Modal onClose={() => setPwOpen(false)} width={420}>
          <div className="ehr-handoff-modal" role="dialog" aria-modal="true" aria-label="Change password">
            <div className="ehr-handoff-head">
              <div className="ehr-handoff-head-title">
                <KeyRound />
                <div>
                  <h2>Change password</h2>
                  <p>{currentUser.name}</p>
                </div>
              </div>
              <div className="ehr-handoff-head-actions">
                <button type="button" className="ehr-handoff-close" aria-label="Close" onClick={() => setPwOpen(false)}>✕</button>
              </div>
            </div>
            <div className="ehr-handoff-body">
              <div>
                <label className="ehr-handoff-label">Current password</label>
                <input type="password" className="ehr-handoff-input" autoComplete="current-password"
                  value={pwForm.current} onChange={e => setPwForm(p => ({ ...p, current: e.target.value }))} />
              </div>
              <div>
                <label className="ehr-handoff-label">New password</label>
                <input type="password" className="ehr-handoff-input" autoComplete="new-password"
                  value={pwForm.next} onChange={e => setPwForm(p => ({ ...p, next: e.target.value }))} />
              </div>
              <div>
                <label className="ehr-handoff-label">Confirm new password</label>
                <input type="password" className="ehr-handoff-input" autoComplete="new-password"
                  value={pwForm.confirm} onChange={e => setPwForm(p => ({ ...p, confirm: e.target.value }))} />
              </div>
              <button type="button" className="ehr-handoff-btn primary" disabled={pwSaving || !pwForm.current || !pwForm.next}
                onClick={() => void handleChangePassword()}>
                {pwSaving ? 'Updating…' : 'Change password'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Screen-lock PIN popup ── */}
      {pinOpen && (
        <Modal onClose={() => setPinOpen(false)} width={420}>
          <div className="ehr-handoff-modal" role="dialog" aria-modal="true" aria-label="Screen-lock PIN">
            <div className="ehr-handoff-head">
              <div className="ehr-handoff-head-title">
                <Lock />
                <div>
                  <h2>Screen-lock PIN</h2>
                  <p>{pinIsSet ? 'PIN is active on this device' : 'Quick unlock on this shared device'}</p>
                </div>
              </div>
              <div className="ehr-handoff-head-actions">
                {pinIsSet && (
                  <button
                    type="button"
                    className="ehr-handoff-btn sm"
                    onClick={() => { clearLockPin(); setPinIsSet(false); setPinForm({ next: '', confirm: '' }); showToast('Screen-lock PIN removed', 'success'); }}
                  >
                    <Trash2 /> Remove
                  </button>
                )}
                <button type="button" className="ehr-handoff-close" aria-label="Close" onClick={() => setPinOpen(false)}>✕</button>
              </div>
            </div>
            <div className="ehr-handoff-body">
              <div>
                <label className="ehr-handoff-label">{pinIsSet ? 'New PIN' : 'PIN'} (4–6 digits)</label>
                <input type="password" inputMode="numeric" maxLength={6} className="ehr-handoff-input" autoComplete="off"
                  value={pinForm.next} onChange={e => setPinForm(p => ({ ...p, next: e.target.value.replace(/\D/g, '') }))} />
              </div>
              <div>
                <label className="ehr-handoff-label">Confirm PIN</label>
                <input type="password" inputMode="numeric" maxLength={6} className="ehr-handoff-input" autoComplete="off"
                  value={pinForm.confirm} onChange={e => setPinForm(p => ({ ...p, confirm: e.target.value.replace(/\D/g, '') }))} />
              </div>
              <button type="button" className="ehr-handoff-btn primary" disabled={pinSaving || !pinForm.next}
                onClick={() => void handleSetPin()}>
                {pinSaving ? 'Saving…' : pinIsSet ? 'Update PIN' : 'Set PIN'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── System administration: inline editor (global properties / no-page
          "configurable" notes) — shared with the standalone /system-admin console ── */}
      {showSystemAdmin && <SystemAdminEditorModal data={sysAdminData} />}
      {showSystemAdmin && <SystemAdminStyles />}
    </div>
  );
}
