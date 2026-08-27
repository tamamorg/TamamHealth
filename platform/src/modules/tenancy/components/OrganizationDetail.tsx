'use client';

/**
 * ONE ORGANIZATION — and that means ITS FACILITIES.
 *
 * Who the tenant is, then the list of sites it owns. That is the whole page.
 *
 * It used to be a user roster with facilities demoted to a filter dropdown, so
 * the one question an operator opens a tenant to answer — "which sites does it
 * have?" — was the one thing the page would not show, and the way down to a
 * facility was to change a dropdown and then hunt for a link. There is no
 * people list here at all now: an account belongs to a facility, so the roster
 * lives one rung down, on the facility, beside the patients and the wards it is
 * a roster FOR.
 *
 * Two hosts, one implementation:
 *   • `/manage` for a role that lives inside exactly one organization — there
 *     is no list of one to choose from, so their console IS this page.
 *   • `/admin/organizations/[id]` for a role that drilled in from the registry.
 *
 * Everything the tenant header offers happens HERE. Edit and Deactivate used
 * to bounce to `/admin/organizations?org=…&edit=1`, a page about every OTHER
 * tenant, and the operator had to find their way back afterwards.
 *
 * Counts come from live records — never from the write-once HospitalDoc
 * counters (2026-08 hardcoded-data sweep).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from '@/components/icons/lucide';
import Modal from '@/components/Modal';
import PopupHeader from '@/components/PopupHeader';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { activeFacilities } from '@/lib/services/hospital-service';
import { OrganizationForm } from '@/components/admin/OrganizationForm';
import FacilityFormModal from '@/components/admin/FacilityFormModal';
import {
  SadbCard, SadbChip, SadbConfirmModal, SadbGridList, SadbGridRow, SadbSearch,
  effectiveOrgStatus, statusChip,
} from '@/components/admin/sadb-ui';
import { useConsoleTrail } from '@/components/navigation/ConsoleTrail';
import type { HospitalDoc } from '@/lib/db-types';
import { canPerformTenancyAction, userWorksAtFacility } from '../index';

/* Facility · Type · Staff · Patients · Status. The two counts are the point of
   the row: they say there is something underneath worth opening. */
const FACILITY_GRID = 'minmax(200px, 1.7fr) minmax(130px, 1fr) minmax(80px, 0.5fr) minmax(80px, 0.5fr) minmax(90px, 0.6fr)';

/** The document's `facilityType` values, as the label keys `hospitals.*` holds. */
const FACILITY_TYPE_LABEL_KEYS: Record<string, string> = {
  national_referral: 'hospitals.typeNationalReferral',
  state_hospital: 'hospitals.typeStateHospital',
  county_hospital: 'hospitals.typeCountyHospital',
  phcc: 'hospitals.typePhcc',
  phcu: 'hospitals.typePhcu',
};

export default function OrganizationDetail({ orgId, hostedAt }: {
  orgId: string;
  /**
   * The URL this page is being served from. It is the `returnTo` handed to the
   * facility pages below it and the href its own trail crumb points at — both
   * differ between the two hosts, and neither can be derived from `orgId`.
   */
  hostedAt: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { showToast } = useToast();
  const { currentUser } = useAuth();
  const orgStore = useOrganizations();
  const hospitalStore = useHospitals();

  /** Per-facility rollups, plus the tenant totals the header quotes. */
  const [rollup, setRollup] = useState<{
    staff: Map<string, number>;
    patients: Map<string, number>;
    totalUsers: number;
    totalPatients: number;
  } | null>(null);
  const [search, setSearch] = useState('');
  const [showOrgEditor, setShowOrgEditor] = useState(false);
  const [showFacilityEditor, setShowFacilityEditor] = useState(false);
  const [editingFacility, setEditingFacility] = useState<HospitalDoc | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [busy, setBusy] = useState(false);

  const role = currentUser?.role;
  const may = useCallback(
    (action: Parameters<typeof canPerformTenancyAction>[1]) => !!role && canPerformTenancyAction(role, action),
    [role],
  );

  const org = orgStore.organizations.find(candidate => candidate._id === orgId)
    ?? (currentUser?.organization?._id === orgId ? currentUser.organization : null);

  const orgFacilities = useMemo(
    () => activeFacilities(hospitalStore.hospitals.filter(hospital => hospital.orgId === orgId))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [hospitalStore.hospitals, orgId],
  );

  /**
   * How many people and patients sit under each site.
   *
   * One pass for the whole tenant rather than a query per row, and the staff
   * rule is `userWorksAtFacility` — home site or covered site — so this count
   * and the roster on the facility's own page answer the same question.
   */
  const loadRollup = useCallback(async () => {
    if (!orgId) return;
    try {
      const [{ getAllUsers }, { getAllPatients }] = await Promise.all([
        import('@/modules/identity/services/user-service'),
        import('@/lib/services/patient-service'),
      ]);
      const [allUsers, allPatients] = await Promise.all([getAllUsers(), getAllPatients()]);
      const users = allUsers.filter(user => user.orgId === orgId);
      const patients = allPatients.filter(patient => patient.orgId === orgId);
      const staff = new Map<string, number>();
      const perFacility = new Map<string, number>();
      for (const user of users) {
        for (const facilityId of new Set([user.hospitalId, ...(user.facilityIds ?? [])])) {
          if (facilityId && userWorksAtFacility(user, facilityId)) {
            staff.set(facilityId, (staff.get(facilityId) ?? 0) + 1);
          }
        }
      }
      for (const patient of patients) {
        const facilityId = patient.registrationHospital;
        if (facilityId) perFacility.set(facilityId, (perFacility.get(facilityId) ?? 0) + 1);
      }
      setRollup({ staff, patients: perFacility, totalUsers: users.length, totalPatients: patients.length });
    } catch (error) {
      console.error('Failed to load organization rollup:', error);
      // Unknown, not zero — a query that failed has not proved an absence.
      setRollup(null);
    }
  }, [orgId]);

  useEffect(() => { void loadRollup(); }, [loadRollup]);

  /**
   * The tenant's own performance, rolled up from its facilities.
   *
   * Averaged over the facilities that HAVE been assessed, not over all of
   * them: counting an unassessed facility as zero would report a tenant as
   * failing for not having been visited yet.
   */
  const perf = useMemo(() => {
    const readiness = orgFacilities
      .map(facility => facility.performance?.serviceReadinessScore)
      .filter((value): value is number => typeof value === 'number');
    const functional = orgFacilities.filter(facility => facility.operationalStatus === 'functional').length;
    return {
      readiness: readiness.length
        ? Math.round(readiness.reduce((sum, value) => sum + value, 0) / readiness.length)
        : null,
      pctFunctional: orgFacilities.length ? Math.round((functional / orgFacilities.length) * 100) : null,
    };
  }, [orgFacilities]);

  /* ── Deep links ──────────────────────────────────────────────────────
     `?new=facility` is what the top rail's Add menu opens; `?edit=1` and
     `?deactivate=1` are the hand-offs the old registry stub still forwards.
     Read once, on mount: re-reading would reopen a dialog just dismissed. */
  const [deepLinkDone, setDeepLinkDone] = useState(false);
  useEffect(() => {
    if (deepLinkDone || !currentUser) return;
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    if (q) setSearch(q);
    const wants = params.get('new');
    if ((wants === 'facility' || wants === '1') && may('facility:create')) setShowFacilityEditor(true);
    if ((wants === 'organization' || params.has('edit')) && may('organization:edit')) setShowOrgEditor(true);
    if (params.has('deactivate') && may('organization:edit')) setConfirmDeactivate(true);
    setDeepLinkDone(true);
  }, [currentUser, deepLinkDone, may]);

  const filteredFacilities = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return orgFacilities;
    /* County is matched as well as town and state: the state dashboard's
       per-county drill-down lands here as `?q=<county>`, and its old consumer
       — the national facility list — no longer exists. */
    return orgFacilities.filter(facility => facility.name.toLowerCase().includes(query)
      || facility.state.toLowerCase().includes(query)
      || (facility.county ?? '').toLowerCase().includes(query)
      || (facility.town ?? '').toLowerCase().includes(query));
  }, [orgFacilities, search]);

  /* Organizations › <this tenant>. The root crumb is dropped for a role whose
     console IS this page — there is no registry above them to go back to. */
  useConsoleTrail('organization-detail', org
    ? (hostedAt === '/manage'
      ? [{ label: org.name }]
      : [{ label: t('management.organizations'), href: '/manage' }, { label: org.name }])
    : null);

  const facilityHref = (facility: HospitalDoc) =>
    `/admin/facilities/${encodeURIComponent(facility._id)}?returnTo=${encodeURIComponent(hostedAt)}`;

  const runDeactivate = async () => {
    if (!org || !currentUser || busy) return;
    setBusy(true);
    try {
      await orgStore.deactivate(org._id, currentUser._id, currentUser.username);
      showToast(t('management.toastDeactivated', { name: org.name }), 'success');
      setConfirmDeactivate(false);
    } catch (error) {
      console.error('Organization status change failed:', error);
      showToast(t('management.actionFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!org) {
    return (
      <p className="sadb-empty">
        {orgStore.loading ? t('orgAdmin.loading') : t('orgAdmin.orgNotFound')}
      </p>
    );
  }

  const status = effectiveOrgStatus(org);
  const onboarded = org.createdAt ? new Date(org.createdAt) : null;
  const onboardedLabel = onboarded && !Number.isNaN(onboarded.getTime())
    ? onboarded.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
    : null;

  return (
    <>
      {/* ═══ The tenant — identity, actions and every figure, in ONE card ═══
          This was two: a white header card whose "Billing & subscriptions"
          strip read TOTAL LICENSED USERS 4/50 and MAX HOSPITALS 2/10, and a
          KPI row directly beneath it repeating both as People 4/50 and
          Facilities 2/10. Each figure appears once now, on one blue surface,
          reading identity → actions → numbers. ═══ */}
      <section className="orgh">
        <div className="orgh-top">
          <div className="orgh-id">
            <div className="orgh-name">
              <h2 title={org.name}>{org.name}</h2>
              <SadbChip tone={statusChip(status)}>{status}</SadbChip>
            </div>
            <p className="orgh-sub">
              {org.orgType === 'public' ? t('orgAdmin.typePublic') : t('orgAdmin.typePrivate')}
              {onboardedLabel ? ` · ${t('orgAdmin.onboarded', { date: onboardedLabel })}` : ''}
            </p>
          </div>
          <div className="orgh-actions">
            {may('organization:edit') && (
              <button type="button" className="orgh-btn" onClick={() => setShowOrgEditor(true)}>
                {t('orgAdmin.editOrganization')}
              </button>
            )}
            {may('organization:edit') && org.isActive !== false && (
              <button
                type="button"
                className="orgh-btn orgh-btn--danger"
                onClick={() => setConfirmDeactivate(true)}
              >
                {t('orgAdmin.deactivate')}
              </button>
            )}
          </div>
        </div>

        <div className="orgh-stats">
          <div className="orgh-stat">
            <span className="orgh-stat-label">{t('adminBilling.colPlan')}</span>
            <SadbChip tone={org.subscriptionPlan === 'basic' ? 'neutral' : 'blue'}>
              {org.subscriptionPlan}
            </SadbChip>
          </div>

          <div className="orgh-stat">
            <span className="orgh-stat-label">{t('management.facilities')}</span>
            <span className="orgh-stat-value">
              {orgFacilities.length}
              <span className="orgh-stat-cap"> / {org.maxHospitals}</span>
            </span>
            <span className={`orgh-stat-note${orgFacilities.length >= org.maxHospitals ? ' orgh-stat-note--warn' : ''}`}>
              {orgFacilities.length >= org.maxHospitals
                ? t('orgAdmin.atFacilityLimit')
                : perf.readiness === null
                  ? (orgFacilities.length ? t('orgAdmin.notYetAssessed') : '—')
                  : t('orgAdmin.readinessSummary', { readiness: perf.readiness, functional: perf.pctFunctional ?? 0 })}
            </span>
          </div>

          {may('person:view') && (
            <div className="orgh-stat">
              <span className="orgh-stat-label">{t('management.people')}</span>
              <span className="orgh-stat-value">
                {rollup ? rollup.totalUsers : '…'}
                <span className="orgh-stat-cap"> / {org.maxUsers}</span>
              </span>
              <span className={`orgh-stat-note${rollup && rollup.totalUsers >= org.maxUsers ? ' orgh-stat-note--warn' : ''}`}>
                {rollup && rollup.totalUsers >= org.maxUsers
                  ? t('orgAdmin.atSeatLimit')
                  : t('orgAdmin.seatsLeft', { count: rollup ? org.maxUsers - rollup.totalUsers : 0 })}
              </span>
            </div>
          )}

          <div className="orgh-stat">
            <span className="orgh-stat-label">{t('breadcrumb.patients')}</span>
            <span className="orgh-stat-value">
              {rollup ? rollup.totalPatients.toLocaleString() : '…'}
            </span>
            <span className="orgh-stat-note">{t('orgAdmin.acrossFacilities')}</span>
          </div>
        </div>
      </section>

      {/* ═══ THE FACILITIES — the whole point of this page ═══ */}
      <SadbCard
        title={t('management.facilities')}
        meta={t('management.showingOf', { shown: filteredFacilities.length, total: orgFacilities.length })}
        action={may('facility:create') ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            data-tour="org-hospitals-add"
            onClick={() => { setEditingFacility(null); setShowFacilityEditor(true); }}
          >
            <Plus className="w-4 h-4" /> {t('management.addFacility')}
          </button>
        ) : undefined}
      >
        <div className="sadb-search-row" style={{ paddingBottom: 12 }}>
          <SadbSearch
            value={search}
            onChange={setSearch}
            placeholder={t('management.searchFacilities')}
            ariaLabel={t('management.searchFacilities')}
          />
        </div>
        <div data-tour="org-hospitals-table">
          <SadbGridList
            template={FACILITY_GRID}
            minWidth={680}
            head={[
              t('management.name'),
              t('management.facilityType'),
              t('management.staff'),
              t('breadcrumb.patients'),
              t('management.status'),
            ]}
            alignEndLast
            empty={hospitalStore.loading ? t('hospitals.loadingFacilities') : t('management.noFacilities')}
          >
            {filteredFacilities.map(facility => (
              <SadbGridRow
                key={facility._id}
                template={FACILITY_GRID}
                onClick={() => router.push(facilityHref(facility))}
              >
                <span className="min-w-0">
                  <span className="sadb-tenant-name truncate">{facility.name}</span>
                  <span className="sadb-tenant-sub truncate">
                    {[facility.town, facility.state].filter(Boolean).join(', ')}
                  </span>
                </span>
                <span className="truncate">
                  {FACILITY_TYPE_LABEL_KEYS[facility.facilityType]
                    ? t(FACILITY_TYPE_LABEL_KEYS[facility.facilityType])
                    : facility.facilityType}
                </span>
                <span className="truncate">{rollup ? rollup.staff.get(facility._id) ?? 0 : '…'}</span>
                <span className="truncate">{rollup ? rollup.patients.get(facility._id) ?? 0 : '…'}</span>
                <span style={{ textAlign: 'end' }}>
                  <SadbChip tone="green">{t('management.active')}</SadbChip>
                </span>
              </SadbGridRow>
            ))}
          </SadbGridList>
        </div>
      </SadbCard>

      {showOrgEditor && (
        <Modal onClose={() => setShowOrgEditor(false)} width={920} labelledBy="organization-editor">
          <div className="sadb-modal mgmt-form-modal">
            <PopupHeader
              titleId="organization-editor"
              title={t('management.editOrganization')}
              onClose={() => setShowOrgEditor(false)}
            />
            <OrganizationForm
              editing={org}
              onCancel={() => setShowOrgEditor(false)}
              onSaved={() => { setShowOrgEditor(false); void orgStore.reload(); }}
            />
          </div>
        </Modal>
      )}

      {showFacilityEditor && (
        <FacilityFormModal
          facility={editingFacility ?? undefined}
          orgId={org._id}
          actor={{ _id: currentUser?._id, username: currentUser?.username }}
          onClose={() => { setShowFacilityEditor(false); setEditingFacility(null); }}
          onSaved={async facility => {
            const wasEditing = !!editingFacility;
            setShowFacilityEditor(false);
            setEditingFacility(null);
            showToast(t('orgHospitals.createdToast', { name: facility.name }), 'success');
            // Facilities are written SERVER-side, so the local changes feed
            // `useHospitals` listens to never fires for a create — ask the
            // hook to refetch alongside the rollup.
            await Promise.all([hospitalStore.reload(), loadRollup()]);
            if (wasEditing) return;
            /* A facility has no implicit human owner, so the setup journey
               continues ON the new site's page, where its roster and the
               scoped account form live. */
            router.push(`${facilityHref(facility)}&new=user`);
          }}
        />
      )}

      {confirmDeactivate && (
        <SadbConfirmModal
          title={t('management.confirmDeactivateTitle', { name: org.name })}
          body={t('management.confirmDeactivateOrg')}
          confirmLabel={t('management.deactivate')}
          busy={busy}
          onCancel={() => { if (!busy) setConfirmDeactivate(false); }}
          onConfirm={() => { void runDeactivate(); }}
        />
      )}
    </>
  );
}
