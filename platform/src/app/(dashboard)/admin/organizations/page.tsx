'use client';

import { CredentialHandoffModal, ORG_ADMIN_MIN_PASSWORD_LENGTH, buildOrgAdminUserPayload, emptyOrgAdminForm, generateTempPassword, validateOrgAdminForm } from '@/modules/identity/client';
import type { InvitationOutcome, OrgAdminFormData } from '@/modules/identity/client';
/**
 * Super-admin → Organizations (tenant registry), restyled to the sadb-*
 * design language (docs/SUPER-ADMIN-DESIGN-PLAN.md § /admin/organizations).
 * The list now mirrors the dashboard's tenant health matrix anatomy
 * (SadbGridList: name+sub, plan, facilities, users, status chip) so the two
 * screens finally rhyme; the bespoke full-screen create/edit form moved into
 * the shared Modal with sadb-modal chrome, feature flags are SadbToggle
 * rows, and every write (create/update/deactivate) now gets toast feedback
 * instead of console.error-only. window.confirm() on deactivate is gone in
 * favor of SadbConfirmModal.
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useAuth } from '@/lib/context';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import { useToast } from '@/components/Toast';
import type { OrganizationDoc, UserRole } from '@/lib/db-types';
import { Plus, X, RefreshCw, Eye, EyeOff, ShieldCheck, Building2} from '@/components/icons/lucide';
import Modal from '@/components/Modal';
import Select from '@/components/Select';

import {
  SadbPage, SadbCard, SadbChip, SadbKpiTile, SadbSearch, SadbGridList, SadbGridRow,
  SadbSettingRow, SadbToggle, SadbConfirmModal, statusChip, effectiveOrgStatus,
} from '@/components/admin/sadb-ui';

import { BRAND_PRIMARY, BRAND_SECONDARY, WARNING } from '@/lib/theme-colors';
import { assignableRolesForOrgAdmin, labelRolesDistinctly } from '@/lib/permissions';

type FeatureFlagKey =
  | 'epidemicIntelligence' | 'mchAnalytics' | 'dhis2Export'
  | 'communityHealth' | 'facilityAssessments';

type OrgFormData = {
  name: string;
  slug: string;
  orgType: 'public' | 'private';
  /** Staff roles this organization employs — see OrganizationDoc.enabledRoles. */
  enabledRoles: UserRole[];
  contactEmail: string;
  country: string;
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  subscriptionPlan: 'basic' | 'professional' | 'enterprise';
  subscriptionStatus: 'trial' | 'active' | 'suspended' | 'cancelled';
  maxUsers: number;
  maxHospitals: number;
} & Record<FeatureFlagKey, boolean>;

// primaryColor/secondaryColor/accentColor below used to default to
// 'var(--accent-primary)' etc., which <input type="color"> cannot parse (it
// only accepts a 7-char hex) — the swatch rendered black, and an org saved
// without touching the picker persisted that literal string as its brand
// colour. BRAND_PRIMARY/BRAND_SECONDARY/WARNING (lib/theme-colors.ts) are the
// tested literal mirror of --accent-primary/--accent-hover/--color-warning —
// used here as the pre-mount-safe default; resolveCssVarToHex() below
// re-resolves the live cascade once mounted so these track the real tokens
// rather than staying hard-coded if a tenant ever overrides them at runtime.
const emptyForm: OrgFormData = {
  name: '', slug: '', orgType: 'public',
  // Every role its type allows, so a new organization behaves exactly as it did
  // before this field existed until the super-admin narrows it on purpose.
  enabledRoles: assignableRolesForOrgAdmin('public'),
  contactEmail: '', country: 'South Sudan',
  logoUrl: '',
  primaryColor: BRAND_PRIMARY, secondaryColor: BRAND_SECONDARY, accentColor: BRAND_PRIMARY,
  subscriptionPlan: 'professional', subscriptionStatus: 'trial',
  maxUsers: 50, maxHospitals: 10,
  epidemicIntelligence: true, mchAnalytics: true, dhis2Export: false,
  communityHealth: true, facilityAssessments: true,
};

/** Normalize a resolved CSS colour string — `#rrggbb`, `#rgb`, or `rgb()`/
 *  `rgba()` (what getComputedStyle returns, possibly with whitespace) — to a
 *  lowercase `#rrggbb` hex string. Returns null for anything else (unresolved
 *  `var(--missing-token)`, a named colour, empty string). */
function normalizeToHex(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const hex6 = value.match(/^#([0-9a-f]{6})$/i);
  if (hex6) return `#${hex6[1].toLowerCase()}`;
  const hex3 = value.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (hex3) return `#${hex3[1]}${hex3[1]}${hex3[2]}${hex3[2]}${hex3[3]}${hex3[3]}`.toLowerCase();
  const rgb = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) {
    const toHex = (n: string) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0');
    return `#${toHex(rgb[1])}${toHex(rgb[2])}${toHex(rgb[3])}`;
  }
  return null;
}

/**
 * Resolve a CSS custom property (e.g. "--accent-primary") to a concrete hex
 * colour by reading the live cascade — globals.css defines these tokens as
 * chains of var() references (--accent-primary -> --tb-blue-900 ->
 * --brand-accent -> #015697), and getComputedStyle() on :root fully
 * substitutes that chain down to the literal value, unlike a static read of
 * the stylesheet text. Falls back to `fallbackHex` outside the browser (SSR)
 * or if the token can't be resolved.
 */
function resolveCssVarToHex(varName: string, fallbackHex: string): string {
  if (typeof window === 'undefined') return fallbackHex;
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(varName);
    return normalizeToHex(raw) ?? fallbackHex;
  } catch {
    return fallbackHex;
  }
}

/**
 * Coerce a *stored* organization colour value for display in the picker.
 * Handles three cases: already-valid hex (pass through), a legacy
 * `var(--...)` string saved before this fix (resolve it through the DOM —
 * assigning to an element's `color` and reading the computed value resolves
 * var() chains and any CSS colour syntax uniformly), or missing/unparseable
 * (fall back to the given resolved brand default).
 */
function coerceStoredColorToHex(raw: string | undefined, fallbackHex: string): string {
  if (!raw) return fallbackHex;
  const direct = normalizeToHex(raw);
  if (direct) return direct;
  if (typeof document === 'undefined') return fallbackHex;
  try {
    const probe = document.createElement('div');
    probe.style.color = '';
    probe.style.color = raw;
    if (!probe.style.color) return fallbackHex; // browser rejected the value
    document.body.appendChild(probe);
    const computed = getComputedStyle(probe).color;
    document.body.removeChild(probe);
    return normalizeToHex(computed) ?? fallbackHex;
  } catch {
    return fallbackHex;
  }
}

/** Grid: Organization (wide) · Plan · Facilities · Users · Sync · Status. */
// No trailing action gutter: clicking the row opens the organization's own
// page, so the 48px that column held goes back to the name and its counts.
const GRID_TEMPLATE = 'minmax(200px,1.6fr) repeat(5, minmax(96px,1fr))';

/** What the grid needs per organization, beyond the OrganizationDoc itself. */
interface OrgRowStats {
  userCount: number;
  hospitalCount: number;
  offlineHospitalCount: number;
}

/**
 * Per-tenant sync: how many of this tenant's facilities emitted a sync event
 * in the last 24 hours (/api/admin/sync-health) out of its facility total.
 * A suspended tenant, or one with no facilities yet, has nothing to report
 * rather than 0%.
 */
function tenantSync(
  org: OrganizationDoc,
  stats: OrgRowStats | undefined,
  /** hospitalIds under this org that emitted a sync event in the last 24h —
   *  null while /api/admin/sync-health is still loading (or unreachable). */
  activeFacilities: number | null,
): { label: string; color: string } {
  const suspended = org.subscriptionStatus === 'suspended' || org.subscriptionStatus === 'cancelled';
  if (!stats) return { label: '…', color: 'var(--text-muted)' };
  if (suspended || stats.hospitalCount === 0) return { label: '—', color: 'var(--text-muted)' };
  // Real signal only: facilities with sync events in the last 24 hours
  // (/api/admin/sync-health). The old derivation counted
  // HospitalDoc.syncStatus, a field frozen at record creation, so every
  // app-created facility read permanently offline and the column showed an
  // amber 0% that measured how records were created, not connectivity.
  if (activeFacilities === null) return { label: '—', color: 'var(--text-muted)' };
  const label = `${activeFacilities}/${stats.hospitalCount} · 24h`;
  return {
    label,
    color: activeFacilities === stats.hospitalCount
      ? 'var(--color-success-800)'
      : activeFacilities > 0 ? 'var(--color-warning-700)' : 'var(--text-muted)',
  };
}

/* The tenant pop card is gone (2026-08-23): a row navigates straight to
   /admin/organizations/[id], where the facilities, the roster, and every
   tenant action live. This page keeps the flows only it owns — the create /
   edit form and the deactivate confirm (reached from the org page via the
   ?deactivate=1 deep link). */

function onboardedLabel(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

export default function AdminOrganizationsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const { organizations, trashedOrganizations, loading, create, update, deactivate, getStats } = useOrganizations();

  // Local to this page now — the previous binding to the app-wide global
  // search leaked whatever was typed here into every other screen's search.
  const [search, setSearch] = useState('');

  // `?org=<id>` seeds the search box rather than locking the list to one row
  // behind an explanatory banner whose button was the only way out — the way
  // back is now the control already on screen. Nothing in the app emits the
  // parameter any more (the super-admin dashboard's tenant matrix, its last
  // producer, was removed on 2026-08-21), but bookmarks and pasted links
  // outlive the screens that made them, so the handler stays. Runs once, after
  // the organizations load, since the id has to be resolved to a name the
  // search can match.
  //
  // It has a producer again: the dashboard's tenant card sends Edit here as
  // `?org=<id>&edit=1` and its other tenant-level actions as `?org=<id>&card=1`,
  // because this page owns the organization form and the deactivate confirm.
  // The card opens on the same tenant so the trip does not lose your place.
  const deepLinkApplied = useRef(false);
  useEffect(() => {
    if (deepLinkApplied.current || organizations.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get('org');
    if (!orgId) return;
    const match = organizations.find(o => o._id === orgId);
    if (!match) return;
    deepLinkApplied.current = true;
    setSearch(match.name);
    if (params.has('edit')) openEditRef.current?.(match);
    // `deactivate=1` opens the confirm directly — the org page's Deactivate
    // sends it, since this registry owns the deactivate flow. (`card=1`, the
    // old tenant-pop-card deep link, has no producer since the card was
    // removed 2026-08-23.)
    else if (params.has('deactivate')) setDeactivateTarget(match);
  }, [organizations]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<OrgFormData>(emptyForm);
  const [formLoading, setFormLoading] = useState(false);
  const [orgStats, setOrgStats] = useState<Record<string, OrgRowStats>>({});
  // Per-org count of facilities that emitted a sync event in the last 24h —
  // the REAL liveness signal behind the Sync column (see tenantSync). null
  // until /api/admin/sync-health answers; stays null offline, which renders
  // as '—' rather than a fabricated figure.
  const [orgSyncActive, setOrgSyncActive] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ apiFetch }, { getAllHospitals }] = await Promise.all([
          import('@/lib/api-fetch'),
          import('@/lib/services/hospital-service'),
        ]);
        const res = await apiFetch('/api/admin/sync-health');
        if (!res.ok) return;
        const body = await res.json() as { perFacilityLast24h?: Record<string, unknown> };
        const seen = new Set(Object.keys(body.perFacilityLast24h || {}));
        const hospitals = await getAllHospitals();
        const byOrg: Record<string, number> = {};
        for (const h of hospitals) {
          if (!h.orgId) continue;
          if (seen.has(h._id)) byOrg[h.orgId] = (byOrg[h.orgId] || 0) + 1;
        }
        if (!cancelled) setOrgSyncActive(byOrg);
      } catch { /* offline — the column reads '—' */ }
    })();
    return () => { cancelled = true; };
  }, []);
  const [deactivateTarget, setDeactivateTarget] = useState<OrganizationDoc | null>(null);
  const [deactivating, setDeactivating] = useState(false);
  // The "Administrator" section's toggle. On create it defaults ON — the
  // whole point is to collapse "create org" + "go create its admin at
  // /admin/users" into one step, so the shortcut should be the default, not
  // an opt-in extra click. On edit it defaults OFF (set in openEdit) —
  // editing an org's name or plan must never silently mint a user account;
  // issuing a login is an explicit, separate decision there.
  const [createAdmin, setCreateAdmin] = useState(true);
  const [adminForm, setAdminForm] = useState<OrgAdminFormData>(emptyOrgAdminForm);
  const [showAdminPassword, setShowAdminPassword] = useState(true);
  const [adminError, setAdminError] = useState<string | null>(null);
  // Credential hand-off for the admin account just created — same one-time
  // panel as /admin/users, shown only after both writes succeed.
  const [handoff, setHandoff] = useState<{ username: string; password: string; invitation?: InvitationOutcome } | null>(null);

  // Resolved brand colours for the branding pickers — starts at the literal
  // (tested) mirror in theme-colors.ts so the first paint is never black,
  // then re-resolves the live cascade on mount so the defaults track the
  // actual tokens (see resolveCssVarToHex above).
  const [brandDefaults, setBrandDefaults] = useState<{ primary: string; hover: string; warning: string }>({ primary: BRAND_PRIMARY, hover: BRAND_SECONDARY, warning: WARNING });
  useEffect(() => {
    setBrandDefaults({
      primary: resolveCssVarToHex('--accent-primary', BRAND_PRIMARY),
      hover: resolveCssVarToHex('--accent-hover', BRAND_SECONDARY),
      warning: resolveCssVarToHex('--color-warning', WARNING),
    });
  }, []);

  // Per-org user + facility counts for the grid. Run all getStats() calls
  // concurrently so the overall wait is the slowest single call, not the sum.
  useEffect(() => {
    let cancelled = false;
    const loadStats = async () => {
      const entries = await Promise.all(
        organizations.map(async (org): Promise<[string, OrgRowStats]> => {
          try {
            const stats = await getStats(org._id);
            return [org._id, {
              userCount: stats.userCount,
              hospitalCount: stats.hospitalCount,
              offlineHospitalCount: stats.offlineHospitalCount,
            }];
          } catch {
            return [org._id, { userCount: 0, hospitalCount: 0, offlineHospitalCount: 0 }];
          }
        })
      );
      if (cancelled) return;
      const next: Record<string, OrgRowStats> = {};
      for (const [id, s] of entries) next[id] = s;
      setOrgStats(next);
    };
    if (organizations.length > 0) loadStats();
    return () => { cancelled = true; };
  }, [organizations, getStats]);

  // The list always shows every organization; a `?org=` deep link no longer
  // narrows it. The narrowing came with a banner as its only reset, so losing
  // the banner would have stranded anyone arriving from the dashboard on a
  // one-row list. Search is the way to narrow now, and it clears itself.
  const filteredOrgs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return organizations.filter(o =>
      !q || o.name.toLowerCase().includes(q) || o.slug.toLowerCase().includes(q) || o.contactEmail.toLowerCase().includes(q)
    );
  }, [organizations, search]);

  // Counted off the SAME status the rows show, so the chips add up to the list
  // beneath them. They used to be three overlapping questions asked of two
  // fields — a deactivated trial tenant answered yes to both "trial" and
  // "suspended", so three organizations reported 2 active + 2 trial + 1
  // suspended, and the one counted as suspended displayed TRIAL in its row.
  //
  // `organizations` is the LIVE list now: a deactivated tenant is in Trash
  // (Settings → Trash) and appears in no console. So "suspended" here can only
  // mean a live tenant whose SUBSCRIPTION is suspended or cancelled — one you
  // are still running, that is not paying.
  const statusOf = (o: OrganizationDoc) => effectiveOrgStatus(o);
  const activeOrgs = organizations.filter(o => statusOf(o) === 'active');
  const trialOrgs = organizations.filter(o => statusOf(o) === 'trial');
  const suspendedOrgs = organizations.filter(o => statusOf(o) === 'suspended' || statusOf(o) === 'cancelled');

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...emptyForm, primaryColor: brandDefaults.primary, secondaryColor: brandDefaults.hover, accentColor: brandDefaults.primary });
    setCreateAdmin(true);
    // Fresh admin sub-form + freshly generated password every time the modal
    // opens, so a password generated in one session (create or edit) can
    // never leak into the next.
    setAdminForm({ ...emptyOrgAdminForm, password: generateTempPassword() });
    setShowAdminPassword(true);
    setAdminError(null);
    setShowForm(true);
  };

  // Deep link: /admin/organizations?new=1 opens the create dialog directly
  // (the dashboard's Organizations card "Add" head action) — same pattern as
  // /admin/users, /hospitals and /org-admin/hospitals. Mount-only: the brand
  // defaults it seeds may still be the constants at this point, which is the
  // same fallback resolveCssVarToHex uses.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('new')) openCreate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Declared below this effect, so the deep-link handler above reaches it
  // through a ref rather than forcing a reorder of the component.
  const openEditRef = useRef<((org: OrganizationDoc) => void) | null>(null);
  const openEdit = (org: OrganizationDoc) => {
    setEditingId(org._id);
    setForm({
      name: org.name,
      slug: org.slug,
      orgType: org.orgType,
      // An organization saved before this field existed has no list; show every
      // role its type allows rather than an empty set that would read as
      // "this organization employs nobody".
      enabledRoles: org.enabledRoles?.length
        ? assignableRolesForOrgAdmin(org.orgType, org.enabledRoles)
        : assignableRolesForOrgAdmin(org.orgType),
      contactEmail: org.contactEmail,
      country: org.country,
      // Stored colours are normally already valid hex; coerce covers a
      // legacy `var(--...)` string saved before this fix (or a missing
      // accentColor) so the picker never renders black.
      logoUrl: org.logoUrl || '',
      primaryColor: coerceStoredColorToHex(org.primaryColor, brandDefaults.primary),
      secondaryColor: coerceStoredColorToHex(org.secondaryColor, brandDefaults.hover),
      accentColor: coerceStoredColorToHex(org.accentColor, brandDefaults.warning),
      subscriptionPlan: org.subscriptionPlan,
      subscriptionStatus: org.subscriptionStatus,
      maxUsers: org.maxUsers,
      maxHospitals: org.maxHospitals,
      epidemicIntelligence: org.featureFlags.epidemicIntelligence,
      mchAnalytics: org.featureFlags.mchAnalytics,
      dhis2Export: org.featureFlags.dhis2Export,
      communityHealth: org.featureFlags.communityHealth,
      facilityAssessments: org.featureFlags.facilityAssessments,
    });
    // Administrator section defaults OFF on edit — see the createAdmin
    // state comment. Reset the admin sub-form + generate a fresh password
    // here too, so nothing from a prior create/edit session survives.
    setCreateAdmin(false);
    setAdminForm({ ...emptyOrgAdminForm, password: generateTempPassword() });
    setShowAdminPassword(true);
    setAdminError(null);
    setShowForm(true);
  };
  /** Read the picked file into a data URL on the form. Same 500KB ceiling and
   *  same storage shape as the org-admin branding editor, so a logo set here
   *  and one set there are the same field. */
  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 512000) {
      showToast(t('branding.errorLogoSize'), 'error');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => setForm(p => ({ ...p, logoUrl: reader.result as string }));
    reader.readAsDataURL(file);
  };

  // The deep-link handler above calls this through the ref.
  openEditRef.current = openEdit;

  // Shared tail of both the create and edit paths once the organization
  // write itself has succeeded: create the org_admin (scoped to `orgId` —
  // the just-created org, or `editingId` on the edit path) via the same
  // createUser() central-provisioning path every other admin-created account
  // uses, then show the same one-time CredentialHandoffModal. A failure here
  // is a PARTIAL failure — the organization write already committed, so this
  // never rolls it back, and the toast is worded per `savedAs` so the admin
  // knows exactly what did and didn't happen.
  const provisionOrgAdmin = async (orgId: string, savedAs: 'created' | 'updated') => {
    const savedToast = savedAs === 'created' ? `Organization "${form.name}" created.` : `Organization "${form.name}" updated.`;
    try {
      const { createUserWithInvitation } = await import('@/modules/identity/services/user-service');
      // The invitation outcome is the point of using this variant: the route
      // always mails a "set your password" link when the account has an email,
      // and this flow used to discard the answer and always tell the operator
      // to read out a temporary password. The actor comes from the session on
      // the server side, so there is nothing to pass here.
      const { user: created, invitation } = await createUserWithInvitation(
        buildOrgAdminUserPayload(adminForm, orgId),
      );
      showToast(savedToast, 'success');
      setShowForm(false);
      // Hand the credentials to the admin exactly once — mirrors the
      // /admin/users "Add user" flow. mustChangePassword was set server-side
      // by createUser()'s POST /api/users path, not here.
      setHandoff({ username: created.username, password: adminForm.password, invitation });
    } catch (adminErr) {
      setShowForm(false);
      showToast(
        t(savedAs === 'created' ? 'orgAdmin.adminCreationPartialError' : 'orgAdmin.adminCreationPartialErrorEdit', {
          name: form.name,
          reason: adminErr instanceof Error ? adminErr.message : 'Unknown error',
        }),
        'error',
        {
          durationMs: 15000,
          action: { label: t('orgAdmin.goToUsers'), onClick: () => router.push('/admin/users') },
        }
      );
    }
  };

  const handleSubmit = async () => {
    if (!form.name || !form.slug || !form.contactEmail) return;

    // Applies on both paths now — the toggle already defaults appropriately
    // per path (ON for create, OFF for edit; see openCreate/openEdit).
    // Validate BEFORE any organization write starts — a bad admin field
    // (empty username, short password) must never leave an org created or
    // updated with no admin attempt at all.
    const wantsAdmin = createAdmin;
    if (wantsAdmin) {
      const errorCode = validateOrgAdminForm(adminForm);
      if (errorCode) {
        setAdminError(errorCode === 'password-too-short'
          ? t('orgAdmin.adminPasswordTooShortError', { min: ORG_ADMIN_MIN_PASSWORD_LENGTH })
          : t('orgAdmin.adminRequiredError'));
        return;
      }
    }

    setAdminError(null);
    setFormLoading(true);
    try {
      const orgData = {
        name: form.name,
        slug: form.slug,
        orgType: form.orgType,
        enabledRoles: form.enabledRoles,
        contactEmail: form.contactEmail,
        country: form.country,
        logoUrl: form.logoUrl || undefined,
        primaryColor: form.primaryColor,
        secondaryColor: form.secondaryColor,
        accentColor: form.accentColor,
        subscriptionPlan: form.subscriptionPlan,
        subscriptionStatus: form.subscriptionStatus,
        maxUsers: form.maxUsers,
        maxHospitals: form.maxHospitals,
        isActive: true,
        featureFlags: {
          epidemicIntelligence: form.epidemicIntelligence,
          mchAnalytics: form.mchAnalytics,
          dhis2Export: form.dhis2Export,
          communityHealth: form.communityHealth,
          facilityAssessments: form.facilityAssessments,
        },
      };

      if (editingId) {
        await update(editingId, orgData, currentUser?._id, currentUser?.username);

        if (!wantsAdmin) {
          showToast(`Organization "${form.name}" updated.`, 'success');
          setShowForm(false);
          return;
        }

        await provisionOrgAdmin(editingId, 'updated');
        return;
      }

      const newOrg = await create(orgData as Omit<OrganizationDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>, currentUser?._id, currentUser?.username);

      if (!wantsAdmin) {
        showToast(`Organization "${form.name}" created.`, 'success');
        setShowForm(false);
        return;
      }

      await provisionOrgAdmin(newOrg._id, 'created');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save organization.', 'error');
    } finally {
      setFormLoading(false);
    }
  };

  const confirmDeactivate = async () => {
    if (!deactivateTarget) return;
    setDeactivating(true);
    try {
      await deactivate(deactivateTarget._id, currentUser?._id, currentUser?.username);
      showToast(`Organization "${deactivateTarget.name}" deactivated.`, 'success');
      setDeactivateTarget(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to deactivate organization.', 'error');
    } finally {
      setDeactivating(false);
    }
  };

  // Every role this organization's TYPE permits — the menu the checkboxes below
  // are drawn from. Recomputed from `form.orgType` so switching public→private
  // immediately stops offering roles the private-sector list excludes.
  const selectableRoles = assignableRolesForOrgAdmin(form.orgType);
  const enabledRoleSet = new Set(form.enabledRoles);
  const toggleRole = (role: UserRole, on: boolean) => {
    setForm(p => {
      const next = new Set(p.enabledRoles);
      if (on) next.add(role); else next.delete(role);
      // Preserve the canonical order rather than click order, so the saved list
      // and the org admin's Role dropdown read the same way every time.
      return { ...p, enabledRoles: selectableRoles.filter(r => next.has(r)) };
    });
  };

  const FEATURE_FLAGS: { key: FeatureFlagKey; label: string; sub: string }[] = [
    { key: 'epidemicIntelligence', label: t('orgAdmin.featureEpidemicIntelligence'), sub: t('orgSettings.flagEpidemicIntelligenceDesc') },
    { key: 'mchAnalytics', label: t('orgAdmin.featureMchAnalytics'), sub: t('orgSettings.flagMchAnalyticsDesc') },
    { key: 'dhis2Export', label: t('orgAdmin.featureDhis2Export'), sub: t('orgSettings.flagDhis2ExportDesc') },
    { key: 'communityHealth', label: t('orgAdmin.featureCommunityHealth'), sub: t('orgSettings.flagCommunityHealthDesc') },
    { key: 'facilityAssessments', label: t('orgAdmin.featureFacilityAssessments'), sub: t('orgSettings.flagFacilityAssessmentsDesc') },
  ];

  // Styles for the raw form fields (basic info / subscription / branding) —
  // there's no shared "field" kit yet, so these stay hand-rolled, tokens only.
  const inputStyle: React.CSSProperties = {
    background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)',
    borderRadius: '4px', padding: '10px 14px', color: 'var(--text-primary)',
    fontSize: '14px', width: '100%', outline: 'none',
  };
  const selectStyle: React.CSSProperties = {
    ...inputStyle, appearance: 'none' as const, paddingInlineEnd: '36px',
    backgroundImage: `url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%238A9E9A' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)',
    textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px', display: 'block',
  };
  const sectionTitleStyle: React.CSSProperties = { marginBottom: 10 };

  // The Administrator section's toggle copy differs by path (see the
  // createAdmin state comment) — create-specific wording must never leak
  // onto the edit path, so each uses its own i18n key.
  const adminToggleLabel = t(editingId ? 'orgAdmin.addAdminToggleLabel' : 'orgAdmin.createAdminToggleLabel');
  const adminToggleSub = t(editingId ? 'orgAdmin.addAdminToggleSub' : 'orgAdmin.createAdminToggleSub');

  return (
    <SadbPage>
      {/* ═══ Subscription vitals — merged from /admin/billing (2026-08-23).
          That page was this same tenant list wearing billing columns; its KPI
          strip lives here now and the plan/status/seat-limit edits it offered
          inline are the registry's own Edit Organization form. ═══ */}
      <div className="sadb-kpi-row">
        <SadbKpiTile
          label={t('adminBilling.kpiActiveSubscriptions')}
          value={activeOrgs.length}
          delta={`of ${organizations.length} organizations`}
          deltaTone={activeOrgs.length > 0 ? 'up' : undefined}
        />
        <SadbKpiTile
          label={t('adminBilling.kpiTrialOrganizations')}
          value={trialOrgs.length}
          delta={trialOrgs.length > 0 ? 'Needs conversion follow-up' : 'None currently'}
          deltaTone={trialOrgs.length > 0 ? 'warn' : undefined}
        />
        <SadbKpiTile
          label={t('adminBilling.kpiSuspended')}
          value={suspendedOrgs.length}
          delta={suspendedOrgs.length > 0 ? 'Review and reconcile' : 'None suspended'}
          deltaTone={suspendedOrgs.length > 0 ? 'warn' : undefined}
        />
        <SadbKpiTile
          label={t('adminBilling.kpiTotalLicensedUsers')}
          value={organizations.reduce((sum, o) => sum + o.maxUsers, 0)}
          delta={`across ${organizations.length} organizations`}
        />
      </div>

      <SadbCard
        title={t('orgAdmin.title')}
        action={
          <div className="sadb-legend">
            <span><i style={{ background: 'var(--text-muted)' }} />{t('orgAdmin.title')} ({organizations.length})</span>
            <span><i style={{ background: 'var(--color-success-800)' }} />{t('orgAdmin.statusActive')} ({activeOrgs.length})</span>
            <span><i style={{ background: 'var(--color-warning-600)' }} />{t('orgAdmin.statusTrial')} ({trialOrgs.length})</span>
            <span><i style={{ background: 'var(--color-danger-500)' }} />{t('orgAdmin.statusSuspended')} ({suspendedOrgs.length})</span>
            {trashedOrganizations.length > 0 && (
              <span><i style={{ background: 'var(--text-muted)' }} />{t('orgAdmin.inTrash')} ({trashedOrganizations.length})</span>
            )}
          </div>
        }
      >
        <div className="sadb-search-row">
          <SadbSearch value={search} onChange={setSearch} placeholder={t('orgAdmin.searchPlaceholder')} />
          <button type="button" className="btn btn-primary btn-sm flex-shrink-0" onClick={openCreate}>
            <Plus className="w-4 h-4" /> {t('orgAdmin.newOrganization')}
          </button>
        </div>

        <SadbGridList
          template={GRID_TEMPLATE}
          minWidth={880}
          head={[
            t('orgAdmin.organization'), t('orgAdmin.colPlan'), t('orgAdmin.colFacilities'),
            t('orgAdmin.colUsers'), t('orgAdmin.colSync'), t('orgAdmin.colStatus'),
          ]}
          alignEndLast
          empty={loading ? t('orgAdmin.loading') : t('orgAdmin.empty')}
        >
          {filteredOrgs.map(org => {
            const stats = orgStats[org._id];
            const sync = tenantSync(org, stats, orgSyncActive ? (orgSyncActive[org._id] ?? 0) : null);
            const onboarded = onboardedLabel(org.createdAt);
            const orgKind = org.orgType === 'public' ? t('orgAdmin.typePublic') : t('orgAdmin.typePrivate');
            return (
              <SadbGridRow
                key={org._id}
                template={GRID_TEMPLATE}
                /* Straight to the organization's own page — no pop card stop
                   (2026-08-23): facilities, roster, and the tenant actions
                   all live there. */
                onClick={() => router.push(`/admin/organizations/${org._id}`)}
              >
                <span className="min-w-0">
                  <span className="sadb-tenant-name truncate" style={{ color: org.isActive ? undefined : 'var(--text-muted)' }}>
                    {org.name}
                  </span>
                  <span className="sadb-tenant-sub truncate">
                    {orgKind}{onboarded ? ` · onboarded ${onboarded}` : ''}
                  </span>
                </span>
                <span className="capitalize">{org.subscriptionPlan}</span>
                <span className="sadb-tenant-num">{stats ? `${stats.hospitalCount} / ${org.maxHospitals}` : '…'}</span>
                <span className="sadb-tenant-num">{stats ? `${stats.userCount} / ${org.maxUsers}` : '…'}</span>
                <span style={{ color: sync.color }}>{sync.label}</span>
                <span style={{ textAlign: 'end' }}>
                  <SadbChip tone={statusChip(effectiveOrgStatus(org))}>{effectiveOrgStatus(org)}</SadbChip>
                </span>
              </SadbGridRow>
            );
          })}
        </SadbGridList>
      </SadbCard>


      {/* Create/Edit Modal */}
      {showForm && (
        <Modal onClose={() => setShowForm(false)} width={640} labelledBy="org-form-title">
          {/* The shared Modal's dialog box sets a max-height but overflow:
              visible — fine for its short editor/confirm variants, but this
              form is taller than the viewport on most screens. Without its
              own scroll container here, content past that max-height paints
              outside the white card, on the dark backdrop. min-height: 0 is
              required alongside overflow-y for a flex child to actually
              shrink to (and then scroll within) its flex parent's height. */}
          {/* Capped well short of the viewport: the dialog box may grow to
              100vh - 32px, which on a laptop is edge to edge and reads as a
              page that failed to centre rather than a dialog. Constraining the
              SCROLLER instead makes the box shrink to it, so the form sits in
              the middle with the backdrop visible above and below and the
              fields scroll inside. */}
          <div className="sadb-modal" style={{ minHeight: 0, overflowY: 'auto', maxHeight: 'min(78vh, 720px)' }}>
            <div className="flex items-start justify-between gap-3 sadb-modal-copy">
              <h2 id="org-form-title" className="sadb-modal-title">
                {editingId ? t('orgAdmin.editOrganization') : t('orgAdmin.createOrganization')}
              </h2>
              <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }} aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-5">
              {/* Basic Info */}
              <div>
                <h4 className="sadb-group-title" style={sectionTitleStyle}>{t('orgAdmin.sectionBasicInfo')}</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label style={labelStyle}>{t('orgAdmin.labelName')}</label>
                    <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                      placeholder={t('orgAdmin.placeholderName')} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>{t('orgAdmin.labelSlug')}</label>
                    <input type="text" value={form.slug}
                      onChange={e => setForm(p => ({ ...p, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                      placeholder={t('orgAdmin.placeholderSlug')} style={inputStyle} disabled={!!editingId} />
                  </div>
                  <div>
                    <label style={labelStyle}>{t('orgAdmin.labelOrgType')}</label>
                    <Select value={form.orgType} onChange={e => setForm(p => {
                      // Switching type changes which roles exist at all. Keep the
                      // admin's selections where they survive the new type, and
                      // drop the rest — leaving them would persist roles the org
                      // admin can never be offered.
                      const nextType = e.target.value as 'public' | 'private';
                      const allowed = assignableRolesForOrgAdmin(nextType);
                      const kept = allowed.filter(r => p.enabledRoles.includes(r));
                      return { ...p, orgType: nextType, enabledRoles: kept.length ? kept : allowed };
                    })} style={selectStyle}>
                      <option value="public">{t('orgAdmin.typePublic')}</option>
                      <option value="private">{t('orgAdmin.typePrivate')}</option>
                    </Select>
                  </div>
                  <div>
                    <label style={labelStyle}>{t('orgAdmin.labelContactEmail')}</label>
                    <input type="email" value={form.contactEmail} onChange={e => setForm(p => ({ ...p, contactEmail: e.target.value }))}
                      placeholder="support.tamam@gmail.com" style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>{t('orgAdmin.labelCountry')}</label>
                    <input type="text" value={form.country} onChange={e => setForm(p => ({ ...p, country: e.target.value }))}
                      style={inputStyle} />
                  </div>
                </div>
              </div>

              {/* Subscription */}
              <div>
                <h4 className="sadb-group-title" style={sectionTitleStyle}>{t('orgAdmin.sectionSubscription')}</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label style={labelStyle}>{t('orgAdmin.labelPlan')}</label>
                    <Select value={form.subscriptionPlan} onChange={e => setForm(p => ({ ...p, subscriptionPlan: e.target.value as OrgFormData['subscriptionPlan'] }))} style={selectStyle}>
                      <option value="basic">{t('orgAdmin.planBasic')}</option>
                      <option value="professional">{t('orgAdmin.planProfessional')}</option>
                      <option value="enterprise">{t('orgAdmin.planEnterprise')}</option>
                    </Select>
                  </div>
                  <div>
                    <label style={labelStyle}>{t('orgAdmin.labelStatus')}</label>
                    <Select value={form.subscriptionStatus} onChange={e => setForm(p => ({ ...p, subscriptionStatus: e.target.value as OrgFormData['subscriptionStatus'] }))} style={selectStyle}>
                      <option value="trial">{t('orgAdmin.statusTrial')}</option>
                      <option value="active">{t('orgAdmin.statusActive')}</option>
                      <option value="suspended">{t('orgAdmin.statusSuspended')}</option>
                      <option value="cancelled">{t('orgAdmin.statusCancelled')}</option>
                    </Select>
                  </div>
                  <div>
                    <label style={labelStyle}>{t('orgAdmin.labelMaxUsers')}</label>
                    <input type="number" min="1" value={form.maxUsers} onChange={e => setForm(p => ({ ...p, maxUsers: parseInt(e.target.value) || 1 }))} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>{t('orgAdmin.labelMaxHospitals')}</label>
                    <input type="number" min="1" value={form.maxHospitals} onChange={e => setForm(p => ({ ...p, maxHospitals: parseInt(e.target.value) || 1 }))} style={inputStyle} />
                  </div>
                </div>
              </div>

              {/* Branding */}
              <div>
                <h4 className="sadb-group-title" style={sectionTitleStyle}>{t('orgAdmin.sectionBranding')}</h4>
                {/* The mark, with the colours it will sit against. A tenant
                    could set three colours here but not the logo, so the one
                    piece of branding staff actually recognise had to be added
                    afterwards from the org-admin console — by somebody who
                    does not exist yet at the moment an organization is
                    created. Stored as a data URL on the org document, same as
                    the branding editor writes. */}
                <div className="flex items-center gap-3" style={{ marginBottom: 12 }}>
                  <span
                    className="flex items-center justify-center rounded-lg overflow-hidden flex-shrink-0"
                    style={{ width: 56, height: 56, border: '1px solid var(--border-light)', background: 'var(--overlay-subtle)' }}
                  >
                    {form.logoUrl
                      ? <img src={form.logoUrl} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                      : <Building2 className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />}
                  </span>
                  <div className="flex items-center gap-2">
                    <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
                      {form.logoUrl ? t('orgAdmin.logoReplace') : t('orgAdmin.logoUpload')}
                      <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                    </label>
                    {form.logoUrl && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setForm(p => ({ ...p, logoUrl: '' }))}>
                        {t('action.remove')}
                      </button>
                    )}
                    <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{t('orgAdmin.logoHint')}</span>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {([
                    { key: 'primaryColor' as const, label: t('orgAdmin.colorPrimary') },
                    { key: 'secondaryColor' as const, label: t('orgAdmin.colorSecondary') },
                    { key: 'accentColor' as const, label: t('orgAdmin.colorAccent') },
                  ]).map(c => (
                    <div key={c.key}>
                      <label style={labelStyle}>{c.label}</label>
                      <div className="flex items-center gap-2">
                        <input type="color" value={form[c.key]} onChange={e => setForm(p => ({ ...p, [c.key]: e.target.value }))}
                          className="w-10 h-10 rounded-lg cursor-pointer border-0" />
                        <input type="text" value={form[c.key]} onChange={e => setForm(p => ({ ...p, [c.key]: e.target.value }))}
                          style={{ ...inputStyle, fontFamily: 'var(--font-platform-mono)', fontSize: '12px' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Staff roles — the roster of roles this organization employs.
                  What is ticked here is exactly what the organization's own
                  admin is offered in the Role dropdown when they create a user,
                  so a clinic that runs on five roles stops scrolling past
                  twenty-five. It narrows a picker; it does not grant anything —
                  POST /api/users re-checks every assignment regardless. */}
              <div>
                <div className="flex items-baseline justify-between gap-3">
                  <h4 className="sadb-group-title" style={sectionTitleStyle}>{t('orgAdmin.sectionRoles')}</h4>
                  <div className="flex items-center gap-3" style={{ marginBottom: 8 }}>
                    <button
                      type="button"
                      className="text-xs font-semibold"
                      style={{ color: 'var(--accent-text)' }}
                      onClick={() => setForm(p => ({ ...p, enabledRoles: selectableRoles }))}
                    >
                      {t('orgAdmin.rolesSelectAll')}
                    </button>
                    <button
                      type="button"
                      className="text-xs font-semibold"
                      style={{ color: 'var(--text-muted)' }}
                      onClick={() => setForm(p => ({ ...p, enabledRoles: [] }))}
                    >
                      {t('orgAdmin.rolesClear')}
                    </button>
                  </div>
                </div>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)', marginBottom: 8 }}>
                  {t('orgAdmin.rolesHint')}
                </p>
                <div
                  className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1"
                  style={{ border: '1px solid var(--border-light)', borderRadius: 8, padding: 12 }}
                >
                  {labelRolesDistinctly(selectableRoles).map(({ role, label }) => (
                    <label
                      key={role}
                      className="flex items-center gap-2 text-xs"
                      /* globals.css force-uppercases every bare <label>; these
                         are checkbox captions, not field labels, so opt out. */
                      style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500, marginBottom: 0, display: 'flex' }}
                    >
                      <input
                        type="checkbox"
                        checked={enabledRoleSet.has(role)}
                        onChange={e => toggleRole(role, e.target.checked)}
                      />
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {label}
                      </span>
                    </label>
                  ))}
                </div>
                {form.enabledRoles.length === 0 && (
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)', marginTop: 6 }}>
                    {t('orgAdmin.rolesNoneSelected')}
                  </p>
                )}
              </div>

              {/* Feature Flags */}
              <div>
                <h4 className="sadb-group-title" style={sectionTitleStyle}>{t('orgAdmin.sectionFeatureFlags')}</h4>
                <div style={{ border: '1px solid var(--border-light)', borderRadius: 8 }}>
                  {FEATURE_FLAGS.map(ff => (
                    <SadbSettingRow key={ff.key} label={ff.label} sub={ff.sub}>
                      <SadbToggle
                        checked={form[ff.key]}
                        onChange={next => setForm(p => ({ ...p, [ff.key]: next }))}
                        label={ff.label}
                      />
                    </SadbSettingRow>
                  ))}
                </div>
              </div>

              {/* Administrator — rendered on both create and edit, but with
                  different defaults and copy (see createAdmin state comment):
                  create defaults ON ("create the first administrator"), edit
                  defaults OFF and reads as adding one to an org that may
                  already have staff, never as re-creating the first one. */}
              <div>
                <h4 className="sadb-group-title" style={sectionTitleStyle}>{t('orgAdmin.sectionAdministrator')}</h4>
                <div style={{ border: '1px solid var(--border-light)', borderRadius: 8 }}>
                  <SadbSettingRow label={adminToggleLabel} sub={adminToggleSub}>
                    <SadbToggle checked={createAdmin} onChange={setCreateAdmin} label={adminToggleLabel} />
                  </SadbSettingRow>
                </div>

                  {createAdmin && (
                    <div className="grid grid-cols-2 gap-3" style={{ marginTop: 12 }}>
                      <div>
                        <label style={labelStyle}>{t('orgAdmin.labelAdminName')}</label>
                        <input type="text" value={adminForm.name} onChange={e => setAdminForm(p => ({ ...p, name: e.target.value }))} style={inputStyle} />
                      </div>
                      <div>
                        <label style={labelStyle}>{t('orgAdmin.labelAdminUsername')}</label>
                        <input type="text" value={adminForm.username} onChange={e => setAdminForm(p => ({ ...p, username: e.target.value }))} style={inputStyle} autoComplete="off" />
                      </div>
                      <div className="col-span-2">
                        <label style={labelStyle}>{t('orgAdmin.labelAdminEmail')}</label>
                        <input type="email" value={adminForm.email} onChange={e => setAdminForm(p => ({ ...p, email: e.target.value }))} style={inputStyle} />
                      </div>
                      <div className="col-span-2">
                        <div className="flex items-center justify-between mb-1.5">
                          <label style={{ ...labelStyle, marginBottom: 0 }}>{t('orgAdmin.labelAdminPassword')}</label>
                          <button
                            type="button"
                            onClick={() => { setAdminForm(p => ({ ...p, password: generateTempPassword() })); setShowAdminPassword(true); }}
                            className="flex items-center gap-1 text-xs font-semibold"
                            style={{ color: 'var(--accent-text)' }}
                          >
                            <RefreshCw className="w-3 h-3" /> {t('orgAdmin.generatePassword')}
                          </button>
                        </div>
                        <div className="relative">
                          <input
                            type={showAdminPassword ? 'text' : 'password'}
                            value={adminForm.password}
                            onChange={e => setAdminForm(p => ({ ...p, password: e.target.value }))}
                            style={{ ...inputStyle, paddingInlineEnd: 40, fontFamily: showAdminPassword ? 'var(--font-mono, monospace)' : undefined }}
                            autoComplete="new-password"
                          />
                          <button type="button" onClick={() => setShowAdminPassword(v => !v)} className="absolute end-3 top-1/2 -translate-y-1/2">
                            {showAdminPassword
                              ? <EyeOff className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                              : <Eye className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />}
                          </button>
                        </div>
                        <p className="mt-1.5 text-[11px] flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                          <ShieldCheck className="w-3 h-3" /> {t('orgAdmin.adminPasswordHint')}
                        </p>
                      </div>
                      {adminError && (
                        <p className="col-span-2 text-xs" style={{ color: 'var(--color-danger-text)' }}>{adminError}</p>
                      )}
                    </div>
                  )}
              </div>

              <div className="sadb-modal-actions" style={{ marginTop: 0, paddingTop: 16, borderTop: '1px solid var(--border-light)' }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowForm(false)}>
                  {t('action.cancel')}
                </button>
                <button type="button" className="btn btn-primary btn-sm" onClick={handleSubmit} disabled={formLoading}>
                  {formLoading ? t('orgAdmin.saving') : editingId ? t('orgAdmin.updateOrganization') : t('orgAdmin.createOrganization')}
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {deactivateTarget && (
        <SadbConfirmModal
          title={t('orgAdmin.deactivate')}
          body={t('orgAdmin.confirmDeactivate', { name: deactivateTarget.name })}
          confirmLabel={t('orgAdmin.deactivate')}
          onCancel={() => setDeactivateTarget(null)}
          onConfirm={confirmDeactivate}
          busy={deactivating}
        />
      )}

      {/* Credential hand-off for the administrator just created — same
          one-time panel as /admin/users. Only ever set after createUser()
          has actually succeeded (see handleSubmit). */}
      {handoff && (
        <CredentialHandoffModal
          title={t('orgAdmin.handoffTitle')}
          description={t('orgAdmin.handoffDescription')}
          username={handoff.username}
          password={handoff.password}
          invitation={handoff.invitation}
          onClose={() => setHandoff(null)}
        />
      )}
    </SadbPage>
  );
}
