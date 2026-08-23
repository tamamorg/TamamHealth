'use client';

import { CredentialHandoffModal } from '@/modules/identity/client';
/**
 * Super-admin → Organizations (tenant registry), restyled to the sadb-*
 * design language (docs/SUPER-ADMIN-DESIGN-PLAN.md § /admin/organizations).
 * The list now mirrors the dashboard's tenant health matrix anatomy
 * (SadbGridList: name+sub, plan, facilities, users, status chip) so the two
 * screens finally rhyme, and every write (create/update/deactivate) gets
 * toast feedback. window.confirm() on deactivate is gone in favor of
 * SadbConfirmModal.
 *
 * The create/edit form itself is the shared OrganizationForm component
 * (2026-08-23) — hosted here in a Modal, and full-page (create only) at
 * /admin/organizations/new, which the modal header's expand button opens.
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useAuth } from '@/lib/context';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import { useToast } from '@/components/Toast';
import type { OrganizationDoc, UserRole } from '@/lib/db-types';
import { Plus, X, Maximize2 } from '@/components/icons/lucide';
import Modal from '@/components/Modal';
import FacilityNetworkView from '@/components/facilities/FacilityNetworkView';

import {
  SadbPage, SadbCard, SadbChip, SadbKpiTile, SadbSearch, SadbGridList, SadbGridRow,
  SadbConfirmModal, statusChip, effectiveOrgStatus,
  SadbPlanChip,
} from '@/components/admin/sadb-ui';

import { OrganizationForm } from '@/components/admin/OrganizationForm';
import type { OrgAdminHandoff } from '@/components/admin/OrganizationForm';

/** Grid: Organization (wide) · Plan · Facilities · Users · Sync · Status. */
// No trailing action gutter: clicking the row opens the organization's own
// page, so the 48px that column held goes back to the name and its counts.
const GRID_TEMPLATE = 'minmax(200px,1.6fr) repeat(5, minmax(96px,1fr))';

/**
 * Who may open this page at all.
 *
 * Inherited from the roles that had /hospitals in their nav before it was
 * deleted, plus the platform operator. `SadbPage` bounces anyone else to their
 * dashboard, and the route table (lib/role-routes.ts) has to agree — the Edge
 * proxy checks that, not this.
 */
const ORGANIZATIONS_PAGE_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'government', 'county_health_director',
  'medical_superintendent', 'hrio', 'hospital_manager', 'records_hmis_officer',
];

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

/**
 * Organizations — who runs what, and the facilities they run.
 *
 * Two views on one page since 2026-08-23, when /hospitals ("Health Facility
 * Performance") was deleted and its network view moved in here. A facility
 * belongs to an organization; keeping the two on separate top-level pages
 * meant leaving the organization you were looking at, opening a national list
 * and filtering your way back to it.
 *
 * Only the platform operator sees the TENANT REGISTRY — the list of every
 * organization on the platform, with plans, seat limits and the create /
 * deactivate controls. Every other role that reaches this page (org admins,
 * superintendents, managers, and the national oversight roles) gets the
 * facility view alone, scoped by `filterByScope` exactly as /hospitals scoped
 * it. Widening the route must never widen what the route shows.
 */
export default function AdminOrganizationsPage() {
  const { currentUser } = useAuth();
  // A structural gate, not a late `return`: the registry's hooks read every
  // organization on the device and fan out a stats query per tenant. Keeping
  // them inside a component that only the platform operator mounts means a
  // facility role never runs that work, and never has the data in hand to
  // render by accident.
  if (currentUser && currentUser.role !== 'super_admin') {
    return (
      <SadbPage roles={ORGANIZATIONS_PAGE_ROLES}>
        <FacilityNetworkView />
      </SadbPage>
    );
  }
  return <TenantRegistryPage />;
}

function TenantRegistryPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser } = useAuth();
  /**
   * A facility-scoped link opens on Facilities, not on the registry.
   *
   * Every `?facility=`, `?new=`, `?state=` and `?county=` link in the product
   * points here since /hospitals was deleted, and the registry is the default
   * view — so without this the whole set of them landed the operator on a list
   * of tenants with their request silently dropped. Read once, at mount: after
   * that the tabs are the operator's to drive.
   */
  const [view, setView] = useState<'organizations' | 'facilities'>(() => {
    if (typeof window === 'undefined') return 'organizations';
    const params = new URLSearchParams(window.location.search);
    // `?view=` names the tab outright. A facility's own page returns here with
    // it, and without this the operator who clicked into a facility from the
    // network list came back to the TENANT registry — a different list, on the
    // other tab, with no way to tell that anything had been dropped.
    const named = params.get('view');
    if (named === 'facilities' || named === 'organizations') return named;
    const facilityScoped = ['facility', 'new', 'state', 'county'].some(k => params.get(k));
    return facilityScoped ? 'facilities' : 'organizations';
  });
  const { showToast } = useToast();
  const { organizations, trashedOrganizations, loading, deactivate, getStats } = useOrganizations();

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
  // The org the form edits — null means the form creates. Only meaningful
  // while showForm is true.
  const [editingOrg, setEditingOrg] = useState<OrganizationDoc | null>(null);
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
  // Credential hand-off for the admin account the form just created — same
  // one-time panel as /admin/users, handed up by OrganizationForm only after
  // both writes succeed. Held here rather than in the form because the form
  // unmounts with its modal the moment it reports success.
  const [handoff, setHandoff] = useState<OrgAdminHandoff | null>(null);

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

  // Opening the modal MOUNTS a fresh OrganizationForm (see `showForm &&`
  // below), so all form seeding — brand-token colours, the generated admin
  // password — happens inside the component, fresh per open.
  const openCreate = () => {
    setEditingOrg(null);
    setShowForm(true);
  };

  // Deep link: /admin/organizations?new=1 opens the create dialog directly
  // (the dashboard's Organizations card "Add" head action) — same pattern as
  // /admin/users, /hospitals and /org-admin/hospitals. Mount-only: the brand
  // defaults it seeds may still be the constants at this point, which is the
  // same fallback resolveCssVarToHex uses.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('new')) openCreate();
     
  }, []);

  // Declared below this effect, so the deep-link handler above reaches it
  // through a ref rather than forcing a reorder of the component.
  const openEditRef = useRef<((org: OrganizationDoc) => void) | null>(null);
  const openEdit = (org: OrganizationDoc) => {
    setEditingOrg(org);
    setShowForm(true);
  };

  // The deep-link handler above calls this through the ref.
  openEditRef.current = openEdit;

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

  return (
    <SadbPage roles={ORGANIZATIONS_PAGE_ROLES}>
      {/* ═══ Organizations · Facilities — the registry and what it runs ═══ */}
      <div className="sadb-viewswitch" role="tablist" aria-label={t('orgAdmin.viewSwitchLabel')}>
        {(['organizations', 'facilities'] as const).map(id => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            className={`sadb-viewswitch-tab${view === id ? ' is-active' : ''}`}
            onClick={() => setView(id)}
          >
            {id === 'organizations' ? t('nav.organizations') : t('orgAdmin.facilities')}
          </button>
        ))}
      </div>

      {view === 'facilities' && <FacilityNetworkView />}

      {view === 'organizations' && <>
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
                <SadbPlanChip plan={org.subscriptionPlan} />
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
      </>}

      {/* Modals belong to the registry view, but stay outside the fragment so
          a handoff or confirm opened there survives a switch to Facilities. */}
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
                {editingOrg ? t('orgAdmin.editOrganization') : t('orgAdmin.createOrganization')}
              </h2>
              <div className="flex items-center gap-1.5">
                {/* Create only: the same form, full-page, wearing the
                    register-patient anatomy — for when the dialog feels
                    cramped. Edit has no page counterpart. */}
                {!editingOrg && (
                  <button
                    type="button"
                    onClick={() => router.push('/admin/organizations/new')}
                    className="p-1.5 rounded-lg"
                    style={{ background: 'var(--overlay-subtle)' }}
                    aria-label={t('orgAdmin.openFullPage')}
                    title={t('orgAdmin.openFullPage')}
                    data-action="org-create-expand"
                  >
                    <Maximize2 className="w-4 h-4" />
                  </button>
                )}
                <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }} aria-label="Close">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <OrganizationForm
              key={editingOrg?._id ?? 'new'}
              editing={editingOrg}
              onCancel={() => setShowForm(false)}
              onSaved={({ handoff: h }) => { setShowForm(false); if (h) setHandoff(h); }}
            />
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
          has actually succeeded (OrganizationForm hands it up via onSaved). */}
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
