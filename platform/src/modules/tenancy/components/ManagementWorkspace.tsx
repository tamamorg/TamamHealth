'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, Building2, Maximize2, Pencil, Plus, RotateCcw, Users } from '@/components/icons/lucide';
import Modal from '@/components/Modal';
import Select from '@/components/Select';
import RowActionsPopup, { rowActionsAt, type RowActionsPopupState } from '@/components/RowActionsPopup';
import type { RowAction } from '@/components/RowActionsMenu';
import { useToast } from '@/components/Toast';
import { useApp } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { useUsers } from '@/lib/hooks/useUsers';
import { canCreateFacilities, canCreateUsers } from '@/lib/people-nav';
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

const VIEWS: readonly ManagementView[] = ['organizations', 'facilities', 'people'];

/** One column template for all three lists, so switching section does not
 *  re-flow the row anatomy under the reader. */
const MGMT_GRID = 'minmax(220px, 1.7fr) minmax(130px, .9fr) minmax(96px, .55fr)';

function initialView(): ManagementView {
  if (typeof window === 'undefined') return 'organizations';
  const value = new URLSearchParams(window.location.search).get('view');
  return VIEWS.includes(value as ManagementView) ? value as ManagementView : 'organizations';
}

/** A deactivate/reactivate awaiting confirmation. `active` is the record's
 *  state NOW, so the pending action is the opposite of it. */
interface PendingStatusChange {
  kind: 'organization' | 'facility' | 'person';
  id: string;
  name: string;
  active: boolean;
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
  /* One menu for the whole list — see RowActionsPopup: the open row and its
     anchor are a single piece of page state, not one portal per row. */
  const [rowMenu, setRowMenu] = useState<RowActionsPopupState | null>(null);
  const [pending, setPending] = useState<PendingStatusChange | null>(null);
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

  /* What the tiles above the list count. Deactivated records stay in both
     lists — the tile is where their number is stated, so a scope with dormant
     accounts in it says so before you scroll. */
  const inactiveOrganizations = organizations.filter(org => org.isActive === false).length;
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
        setPending({ kind: 'organization', id: scopedOrg._id, name: scopedOrg.name, active: true });
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

  /* ── Row actions ──────────────────────────────────────────────────────
     Clicking a row opens these at the pointer rather than doing one thing
     silently. Drilling down used to BE the row click, which left the two
     registries with no CRUD at all: an organization row jumped to Facilities
     and a facility row to People, and editing either meant finding the button
     in the bar above. Now the drill-down is one entry among the actions, so
     nothing is lost and Edit/Deactivate are reachable from the record itself.

     Each list gates on the same permission its existing bar button uses, so
     the menu never offers what the toolbar would have refused. */
  const mayEditOrganizations = currentUser.role === 'super_admin';
  const mayEditFacilities = canCreateFacilities(currentUser.role);
  const mayEditPeople = mayCreatePeople;

  const scopeTo = (view: ManagementView, org: string, facility = '') => {
    setOrgId(org);
    setFacilityId(facility);
    setView(view);
    const params = new URLSearchParams({ view });
    if (org) params.set('org', org);
    if (facility) params.set('facility', facility);
    router.replace(`/manage?${params.toString()}`, { scroll: false });
  };

  const organizationActions = (org: OrganizationDoc): RowAction[] => {
    const active = org.isActive !== false;
    return [
      ...(mayEditOrganizations ? [{
        key: 'edit', label: t('management.editOrganization'), icon: <Pencil className="w-4 h-4" />,
        onClick: () => { setEditingOrg(org); setShowOrgEditor(true); },
      }] : []),
      ...(visibleViews.includes('facilities') ? [{
        key: 'facilities', label: t('management.viewFacilities'), icon: <Building2 className="w-4 h-4" />,
        onClick: () => scopeTo('facilities', org._id),
      }] : []),
      ...(visibleViews.includes('people') ? [{
        key: 'people', label: t('management.viewPeople'), icon: <Users className="w-4 h-4" />,
        onClick: () => scopeTo('people', org._id),
      }] : []),
      {
        key: 'open', label: t('management.openFullPage'), icon: <Maximize2 className="w-4 h-4" />,
        onClick: () => router.push(`/admin/organizations/${encodeURIComponent(org._id)}`),
      },
      ...(mayEditOrganizations ? [{
        key: 'status',
        label: active ? t('management.deactivate') : t('management.reactivate'),
        tone: (active ? 'danger' : 'success') as RowAction['tone'],
        icon: active ? <Ban className="w-4 h-4" /> : <RotateCcw className="w-4 h-4" />,
        onClick: () => setPending({ kind: 'organization', id: org._id, name: org.name, active }),
      }] : []),
    ];
  };

  const facilityActions = (facility: HospitalDoc): RowAction[] => [
    ...(mayEditFacilities ? [{
      key: 'edit', label: t('management.editFacility'), icon: <Pencil className="w-4 h-4" />,
      onClick: () => { setEditingFacility(facility); setShowFacilityEditor(true); },
    }] : []),
    ...(visibleViews.includes('people') ? [{
      key: 'people', label: t('management.viewPeople'), icon: <Users className="w-4 h-4" />,
      onClick: () => scopeTo('people', facility.orgId ?? orgId, facility._id),
    }] : []),
    {
      key: 'open', label: t('management.openFullPage'), icon: <Maximize2 className="w-4 h-4" />,
      onClick: () => router.push(`/admin/facilities/${encodeURIComponent(facility._id)}`),
    },
    /* Deactivate only, never reactivate: this list is `activeFacilities`, so a
       retired facility is not in it to be picked. Bringing one back is the
       facility page's job. */
    ...(mayEditFacilities ? [{
      key: 'status', label: t('management.deactivate'), tone: 'danger' as const,
      icon: <Ban className="w-4 h-4" />,
      onClick: () => setPending({ kind: 'facility', id: facility._id, name: facility.name, active: true }),
    }] : []),
  ];

  const personActions = (user: typeof people[number]): RowAction[] => {
    const active = user.isActive !== false;
    /* Deactivating yourself would end the session doing it. */
    const isSelf = user._id === currentUser._id;
    return [
      {
        key: 'open',
        label: mayEditPeople ? t('management.editPerson') : t('management.openFullPage'),
        icon: mayEditPeople ? <Pencil className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />,
        onClick: () => router.push(`/admin/users/${encodeURIComponent(user._id)}?returnTo=${encodeURIComponent('/manage?view=people')}`),
      },
      ...(mayEditPeople && !isSelf ? [{
        key: 'status',
        label: active ? t('management.deactivate') : t('management.reactivate'),
        tone: (active ? 'danger' : 'success') as RowAction['tone'],
        icon: active ? <Ban className="w-4 h-4" /> : <RotateCcw className="w-4 h-4" />,
        onClick: () => setPending({ kind: 'person', id: user._id, name: user.name, active }),
      }] : []),
    ];
  };

  /** Runs the confirmed deactivate/reactivate and reloads the list it changed. */
  const runPending = async () => {
    if (!pending || busy) return;
    setBusy(true);
    try {
      if (pending.kind === 'organization') {
        if (pending.active) await orgStore.deactivate(pending.id, currentUser._id, currentUser.username);
        else await orgStore.restore(pending.id, currentUser._id, currentUser.username);
      } else if (pending.kind === 'facility') {
        const { setFacilityActive } = await import('@/lib/services/hospital-service');
        await setFacilityActive(pending.id, false, currentUser._id, currentUser.username);
        await hospitalStore.reload();
      } else {
        if (pending.active) await userStore.deactivate(pending.id, currentUser._id, currentUser.username);
        else await userStore.reactivate(pending.id, currentUser._id, currentUser.username);
      }
      showToast(
        t(pending.active ? 'management.toastDeactivated' : 'management.toastReactivated', { name: pending.name }),
        'success',
      );
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
              delta={inactiveOrganizations > 0 ? t('management.kpiInactive', { count: inactiveOrganizations }) : undefined}
              deltaTone={inactiveOrganizations > 0 ? 'warn' : undefined}
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
                    <SadbGridRow key={org._id} template={MGMT_GRID} onClick={event => setRowMenu(rowActionsAt(event, organizationActions(org)))}>
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
                  <SadbGridRow key={facility._id} template={MGMT_GRID} onClick={event => setRowMenu(rowActionsAt(event, facilityActions(facility)))}>
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
                    <SadbGridRow key={user._id} template={MGMT_GRID} onClick={event => setRowMenu(rowActionsAt(event, personActions(user)))}>
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
      <RowActionsPopup state={rowMenu} onClose={() => setRowMenu(null)} />

      {pending && (
        <SadbConfirmModal
          title={t(pending.active ? 'management.confirmDeactivateTitle' : 'management.confirmReactivateTitle', { name: pending.name })}
          body={pending.active
            ? t(`management.confirmDeactivate${pending.kind === 'organization' ? 'Org' : pending.kind === 'facility' ? 'Facility' : 'Person'}`)
            : t('management.confirmReactivateBody')}
          confirmLabel={pending.active ? t('management.deactivate') : t('management.reactivate')}
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
