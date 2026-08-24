'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Plus, Users } from '@/components/icons/lucide';
import Modal from '@/components/Modal';
import { useApp } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { useUsers } from '@/lib/hooks/useUsers';
import { canCreateFacilities, canCreateUsers } from '@/lib/people-nav';
import { activeFacilities } from '@/lib/services/hospital-service';
import { OrganizationForm } from '@/components/admin/OrganizationForm';
import FacilityFormModal from '@/components/admin/FacilityFormModal';
import { AccountRequestQueue, CredentialHandoffModal, CreateUserModal } from '@/modules/identity/client';
import {
  SadbCard, SadbChip, SadbGridList, SadbGridRow, SadbSearch,
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

function initialPeopleMode(): 'staff' | 'requests' {
  if (typeof window === 'undefined') return 'staff';
  return new URLSearchParams(window.location.search).get('tab') === 'requests' ? 'requests' : 'staff';
}

export default function ManagementWorkspace() {
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser } = useApp();
  const orgStore = useOrganizations();
  const hospitalStore = useHospitals();
  const userStore = useUsers();
  const [view, setView] = useState<ManagementView>(initialView);
  const [peopleMode, setPeopleMode] = useState<'staff' | 'requests'>(initialPeopleMode);
  const [orgId, setOrgId] = useState('');
  const [facilityId, setFacilityId] = useState('');
  const [search, setSearch] = useState('');
  const [showOrgEditor, setShowOrgEditor] = useState(false);
  const [showFacilityEditor, setShowFacilityEditor] = useState(false);
  const [showUserEditor, setShowUserEditor] = useState(false);
  const [editingOrg, setEditingOrg] = useState<OrganizationDoc | null>(null);
  const [editingFacility, setEditingFacility] = useState<HospitalDoc | null>(null);
  const [handoff, setHandoff] = useState<UserCredentialHandoff | null>(null);
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
  const { facilities: assignableFacilities } = useAssignableFacilities(orgId);
  const people = useMemo(() => userStore.users.filter(user => {
    if (orgId && user.orgId !== orgId) return false;
    if (facilityId && !userWorksAtFacility(user, facilityId)) return false;
    return true;
  }), [facilityId, orgId, userStore.users]);

  /* Every list answers the scope chosen in the rail, the People list included:
     pick an organization and the Organizations list is that organization, pick
     a facility and the Facilities list is that facility. `organizations` and
     `facilities` stay whole above this line because they are what the two rail
     selects offer — narrowing them there would strand you on the current
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
    const q = params.get('q');
    if (q) setSearch(q);
    if (params.has('new')) {
      if (activeView === 'organizations' && currentUser.role === 'super_admin') setShowOrgEditor(true);
      if (activeView === 'facilities' && canCreateFacilities(currentUser.role)) setShowFacilityEditor(true);
      if (activeView === 'people' && canCreateUsers(currentUser.role)) setShowUserEditor(true);
    }
    const userId = params.get('user');
    if (userId && canCreateUsers(currentUser.role)) {
      router.replace(`/admin/users/${encodeURIComponent(userId)}?returnTo=${encodeURIComponent('/manage?view=people')}`);
    }
    handledDeepLink.current = true;
  }, [activeView, currentUser, orgId, router]);

  const changeView = (next: ManagementView) => {
    setView(next);
    const params = new URLSearchParams();
    params.set('view', next);
    if (orgId) params.set('org', orgId);
    if (facilityId) params.set('facility', facilityId);
    router.replace(`/manage?${params.toString()}`, { scroll: false });
  };

  const changePeopleMode = (next: 'staff' | 'requests') => {
    setPeopleMode(next);
    const params = new URLSearchParams({ view: 'people' });
    if (next === 'requests') params.set('tab', 'requests');
    if (orgId) params.set('org', orgId);
    if (facilityId) params.set('facility', facilityId);
    router.replace(`/manage?${params.toString()}`, { scroll: false });
  };

  if (!currentUser || !TENANCY_WORKSPACE_ROLES.includes(currentUser.role)) return null;

  const peopleRequestsAvailable = canCreateUsers(currentUser.role);
  const activePeopleMode = peopleRequestsAvailable ? peopleMode : 'staff';
  const canAddOrganization = currentUser.role === 'super_admin' && activeView === 'organizations';
  const canAddFacility = canCreateFacilities(currentUser.role) && activeView === 'facilities' && !!orgId;
  const canAddPerson = canCreateUsers(currentUser.role) && activeView === 'people' && !!orgId;
  const openPrimaryAction = () => {
    if (canAddOrganization) { setEditingOrg(null); setShowOrgEditor(true); }
    if (canAddFacility) { setEditingFacility(null); setShowFacilityEditor(true); }
    if (canAddPerson) setShowUserEditor(true);
  };
  const showPrimaryAction = canAddOrganization || canAddFacility || canAddPerson;

  const showRoster = activeView !== 'people' || activePeopleMode === 'staff';

  return (
    <main className="page-container page-enter sadb-scope mgmt-shell">
      <div className="mgmt-layout">
        <aside className="sadb-card mgmt-scope" aria-label={t('management.scopeLabel')}>
          <div className="mgmt-scope-head">
            <h1>{t('management.title')}</h1>
          </div>

          <div className="mgmt-rail-group">
            <p className="sadb-rail-title">{t('management.scopeLabel')}</p>
            <label className="mgmt-field">
              <span className="mgmt-field-label">{t('management.organizationField')}</span>
              {currentUser.role === 'super_admin' ? (
                <select value={orgId} onChange={event => { setOrgId(event.target.value); setFacilityId(''); }}>
                  <option value="">{t('management.allOrganizations')}</option>
                  {organizations.map(org => <option key={org._id} value={org._id}>{org.name}</option>)}
                </select>
              ) : <strong>{selectedOrg?.name ?? currentUser.organization?.name}</strong>}
            </label>
            <label className="mgmt-field">
              <span className="mgmt-field-label">{t('management.facilityField')}</span>
              <select value={facilityId} onChange={event => setFacilityId(event.target.value)} disabled={!orgId}>
                <option value="">{t('management.allFacilities')}</option>
                {facilities.map(facility => <option key={facility._id} value={facility._id}>{facility.name}</option>)}
              </select>
            </label>
          </div>
        </aside>

        <div className="sadb-shell-main">
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
            {/* One toolbar line: which people list, then the search over it.
                The roster / requests switch is a select rather than a second
                pill strip — one tab strip per screen, and the strip above
                already owns that shape. */}
            <div className="sadb-search-row">
              {activeView === 'people' && peopleRequestsAvailable && (
                <select
                  className="mgmt-mode-select"
                  aria-label={t('management.peopleViewsLabel')}
                  value={activePeopleMode}
                  onChange={event => changePeopleMode(event.target.value as 'staff' | 'requests')}
                >
                  <option value="staff">{t('management.staffAccounts')}</option>
                  <option value="requests">{t('management.accountRequests')}</option>
                </select>
              )}
              {showRoster && (
                <SadbSearch value={search} onChange={setSearch} placeholder={t('management.searchPlaceholder')} ariaLabel={t('management.search')} />
              )}
            </div>

            {showRoster && (
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
                      <SadbGridRow key={org._id} template={MGMT_GRID} onClick={() => { setOrgId(org._id); setView('facilities'); router.replace(`/manage?view=facilities&org=${encodeURIComponent(org._id)}`, { scroll: false }); }}>
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
                    <SadbGridRow key={facility._id} template={MGMT_GRID} onClick={() => { setFacilityId(facility._id); setView('people'); router.replace(`/manage?view=people&org=${encodeURIComponent(orgId)}&facility=${encodeURIComponent(facility._id)}`, { scroll: false }); }}>
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
                    const open = canCreateUsers(currentUser.role)
                      ? () => router.push(`/admin/users/${encodeURIComponent(user._id)}?returnTo=${encodeURIComponent('/manage?view=people')}`)
                      : undefined;
                    return (
                      <SadbGridRow key={user._id} template={MGMT_GRID} onClick={open}>
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
            )}

            {activeView === 'people' && activePeopleMode === 'requests' && (
              <AccountRequestQueue viewerRole={currentUser.role} embedded />
            )}
          </SadbCard>
        </div>
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
          onSaved={() => { setShowFacilityEditor(false); void hospitalStore.reload(); }}
        />
      )}
      {showUserEditor && (
        <CreateUserModal
          hospitals={assignableFacilities}
          presetHospitalId={assignableFacilities.some(f => f._id === selectedFacility?._id) ? selectedFacility?._id : undefined}
          lockFacility={!!selectedFacility && assignableFacilities.some(f => f._id === selectedFacility._id)}
          onClose={() => setShowUserEditor(false)}
          onCreated={credentials => { setShowUserEditor(false); setHandoff(credentials); void userStore.reload(); }}
          onAddFacility={() => { setShowUserEditor(false); setShowFacilityEditor(true); }}
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
