'use client';

/**
 * System Administration — shared section content, extracted so the same
 * apps/extensions/privileges/metadata/properties UI and mutation logic can
 * be rendered from two hosts with zero duplicated logic:
 *   - the standalone console at src/app/(dashboard)/system-admin/page.tsx
 *     (its own sidebar, IT Operations tab, shortcuts, cross-section search)
 *   - the personal Settings page (src/components/settings/RoleSettingsView.tsx),
 *     which embeds these same six sections as a "System administration" rail
 *     group — lean variant, no shortcuts, an optional small per-section filter.
 *
 * `useSystemAdminConfig()` is the single source of truth for the org's
 * system-config overrides (src/lib/services/system-config-service.ts) and
 * every mutation (toggle app/extension, edit a global property/configurable
 * note). Both hosts call it themselves so each owns its own load — cheap,
 * since it's a single local PouchDB `get` by known id — and renders
 * `<SystemAdminSectionContent>` / `<SystemAdminEditorModal>` against the
 * result. `<SystemAdminStyles>` carries every `.sysadm-*` class either host
 * needs (including the standalone shell/sidebar rules, which are simply
 * unused — and harmless — inside the Settings embed).
 */
import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '@/lib/context';
import { systemConfigScope } from '@/lib/services/system-config-service';
import { useToast } from '@/components/Toast';
import PortalModal from '@/components/Modal';
import { isPathAllowed } from '@/lib/role-routes';
import {
  SYSTEM_APP_DEFINITIONS,
  SYSTEM_EXTENSION_DEFINITIONS,
  SYSTEM_GLOBAL_PROPERTY_DEFINITIONS,
  SYSTEM_METADATA_DEFINITIONS,
  SYSTEM_PRIVILEGE_DEFINITIONS,
  domainLabel,
  type AdminDomain,
  type SystemAppDefinition,
  type SystemExtensionDefinition,
} from '@/lib/admin/system-admin-registry';
import type { SystemConfigDoc } from '@/lib/services/system-config-service';
import {
  Building2, ChevronRight, ClipboardCheck, ClipboardList, Database, KeyRound, Layers,
  Pencil, Search, Settings, X, type LucideIcon,
} from '@/components/icons/lucide';

export type SystemAdminSectionId =
  | 'apps' | 'extensions' | 'privileges' | 'patientActions' | 'metadata' | 'properties';

/** The six sections both hosts render — id, label, icon only (no counts;
 *  counts depend on the current user's role/org, computed via
 *  `systemAdminSectionCount` against a loaded `SystemAdminConfigData`). */
export const SYSTEM_ADMIN_SECTIONS_META: { id: SystemAdminSectionId; label: string; icon: LucideIcon }[] = [
  { id: 'apps', label: 'Manage Apps', icon: Building2 },
  { id: 'extensions', label: 'Manage Extensions', icon: Layers },
  { id: 'privileges', label: 'Roles & Privileges', icon: KeyRound },
  { id: 'patientActions', label: 'Patient Record Actions', icon: ClipboardList },
  { id: 'metadata', label: 'Metadata Management', icon: Database },
  { id: 'properties', label: 'Global Properties', icon: ClipboardCheck },
];

/** Pages that are genuinely where a "configurable" app/extension gets
 *  configured — safe to deep-link a "Configure" action straight to. Anything
 *  else routes to where the item merely *appears*, so a real inline editor
 *  is offered instead of a misleading "Configure" link. */
const REAL_SETTINGS_ROUTES = new Set(['/facility-settings', '/it', '/admin/users', '/org-admin/users', '/reports']);

/** Curated subset of the privilege matrix that specifically governs patient
 *  record actions (create/edit/merge/void), surfaced as its own section —
 *  the full matrix stays intact under "Roles & Privileges". */
const PATIENT_RECORD_PRIVILEGE_IDS = new Set([
  'Create Visit',
  'Create Retrospective Visit',
  'Edit Patient Demographics',
  'Merge Patients',
  'Mark Patient Dead',
  'Delete Patient',
]);

export interface EditTarget {
  id: string;
  label: string;
  description: string;
  value: string;
}

export interface SystemAdminConfigData {
  loading: boolean;
  visibleApps: SystemAppDefinition[];
  extensions: SystemExtensionDefinition[];
  privileges: typeof SYSTEM_PRIVILEGE_DEFINITIONS;
  patientRecordPrivileges: typeof SYSTEM_PRIVILEGE_DEFINITIONS;
  metadata: typeof SYSTEM_METADATA_DEFINITIONS;
  properties: typeof SYSTEM_GLOBAL_PROPERTY_DEFINITIONS;
  appOverrides: Record<string, boolean>;
  extensionOverrides: Record<string, boolean>;
  propertyOverrides: Record<string, string>;
  canOpen: (route?: string) => route is string;
  busyId: string | null;
  toggleApp: (app: SystemAppDefinition, next: boolean) => void;
  toggleExtension: (ext: SystemExtensionDefinition, next: boolean) => void;
  openEditor: (target: EditTarget) => void;
  editing: EditTarget | null;
  draftValue: string;
  setDraftValue: (value: string) => void;
  closeEditor: () => void;
  saveEditor: () => void;
  saving: boolean;
}

function matches(query: string, ...fields: string[]): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return fields.some(f => (f || '').toLowerCase().includes(q));
}

/**
 * Single source of truth for the org's system-config overrides + every
 * mutation. `enabled=false` skips the load entirely (e.g. a Settings host
 * that hasn't confirmed the current role even has system-admin access yet).
 */
export function useSystemAdminConfig(enabled: boolean = true): SystemAdminConfigData {
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  // A super_admin carries no orgId — that is what makes it cross-tenant — so
  // keying this console off orgId alone left the one role whose job IS platform
  // configuration unable to load or save anything: the effect below returned
  // early, and every toggle answered "No organization on this account."
  const orgId = systemConfigScope(currentUser?.orgId, currentUser?.role);

  const [config, setConfig] = useState<SystemConfigDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    if (!orgId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { getSystemConfig } = await import('@/lib/services/system-config-service');
        const doc = await getSystemConfig(orgId);
        if (!cancelled) setConfig(doc);
      } catch (err) {
        console.error('Failed to load system configuration:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [orgId, enabled]);

  const appOverrides = config?.appOverrides || {};
  const extensionOverrides = config?.extensionOverrides || {};
  const propertyOverrides = config?.propertyOverrides || {};

  // Every Open/Configure link is gated against this role's real allowed-route
  // table — a row whose module the current role can't enter just loses its
  // navigation action instead of linking somewhere that would bounce/403.
  const canOpen = (route?: string): route is string =>
    !!route && !!currentUser && isPathAllowed(currentUser.role, route);

  const visibleApps = useMemo(() => {
    if (!currentUser) return SYSTEM_APP_DEFINITIONS;
    return SYSTEM_APP_DEFINITIONS.filter(app => app.ownerRoles.includes(currentUser.role));
  }, [currentUser]);

  const patientRecordPrivileges = useMemo(
    () => SYSTEM_PRIVILEGE_DEFINITIONS.filter(p => PATIENT_RECORD_PRIVILEGE_IDS.has(p.id)),
    [],
  );

  const toggleApp = async (app: SystemAppDefinition, next: boolean) => {
    if (!orgId || !currentUser) { showToast('This account has no configuration scope.', 'error'); return; }
    setBusyId(app.id);
    setConfig(prev => prev ? { ...prev, appOverrides: { ...prev.appOverrides, [app.id]: next } } : prev);
    try {
      const { setAppEnabled } = await import('@/lib/services/system-config-service');
      await setAppEnabled(orgId, app.id, next, currentUser._id, currentUser.username);
      showToast(`${app.label} ${next ? 'enabled' : 'disabled'}.`, 'success');
    } catch (err) {
      console.error(err);
      setConfig(prev => prev ? { ...prev, appOverrides: { ...prev.appOverrides, [app.id]: !next } } : prev);
      showToast(`Failed to update ${app.label}.`, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const toggleExtension = async (ext: SystemExtensionDefinition, next: boolean) => {
    if (!orgId || !currentUser) { showToast('This account has no configuration scope.', 'error'); return; }
    setBusyId(ext.id);
    setConfig(prev => prev ? { ...prev, extensionOverrides: { ...prev.extensionOverrides, [ext.id]: next } } : prev);
    try {
      const { setExtensionEnabled } = await import('@/lib/services/system-config-service');
      await setExtensionEnabled(orgId, ext.id, next, currentUser._id, currentUser.username);
      showToast(`${ext.label} ${next ? 'enabled' : 'disabled'}.`, 'success');
    } catch (err) {
      console.error(err);
      setConfig(prev => prev ? { ...prev, extensionOverrides: { ...prev.extensionOverrides, [ext.id]: !next } } : prev);
      showToast(`Failed to update ${ext.label}.`, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const openEditor = (target: EditTarget) => {
    setEditing(target);
    setDraftValue(target.value);
  };

  const closeEditor = () => { if (!saving) setEditing(null); };

  const saveEditor = async () => {
    if (!editing) return;
    if (!orgId || !currentUser) { showToast('This account has no configuration scope.', 'error'); return; }
    setSaving(true);
    try {
      const { setPropertyValue } = await import('@/lib/services/system-config-service');
      await setPropertyValue(orgId, editing.id, draftValue, currentUser._id, currentUser.username);
      setConfig(prev => prev ? { ...prev, propertyOverrides: { ...prev.propertyOverrides, [editing.id]: draftValue } } : prev);
      showToast(`${editing.label} saved.`, 'success');
      setEditing(null);
    } catch (err) {
      console.error(err);
      showToast(`Failed to save ${editing.label}.`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return {
    loading, visibleApps, extensions: SYSTEM_EXTENSION_DEFINITIONS, privileges: SYSTEM_PRIVILEGE_DEFINITIONS,
    patientRecordPrivileges, metadata: SYSTEM_METADATA_DEFINITIONS, properties: SYSTEM_GLOBAL_PROPERTY_DEFINITIONS,
    appOverrides, extensionOverrides, propertyOverrides, canOpen, busyId,
    toggleApp, toggleExtension, openEditor, editing, draftValue, setDraftValue, closeEditor, saveEditor, saving,
  };
}

/** Item count for a section, given a loaded config bag — powers the sidebar
 *  / settings-rail badges in both hosts. */
export function systemAdminSectionCount(id: SystemAdminSectionId, data: SystemAdminConfigData): number {
  switch (id) {
    case 'apps': return data.visibleApps.length;
    case 'extensions': return data.extensions.length;
    case 'privileges': return data.privileges.length;
    case 'patientActions': return data.patientRecordPrivileges.length;
    case 'metadata': return data.metadata.length;
    case 'properties': return data.properties.length;
    default: return 0;
  }
}

/** How many of a section's items match a search query — used by the
 *  standalone console's cross-section search to label/hide each result
 *  group (distinct from `systemAdminSectionCount`, which is the unfiltered
 *  total shown in the sidebar). */
export function systemAdminSectionMatchCount(id: SystemAdminSectionId, data: SystemAdminConfigData, query: string): number {
  switch (id) {
    case 'apps': return data.visibleApps.filter(a => matches(query, a.label, a.description)).length;
    case 'extensions': return data.extensions.filter(e => matches(query, e.label, e.description)).length;
    case 'privileges': return data.privileges.filter(p => matches(query, p.label, p.description)).length;
    case 'patientActions': return data.patientRecordPrivileges.filter(p => matches(query, p.label, p.description)).length;
    case 'metadata': return data.metadata.filter(m => matches(query, m.label, m.description)).length;
    case 'properties': return data.properties.filter(p => matches(query, p.label, p.description)).length;
    default: return 0;
  }
}

const DOMAIN_COLORS: Record<AdminDomain, { bg: string; fg: string; border: string }> = {
  clinical: { bg: 'var(--semantic-success-bg)', fg: 'var(--semantic-success)', border: 'var(--semantic-success-border)' },
  registration: { bg: 'var(--semantic-active-bg)', fg: 'var(--semantic-active)', border: 'var(--semantic-active-border)' },
  operations: { bg: 'var(--semantic-neutral-bg)', fg: 'var(--semantic-neutral)', border: 'var(--semantic-neutral-border)' },
  billing: { bg: 'var(--semantic-warning-bg)', fg: 'var(--semantic-warning)', border: 'var(--semantic-warning-border)' },
  reporting: { bg: 'var(--semantic-request-bg)', fg: 'var(--semantic-request)', border: 'var(--semantic-request-border)' },
  it: { bg: 'var(--semantic-it-bg)', fg: 'var(--semantic-it)', border: 'var(--semantic-it-border)' },
  security: { bg: 'var(--semantic-danger-bg)', fg: 'var(--semantic-danger)', border: 'var(--semantic-danger-border)' },
  metadata: { bg: 'var(--semantic-neutral-bg)', fg: 'var(--semantic-neutral)', border: 'var(--semantic-neutral-border)' },
};

function ItemRow({ title, description, meta, domain, actions, valueLine }: {
  title: string;
  description: string;
  meta?: string;
  domain: AdminDomain;
  actions: ReactNode;
  valueLine?: string;
}) {
  const domainColor = DOMAIN_COLORS[domain];
  return (
    <div className="sysadm-row">
      <div className="sysadm-row-main">
        <strong>{title}</strong>
        <p>{description}</p>
        {valueLine && <span className="sysadm-row-value">{valueLine}</span>}
        {meta && <small>{meta}</small>}
      </div>
      <div className="sysadm-row-actions">
        <span className="sysadm-pill" style={{ background: domainColor.bg, color: domainColor.fg, borderColor: domainColor.border }}>
          {domainLabel(domain)}
        </span>
        {actions}
      </div>
    </div>
  );
}

export function EmptyRow({ text }: { text: string }) {
  return <div className="sysadm-empty">{text}</div>;
}

export function SearchGroup({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <div className="sysadm-search-group">
      <div className="sysadm-search-group-head">
        <span>{title}</span>
        <b>{count}</b>
      </div>
      {children}
    </div>
  );
}

function Toggle({ checked, disabled, onChange, label }: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      data-on={checked ? 'true' : 'false'}
      onClick={() => onChange(!checked)}
      className="sysadm-toggle"
    >
      <span className="sysadm-toggle-thumb" />
    </button>
  );
}

function AppExtActions({ id, label, status, route, enabled, kind, data, embedded = false }: {
  id: string; label: string; status: SystemAppDefinition['status']; route?: string;
  enabled: boolean; kind: 'app' | 'extension'; data: SystemAdminConfigData; embedded?: boolean;
}) {
  const isConfigurable = status === 'configurable';
  const hasRealSettingsRoute = !!route && REAL_SETTINGS_ROUTES.has(route) && data.canOpen(route);
  const openAllowed = data.canOpen(route);
  const busy = data.busyId === id;

  return (
    <div className="sysadm-row-actions">
      <span
        className="sysadm-pill"
        style={isConfigurable
          ? { background: 'var(--semantic-warning-bg)', color: 'var(--semantic-warning)' }
          : { background: enabled ? 'var(--semantic-success-bg)' : 'var(--semantic-inactive-bg)', color: enabled ? 'var(--semantic-success)' : 'var(--semantic-inactive)' }}
      >
        {isConfigurable ? 'Configurable' : enabled ? 'Enabled' : 'Disabled'}
      </span>

      {isConfigurable ? (
        hasRealSettingsRoute ? (
          embedded ? (
            <button type="button" className="sysadm-action-btn" onClick={() => data.openEditor({
              id,
              label,
              description: 'Configuration stays inside Settings. Add a local setup note here, or open the standalone System Administration console for cross-module navigation.',
              value: data.propertyOverrides[id] ?? '',
            })}>
              <Settings className="w-3 h-3" /> Configure
            </button>
          ) : (
            <Link href={route!} className="sysadm-action-btn">
              <Settings className="w-3 h-3" /> Configure
            </Link>
          )
        ) : (
          <>
            <button
              type="button"
              className="sysadm-action-btn"
              onClick={() => data.openEditor({
                id,
                label,
                description: 'Free-text configuration note — there is no dedicated settings page for this item yet.',
                value: data.propertyOverrides[id] ?? '',
              })}
            >
              <Pencil className="w-3 h-3" /> Configure
            </button>
            {openAllowed && !embedded && (
              <Link href={route!} className="sysadm-open-link">
                Open <ChevronRight className="w-3 h-3" />
              </Link>
            )}
          </>
        )
      ) : (
        <>
          <Toggle
            checked={enabled}
            disabled={busy}
            label={`Toggle ${label}`}
            onChange={(next) => kind === 'app'
              ? data.toggleApp(SYSTEM_APP_DEFINITIONS.find(a => a.id === id)!, next)
              : data.toggleExtension(SYSTEM_EXTENSION_DEFINITIONS.find(e => e.id === id)!, next)}
          />
          {openAllowed && !embedded && (
            <Link href={route!} className="sysadm-open-link">
              Open <ChevronRight className="w-3 h-3" />
            </Link>
          )}
        </>
      )}
    </div>
  );
}

function renderApps(list: SystemAppDefinition[], data: SystemAdminConfigData, embedded = false) {
  return (
    <div className="sysadm-list">
      {list.length === 0 && <EmptyRow text="No apps match your search." />}
      {list.map(app => (
        <ItemRow
          key={app.id}
          title={app.label}
          description={app.description}
          meta={`${app.id} · ${app.level}`}
          domain={app.domain}
          actions={
            <AppExtActions
              id={app.id}
              label={app.label}
              status={app.status}
              route={app.route}
              enabled={data.appOverrides[app.id] ?? app.status === 'enabled'}
              kind="app"
              data={data}
              embedded={embedded}
            />
          }
        />
      ))}
    </div>
  );
}

function renderExtensions(list: SystemExtensionDefinition[], data: SystemAdminConfigData, embedded = false) {
  return (
    <div className="sysadm-list">
      {list.length === 0 && <EmptyRow text="No extensions match your search." />}
      {list.map(ext => (
        <ItemRow
          key={ext.id}
          title={ext.label}
          description={ext.description}
          meta={`${ext.extensionPoint} · ${ext.level}`}
          domain={ext.domain}
          actions={
            <AppExtActions
              id={ext.id}
              label={ext.label}
              status={ext.status}
              route={ext.route}
              enabled={data.extensionOverrides[ext.id] ?? ext.status === 'enabled'}
              kind="extension"
              data={data}
              embedded={embedded}
            />
          }
        />
      ))}
    </div>
  );
}

function renderPrivileges(list: typeof SYSTEM_PRIVILEGE_DEFINITIONS) {
  return (
    <div className="sysadm-table">
      <div className="sysadm-table-head">
        <span>Privilege</span>
        <span>Roles</span>
        <span>Risk</span>
      </div>
      {list.length === 0 && <EmptyRow text="No privileges match your search." />}
      {list.map(privilege => (
        <div key={privilege.id} className="sysadm-table-row">
          <span className="sysadm-table-cell-main">
            <strong>{privilege.label}</strong>
            <small>{privilege.description}</small>
          </span>
          <span className="sysadm-table-roles">{privilege.roles.map(role => role.replace(/_/g, ' ')).join(', ')}</span>
          <b className={`risk-${privilege.risk}`}>{privilege.risk.toUpperCase()}</b>
        </div>
      ))}
    </div>
  );
}

function renderMetadata(list: typeof SYSTEM_METADATA_DEFINITIONS, data: SystemAdminConfigData, embedded = false) {
  return (
    <div className="sysadm-list">
      {list.length === 0 && <EmptyRow text="No metadata definitions match your search." />}
      {list.map(m => (
        <ItemRow
          key={m.id}
          title={m.label}
          description={m.description}
          meta={m.countLabel}
          domain={m.domain}
          actions={
            <div className="sysadm-row-actions">
              {data.canOpen(m.route) && !embedded && (
                <Link href={m.route!} className="sysadm-action-btn">
                  Open <ChevronRight className="w-3 h-3" />
                </Link>
              )}
            </div>
          }
        />
      ))}
    </div>
  );
}

function renderProperties(list: typeof SYSTEM_GLOBAL_PROPERTY_DEFINITIONS, data: SystemAdminConfigData, embedded = false) {
  return (
    <div className="sysadm-list">
      {list.length === 0 && <EmptyRow text="No global properties match your search." />}
      {list.map(p => {
        const effectiveValue = data.propertyOverrides[p.id] ?? p.currentValue;
        const isOverridden = data.propertyOverrides[p.id] !== undefined && data.propertyOverrides[p.id] !== p.currentValue;
        return (
          <ItemRow
            key={p.id}
            title={p.label}
            description={p.description}
            meta={`${p.id}${isOverridden ? ' · customized' : ''}`}
            domain={p.domain}
            valueLine={effectiveValue}
            actions={
              <div className="sysadm-row-actions">
                {p.route && p.route !== '/system-admin' && data.canOpen(p.route) && !embedded && (
                  <Link href={p.route} className="sysadm-open-link" title="Related settings">
                    Related <ChevronRight className="w-3 h-3" />
                  </Link>
                )}
                <button
                  type="button"
                  className="sysadm-action-btn"
                  onClick={() => data.openEditor({ id: p.id, label: p.label, description: p.description, value: effectiveValue })}
                >
                  <Pencil className="w-3 h-3" /> Edit
                </button>
              </div>
            }
          />
        );
      })}
    </div>
  );
}

/**
 * Renders ONE section's content given its id. `filter` is externally
 * controlled (the standalone console's cross-section search passes the same
 * query into all six at once); `showLocalFilter` instead renders a small
 * built-in filter input the component manages itself (the Settings embed —
 * one section visible at a time, no shared search state to thread through).
 */
export function SystemAdminSectionContent({ sectionId, data, filter, showLocalFilter }: {
  sectionId: SystemAdminSectionId;
  data: SystemAdminConfigData;
  filter?: string;
  showLocalFilter?: boolean;
}) {
  const [localFilter, setLocalFilter] = useState('');
  const q = (filter ?? localFilter).trim();

  if (data.loading) {
    return <div className="sysadm-empty">Loading…</div>;
  }

  let body: ReactNode;
  const embedded = Boolean(showLocalFilter);
  switch (sectionId) {
    case 'apps':
      body = renderApps(data.visibleApps.filter(a => matches(q, a.label, a.description)), data, embedded);
      break;
    case 'extensions':
      body = renderExtensions(data.extensions.filter(e => matches(q, e.label, e.description)), data, embedded);
      break;
    case 'privileges':
      body = renderPrivileges(data.privileges.filter(p => matches(q, p.label, p.description)));
      break;
    case 'patientActions':
      body = renderPrivileges(data.patientRecordPrivileges.filter(p => matches(q, p.label, p.description)));
      break;
    case 'metadata':
      body = renderMetadata(data.metadata.filter(m => matches(q, m.label, m.description)), data, embedded);
      break;
    case 'properties':
      body = renderProperties(data.properties.filter(p => matches(q, p.label, p.description)), data, embedded);
      break;
    default:
      body = null;
  }

  return (
    <div className="sysadm-section-content">
      {showLocalFilter && (
        <div className="sysadm-search sysadm-search-local">
          <Search className="w-3.5 h-3.5" />
          <input
            value={localFilter}
            onChange={e => setLocalFilter(e.target.value)}
            placeholder="Filter this list…"
            aria-label={`Filter ${sectionId}`}
          />
          {localFilter && (
            <button type="button" onClick={() => setLocalFilter('')} aria-label="Clear filter">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
      {body}
    </div>
  );
}

/** The inline editor popup — global property values and "configurable"
 *  app/extension notes with no dedicated settings page. Shared by both
 *  hosts; renders nothing when `data.editing` is null. */
export function SystemAdminEditorModal({ data }: { data: SystemAdminConfigData }) {
  if (!data.editing) return null;
  return (
    <PortalModal onClose={data.closeEditor} width={480}>
      <div className="sysadm-modal">
        <div className="sysadm-modal-head">
          <div>
            <h2>{data.editing.label}</h2>
            <p>{data.editing.description}</p>
          </div>
          <button type="button" onClick={data.closeEditor} aria-label="Close" disabled={data.saving}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <label className="sysadm-modal-label" htmlFor="sysadm-edit-value">Current value</label>
        <textarea
          id="sysadm-edit-value"
          value={data.draftValue}
          onChange={e => data.setDraftValue(e.target.value)}
          rows={3}
          autoFocus
        />
        <div className="sysadm-modal-actions">
          <button type="button" className="btn btn-secondary" onClick={data.closeEditor} disabled={data.saving}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={data.saveEditor} disabled={data.saving}>{data.saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </PortalModal>
  );
}

/** Every `.sysadm-*` class either host needs. The standalone-only rules
 *  (shell/sidebar/shortcuts/content-head) simply match nothing inside the
 *  Settings embed, which never renders those elements. Render once per host. */
export function SystemAdminStyles() {
  return (
    <style>{`
      .sysadm-shell {
        display: flex;
        flex: 1;
        min-height: 0;
        gap: 14px;
      }
      .sysadm-sidebar {
        display: flex;
        flex-direction: column;
        flex: 0 0 280px;
        min-width: 0;
        overflow-y: auto;
        border: 1px solid var(--border-light);
        border-radius: 8px;
        background: var(--bg-card-solid);
        box-shadow: var(--list-row-shadow);
      }
      .sysadm-sidebar-head {
        padding: 14px 16px 10px;
      }
      .sysadm-eyebrow {
        margin: 0 0 4px;
        color: var(--accent-primary);
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.07em;
        text-transform: uppercase;
      }
      .sysadm-sidebar-head h1 {
        margin: 0;
        color: var(--text-primary);
        font-size: 17px;
        font-weight: 800;
        letter-spacing: 0;
      }
      .sysadm-shortcuts {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 4px 8px;
      }
      .sysadm-shortcut {
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 8px;
        border-radius: 8px;
        color: var(--text-primary);
        text-decoration: none;
      }
      .sysadm-shortcut:hover {
        background: rgba(33, 145, 208, 0.06);
      }
      .sysadm-shortcut-icon {
        display: grid;
        width: 28px;
        height: 28px;
        flex: 0 0 auto;
        place-items: center;
        border-radius: 7px;
        background: var(--accent-light);
        color: var(--accent-primary);
      }
      .sysadm-shortcut-text {
        min-width: 0;
        flex: 1;
      }
      .sysadm-shortcut-text strong {
        display: block;
        font-size: 12.5px;
        font-weight: 700;
      }
      .sysadm-shortcut-text small {
        display: block;
        margin-top: 1px;
        overflow: hidden;
        color: var(--text-muted);
        font-size: 10.5px;
        line-height: 1.3;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sysadm-shortcut-go {
        flex: 0 0 auto;
        color: var(--text-muted);
      }
      .sysadm-sidebar-divider {
        margin: 6px 12px;
        border-top: 1px solid var(--border-light);
      }
      .sysadm-sidebar-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 4px 8px 10px;
      }
      .sysadm-sidebar-item {
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 9px 8px;
        border: none;
        border-radius: 8px;
        background: transparent;
        color: var(--text-secondary);
        font-size: 12.5px;
        font-weight: 700;
        text-align: left;
        cursor: pointer;
      }
      .sysadm-sidebar-item:hover {
        background: var(--overlay-subtle);
      }
      .sysadm-sidebar-item.is-active {
        background: #F2FCFF;
        color: #113055;
      }
      .sysadm-sidebar-item span {
        flex: 1;
        min-width: 0;
      }
      .sysadm-sidebar-item b {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 19px;
        height: 17px;
        padding: 0 5px;
        border-radius: 999px;
        background: #ECEEF1;
        color: #015697;
        font-family: var(--font-condensed);
        font-size: 10px;
        font-weight: 600;
      }
      .sysadm-sidebar-item.is-active b {
        background: #ECEEF1;
      }
      .sysadm-content {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
        min-height: 0;
        border: 1px solid var(--border-light);
        border-radius: 8px;
        background: var(--bg-card-solid);
        box-shadow: var(--list-row-shadow);
        overflow: hidden;
      }
      .sysadm-content-head {
        flex: 0 0 auto;
        padding: 12px 16px;
        border-bottom: 1px solid var(--border-light);
      }
      .sysadm-content-title {
        margin: 10px 0 0;
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--text-primary);
        font-size: 15px;
        font-weight: 800;
      }
      .sysadm-content-title b {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 24px;
        height: 22px;
        padding: 0 7px;
        border-radius: 999px;
        background: var(--overlay-subtle);
        color: var(--text-muted);
        font-size: 11px;
      }
      .sysadm-search {
        display: flex;
        align-items: center;
        gap: 8px;
        height: 36px;
        padding: 0 12px;
        border: 1px solid #ECEEF1;
        border-radius: 8px;
        background: #F5F7F8;
        color: #5D728B;
      }
      .sysadm-search:focus-within {
        border-color: #7CC7FF;
      }
      .sysadm-search input {
        flex: 1;
        min-width: 0;
        border: 0;
        outline: 0;
        background: transparent;
        color: var(--text-primary);
        font-size: 13px;
      }
      .sysadm-search button {
        display: flex;
        border: none;
        background: transparent;
        color: var(--text-muted);
        cursor: pointer;
      }
      .sysadm-search-local {
        height: 34px;
        margin-bottom: 10px;
      }
      .sysadm-content-body {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 4px 16px 16px;
      }
      .sysadm-search-group {
        margin-top: 14px;
      }
      .sysadm-search-group-head {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 4px;
        color: #5D728B;
        font-family: var(--font-condensed);
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .sysadm-list {
        display: flex;
        flex-direction: column;
      }
      .sysadm-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 12px 4px;
        border-bottom: 1px solid #F1F3F5;
      }
      .sysadm-row:hover {
        background: #F2FCFF;
      }
      .sysadm-list .sysadm-row:last-child {
        border-bottom: 0;
      }
      .sysadm-row-main {
        min-width: 0;
        flex: 1 1 auto;
      }
      .sysadm-row-main strong {
        display: block;
        color: #113055;
        font-size: 13.5px;
        font-weight: 600;
      }
      .sysadm-row-main p {
        margin: 2px 0 0;
        color: #5D728B;
        font-size: 12px;
        line-height: 1.5;
      }
      .sysadm-row-main small {
        display: block;
        margin-top: 4px;
        color: var(--text-muted);
        font-size: 10.5px;
        font-weight: 700;
      }
      .sysadm-row-value {
        display: block;
        margin-top: 5px;
        color: var(--accent-primary);
        font-size: 12px;
        font-weight: 700;
      }
      .sysadm-row-actions {
        display: flex;
        flex-wrap: nowrap;
        flex: 0 0 auto;
        align-items: center;
        gap: 8px;
        white-space: nowrap;
      }
      .sysadm-pill {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        min-height: 22px;
        padding: 0 9px;
        border: 1px solid transparent;
        border-radius: 999px;
        font-family: var(--font-condensed);
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        line-height: 1;
        white-space: nowrap;
      }
      .sysadm-action-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        height: 28px;
        padding: 0 11px;
        border: 1px solid #ECEEF1;
        border-radius: 6px;
        background: #FFFFFF;
        color: #015697;
        font-family: var(--font-condensed);
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        text-decoration: none;
        cursor: pointer;
        white-space: nowrap;
      }
      .sysadm-action-btn:hover {
        background: #F2FCFF;
      }
      .sysadm-open-link {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        color: var(--accent-primary);
        font-size: 11.5px;
        font-weight: 800;
        text-decoration: none;
        white-space: nowrap;
      }
      .sysadm-open-link:hover {
        text-decoration: underline;
      }
      .sysadm-toggle {
        position: relative;
        width: 38px;
        height: 21px;
        flex: 0 0 auto;
        border: 0;
        border-radius: 999px;
        background: #CFD6DD;
        cursor: pointer;
        transition: background 0.15s ease;
      }
      .sysadm-toggle[data-on="true"] {
        background: #015697;
      }
      .sysadm-toggle:disabled {
        opacity: 0.5;
        cursor: default;
      }
      .sysadm-toggle-thumb {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 17px;
        height: 17px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 1px 2px rgba(17, 48, 85,0.25);
        transition: transform 0.15s ease;
      }
      .sysadm-toggle[data-on="true"] .sysadm-toggle-thumb {
        transform: translateX(17px);
      }
      .sysadm-table {
        display: flex;
        flex-direction: column;
      }
      .sysadm-table-head,
      .sysadm-table-row {
        display: grid;
        grid-template-columns: minmax(240px, 1.6fr) minmax(180px, 1fr) 90px;
        gap: 14px;
        align-items: center;
        padding: 10px 4px;
        border-bottom: 1px solid var(--border-light);
      }
      .sysadm-table-head {
        color: #5D728B;
        font-family: var(--font-condensed);
        font-size: 10.5px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .sysadm-table-cell-main strong {
        display: block;
        color: var(--text-primary);
        font-size: 12.5px;
        font-weight: 800;
      }
      .sysadm-table-cell-main small {
        display: block;
        margin-top: 2px;
        color: var(--text-muted);
        font-size: 11.5px;
        line-height: 1.3;
      }
      .sysadm-table-roles {
        overflow: hidden;
        color: var(--text-secondary);
        font-size: 12px;
        text-overflow: ellipsis;
        text-transform: capitalize;
      }
      .sysadm-table-row b {
        justify-self: start;
        padding: 5px 9px;
        border-radius: 999px;
        font-size: 10px;
      }
      .risk-low { background: var(--semantic-success-bg); color: var(--semantic-success); }
      .risk-medium { background: var(--semantic-warning-bg); color: var(--semantic-warning); }
      .risk-high { background: var(--semantic-danger-bg); color: var(--semantic-danger); }
      .sysadm-empty {
        padding: 32px 8px;
        color: var(--text-muted);
        font-size: 13px;
        text-align: center;
      }
      .sysadm-modal {
        padding: 18px;
      }
      .sysadm-modal-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 14px;
      }
      .sysadm-modal-head h2 {
        margin: 0;
        color: var(--text-primary);
        font-size: 16px;
        font-weight: 800;
      }
      .sysadm-modal-head p {
        margin: 4px 0 0;
        color: var(--text-secondary);
        font-size: 12.5px;
        line-height: 1.4;
      }
      .sysadm-modal-head button {
        border: none;
        background: transparent;
        color: var(--text-muted);
        cursor: pointer;
        flex-shrink: 0;
      }
      .sysadm-modal-label {
        display: block;
        margin-bottom: 6px;
        color: var(--text-muted);
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .sysadm-modal textarea {
        width: 100%;
        padding: 10px 12px;
        border: 1px solid var(--border-light);
        border-radius: 8px;
        background: var(--overlay-subtle);
        color: var(--text-primary);
        font-size: 13px;
        font-family: inherit;
        resize: vertical;
      }
      .sysadm-modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 16px;
      }
      @media (max-width: 1024px) {
        .sysadm-shell {
          flex-direction: column;
        }
        .sysadm-sidebar {
          flex: 0 0 auto;
          max-height: none;
          overflow: visible;
        }
        .sysadm-sidebar-head {
          padding: 12px 14px 8px;
        }
        .sysadm-shortcuts {
          flex-direction: row;
          overflow-x: auto;
          padding: 4px 8px;
        }
        .sysadm-shortcut {
          flex: 0 0 auto;
          min-width: 160px;
        }
        .sysadm-sidebar-divider {
          display: none;
        }
        .sysadm-sidebar-list {
          flex-direction: row;
          overflow-x: auto;
          padding: 8px;
        }
        .sysadm-sidebar-item {
          flex: 0 0 auto;
          border: 1px solid var(--border-light);
          border-radius: 999px;
        }
        .sysadm-sidebar-item.is-active {
          border-color: var(--accent-primary);
        }
      }
      @media (max-width: 640px) {
        .sysadm-row {
          flex-direction: column;
          align-items: flex-start;
        }
        .sysadm-row-actions {
          flex-wrap: wrap;
        }
        .sysadm-table-head,
        .sysadm-table-row {
          grid-template-columns: 1fr;
        }
      }
    `}</style>
  );
}
