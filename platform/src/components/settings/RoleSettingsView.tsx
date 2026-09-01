'use client';

/**
 * Settings (designs 10 + 11) — nav-driven, per-role.
 *
 * The grouped sidebar (design 10) decides what the body shows: exactly one
 * panel at a time. Every user gets their own role's personal panels (design
 * 11 sections — account, role defaults, notifications, security); users with
 * management rights additionally get the design-10 facility panels backed by
 * real functionality: the real facility settings editor, integration/sync
 * status, restricted actions, and one People & access entry that opens the
 * live user & hospital management screen (the roster used to be mirrored
 * here read-only, with every action bouncing to that same screen).
 * There is no role switcher — each user sees only their own settings.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import Modal from '@/components/Modal';
import { useAuth, useSync } from '@/lib/context';
import { useToast } from '@/components/Toast';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { useUsers } from '@/lib/hooks/useUsers';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { SUPPORTED_LOCALES } from '@/lib/i18n';
import { getUserPrefs, setUserPrefs } from '@/lib/user-prefs';
import {
  hasLockPin, setLockPin, clearLockPin,
  idleChoiceMinutes, lockIsMandatory, policyLockMinutes, USER_LOCK_KEY, USER_IDLE_KEY,
} from '@/lib/hooks/useAutoLock';
import { getRoleConfig } from '@/lib/permissions';
import { isPathAllowed } from '@/lib/role-routes';
import {
  specForRole, getStoredRoleSettings,
  type RoleSettingsValues, type RoleSettingRow, type RoleSettingSection,
} from '@/lib/role-settings';
import { replaceRoleSettings, resetRoleSettings } from '@/lib/settings/role-settings-store';
import { FacilitySettingsView, FACILITY_MODULES } from '@/components/settings/FacilitySettingsView';
import { NETWORK_MODULES } from '@/components/settings/NetworkDefaultsView';
import FacilityPolicySections from '@/components/settings/FacilityPolicySections';
import { useFacilitySync, FacilitySyncButton, FacilitySyncDetail } from '@/components/settings/FacilitySyncPanel';
import { useSettings } from '@/lib/settings/SettingsProvider';
import OrganizationSettingsPanel, { type OrganizationSettingsSection } from '@/components/settings/OrganizationSettingsPanel';
import OrgBrandingPage from '@/app/(dashboard)/org-admin/branding/page';
import ServicePricingPage from '@/app/(dashboard)/org-admin/pricing/page';
import ItOperationsPanel, { IT_OPERATIONS_JOB_COUNT } from '@/components/admin/ItOperationsPanel';
import TrashPanel from './TrashPanel';
import DataManagementPanel from './DataManagementPanel';

/**
 * Platform operations and governance, embedded rather than linked.
 *
 * These seven consoles were seven primary-nav rows in the super-admin rail —
 * the two largest groups in it — and every one of them is configuration or a
 * read-only health view, which is what Settings is for. Moving them here
 * shortens the operator's nav to the things they *do* (command, tenants,
 * people) and puts the things they *set* behind one door.
 *
 * Loaded on demand: they are super-admin-only and heavy (charts, whole-store
 * scans), and a static import would put all seven in the settings bundle that
 * every role downloads to change their own password.
 */
const embedded = (load: () => Promise<{ default: React.ComponentType }>) =>
  dynamic(load, { ssr: false, loading: () => <p className="ehr-set-embed-loading">Loading…</p> });

const AdminSystemPage = embedded(() => import('@/app/(dashboard)/admin/system/page'));
const AdminSyncPage = embedded(() => import('@/app/(dashboard)/admin/sync/page'));
const AdminInteropPage = embedded(() => import('@/app/(dashboard)/admin/interop/page'));
const AdminDataPage = embedded(() => import('@/app/(dashboard)/admin/data/page'));
const AdminSecurityPage = embedded(() => import('@/app/(dashboard)/admin/security/page'));
const AdminConfigPage = embedded(() => import('@/app/(dashboard)/admin/config/page'));
const AdminFlagsPage = embedded(() => import('@/app/(dashboard)/admin/flags/page'));

/** Settings panel id → the console it embeds, for the two groups above. */
const EMBEDDED_ADMIN_PAGES: Record<string, React.ComponentType> = {
  'plat-system': AdminSystemPage,
  'plat-sync': AdminSyncPage,
  'plat-interop': AdminInteropPage,
  'plat-data': AdminDataPage,
  'gov-security': AdminSecurityPage,
  'gov-config': AdminConfigPage,
  'gov-flags': AdminFlagsPage,
};
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import { SettingsHostProvider } from '@/components/settings/SettingsHost';
import {
  SYSTEM_ADMIN_SECTIONS_META,
  systemAdminSectionCount,
  useSystemAdminConfig,
  SystemAdminSectionContent,
  SystemAdminEditorModal,
  SystemAdminStyles,
} from '@/components/settings/SystemAdminSections';
import { isDhis2Configured } from '@/lib/services/dhis2-sync-log-service';
import {
  AlertTriangle, ArrowLeft, Bell, BedDouble, Building2, Check, ChevronRight, Clock,
  CreditCard, Database, FileText, Flag, FlaskConical, Globe, KeyRound, List, Lock, Palette, Pill,
  RefreshCw, Server, Settings, Shield, Stethoscope, Trash2, User, Users, Zap, type LucideIcon,
} from '@/components/icons/lucide';
import Select from '@/components/Select';
const SECTION_ICONS: Record<string, LucideIcon> = {
  user: User, bell: Bell, shield: Shield, steth: Stethoscope, pill: Pill,
  flask: FlaskConical, card: CreditCard, bed: BedDouble, clock: Clock,
  list: List, doc: FileText, users: Users, sync: RefreshCw, building: Building2,
};

/** Default value for a row, resolving the app-wired specials. */
function rowDefault(row: RoleSettingRow, wired: { language: string; density: string; theme: string; displayName: string }): boolean | string | null {
  if (row.kind === 'toggle') return row.pending ? null : row.def;
  if (row.kind === 'select') {
    if (row.pending) return null;
    if (row.key === 'account.language') return wired.language;
    if (row.key === 'account.density') return wired.density;
    if (row.key === 'account.theme') return wired.theme;
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
  'org-billing',
]);

type NavItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
  nested?: boolean;
  href?: string;
  /**
   * A row that expands DOWN into the rail rather than opening a second column.
   *
   * Facility settings used to render its own nav beside this one, so the
   * reader chose a section twice — once here, once there — and the two rails
   * competed for the same job. Its modules are these children now.
   */
  children?: NavItem[];
  /** Indented child row. */
  sub?: boolean;
  /** Group heading inside an expanded row — not clickable. */
  heading?: string;
};
type NavGroup = { title: string; items: NavItem[] };

export default function RoleSettingsView() {
  const router = useRouter();
  const { currentUser, refreshCurrentUser, platformPolicy } = useAuth();
  const { isOnline, syncPaused, lastSync, toggleOnline } = useSync();
  const { showToast } = useToast();
  const { canManageUsers, canAccess } = usePermissions();
  const { users, update: updateUser } = useUsers();
  const { hospitals } = useHospitals();
  const { t, locale, setLocale } = useTranslation();
  const facilitySettings = useSettings();

  /**
   * When the operator has made the screen lock mandatory, the switch is not a
   * control — it is a statement of what this deployment requires. Read
   * through the same helpers the lock timer reads, so the row can never claim
   * an enforcement the timer will not apply (or hide one it does).
   */
  const lockMandatory = lockIsMandatory(platformPolicy);
  const enforcedLockMinutes = lockMandatory
    ? policyLockMinutes(
      facilitySettings.lockTimeoutMinutes,
      currentUser?.organization?.lockTimeoutMinutes,
      platformPolicy.sessionTimeoutMinutes,
    )
    : undefined;

  const settingLabel = (row: RoleSettingRow): string => (
    'key' in row && row.key === USER_LOCK_KEY ? t('roleSettings.lockScreenIdle') : row.label
  );
  const settingHint = (row: RoleSettingRow): string => {
    if (!('key' in row)) return row.hint;
    if (row.key === USER_LOCK_KEY) return t('roleSettings.lockScreenIdleHint');
    if (row.key === USER_IDLE_KEY && draft[USER_LOCK_KEY] === false && enforcedLockMinutes === undefined) {
      return t('roleSettings.lockWindowInactive');
    }
    return row.hint;
  };

  const spec = useMemo(() => (currentUser ? specForRole(currentUser.role) : null), [currentUser]);
  const roleConfig = currentUser ? getRoleConfig(currentUser.role) : null;

  const wired = useMemo(() => ({
    language: SUPPORTED_LOCALES.find(l => l.code === locale)?.nativeName
      || SUPPORTED_LOCALES.find(l => l.code === locale)?.name || 'English',
    density: getUserPrefs().density === 'compact' ? 'Compact' : 'Comfortable',
    theme: getUserPrefs().theme === 'dark' ? 'Dark' : getUserPrefs().theme === 'system' ? 'System' : 'Light',
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
        const isWiredRow = row.key === 'account.language' || row.key === 'account.density'
          || row.key === 'account.theme' || row.key === 'account.displayName';
        map[row.key] = (!isWiredRow && stored[row.key] !== undefined ? stored[row.key] : def) as boolean | string;
      }
    }
    // Preserve the retired dropdown's explicit Off choice when introducing
    // the dedicated switch; otherwise the switch's default true reverses the
    // user's stored preference merely by opening Settings after an update.
    if (stored[USER_LOCK_KEY] === undefined && String(stored[USER_IDLE_KEY]).toLowerCase() === 'off') {
      map[USER_LOCK_KEY] = false;
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
  // Second-factor setup. The panel is the same component the enrolment gate
  // renders — one implementation, so voluntary enrolment and required
  // enrolment cannot describe the same thing differently.
  const [pinForm, setPinForm] = useState({ next: '', confirm: '' });
  const [pinIsSet, setPinIsSet] = useState(false);
  const [pinSaving, setPinSaving] = useState(false);

  // ── Update-account popup (gear on the My account header) ──
  const [acctOpen, setAcctOpen] = useState(false);
  /* The account rows are edited in the popup now, against the same draft the
     rest of Settings writes to. Snapshotting them on open is what lets a
     cancelled dialog put them back instead of leaving the page dirty. */
  const [acctSnapshot, setAcctSnapshot] = useState<RoleSettingsValues>({});
  useEffect(() => { setPinIsSet(hasLockPin()); }, [pinOpen]);

  // ── Integration status (real: DHIS2 push log + offline sync state) ──
  // One owner for the sync log. This screen used to load it here AND inside
  // FacilitySyncPanel, so running a push updated one copy and left the status
  // grid reading the other — the same facts, twice, disagreeing.
  const sync = useFacilitySync();
  const dhis2Log = sync.log;

  /**
   * Which facility module the expanded rail row is pointing at. Held here
   * rather than inside FacilitySettingsView because the rail is what chooses
   * it now — the view renders whatever this says. Must sit above the
   * `!currentUser || !spec` guard below: a hook after an early return does not
   * run in the same order on every render.
   */
  const [facilityModule, setFacilityModule] = useState('facility:identity');

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
  // Trash holds deactivated TENANTS, so it belongs to whoever can deactivate
  // one: the operator who runs /admin/organizations, and nobody else.
  const showTrash = Boolean(currentUser && isPathAllowed(currentUser.role, '/admin/organizations'));
  const { trashedOrganizations } = useOrganizations();
  const trashedCount = showTrash ? trashedOrganizations.length : 0;
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
        title: 'Facility configuration',
        items: [
          ...(showFacility ? [{ id: 'facility-config', label: 'Clinical setup', icon: Stethoscope }] : []),
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
          { id: 'data-management', label: 'Data management', icon: Database },
        ],
      });
    }

    if (isAdminSpec || showFacility || canManageUsers) {
      const facilityItems: NavItem[] = [];
      if (showFacility && currentUser.role !== 'org_admin') {
        facilityItems.push({
          id: 'facility-editor',
          label: 'Facility settings',
          icon: Building2,
          // Expands DOWN into this rail. These are exactly the modules the
          // facility view used to list in a second column of its own.
          children: [
            { id: 'mod:facility', label: 'This facility', icon: Building2, heading: 'This facility' },
            ...FACILITY_MODULES.map(m => ({
              id: `mod:facility:${m.key}`, label: m.label, icon: m.icon, sub: true,
            })),
            { id: 'mod:network', label: 'All facilities', icon: Building2, heading: 'All facilities' },
            ...NETWORK_MODULES.map(m => ({
              id: `mod:network:${m.key}`, label: m.label, icon: m.icon, sub: true,
            })),
          ],
        });
      }
      const clinical = spec.sections.find(s => s.id === 'clinical');
      if (isAdminSpec && clinical) facilityItems.push({ id: 'clinical', label: clinical.title, icon: Stethoscope });
      const reporting = spec.sections.find(s => s.id === 'reporting');
      if (isAdminSpec && reporting) facilityItems.push({ id: 'reporting', label: reporting.title, icon: FileText });
      if (facilityItems.length > 0) groups.push({ title: 'Facility', items: facilityItems });

      // No People & access entry here: it was a rail item that only ever
      // bounced out of Settings to the roster page those roles already reach
      // from their own navigation, so it padded the rail without being a
      // setting. The roster stays where it is administered.
      if (isAdminSpec && currentUser.role !== 'org_admin') {
        groups.push({
          title: 'System',
          items: [
            { id: 'integrations-live', label: 'Integrations & sync', icon: RefreshCw },
            // Sits beside sync on purpose: the two answer the same question
            // from opposite ends — sync says what is moving, data management
            // says what has not moved yet and what would be lost with it.
            { id: 'data-management', label: 'Data management', icon: Database },
            { id: 'restricted', label: 'Restricted actions', icon: AlertTriangle },
          ],
        });
      }
    }

    // Platform operations and governance — moved out of the super-admin
    // primary nav (see lib/permissions.ts). Gated per item on the role's own
    // route table rather than on the role name, so a role that gains one of
    // these routes gains the panel with it.
    const allowed = (path: string) => isPathAllowed(currentUser.role, path);
    const platformItems: NavItem[] = [
      { id: 'plat-system', label: 'System Health', icon: Server, path: '/admin/system' },
      { id: 'plat-sync', label: 'Sync & Jobs', icon: RefreshCw, path: '/admin/sync' },
      { id: 'plat-interop', label: 'Interoperability', icon: Globe, path: '/admin/interop' },
      { id: 'plat-data', label: 'Data Governance', icon: Database, path: '/admin/data' },
    ].filter(i => allowed(i.path)).map(({ path: _path, ...item }) => item);
    if (platformItems.length > 0) {
      groups.push({ title: 'Platform operations', items: platformItems });
    }

    const governanceItems: NavItem[] = [
      { id: 'gov-security', label: 'Security & Compliance', icon: Shield, path: '/admin/security' },
      { id: 'gov-config', label: 'Configuration', icon: Settings, path: '/admin/config' },
      { id: 'gov-flags', label: 'Feature Flags', icon: Flag, path: '/admin/flags' },
    ].filter(i => allowed(i.path)).map(({ path: _path, ...item }) => item);
    if (governanceItems.length > 0) {
      groups.push({ title: 'Governance', items: governanceItems });
    }

    if (showTrash) {
      groups.push({
        title: 'Trash',
        items: [
          { id: 'trash', label: 'Deleted organizations', icon: Trash2, badge: String(trashedCount) },
        ],
      });
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
  }, [spec, currentUser, isAdminSpec, showFacility, canManageUsers, users.length, hospitals.length, showSystemAdmin, sysAdminData, showTrash, trashedCount]);

  if (!currentUser || !spec) return null;

  const identityRows = [
    { label: 'Role', value: roleConfig?.label || spec.title },
    // The organization the account belongs to. Shown above Facility because it
    // is the wider scope, and because org-wide roles have no facility at all —
    // for them this row is the only answer to "who do I work for".
    { label: 'Organization', value: currentUser.orgName || 'No organization' },
    { label: 'Facility', value: currentUser.hospitalName || 'All facilities' },
    { label: 'Username', value: currentUser.username },
  ];

  const setValue = (key: string, value: boolean | string) => setDraft(prev => ({ ...prev, [key]: value }));
  const handleDiscard = () => setDraft(baseline);

  /* The rows the Update-account popup owns. They stay declared in the role
     spec — the draft, the save, and the reset all key off it — they are just
     no longer drawn as a fifth card under the identity summary. */
  const accountRows = (spec.sections.find(s => s.id === 'account')?.rows ?? [])
    .filter((row): row is Extract<RoleSettingRow, { key: string }> => 'key' in row);
  const displayNameKey = 'account.displayName';
  const displayName = String(draft[displayNameKey] ?? '');

  const openAccountEditor = () => {
    const snap: RoleSettingsValues = {};
    for (const row of accountRows) if (draft[row.key] !== undefined) snap[row.key] = draft[row.key];
    setAcctSnapshot(snap);
    setAcctOpen(true);
  };
  /* Cancel restores what the popup found; the two hand-offs below it
     (password, PIN) deliberately keep the edits, since they continue the
     same errand rather than abandoning it. */
  const closeAccountEditor = () => {
    setDraft(prev => ({ ...prev, ...acctSnapshot }));
    setAcctOpen(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const langName = draft['account.language'];
      const langCode = SUPPORTED_LOCALES.find(l => l.nativeName === langName || l.name === langName)?.code;
      if (langCode && langCode !== locale) setLocale(langCode);

      const density = draft['account.density'] === 'Compact' ? 'compact' : 'comfortable';
      if (density !== getUserPrefs().density) setUserPrefs({ density });

      const theme = draft['account.theme'] === 'Dark' ? 'dark' as const
        : draft['account.theme'] === 'System' ? 'system' as const
        : 'light' as const;
      if (theme !== getUserPrefs().theme) setUserPrefs({ theme });

      const nextName = String(draft['account.displayName'] || '').trim();
      if (nextName && nextName !== currentUser.name) {
        await updateUser(currentUser._id, { name: nextName }, currentUser._id, currentUser.username);
        // The account record is only half the change: `currentUser` is what
        // the header, the avatar, and every clinical signature actually read.
        // Without this the app keeps stamping the old name until re-login.
        await refreshCurrentUser();
      }

      // Through the store, not straight to localStorage: this is what pushes
      // the new values to every live consumer (queue order, prescribing
      // prompts, MAR, notification filters) without a reload.
      replaceRoleSettings(currentUser._id, draft);
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
    resetRoleSettings(currentUser._id, currentUser.role);
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
    } catch (err) {
      // Thrown on a non-secure context (no crypto.subtle) — this device
      // cannot hash a PIN safely, and setLockPin refuses rather than falling
      // back to a weaker scheme. Surface that instead of an uncaught
      // rejection with the dialog stuck open and no explanation.
      showToast(err instanceof Error ? err.message : 'Could not set a screen-lock PIN on this device', 'error');
    } finally {
      setPinSaving(false);
    }
  };

  const handleNav = (item: NavItem) => {
    // A rail row with an href is a shortcut to a page that owns itself
    // elsewhere in the nav; everything else is a panel of this screen.
    if (item.href) { router.push(item.href); return; }
    // A module row selects inside the facility panel without leaving it.
    if (item.id.startsWith('mod:')) {
      setFacilityModule(item.id.slice('mod:'.length));
      setActivePanel('facility-editor');
      return;
    }
    setActivePanel(item.id);
  };

  const renderControl = (row: RoleSettingRow): ReactNode => {
    // A `pending` row is declared but not wired — nothing reads its value.
    // Rendering a live control for it invites the reader to believe the
    // setting is in force, which for `mar.barcode` ("Confirms patient and
    // drug") or `security.twoFactor` ("One-time code at sign-in") is a claim
    // the platform cannot keep. Show it as unavailable, in the same language
    // as a facility-managed row. Selects need this as much as toggles: a
    // "Default acuity" dropdown reading "Clerk may raise it, never lower it"
    // describes an enforcement that does not exist.
    if ((row.kind === 'toggle' || row.kind === 'select') && row.pending) {
      return (
        <span className="ehr-set-locked" title="Not available in this version">
          <Lock /> Not available yet
        </span>
      );
    }
    // The screen-lock switch and the window it uses are one setting in two
    // rows: neither may claim a state the lock timer will not honour.
    //
    //   • An admin policy outranks both — the switch becomes a statement of
    //     what is required, not a control, because useAutoLock keeps locking
    //     the session whatever this user stores.
    //   • With the switch off, the window is inert. It stays visible (it is
    //     what turning the lock back on will use) but not editable, rather
    //     than reading "15 min" over a session that never locks.
    if (row.kind === 'toggle' && row.key === USER_LOCK_KEY && enforcedLockMinutes !== undefined) {
      return (
        <span className="ehr-set-locked" title={t('roleSettings.lockRequiredTitle', { minutes: enforcedLockMinutes })}>
          <Lock /> {t('roleSettings.lockRequired', { minutes: enforcedLockMinutes })}
        </span>
      );
    }
    const userLockOff = draft[USER_LOCK_KEY] === false && enforcedLockMinutes === undefined;

    if (row.kind === 'toggle') {
      const on = Boolean(draft[row.key]);
      const flip = () => {
        setValue(row.key, !on);
        // Turning the lock on with no usable window stored (an account
        // carrying the retired "Off" choice) would switch on a lock that
        // never fires. Restore this role's own default window with it.
        if (!on && row.key === USER_LOCK_KEY && idleChoiceMinutes(String(draft[USER_IDLE_KEY] ?? '')) === undefined) {
          const idleRow = spec?.sections.find(section => section.id === 'security')
            ?.rows.find((r): r is Extract<RoleSettingRow, { kind: 'select' }> => r.kind === 'select' && r.key === USER_IDLE_KEY);
          if (idleRow) setValue(USER_IDLE_KEY, idleRow.def);
        }
      };
      return (
        <button
          type="button"
          className={`ehr-set-toggle ${on ? 'is-on' : ''}`.trim()}
          role="switch"
          aria-checked={on}
          aria-label={settingLabel(row)}
          onClick={flip}
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
      const inert = row.key === USER_IDLE_KEY && userLockOff;
      return (
        <Select
          className="ehr-set-select"
          value={value}
          aria-label={settingLabel(row)}
          disabled={inert}
          title={inert ? t('roleSettings.lockWindowInactive') : undefined}
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
          onClick={() => {
            if (row.action === 'password') setPwOpen(true);
            else setPinOpen(true);
          }}
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
              <b>{settingLabel(row)}</b>
              <span>{settingHint(row)}</span>
            </div>
            {renderControl(row)}
          </div>
        ))}
      </section>
    );
  };

  // ── Integrations & sync panel (real status where the app has it) ──
  const renderIntegrationsPanel = () => {
    // Read from facility policy, not this browser: whether the facility runs
    // mobile money or SMS is the same answer for every user at it.
    const mobileMoneyOn = facilitySettings.itOperations.integrations.includes('payments');
    const smsOn = facilitySettings.itOperations.integrations.includes('sms');
    const lastPush = dhis2Log?.lastPush;
    const dhis2Status = !isDhis2Configured()
      ? { label: 'Not set up', tone: 'neutral', detail: 'Set NEXT_PUBLIC_DHIS2_BASE_URL to enable national reporting. Sync now still prepares the export locally.' }
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
        label: mobileMoneyOn ? 'Connected' : 'Not set up', tone: mobileMoneyOn ? 'green' : 'neutral',
        detail: mobileMoneyOn ? 'Payment confirmations posted to billing.' : 'Enable it in the Integrations policy below.',
      },
      {
        name: 'SMS gateway',
        label: smsOn ? 'Pending' : 'Not set up', tone: smsOn ? 'yellow' : 'neutral',
        detail: smsOn ? 'Sender ID awaiting regulator approval.' : 'No sender ID requested.',
      },
    ];
    return (
      <>
        <section className="ehr-set-section">
          <div className="ehr-set-section-head">
            <span><RefreshCw /></span>
            <div style={{ minWidth: 0, flex: '1 1 auto' }}>
              <h3>Integrations &amp; offline sync</h3>
              <small>Live status on this device &middot; {sync.lastSyncedLabel}</small>
            </div>
            {/* The push is an action on this section, not a card of its own.
                As a card it repeated the heading, the DHIS2 status and the
                last-push message that are all already on this screen. */}
            <FacilitySyncButton sync={sync} />
          </div>
          {/* The sync switch, where someone goes looking for it. Sync is ON
              at every boot and cannot be paused persistently — this pauses
              THIS session only, for the moments that genuinely call for it
              (metered hotspot, clinic bandwidth saturated during an upload).
              The row states the consequence rather than describing the
              mechanism. */}
          <div className="ehr-set-row">
            <div className="ehr-set-row-label">
              <b>Keep this device syncing</b>
              <span>
                {syncPaused
                  ? 'Paused for this session — records save locally and reach the server after sync resumes. Sync turns back on at the next sign-in regardless.'
                  : 'Records replicate to the server whenever the device is online. Pausing lasts for this session only.'}
              </span>
            </div>
            <button
              type="button"
              className={`ehr-set-toggle ${syncPaused ? '' : 'is-on'}`.trim()}
              role="switch"
              aria-checked={!syncPaused}
              aria-label="Keep this device syncing"
              onClick={toggleOnline}
            >
              <b>{syncPaused ? 'Off' : 'On'}</b>
              <span><i /></span>
            </button>
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
        {/* Renders nothing until a push has actually run. */}
        <FacilitySyncDetail sync={sync} />
        <FacilityPolicySections panel="integrations" />
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
          <FacilitySettingsView
            embedded
            hideNav
            activeModule={facilityModule}
            onModuleChange={setFacilityModule}
          />
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
    if (activePanel === 'org-billing-editor') {
      return (
        <section className="ehr-set-section settings-embedded-page">
          <ServicePricingPage />
        </section>
      );
    }
    if (activePanel === 'data-management') {
      return <DataManagementPanel />;
    }
    const EmbeddedAdminPage = EMBEDDED_ADMIN_PAGES[activePanel];
    if (EmbeddedAdminPage) {
      return (
        <section className="ehr-set-section settings-embedded-page">
          <EmbeddedAdminPage />
        </section>
      );
    }
    if (activePanel === 'trash') {
      return <TrashPanel />;
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
    // Clinical policy and Reporting are facility-wide rules, not personal
    // preferences — they are edited against the replicated facility settings
    // doc, not this browser's localStorage.
    if (isAdminSpec && (activePanel === 'clinical' || activePanel === 'reporting')) {
      return <FacilityPolicySections panel={activePanel} />;
    }
    if (activePanel === 'integrations-live') return renderIntegrationsPanel();
    if (activePanel === 'restricted') return renderRestrictedPanel();
    const section = spec.sections.find(s => s.id === activePanel) || spec.sections[0];
    return (
      <>
        {section.id === 'account' ? (
          /* One card, not three. The identity head, the assignment rows and
             the scope note all answer "who am I here", and the four editable
             rows that used to sit under them have moved into the
             Update-account popup — so what is left reads as one summary
             instead of three stacked boxes saying the same thing. */
          <section className="ehr-set-section ehr-set-account">
            <div className="ehr-set-account-head">
              <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                <b>{currentUser.name}</b>
                <small>{currentUser.username}</small>
              </div>
              <button type="button" className="ehr-set-account-edit" onClick={openAccountEditor}>
                <Settings /> Update account
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
        ) : renderSection(section)}
      </>
    );
  };

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
      'org-billing-editor': 'org-billing',
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
          {/* Scope, on the title line: "Settings" alone never said whose. Only
              at the top level — once you are inside a panel the crumb is the
              more useful thing for the same few centimetres. */}
          {!backLabel && <span className="ehr-set-scope-note" title={spec.subtitle}>{spec.subtitle}</span>}
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
                  // A row with children expands DOWN into the rail. It opens
                  // its panel on click like any other row; the chevron only
                  // reports whether its modules are showing.
                  const expanded = !!item.children && isNavActive(item.id);
                  return (
                    <Fragment key={item.id}>
                      <button
                        type="button"
                        className={isNavActive(item.id) ? 'active' : undefined}
                        onClick={() => handleNav(item)}
                        aria-expanded={item.children ? expanded : undefined}
                        /* A rail label can outrun its column; the tooltip keeps
                           the full wording reachable when it ellipsises. */
                        title={item.label}
                      >
                        <Icon />
                        <em>{item.label}</em>
                        {item.badge && <b className="is-badge">{item.badge}</b>}
                        {item.children && (
                          <b className={`is-caret${expanded ? ' is-open' : ''}`} aria-hidden="true"><ChevronRight /></b>
                        )}
                        {item.nested && <b className="is-nested" aria-hidden="true"><ChevronRight /></b>}
                      </button>
                      {expanded && item.children!.map(child => (
                        child.heading
                          ? (
                            <span key={child.id} className="ehr-set-nav-subhead">{child.heading}</span>
                          ) : (
                            <button
                              key={child.id}
                              type="button"
                              className={`ehr-set-nav-sub${facilityModule === child.id.slice(4) ? ' active' : ''}`}
                              onClick={() => handleNav(child)}
                              title={child.label}
                            >
                              <child.icon />
                              <em>{child.label}</em>
                            </button>
                          )
                      ))}
                    </Fragment>
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

      {/* ── Update-account popup ───────────────────────────────────────
             Everything personal now lives here: the display name, the three
             preference rows that used to sit in a card below the identity
             summary, the assignment facts an administrator owns, and the two
             credential hand-offs. Editing writes to the same draft the rest
             of Settings uses, so Save is the page's one save path. ── */}
      {acctOpen && (
        <Modal onClose={closeAccountEditor} width={640} labelledBy="acct-modal-title">
          <div className="ehr-handoff-modal ehr-set-acct">
            <div className="ehr-handoff-head">
              <div className="ehr-handoff-head-title">
                <User />
                <div>
                  <h2 id="acct-modal-title">Update account</h2>
                  <p>{currentUser.username}</p>
                </div>
              </div>
              <div className="ehr-handoff-head-actions">
                <button type="button" className="ehr-handoff-close" aria-label="Close" onClick={closeAccountEditor}>✕</button>
              </div>
            </div>

            <div className="ehr-handoff-body ehr-set-acct-body">
              <section className="ehr-set-acct-group">
                <h3>Identity</h3>
                <div className="ehr-set-acct-field">
                  <label htmlFor="acct-display-name">Display name</label>
                  <input
                    id="acct-display-name"
                    type="text"
                    className="ehr-handoff-input"
                    autoComplete="name"
                    value={displayName}
                    onChange={e => setValue(displayNameKey, e.target.value)}
                  />
                  <small>Shown on notes, receipts, and referrals</small>
                </div>
                <div className="ehr-set-acct-facts">
                  {identityRows.filter(row => row.label !== 'Username').map(row => (
                    <div key={row.label}>
                      <span>{row.label}</span>
                      <b title={row.value}>{row.value}</b>
                    </div>
                  ))}
                </div>
                <p className="ehr-set-acct-note">
                  Role and facility are assigned by an administrator and can&rsquo;t be changed here.
                </p>
              </section>

              <section className="ehr-set-acct-group">
                <h3>Preferences</h3>
                {accountRows.filter(row => row.key !== displayNameKey).map(row => (
                  <div key={row.key} className="ehr-set-row ehr-set-acct-row">
                    <div className="ehr-set-row-label">
                      <b>{row.label}</b>
                      <span>{row.hint}</span>
                    </div>
                    {renderControl(row)}
                  </div>
                ))}
              </section>

              <section className="ehr-set-acct-group">
                <h3>Sign-in &amp; device</h3>
                <div className="ehr-set-acct-actions">
                  <button type="button" className="ehr-handoff-btn" onClick={() => { setAcctOpen(false); setPwOpen(true); }}>
                    <KeyRound /> Change password
                  </button>
                  <button type="button" className="ehr-handoff-btn" onClick={() => { setAcctOpen(false); setPinOpen(true); }}>
                    <Lock /> {pinIsSet ? 'Change screen-lock PIN' : 'Set screen-lock PIN'}
                  </button>
                </div>
              </section>
            </div>

            <div className="ehr-set-acct-foot">
              <button type="button" className="ehr-handoff-btn" onClick={closeAccountEditor}>Cancel</button>
              <button
                type="button"
                className="ehr-handoff-btn primary"
                disabled={saving || !displayName.trim()}
                onClick={async () => { await handleSave(); setAcctOpen(false); }}
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Change password popup ── */}
      {pwOpen && (
        <Modal onClose={() => setPwOpen(false)} width={420} labelledBy="pw-modal-title">
          <div className="ehr-handoff-modal">
            <div className="ehr-handoff-head">
              <div className="ehr-handoff-head-title">
                <KeyRound />
                <div>
                  <h2 id="pw-modal-title">Change password</h2>
                  <p>{currentUser.name}</p>
                </div>
              </div>
              <div className="ehr-handoff-head-actions">
                <button type="button" className="ehr-handoff-close" aria-label="Close" onClick={() => setPwOpen(false)}>✕</button>
              </div>
            </div>
            <div className="ehr-handoff-body">
              {/* The account these passwords belong to, stated for the browser.
                  Without it Chrome hunts the page for a username field to pair
                  with the password ones, walks up out of the dialog, and fills
                  the workspace search box in the top rail with the signed-in
                  username — the account name appearing in the search bar the
                  moment Settings opened. Rendered, not `display:none`: a
                  hidden input is skipped by the same heuristic it exists to
                  satisfy. */}
              <input
                type="text"
                name="username"
                autoComplete="username"
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                readOnly
                value={currentUser.username}
              />
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
        <Modal onClose={() => setPinOpen(false)} width={420} labelledBy="pin-modal-title">
          <div className="ehr-handoff-modal">
            <div className="ehr-handoff-head">
              <div className="ehr-handoff-head-title">
                <Lock />
                <div>
                  <h2 id="pin-modal-title">Screen-lock PIN</h2>
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
