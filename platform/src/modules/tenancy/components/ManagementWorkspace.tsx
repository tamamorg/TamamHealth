'use client';

/**
 * THE CONSOLE ROOT — the top of one drill-down, not three flat lists.
 *
 * This was a workspace of three sibling tabs (People · Facilities ·
 * Organizations) over two scope dropdowns. Every list was a peer of every
 * other, which is a flat answer to a question that is not flat: a facility
 * belongs to an organization and a person works at a facility. Getting from a
 * tenant to its sites meant changing tab and re-narrowing a dropdown; nothing
 * on an organization row said it HAD facilities, let alone offered them.
 *
 * The chain is now literal, and each rung lists the one below it:
 *
 *   /manage                      organizations
 *   /admin/organizations/[id]    one organization → its facilities, its people
 *   /admin/facilities/[id]       one facility → its staff, its wards, its stock
 *   /admin/users/[id]            one person
 *
 * A role that can only ever see its own tenant has no list of one to choose
 * from, so `/manage` renders their organization's page directly
 * (`managementRootForRole`) — same component, one rung shorter.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from '@/components/icons/lucide';
import Modal from '@/components/Modal';
import PopupHeader from '@/components/PopupHeader';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { useUsers } from '@/lib/hooks/useUsers';
import { activeFacilities } from '@/lib/services/hospital-service';
import { isPathAllowed } from '@/lib/role-routes';
import { OrganizationForm } from '@/components/admin/OrganizationForm';
import FacilityFormModal from '@/components/admin/FacilityFormModal';
import {
  SadbCard, SadbChip, SadbGridList, SadbGridRow, SadbKpiTile, SadbSearch,
  effectiveOrgStatus, statusChip,
} from '@/components/admin/sadb-ui';
import type { OrganizationDoc } from '@/lib/db-types';
import {
  canPerformTenancyAction, managementRootForRole, TENANCY_WORKSPACE_ROLES,
} from '../index';
import OrganizationDetail from './OrganizationDetail';

/* Organization · Type · Facilities · People · Status. The two counts are the
   whole point of the row: they say there is something underneath to open. */
const ORG_GRID = 'minmax(200px, 1.7fr) minmax(110px, 0.8fr) minmax(90px, 0.6fr) minmax(90px, 0.6fr) minmax(90px, 0.6fr)';

export default function ManagementWorkspace() {
  const { currentUser } = useAuth();
  if (!currentUser || !TENANCY_WORKSPACE_ROLES.includes(currentUser.role)) return null;
  const root = managementRootForRole(currentUser.role);
  if (root === 'organization') {
    /* One tenant, so the registry above it would be a list with one row.
       `orgId` is guaranteed for these roles by `filterByScope` — a session
       without one sees nothing anywhere in the product. */
    return (
      <main className="page-container page-enter sadb-scope mgmt-shell">
        <div className="sadb-page">
          <OrganizationDetail orgId={currentUser.orgId ?? ''} hostedAt="/manage" />
        </div>
      </main>
    );
  }
  return <OrganizationRegistry />;
}

/** Every tenant on the platform — the rung above `OrganizationDetail`. */
function OrganizationRegistry() {
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser } = useAuth();
  const orgStore = useOrganizations();
  const hospitalStore = useHospitals();
  const userStore = useUsers();

  const [search, setSearch] = useState('');
  const [showOrgEditor, setShowOrgEditor] = useState(false);
  const [showFacilityEditor, setShowFacilityEditor] = useState(false);
  const [deepLinkDone, setDeepLinkDone] = useState(false);

  const role = currentUser?.role;
  const may = useCallback(
    (action: Parameters<typeof canPerformTenancyAction>[1]) => !!role && canPerformTenancyAction(role, action),
    [role],
  );

  const organizations = orgStore.organizations;
  const facilities = useMemo(() => activeFacilities(hospitalStore.hospitals), [hospitalStore.hospitals]);

  /* Counts per tenant in one pass — a row that cannot say how many sites and
     accounts sit under it gives the operator no reason to open it. */
  const rollup = useMemo(() => {
    const counts = new Map<string, { facilities: number; people: number }>();
    const bump = (orgId: string | undefined, key: 'facilities' | 'people') => {
      if (!orgId) return;
      const entry = counts.get(orgId) ?? { facilities: 0, people: 0 };
      entry[key] += 1;
      counts.set(orgId, entry);
    };
    for (const facility of facilities) bump(facility.orgId, 'facilities');
    for (const user of userStore.users) bump(user.orgId, 'people');
    return counts;
  }, [facilities, userStore.users]);

  /* ── Deep links the top rail's Add menu and the work queue emit ──────
     Read once on mount; re-reading would reopen a dialog just dismissed. */
  useEffect(() => {
    if (deepLinkDone || !currentUser) return;
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    if (q) setSearch(q);
    /* A person is a record three rungs down, so `?user=<id>` cannot be
       answered by a list of tenants — it goes straight to the account. */
    const userId = params.get('user');
    if (userId) {
      router.replace(`/admin/users/${encodeURIComponent(userId)}?returnTo=${encodeURIComponent('/manage')}`);
      setDeepLinkDone(true);
      return;
    }
    const wants = params.get('new');
    if (wants === 'organization' && may('organization:create')) setShowOrgEditor(true);
    /* A facility needs an owning tenant, which the dialog asks for here. An
       ACCOUNT needs an owning facility as well as a tenant, which is more
       than a dialog should ask standing at the top of the tree — the full
       form owns that, and comes back here when it is done. */
    if (wants === 'facility' && may('facility:create')) setShowFacilityEditor(true);
    if (wants === 'user' && may('person:create')) {
      router.push(`/admin/users/new?returnTo=${encodeURIComponent('/manage')}`);
    }
    setDeepLinkDone(true);
  }, [currentUser, deepLinkDone, may, router]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return organizations;
    return organizations.filter(org => org.name.toLowerCase().includes(query)
      || org.slug.toLowerCase().includes(query));
  }, [organizations, search]);

  if (!currentUser) return null;

  /* A role whose allow-list has no tenant page gets a row that does not
     pretend to be clickable, rather than a link the Edge proxy bounces
     straight back to its dashboard. */
  const opensRecord = isPathAllowed(currentUser.role, '/admin/organizations');
  const organizationHref = (org: OrganizationDoc) => `/admin/organizations/${encodeURIComponent(org._id)}`;

  return (
    <main className="page-container page-enter sadb-scope mgmt-shell">
      <div className="sadb-page">
        {/* What the platform holds, in total — context for the list, not
            navigation. The tiles used to switch tab; there are no tabs. */}
        <div className="sadb-kpi-row">
          <SadbKpiTile label={t('management.organizations')} value={organizations.length} />
          <SadbKpiTile label={t('management.facilities')} value={facilities.length} />
          {may('person:view') && (
            <SadbKpiTile label={t('management.people')} value={userStore.users.length} />
          )}
        </div>

        <SadbCard
          title={t('management.organizations')}
          meta={t('management.showingOf', { shown: filtered.length, total: organizations.length })}
          action={may('organization:create') ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              data-tour="manage-add-organization"
              onClick={() => setShowOrgEditor(true)}
            >
              <Plus className="w-4 h-4" /> {t('management.addOrganization')}
            </button>
          ) : undefined}
        >
          <div className="sadb-search-row" style={{ paddingBottom: 12 }}>
            <SadbSearch
              value={search}
              onChange={setSearch}
              placeholder={t('management.searchOrganizations')}
              ariaLabel={t('management.searchOrganizations')}
            />
          </div>

          <div data-tour="manage-organizations-list">
            <SadbGridList
              template={ORG_GRID}
              minWidth={720}
              head={[
                t('management.name'),
                t('management.scope'),
                t('management.facilities'),
                t('management.people'),
                t('management.status'),
              ]}
              alignEndLast
              empty={orgStore.loading ? t('orgAdmin.loading') : t('management.empty')}
            >
              {filtered.map(org => {
                const status = effectiveOrgStatus(org);
                const counts = rollup.get(org._id) ?? { facilities: 0, people: 0 };
                return (
                  <SadbGridRow
                    key={org._id}
                    template={ORG_GRID}
                    onClick={opensRecord ? () => router.push(organizationHref(org)) : undefined}
                  >
                    <span className="min-w-0">
                      <span className="sadb-tenant-name truncate">{org.name}</span>
                      <span className="sadb-tenant-sub truncate">{org.slug}</span>
                    </span>
                    <span className="truncate">{org.orgType}</span>
                    <span className="truncate">{counts.facilities}</span>
                    <span className="truncate">{may('person:view') ? counts.people : '—'}</span>
                    <span style={{ textAlign: 'end' }}>
                      <SadbChip tone={statusChip(status)}>{status}</SadbChip>
                    </span>
                  </SadbGridRow>
                );
              })}
            </SadbGridList>
          </div>
        </SadbCard>
      </div>

      {showOrgEditor && (
        <Modal onClose={() => setShowOrgEditor(false)} width={920} labelledBy="management-org-editor">
          <div className="sadb-modal mgmt-form-modal">
            <PopupHeader
              titleId="management-org-editor"
              title={t('management.addOrganization')}
              onClose={() => setShowOrgEditor(false)}
              onExpand={() => { setShowOrgEditor(false); router.push('/admin/organizations/new'); }}
            />
            <OrganizationForm
              editing={null}
              onCancel={() => setShowOrgEditor(false)}
              onSaved={() => { setShowOrgEditor(false); void orgStore.reload(); }}
            />
          </div>
        </Modal>
      )}

      {showFacilityEditor && (
        <FacilityFormModal
          organizations={organizations}
          actor={{ _id: currentUser._id, username: currentUser.username }}
          onClose={() => setShowFacilityEditor(false)}
          onSaved={async facility => {
            setShowFacilityEditor(false);
            await hospitalStore.reload();
            /* Land ON the tenant the new site belongs to, with its own
               roster and the account form one button away — the level the
               operator is now working at. */
            router.push(`/admin/organizations/${encodeURIComponent(facility.orgId ?? '')}?facility=${encodeURIComponent(facility._id)}&new=user`);
          }}
        />
      )}
    </main>
  );
}
