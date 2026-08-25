'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Plus, Users } from '@/components/icons/lucide';
import Modal from '@/components/Modal';
import Select from '@/components/Select';
import { useToast } from '@/components/Toast';
import { useApp } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { useUsers } from '@/lib/hooks/useUsers';
import { canCreateFacilities, canCreateUsers } from '@/lib/people-nav';
import { isPathAllowed } from '@/lib/role-routes';
import { activeFacilities } from '@/lib/services/hospital-service';
import { OrganizationForm } from '@/components/admin/OrganizationForm';
import FacilityFormModal from '@/components/admin/FacilityFormModal';
import { CredentialHandoffModal, CreateUserModal } from '@/modules/identity/client';
import {
  SadbCard, SadbChip, SadbConfirmModal, SadbGridList, SadbGridRow, SadbKpiTile, SadbSearch,
  effectiveOrgStatus, statusChip,
} from '@/components/admin/sadb-ui';
import type { UserCredentialHandoff } from '@/components/admin/UserForm';
import type { HospitalDoc, OrganizationDoc } from '@/lib/db-types';
import { managementViewsForRole, TENANCY_WORKSPACE_ROLES, type ManagementView, userWorksAtFacility } from '../index';
import { useAssignableFacilities } from '../hooks/useAssignableFacilities';

/* People first. The console is opened far more often to find a person than
   to audit the tenant tree, and landing on Organizations meant two clicks
   before the common task every time. Organizations and facilities are the
   scope you narrow BY — they stay, one tab over. */
const VIEWS: readonly ManagementView[] = ['people', 'facilities', 'organizations'];

/** One column template for all three lists, so switching section does not
 *  re-flow the row anatomy under the reader. */
/* Even thirds. The columns were weighted 1.7 / .9 / .55, which pushed Scope
   and Status into the left half and left a wide gutter after them; nothing in
   these lists needs that much more room for its name than for its scope. */
const MGMT_GRID = 'minmax(180px, 1fr) minmax(140px, 1fr) minmax(120px, 1fr)';

function initialView(): ManagementView {
  if (typeof window === 'undefined') return 'people';
  const value = new URLSearchParams(window.location.search).get('view');
  // Falls back to the first view, not a hard-coded 'organizations' — the
  // landing tab is VIEWS[0], and pinning the name here is what kept the
  // console opening on Organizations after the order changed.
  return VIEWS.includes(value as ManagementView) ? value as ManagementView : VIEWS[0];
}

/**
 * An organization deactivation awaiting confirmation.
 *
 * Organizations only, and one direction only. A facility is retired and a
 * person is deactivated on their own pages, which is where a row click now
 * lands; bringing a deactivated tenant BACK is the Trash panel's job, since
 * `useOrganizations` keeps trashed tenants out of every console list. What is
 * left here is the confirm the tenant page hands back as
 * `?org=<id>&deactivate=1` — the registry owns that dialog.
 */
interface PendingDeactivation {
  id: string;
  name: string;
}

export default function ManagementWorkspace() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const router = useRouter();
  const { currentUser } = useApp();
  const orgStore = useOrganizations();
  const hospitalStore = useHospitals();
  const userStore = useUsers();
  const [view, setView] = useState<ManagementView>(initialView);
  const [orgId, setOrgId] = useState('');
  const [facilityId, setFacilityId] = useState('');
  const [search, setSearch] = useState('');
  const [showOrgEditor, setShowOrgEditor] = useState(false);
  const [showFacilityEditor, setShowFacilityEditor] = useState(false);
  const [showUserEditor, setShowUserEditor] = useState(false);
  const [editingOrg, setEditingOrg] = useState<OrganizationDoc | null>(null);
  const [editingFacility, setEditingFacility] = useState<HospitalDoc | null>(null);
  const [handoff, setHandoff] = useState<UserCredentialHandoff | null>(null);
  const [pending, setPending] = useState<PendingDeactivation | null>(null);
  const [busy, setBusy] = useState(false);
  const handledDeepLink = useRef(false);
  const seededScope = useRef(false);
  const visibleViews = currentUser ? managementViewsForRole(currentUser.role) : VIEWS;
  const activeView = visibleViews.includes(view) ? view : (visibleViews[0] ?? 'facilities');

  const organizations = useMemo(() => {
    if (orgStore.organizations.length) return orgStore.organizations;
    return currentUser?.organization ? [currentUser.organization] : [];
  }, [currentUser, orgStore.organizations]);

  /* Seed the working scope ONCE. This used to re-assert it on every run, and
     `organizations` gets a new identity each time the store ticks — so
     choosing "All organizations" set the empty string and the next tick put
     the user's own organization straight back. The rail's first option was
     unpickable. */
  useEffect(() => {
    if (!currentUser || seededScope.current) return;
    const params = new URLSearchParams(window.location.search);
    const seed = params.get('org') || currentUser.orgId || organizations[0]?._id || '';
    if (!seed) return; // the organization store has not answered yet
    seededScope.current = true;
    setOrgId(current => current || seed);
    const requestedFacility = params.get('facility');
    if (requestedFacility) setFacilityId(current => current || requestedFacility);
  }, [currentUser, organizations]);

  const selectedOrg = organizations.find(org => org._id === orgId) ?? null;
  const facilities = useMemo(
    () => activeFacilities(hospitalStore.hospitals.filter(hospital => !orgId || hospital.orgId === orgId)),
    [hospitalStore.hospitals, orgId],
  );
  const selectedFacility = facilities.find(facility => facility._id === facilityId) ?? null;
  const mayCreatePeople = canCreateUsers(currentUser?.role ?? '');
  const {
    facilities: assignableFacilities,
    reload: reloadAssignableFacilities,
  } = useAssignableFacilities(orgId, mayCreatePeople);
  const people = useMemo(() => userStore.users.filter(user => {
    if (orgId && user.orgId !== orgId) return false;
    if (facilityId && !userWorksAtFacility(user, facilityId)) return false;
    return true;
  }), [facilityId, orgId, userStore.users]);

  /* Deactivated accounts stay in the People list wearing a chip, so the tile
     states how many before you scroll. There is no organization equivalent:
     `useOrganizations` takes a deactivated tenant out of every console list
     and into the Trash panel, so this registry never holds one to count. */
  const inactivePeople = people.filter(user => user.isActive === false).length;

  /* Every list answers the scope chosen on the search row, the People list
     included: pick an organization and the Organizations list is that
     organization, pick a facility and the Facilities list is that facility. `organizations` and
     `facilities` stay whole above this line because they are what the two
     scope selects offer — narrowing them there would strand you on the current
     choice with nothing else to pick. */
  const scopedOrganizations = orgId ? organizations.filter(org => org._id === orgId) : organizations;
  const scopedFacilities = facilityId ? facilities.filter(facility => facility._id === facilityId) : facilities;

  const query = search.trim().toLowerCase();
  const filteredOrganizations = scopedOrganizations.filter(org => !query
    || org.name.toLowerCase().includes(query)
    || org.slug.toLowerCase().includes(query));
  const filteredFacilities = scopedFacilities.filter(facility => !query
    || facility.name.toLowerCase().includes(query)
    || facility.state.toLowerCase().includes(query)
    || (facility.town ?? '').toLowerCase().includes(query));
  const filteredPeople = people.filter(user => !query
    || user.name.toLowerCase().includes(query)
    || user.username.toLowerCase().includes(query)
    || user.role.toLowerCase().includes(query));

  useEffect(() => {
    if (handledDeepLink.current || !currentUser || (activeView !== 'organizations' && !orgId)) return;
    const params = new URLSearchParams(window.location.search);
    /* ?edit / ?deactivate name a RECORD, so they cannot be answered until the
       organization store has produced one. Consuming the deep link against an
       empty list would set `handledDeepLink` and the effect would never look
       again — which is exactly how the link arrived here doing nothing. Once
       the store has answered, an id that still matches nothing falls through
       rather than blocking `q` and `new` forever. */
    const scopedOrg = organizations.find(org => org._id === (params.get('org') || orgId));
    const wantsOrgAction = params.has('edit') || params.has('deactivate');
    if (wantsOrgAction && !scopedOrg && !organizations.length) return;
    const q = params.get('q');
    if (q) setSearch(q);
    if (params.has('new')) {
      if (activeView === 'organizations' && currentUser.role === 'super_admin') setShowOrgEditor(true);
      if (activeView === 'facilities' && canCreateFacilities(currentUser.role)) setShowFacilityEditor(true);
      if (activeView === 'people' && canCreateUsers(currentUser.role)) setShowUserEditor(true);
    }
    /* ?edit=1 / ?deactivate=1 on a scoped organization — the hand-off the
       tenant page's own two buttons make. Both need the organization to have
       resolved, which the `orgId` guard above already waits for. */
    if (scopedOrg && currentUser.role === 'super_admin') {
      if (params.has('edit')) { setEditingOrg(scopedOrg); setShowOrgEditor(true); }
      else if (params.has('deactivate') && scopedOrg.isActive !== false) {
        setPending({ id: scopedOrg._id, name: scopedOrg.name });
      }
    }
    const userId = params.get('user');
    if (userId && canCreateUsers(currentUser.role)) {
      router.replace(`/admin/users/${encodeURIComponent(userId)}?returnTo=${encodeURIComponent('/manage?view=people')}`);
    }
    handledDeepLink.current = true;
  }, [activeView, currentUser, orgId, organizations, router]);

  const changeView = (next: ManagementView) => {
    setView(next);
    const params = new URLSearchParams();
    params.set('view', next);
    if (orgId) params.set('org', orgId);
    if (facilityId) params.set('facility', facilityId);
    router.replace(`/manage?${params.toString()}`, { scroll: false });
  };

  if (!currentUser || !TENANCY_WORKSPACE_ROLES.includes(currentUser.role)) return null;

  const canAddOrganization = currentUser.role === 'super_admin' && activeView === 'organizations';
  const canAddFacility = canCreateFacilities(currentUser.role) && activeView === 'facilities' && !!orgId;
  const canAddPerson = canCreateUsers(currentUser.role) && activeView === 'people' && !!orgId;
  const openPrimaryAction = () => {
    if (canAddOrganization) { setEditingOrg(null); setShowOrgEditor(true); }
    if (canAddFacility) { setEditingFacility(null); setShowFacilityEditor(true); }
    if (canAddPerson) setShowUserEditor(true);
  };
  const showPrimaryAction = canAddOrganization || canAddFacility || canAddPerson;

  /* ── Opening a record ─────────────────────────────────────────────────
     A row click opens the record's own page. It used to open a menu at the
     pointer — edit, drill down, deactivate, open full page — which put five
     choices in front of an operator whose click already said which record
     they meant, and buried the page that answers the question behind one of
     them. Everything that menu offered lives on the page the row now opens:
     each detail page carries its own edit and its own deactivate.

     A role whose allow-list has no such page gets a row that does not
     pretend to be clickable, rather than a link the Edge proxy bounces
     straight back to its dashboard. */
  const opensRecord = (base: string) => isPathAllowed(currentUser.role, base);
  const openRecord = (href: string) => () => router.push(href);
  const organizationHref = (org: OrganizationDoc) => `/admin/organizations/${encodeURIComponent(org._id)}`;
  const facilityHref = (facility: HospitalDoc) => `/admin/facilities/${encodeURIComponent(facility._id)}`;
  /* `returnTo` so Save on the person's page comes back to this list rather
     than to the console the page itself belongs to. */
  const personHref = (userId: string) =>
    `/admin/users/${encodeURIComponent(userId)}?returnTo=${encodeURIComponent('/manage?view=people')}`;

  /** Runs the confirmed deactivation and reloads the list it changed. */
  const runPending = async () => {
    if (!pending || busy) return;
    setBusy(true);
    try {
      await orgStore.deactivate(pending.id, currentUser._id, currentUser.username);
      showToast(t('management.toastDeactivated', { name: pending.name }), 'success');
      setPending(null);
    } catch (error) {
      console.error('Management status change failed:', error);
      showToast(t('management.actionFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };


  return (
    <main className="page-container page-enter sadb-scope mgmt-shell">
      <div className="sadb-page">
        {/* ═══ Scope vitals — what this organization and facility scope holds,
            one tile per section so the number and the list it counts are the
            same click. The tiles answer the scope, not the query: typing in
            the search below narrows the rows, never the totals above them. ═══ */}
        <div className="sadb-kpi-row">
          {visibleViews.includes('organizations') && (
            <SadbKpiTile
              label={t('management.organizations')}
              value={organizations.length}
              onClick={activeView === 'organizations' ? undefined : () => changeView('organizations')}
            />
          )}
          <SadbKpiTile
            label={t('management.facilities')}
            value={facilities.length}
            delta={selectedOrg?.name ?? (currentUser.role === 'super_admin' ? t('management.allOrganizations') : undefined)}
            onClick={activeView === 'facilities' ? undefined : () => changeView('facilities')}
          />
          {visibleViews.includes('people') && (
            <SadbKpiTile
              label={t('management.people')}
              value={people.length}
              delta={inactivePeople > 0 ? t('management.kpiInactive', { count: inactivePeople }) : undefined}
              deltaTone={inactivePeople > 0 ? 'warn' : undefined}
              onClick={activeView === 'people' ? undefined : () => changeView('people')}
            />
          )}
        </div>

        <div className="mgmt-main-bar">
          <nav className="mgmt-tabs" aria-label={t('management.viewsLabel')}>
            {visibleViews.map(item => (
              <button key={item} type="button" data-tour={`manage-tab-${item}`} className={activeView === item ? 'active' : undefined} onClick={() => changeView(item)}>
                {item === 'organizations' ? <Building2 /> : item === 'facilities' ? <Building2 /> : <Users />}
                {t(`management.${item}`)}
              </button>
            ))}
          </nav>
          <div className="mgmt-main-actions">
            {activeView === 'organizations' && selectedOrg && currentUser.role === 'super_admin' && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setEditingOrg(selectedOrg); setShowOrgEditor(true); }}>
                {t('management.editOrganization')}
              </button>
            )}
            {activeView === 'facilities' && selectedFacility && canCreateFacilities(currentUser.role) && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setEditingFacility(selectedFacility); setShowFacilityEditor(true); }}>
                {t('management.editFacility')}
              </button>
            )}
            {showPrimaryAction && (
              <button type="button" className="btn btn-primary btn-sm" onClick={openPrimaryAction} data-tour={activeView === 'facilities' ? 'org-hospitals-add' : activeView === 'people' ? 'org-users-create-btn' : undefined}>
                <Plus className="w-4 h-4" /> {activeView === 'organizations'
                  ? t('management.addOrganization')
                  : activeView === 'facilities' ? t('management.addFacility') : t('management.addPerson')}
              </button>
            )}
          </div>
        </div>

        <SadbCard>
          {/* The scope sits on the search row, beside the field it narrows —
              one line saying WHICH records and WHICH OF THOSE, rather than a
              rail holding the first half a column away from the second.
              Organization appears only where there is more than one to pick;
              every other role is already inside exactly one. */}
          <div className="sadb-search-row">
            <SadbSearch value={search} onChange={setSearch} placeholder={t('management.searchPlaceholder')} ariaLabel={t('management.search')} />
            {currentUser.role === 'super_admin' && (
              <Select
                className="mgmt-scope-select"
                value={orgId}
                onChange={event => { setOrgId(event.target.value); setFacilityId(''); }}
                aria-label={t('management.organizationField')}
              >
                <option value="">{t('management.allOrganizations')}</option>
                {organizations.map(org => <option key={org._id} value={org._id}>{org.name}</option>)}
              </Select>
            )}
            {/* A facility narrows the facilities and people lists; on the
                organizations list there is nothing for it to narrow. */}
            {activeView !== 'organizations' && (
              <Select
                className="mgmt-scope-select"
                value={facilityId}
                onChange={event => setFacilityId(event.target.value)}
                disabled={!orgId}
                aria-label={t('management.facilityField')}
              >
                <option value="">{t('management.allFacilities')}</option>
                {facilities.map(facility => <option key={facility._id} value={facility._id}>{facility.name}</option>)}
              </Select>
            )}
          </div>

          <div data-tour={activeView === 'facilities' ? 'org-hospitals-table' : activeView === 'people' ? 'org-users-list' : undefined}>
              <SadbGridList
                template={MGMT_GRID}
                minWidth={620}
                head={[
                  activeView === 'people' ? t('management.person') : t('management.name'),
                  t('management.scope'),
                  t('management.status'),
                ]}
                alignEndLast
                empty={t('management.empty')}
              >
                {activeView === 'organizations' && filteredOrganizations.map(org => {
                  const status = effectiveOrgStatus(org);
                  return (
                    <SadbGridRow key={org._id} template={MGMT_GRID} onClick={opensRecord('/admin/organizations') ? openRecord(organizationHref(org)) : undefined}>
                      <span className="min-w-0">
                        <span className="sadb-tenant-name truncate">{org.name}</span>
                        <span className="sadb-tenant-sub truncate">{org.slug}</span>
                      </span>
                      <span className="truncate">{org.orgType}</span>
                      <span style={{ textAlign: 'end' }}><SadbChip tone={statusChip(status)}>{status}</SadbChip></span>
                    </SadbGridRow>
                  );
                })}
                {activeView === 'facilities' && filteredFacilities.map(facility => (
                  <SadbGridRow key={facility._id} template={MGMT_GRID} onClick={opensRecord('/admin/facilities') ? openRecord(facilityHref(facility)) : undefined}>
                    <span className="min-w-0">
                      <span className="sadb-tenant-name truncate">{facility.name}</span>
                      <span className="sadb-tenant-sub truncate">{[facility.town, facility.state].filter(Boolean).join(', ')}</span>
                    </span>
                    <span className="truncate">{facility.facilityType}</span>
                    <span style={{ textAlign: 'end' }}><SadbChip tone="green">{t('management.active')}</SadbChip></span>
                  </SadbGridRow>
                ))}
                {activeView === 'people' && filteredPeople.map(user => {
                  const inactive = user.isActive === false;
                  return (
                    <SadbGridRow key={user._id} template={MGMT_GRID} onClick={opensRecord('/admin/users') ? openRecord(personHref(user._id)) : undefined}>
                      <span className="min-w-0">
                        <span className="sadb-tenant-name truncate">{user.name}</span>
                        <span className="sadb-tenant-sub truncate">@{user.username}</span>
                      </span>
                      <span className="truncate">{user.hospitalName ?? user.orgName ?? t('management.organizationWide')}</span>
                      <span style={{ textAlign: 'end' }}>
                        <SadbChip tone={inactive ? 'neutral' : 'green'}>
                          {inactive ? t('management.inactive') : t('management.active')}
                        </SadbChip>
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
            <h2 id="management-org-editor" className="sadb-modal-title">{editingOrg ? t('management.editOrganization') : t('management.addOrganization')}</h2>
            <OrganizationForm editing={editingOrg} onCancel={() => setShowOrgEditor(false)} onSaved={() => { setShowOrgEditor(false); void orgStore.reload(); }} />
          </div>
        </Modal>
      )}
      {showFacilityEditor && (
        <FacilityFormModal
          facility={editingFacility ?? undefined}
          orgId={orgId || undefined}
          organizations={organizations}
          actor={{ _id: currentUser._id, username: currentUser.username }}
          onClose={() => setShowFacilityEditor(false)}
          onSaved={async hospital => {
            const wasEditing = !!editingFacility;
            setShowFacilityEditor(false);
            setEditingFacility(null);
            await hospitalStore.reload();
            if (!wasEditing && mayCreatePeople) {
              // Continue the setup journey at the record just created. The
              // facility write is already on the server, so refresh the
              // authoritative assignment picker before opening the account
              // form; otherwise its stale list drops the preset and the user
              // creation fails with a misleading facility error.
              setOrgId(hospital.orgId || orgId);
              setFacilityId(hospital._id);
              setView('people');
              router.replace(`/manage?view=people&org=${encodeURIComponent(hospital.orgId || orgId)}&facility=${encodeURIComponent(hospital._id)}`, { scroll: false });
              await reloadAssignableFacilities();
              setShowUserEditor(true);
            }
          }}
        />
      )}
      {showUserEditor && (
        <CreateUserModal
          hospitals={assignableFacilities}
          presetOrgId={orgId || undefined}
          presetHospitalId={selectedFacility?._id}
          lockFacility={!!selectedFacility}
          onClose={() => setShowUserEditor(false)}
          onCreated={credentials => { setShowUserEditor(false); setHandoff(credentials); void userStore.reload(); }}
          onAddFacility={() => { setShowUserEditor(false); setShowFacilityEditor(true); }}
        />
      )}

      {pending && (
        <SadbConfirmModal
          title={t('management.confirmDeactivateTitle', { name: pending.name })}
          body={t('management.confirmDeactivateOrg')}
          confirmLabel={t('management.deactivate')}
          busy={busy}
          onCancel={() => { if (!busy) setPending(null); }}
          onConfirm={() => { void runPending(); }}
        />
      )}

      {handoff && (
        <CredentialHandoffModal
          title={t('adminUsers.handoffCreatedTitle')}
          description={t('adminUsers.handoffDescription')}
          {...handoff}
          onClose={() => setHandoff(null)}
        />
      )}
    </main>
  );
}
