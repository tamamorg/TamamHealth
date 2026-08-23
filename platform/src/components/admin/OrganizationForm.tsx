'use client';

/**
 * The organization create/edit form — the FORM ONLY, no dialog or page chrome.
 *
 * Extracted from /admin/organizations (2026-08-23) so the same editor can be
 * hosted on two surfaces without forking its fields: the registry's modal
 * (create + edit) and the full /admin/organizations/new page (create, wearing
 * the register-patient page anatomy). Same move as PatientRegistrationForm —
 * the form is a shared feature, its hosts own only the frame around it.
 *
 * The host owns what happens AFTER the form: `onCancel` for the cancel
 * button, `onSaved` once the write (and any admin provisioning) has finished.
 * The one-time CredentialHandoffModal stays with the host too — this
 * component may be unmounted (modal closed, page navigated) the moment it
 * reports success, so it hands the credentials up instead of rendering them.
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useAuth } from '@/lib/context';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import { useToast } from '@/components/Toast';
import type { OrganizationDoc, UserRole } from '@/lib/db-types';
import { RefreshCw, Eye, EyeOff, ShieldCheck, Building2 } from '@/components/icons/lucide';
import Select from '@/components/Select';
import { SadbSettingRow, SadbToggle } from '@/components/admin/sadb-ui';
import { BRAND_PRIMARY, BRAND_SECONDARY, WARNING } from '@/lib/theme-colors';
import { assignableRolesForOrgAdmin, labelRolesDistinctly } from '@/lib/permissions';
import {
  ORG_ADMIN_MIN_PASSWORD_LENGTH, buildOrgAdminUserPayload, emptyOrgAdminForm,
  generateTempPassword, validateOrgAdminForm,
} from '@/modules/identity/client';
import type { InvitationOutcome, OrgAdminFormData } from '@/modules/identity/client';

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

/** What the form hands up after a successful save that also provisioned an
 *  org_admin — the host shows the one-time CredentialHandoffModal with it. */
export interface OrgAdminHandoff {
  username: string;
  password: string;
  invitation?: InvitationOutcome;
}

/** The form's sections, in render order, with their anchor ids — the full-page
 *  host renders its jump rail from this so the rail and the form can never
 *  drift apart. */
export const ORG_FORM_SECTIONS = [
  { id: 'org-form-basic', labelKey: 'orgAdmin.sectionBasicInfo' },
  { id: 'org-form-subscription', labelKey: 'orgAdmin.sectionSubscription' },
  { id: 'org-form-branding', labelKey: 'orgAdmin.sectionBranding' },
  { id: 'org-form-roles', labelKey: 'orgAdmin.sectionRoles' },
  { id: 'org-form-flags', labelKey: 'orgAdmin.sectionFeatureFlags' },
  { id: 'org-form-admin', labelKey: 'orgAdmin.sectionAdministrator' },
] as const;

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

/** Seed the form for the given mode. Colours use the pre-mount-safe constants
 *  here; the mount effect below re-seeds them from the live cascade before the
 *  user can have touched anything. */
function seedForm(editing: OrganizationDoc | null): OrgFormData {
  if (!editing) return { ...emptyForm };
  return {
    name: editing.name,
    slug: editing.slug,
    orgType: editing.orgType,
    // An organization saved before this field existed has no list; show every
    // role its type allows rather than an empty set that would read as
    // "this organization employs nobody".
    enabledRoles: editing.enabledRoles?.length
      ? assignableRolesForOrgAdmin(editing.orgType, editing.enabledRoles)
      : assignableRolesForOrgAdmin(editing.orgType),
    contactEmail: editing.contactEmail,
    country: editing.country,
    logoUrl: editing.logoUrl || '',
    primaryColor: coerceStoredColorToHex(editing.primaryColor, BRAND_PRIMARY),
    secondaryColor: coerceStoredColorToHex(editing.secondaryColor, BRAND_SECONDARY),
    accentColor: coerceStoredColorToHex(editing.accentColor, WARNING),
    subscriptionPlan: editing.subscriptionPlan,
    subscriptionStatus: editing.subscriptionStatus,
    maxUsers: editing.maxUsers,
    maxHospitals: editing.maxHospitals,
    epidemicIntelligence: editing.featureFlags.epidemicIntelligence,
    mchAnalytics: editing.featureFlags.mchAnalytics,
    dhis2Export: editing.featureFlags.dhis2Export,
    communityHealth: editing.featureFlags.communityHealth,
    facilityAssessments: editing.featureFlags.facilityAssessments,
  };
}

export function OrganizationForm({ editing = null, onCancel, onSaved }: {
  /** null → create a new organization; a doc → edit that one. */
  editing?: OrganizationDoc | null;
  onCancel: () => void;
  /** The save (and any admin provisioning) finished — close the host surface.
   *  `handoff` is set only when an org_admin account was just created. */
  onSaved: (result: { handoff?: OrgAdminHandoff }) => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const { create, update } = useOrganizations();

  const editingId = editing?._id ?? null;
  const [form, setForm] = useState<OrgFormData>(() => seedForm(editing));
  const [formLoading, setFormLoading] = useState(false);

  // The "Administrator" section's toggle. On create it defaults ON — the
  // whole point is to collapse "create org" + "go create its admin at
  // /admin/users" into one step, so the shortcut should be the default, not
  // an opt-in extra click. On edit it defaults OFF — editing an org's name or
  // plan must never silently mint a user account; issuing a login is an
  // explicit, separate decision there.
  const [createAdmin, setCreateAdmin] = useState(!editing);
  // Password seeded in the mount effect below, not here: this component
  // renders on the server for the /admin/organizations/new page, and a random
  // value in the initializer would hydrate differently than it rendered.
  const [adminForm, setAdminForm] = useState<OrgAdminFormData>(emptyOrgAdminForm);
  const [showAdminPassword, setShowAdminPassword] = useState(true);
  const [adminError, setAdminError] = useState<string | null>(null);
  /**
   * Refused-submit message, rendered beside the buttons.
   *
   * handleSubmit used to `return` silently when a required field was empty —
   * in a modal tall enough that name/slug/email are scrolled out of view by
   * the time the operator reaches the submit button, so the click appeared to
   * do nothing at all. The message lives in the footer because the footer is
   * the one part of the form guaranteed to be on screen at the moment of the
   * refusal; the first empty field is also scrolled back into view.
   */
  const [formError, setFormError] = useState<string | null>(null);
  /** Slug follows the name until the operator edits it by hand. */
  const [slugTouched, setSlugTouched] = useState(!!editingId);

  // One mount pass, before the user can have touched anything: resolve the
  // live brand tokens and re-seed the colour pickers with them (create mode
  // gets the resolved defaults; edit mode re-coerces the stored values against
  // them), and generate the admin section's temporary password — fresh per
  // mount, so a password from one create/edit session never leaks into the
  // next (each open of the host surface mounts a new instance).
  useEffect(() => {
    const primary = resolveCssVarToHex('--accent-primary', BRAND_PRIMARY);
    const hover = resolveCssVarToHex('--accent-hover', BRAND_SECONDARY);
    const warning = resolveCssVarToHex('--color-warning', WARNING);
    setForm(p => editing
      ? {
        ...p,
        primaryColor: coerceStoredColorToHex(editing.primaryColor, primary),
        secondaryColor: coerceStoredColorToHex(editing.secondaryColor, hover),
        accentColor: coerceStoredColorToHex(editing.accentColor, warning),
      }
      : { ...p, primaryColor: primary, secondaryColor: hover, accentColor: primary });
    setAdminForm(p => ({ ...p, password: generateTempPassword() }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Shared tail of both the create and edit paths once the organization
  // write itself has succeeded: create the org_admin (scoped to `orgId` —
  // the just-created org, or `editingId` on the edit path) via the same
  // createUser() central-provisioning path every other admin-created account
  // uses, then hand the credentials up for the host's one-time
  // CredentialHandoffModal. A failure here is a PARTIAL failure — the
  // organization write already committed, so this never rolls it back, and
  // the toast is worded per `savedAs` so the admin knows exactly what did
  // and didn't happen.
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
      // mustChangePassword was set server-side by createUser()'s POST
      // /api/users path, not here.
      onSaved({ handoff: { username: created.username, password: adminForm.password, invitation } });
    } catch (adminErr) {
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
      onSaved({});
    }
  };

  const handleSubmit = async () => {
    if (!form.name || !form.slug || !form.contactEmail) {
      setFormError(t('orgAdmin.requiredFieldsError'));
      const firstEmpty = !form.name ? 'org-form-name' : !form.slug ? 'org-form-slug' : 'org-form-email';
      document.getElementById(firstEmpty)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setFormError(null);

    // Applies on both paths — the toggle already defaults appropriately per
    // path (ON for create, OFF for edit). Validate BEFORE any organization
    // write starts — a bad admin field (empty username, short password) must
    // never leave an org created or updated with no admin attempt at all.
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
          onSaved({});
          return;
        }

        await provisionOrgAdmin(editingId, 'updated');
        return;
      }

      const newOrg = await create(orgData as Omit<OrganizationDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>, currentUser?._id, currentUser?.username);

      if (!wantsAdmin) {
        showToast(`Organization "${form.name}" created.`, 'success');
        onSaved({});
        return;
      }

      await provisionOrgAdmin(newOrg._id, 'created');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save organization.', 'error');
    } finally {
      setFormLoading(false);
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
    <div className="space-y-5">
      {/* Basic Info */}
      <div id="org-form-basic">
        <h4 className="sadb-group-title" style={sectionTitleStyle}>{t('orgAdmin.sectionBasicInfo')}</h4>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label style={labelStyle}>{t('orgAdmin.labelName')}</label>
            <input type="text" value={form.name} onChange={e => {
              const name = e.target.value;
              // "Nile Care Group" → "nile-care-group", live, until the slug
              // field is touched by hand. A required identifier the operator
              // has to invent is a required identifier that gets left blank.
              setForm(p => slugTouched
                ? { ...p, name }
                : { ...p, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') });
            }}
              placeholder={t('orgAdmin.placeholderName')} style={inputStyle} id="org-form-name" />
          </div>
          <div>
            <label style={labelStyle}>{t('orgAdmin.labelSlug')}</label>
            <input type="text" value={form.slug}
              onChange={e => { setSlugTouched(true); setForm(p => ({ ...p, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })); }}
              placeholder={t('orgAdmin.placeholderSlug')} style={inputStyle} disabled={!!editingId} id="org-form-slug" />
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
            <input type="email" id="org-form-email" value={form.contactEmail} onChange={e => setForm(p => ({ ...p, contactEmail: e.target.value }))}
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
      <div id="org-form-subscription">
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
      <div id="org-form-branding">
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
      <div id="org-form-roles">
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
      <div id="org-form-flags">
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
      <div id="org-form-admin">
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
        {formError && (
          <p className="text-xs" role="alert" style={{ color: 'var(--color-danger-text)', marginInlineEnd: 'auto' }}>
            {formError}
          </p>
        )}
        <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>
          {t('action.cancel')}
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={handleSubmit} disabled={formLoading}>
          {formLoading ? t('orgAdmin.saving') : editingId ? t('orgAdmin.updateOrganization') : t('orgAdmin.createOrganization')}
        </button>
      </div>
    </div>
  );
}
