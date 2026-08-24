'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Check, ChevronRight, Plus, Search, Users } from '@/components/icons/lucide';
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
import { CredentialHandoffModal, CreateUserModal } from '@/modules/identity/client';
import type { UserCredentialHandoff } from '@/components/admin/UserForm';
import type { HospitalDoc, OrganizationDoc } from '@/lib/db-types';
import { managementViewsForRole, TENANCY_WORKSPACE_ROLES, type ManagementView, userWorksAtFacility } from '../index';
import { useAssignableFacilities } from '../hooks/useAssignableFacilities';

const VIEWS: readonly ManagementView[] = ['organizations', 'facilities', 'people'];

function initialView(): ManagementView {
  if (typeof window === 'undefined') return 'organizations';
  const value = new URLSearchParams(window.location.search).get('view');
  return VIEWS.includes(value as ManagementView) ? value as ManagementView : 'organizations';
}

export default function ManagementWorkspace() {
  const { t } = useTranslation();
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
  const handledDeepLink = useRef(false);
  const visibleViews = currentUser ? managementViewsForRole(currentUser.role) : VIEWS;
  const activeView = visibleViews.includes(view) ? view : (visibleViews[0] ?? 'facilities');

  const organizations = useMemo(() => {
    if (orgStore.organizations.length) return orgStore.organizations;
    return currentUser?.organization ? [currentUser.organization] : [];
  }, [currentUser?.organization, orgStore.organizations]);

  useEffect(() => {
    if (!currentUser) return;
    const params = new URLSearchParams(window.location.search);
    const requestedOrg = params.get('org');
    const requestedFacility = params.get('facility');
    setOrgId(current => current || requestedOrg || currentUser.orgId || organizations[0]?._id || '');
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

  const query = search.trim().toLowerCase();
  const filteredOrganizations = organizations.filter(org => !query
    || org.name.toLowerCase().includes(query)
    || org.slug.toLowerCase().includes(query));
  const filteredFacilities = facilities.filter(facility => !query
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

  const onboarding = [
    { label: t('management.setupOrganization'), done: !!selectedOrg },
    { label: t('management.setupFacility'), done: facilities.length > 0 },
    { label: t('management.setupAdministrator'), done: userStore.users.some(user => user.orgId === orgId && user.role === 'org_admin' && user.isActive !== false) },
    { label: t('management.setupStaff'), done: userStore.users.some(user => user.orgId === orgId && user.role !== 'org_admin' && user.isActive !== false) },
  ];

  return (
    <main className="page-container page-enter mgmt-shell">
      <header className="mgmt-header">
        <div>
          <p className="mgmt-eyebrow">{t('management.eyebrow')}</p>
          <h1>{t('management.title')}</h1>
          <p>{t('management.subtitle')}</p>
        </div>
        <div className="mgmt-header-actions">
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
      </header>

      <div className="mgmt-layout">
        <aside className="mgmt-scope" aria-label={t('management.scopeLabel')}>
          <div className="mgmt-scope-title">{t('management.scopeLabel')}</div>
          {currentUser.role === 'super_admin' ? (
            <select value={orgId} onChange={event => { setOrgId(event.target.value); setFacilityId(''); }}>
              <option value="">{t('management.allOrganizations')}</option>
              {organizations.map(org => <option key={org._id} value={org._id}>{org.name}</option>)}
            </select>
          ) : <strong>{selectedOrg?.name ?? currentUser.organization?.name}</strong>}
          <ChevronRight aria-hidden="true" />
          <select value={facilityId} onChange={event => setFacilityId(event.target.value)} disabled={!orgId}>
            <option value="">{t('management.allFacilities')}</option>
            {facilities.map(facility => <option key={facility._id} value={facility._id}>{facility.name}</option>)}
          </select>
          <ChevronRight aria-hidden="true" />
          <span>{activeView === 'people' ? t('management.people') : t(`management.${activeView}`)}</span>

          {orgId && (
            <section className="mgmt-checklist">
              <h2>{t('management.setupTitle')}</h2>
              {onboarding.map(item => (
                <div key={item.label} className={item.done ? 'done' : undefined}>
                  {item.done ? <Check aria-hidden="true" /> : <span className="mgmt-step-dot" aria-hidden="true" />}
                  <span>{item.label}</span>
                </div>
              ))}
            </section>
          )}
        </aside>

        <section className="mgmt-main">
          <nav className="mgmt-tabs" aria-label={t('management.viewsLabel')}>
            {visibleViews.map(item => (
              <button key={item} type="button" data-tour={`manage-tab-${item}`} className={activeView === item ? 'active' : undefined} onClick={() => changeView(item)}>
                {item === 'organizations' ? <Building2 /> : item === 'facilities' ? <Building2 /> : <Users />}
                {t(`management.${item}`)}
              </button>
            ))}
          </nav>
          <label className="mgmt-search">
            <Search aria-hidden="true" />
            <span className="sr-only">{t('management.search')}</span>
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder={t('management.searchPlaceholder')} />
          </label>

          <div className="mgmt-list-head" aria-hidden="true">
            <span>{activeView === 'people' ? t('management.person') : t('management.name')}</span>
            <span>{t('management.scope')}</span>
            <span>{t('management.status')}</span>
          </div>
          <div className="mgmt-list" data-tour={activeView === 'facilities' ? 'org-hospitals-table' : activeView === 'people' ? 'org-users-list' : undefined}>
            {activeView === 'organizations' && filteredOrganizations.map(org => (
              <button key={org._id} type="button" className="mgmt-row" onClick={() => { setOrgId(org._id); setView('facilities'); router.replace(`/manage?view=facilities&org=${encodeURIComponent(org._id)}`, { scroll: false }); }}>
                <span><strong>{org.name}</strong><small>{org.slug}</small></span>
                <span>{org.orgType}</span><span>{org.subscriptionStatus}</span>
              </button>
            ))}
            {activeView === 'facilities' && filteredFacilities.map(facility => (
              <button key={facility._id} type="button" className="mgmt-row" onClick={() => { setFacilityId(facility._id); setView('people'); router.replace(`/manage?view=people&org=${encodeURIComponent(orgId)}&facility=${encodeURIComponent(facility._id)}`, { scroll: false }); }}>
                <span><strong>{facility.name}</strong><small>{facility.town}, {facility.state}</small></span>
                <span>{facility.facilityType}</span><span>{t('management.active')}</span>
              </button>
            ))}
            {activeView === 'people' && filteredPeople.map(user => (
              <button key={user._id} type="button" className="mgmt-row" disabled={!canCreateUsers(currentUser.role)} onClick={() => router.push(`/admin/users/${encodeURIComponent(user._id)}?returnTo=${encodeURIComponent('/manage?view=people')}`)}>
                <span><strong>{user.name}</strong><small>@{user.username}</small></span>
                <span>{user.hospitalName ?? user.orgName ?? t('management.organizationWide')}</span>
                <span>{user.isActive === false ? t('management.inactive') : t('management.active')}</span>
              </button>
            ))}
            {((activeView === 'organizations' && filteredOrganizations.length === 0)
              || (activeView === 'facilities' && filteredFacilities.length === 0)
              || (activeView === 'people' && filteredPeople.length === 0)) && (
              <p className="mgmt-empty">{t('management.empty')}</p>
            )}
          </div>
        </section>
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
