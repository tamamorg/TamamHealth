'use client';

/**
 * One organization, as a full page — what the tenant card's expand (⤢)
 * promotes to.
 *
 * ONE surface, not two stacked trees: a single user roster with a facility
 * selector over it. The default view is every account in the organization;
 * picking a facility narrows the roster to the people attached to it (home
 * site or covered site) and offers that facility's own page. The selector
 * lists facilities only — the organization itself is deliberately not an
 * entry, because org-level administration already lives behind "Edit
 * organization".
 *
 * Header is one line: identity on the left, the actions on the right.
 * Counts are computed from live records — never from the write-once
 * HospitalDoc counters (2026-08 hardcoded-data sweep).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import { useHospitals } from '@/lib/hooks/useHospitals';
import {
  SadbPage, SadbCard, SadbChip, SadbKpiTile, SadbGridList, SadbGridRow, SadbSearch, SadbHeadLink,
  statusChip, effectiveOrgStatus,
} from '@/components/admin/sadb-ui';
import { TENANT_ACTION_ICONS } from '@/components/admin/TenantCard';
import Select from '@/components/Select';
import { getRoleConfig } from '@/lib/permissions';
import Modal from '@/components/Modal';
import { Maximize2, X } from '@/components/icons/lucide';
import { UserForm, type UserCredentialHandoff } from '@/components/admin/UserForm';
import FacilityFormModal from '@/components/admin/FacilityFormModal';
import { CredentialHandoffModal } from '@/modules/identity/client';
import { useApp } from '@/lib/context';
import { useToast } from '@/components/Toast';
import type { UserDoc } from '@/lib/db-types';
import { userWorksAtFacility } from '@/modules/tenancy/client';

/* Roster columns: Account (name + username) · Role · Facility · Status */
const USER_GRID = 'minmax(220px, 1.6fr) minmax(140px, 1fr) minmax(160px, 1.1fr) minmax(90px, 0.7fr)';

export default function AdminOrganizationDetailPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const orgId = params?.id;

  const { organizations, loading: orgsLoading } = useOrganizations();
  const { hospitals, reload: reloadHospitals } = useHospitals();
  const org = organizations.find(o => o._id === orgId) ?? null;

  const [users, setUsers] = useState<UserDoc[]>([]);
  const [patientCount, setPatientCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  /** '' = all facilities (the default view). */
  const [facilityFilter, setFacilityFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [showAddFacility, setShowAddFacility] = useState(false);
  const [handoff, setHandoff] = useState<UserCredentialHandoff | null>(null);
  const { currentUser } = useApp();
  const { showToast } = useToast();

  const loadOrgDetail = useCallback(async () => {
    if (!orgId) return;
    try {
      const [{ getAllUsers }, { getAllPatients }] = await Promise.all([
        import('@/modules/identity/services/user-service'),
        import('@/lib/services/patient-service'),
      ]);
      const [allUsers, allPatients] = await Promise.all([getAllUsers(), getAllPatients()]);
      setUsers(allUsers.filter(u => u.orgId === orgId));
      setPatientCount(allPatients.filter(p => p.orgId === orgId).length);
    } catch (err) {
      console.error('Failed to load organization detail:', err);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { void loadOrgDetail(); }, [loadOrgDetail]);

  const orgFacilities = useMemo(
    () => hospitals.filter(h => h.orgId === orgId).sort((a, b) => a.name.localeCompare(b.name)),
    [hospitals, orgId],
  );

  /**
   * The tenant's own performance, rolled up from its facilities.
   *
   * Averaged over the facilities that HAVE been assessed, not over all of
   * them: counting an unassessed facility as zero would report a tenant as
   * failing for not having been visited yet.
   */
  const perf = useMemo(() => {
    const assessed = orgFacilities.filter(h => h.performance);
    const mean = (pick: (p: NonNullable<typeof assessed[number]['performance']>) => number | undefined) => {
      const values = assessed.map(h => pick(h.performance!)).filter((v): v is number => typeof v === 'number');
      return values.length ? Math.round(values.reduce((sum, v) => sum + v, 0) / values.length) : null;
    };
    const functional = orgFacilities.filter(h => h.operationalStatus === 'functional').length;
    return {
      reporting: mean(p => p.reportingCompleteness),
      readiness: mean(p => p.serviceReadinessScore),
      functional,
      pctFunctional: orgFacilities.length ? Math.round((functional / orgFacilities.length) * 100) : null,
    };
  }, [orgFacilities]);

  const facilityName = (id?: string) =>
    (id && orgFacilities.find(h => h._id === id)?.name) || (id ? id : '—');

  /* A user belongs to a facility view through either attachment: `hospitalId`
     is the home site, `facilityIds` the extra sites they cover. */
  const visibleUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users
      .filter(u => (!facilityFilter || userWorksAtFacility(u, facilityFilter)))
      .filter(u => !q || `${u.name} ${u.username}`.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [users, facilityFilter, search]);

  const onboarded = org?.createdAt ? new Date(org.createdAt) : null;
  const onboardedLabel = onboarded && !isNaN(onboarded.getTime())
    ? onboarded.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
    : null;

  if (!org) {
    return (
      <SadbPage>
        <p className="sadb-empty">
          {orgsLoading ? t('orgAdmin.loading') : t('orgAdmin.orgNotFound')}
        </p>
      </SadbPage>
    );
  }

  const status = effectiveOrgStatus(org);
  const selectedFacility = facilityFilter ? orgFacilities.find(h => h._id === facilityFilter) : null;

  return (
    <SadbPage>
      {/* ═══ Header: identity + actions, with the tenant's subscription
          facts on a second line — the standalone Billing & Subscriptions
          card merged in (2026-08-23). Its Status row was the chip already
          next to the name, and its Edit link the button already here, so
          what survives is what was unique: the plan chip and the license
          usage against the plan's limits. Facts only, from the org doc and
          live counts; edited in the registry's Edit Organization form. ═══ */}
      <div className="sadb-card" style={{ gap: 12, padding: '14px 16px' }}>
        <div className="flex items-center flex-wrap" style={{ gap: 12 }}>
          <div className="min-w-0 flex items-center gap-3" style={{ flex: '1 1 320px' }}>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <h2 className="sadb-panel-title truncate">{org.name}</h2>
                <SadbChip tone={statusChip(status)}>{status}</SadbChip>
              </div>
              <p className="sadb-panel-note" style={{ marginTop: 2 }}>
                {org.orgType === 'public' ? t('orgAdmin.typePublic') : t('orgAdmin.typePrivate')}
                {onboardedLabel ? ` · onboarded ${onboardedLabel}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
            {/* Both dialogs open HERE and their results land here. They used
                to navigate away — the facility to the registry, the account to
                the platform roster — so staffing the tenant you were reading
                ended on a page about every other tenant. */}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowAddFacility(true)}>
              {TENANT_ACTION_ICONS.addFacility} {t('orgHospitals.addFacility')}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowCreateUser(true)} data-action="org-create-user">
              {TENANT_ACTION_ICONS.addUser} {t('orgUsers.createUser')}
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => router.push(`/admin/organizations?org=${org._id}&edit=1`)}>
              {TENANT_ACTION_ICONS.edit} {t('orgAdmin.editOrganization')}
            </button>
            {/* The registry owns the deactivate confirm — ?deactivate=1 opens
                it directly there, on this same tenant. */}
            {org.isActive && (
              <button type="button" className="btn btn-sm sadb-btn-danger" onClick={() => router.push(`/admin/organizations?org=${org._id}&deactivate=1`)}>
                {TENANT_ACTION_ICONS.deactivate} {t('orgAdmin.deactivate')}
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center flex-wrap sadb-headfacts">
          <span className="sadb-headfacts-title">{t('adminBilling.title')}</span>
          <span className="sadb-headfacts-item">
            <span className="sadb-headfacts-label">{t('adminBilling.colPlan')}</span>
            <SadbChip tone={org.subscriptionPlan === 'basic' ? 'neutral' : 'blue'}>{org.subscriptionPlan}</SadbChip>
          </span>
          <span className="sadb-headfacts-item">
            <span className="sadb-headfacts-label">{t('adminBilling.kpiTotalLicensedUsers')}</span>
            <span className="sadb-headfacts-value" style={!loading && users.length >= org.maxUsers ? { color: 'var(--color-warning-700)' } : undefined}>
              {loading ? '…' : `${users.length} / ${org.maxUsers}`}
            </span>
          </span>
          <span className="sadb-headfacts-item">
            <span className="sadb-headfacts-label">{t('adminBilling.colMaxHospitals')}</span>
            <span className="sadb-headfacts-value" style={orgFacilities.length >= org.maxHospitals ? { color: 'var(--color-warning-700)' } : undefined}>
              {`${orgFacilities.length} / ${org.maxHospitals}`}
            </span>
          </span>
        </div>
      </div>

      {/* ═══ Tenant vitals — live counts against the plan's limits ═══ */}
      <div className="sadb-kpi-row">
        {/* The facilities tile carries the tenant's readiness alongside the
            count — "how many" and "how well", which is the pair an operator
            opening a tenant page is actually asking about. */}
        <SadbKpiTile
          label={t('government.colFacilities')}
          value={`${orgFacilities.length} / ${org.maxHospitals}`}
          delta={perf.readiness === null
            ? (orgFacilities.length ? 'not yet assessed' : undefined)
            : `${perf.readiness}% avg readiness · ${perf.pctFunctional}% functional`}
          deltaTone={perf.readiness !== null && perf.readiness < 60 ? 'warn' : 'up'}
        />
        <SadbKpiTile label={t('breadcrumb.users')} value={loading ? '…' : `${users.length} / ${org.maxUsers}`} />
        <SadbKpiTile label={t('breadcrumb.patients')} value={patientCount === null ? '…' : patientCount.toLocaleString()} />
      </div>

      {/* ═══ The roster — every account by default, one facility on demand ═══ */}
      <SadbCard
        title={selectedFacility ? selectedFacility.name : t('orgAdmin.allUsers')}
        meta={loading ? undefined : `${visibleUsers.length} of ${users.length}`}
        action={selectedFacility ? (
          /* The narrowed view offers the facility's own page — profile,
             wards, stock, staff: the create/update/retire surface. */
          <SadbHeadLink onClick={() => router.push(`/admin/facilities/${encodeURIComponent(selectedFacility._id)}`)}>
            {t('orgAdmin.openFacility')}
          </SadbHeadLink>
        ) : undefined}
      >
        <div className="sadb-search-row" style={{ paddingBottom: 12 }}>
          <SadbSearch value={search} onChange={setSearch} placeholder="Search by name or username…" />
          {/* Facilities only — no entry for the organization itself: org-level
              administration lives behind "Edit organization". */}
          <Select
            value={facilityFilter}
            onChange={e => setFacilityFilter(e.target.value)}
            style={{ width: 'auto', minWidth: 220, paddingInlineEnd: 40 }}
            aria-label="Filter by facility"
          >
            <option value="">{t('orgAdmin.allFacilities')}</option>
            {orgFacilities.map(h => (
              <option key={h._id} value={h._id}>{h.name}</option>
            ))}
          </Select>
        </div>

        <SadbGridList
          template={USER_GRID}
          minWidth={640}
          head={['Account', 'Role', 'Facility', 'Status']}
          alignEndLast
          empty={loading
            ? t('orgAdmin.loading')
            : selectedFacility
              ? t('orgAdmin.noFacilityAccounts')
              : t('orgAdmin.noOrgAccounts')}
        >
          {!loading && visibleUsers.map(u => (
            <SadbGridRow
              key={u._id}
              template={USER_GRID}
              onClick={() => router.push(`/admin/users/${encodeURIComponent(u._id)}`)}
            >
              <span className="min-w-0">
                <span className="sadb-tenant-name truncate">{u.name}</span>
                <span className="sadb-tenant-sub truncate">{u.username}</span>
              </span>
              <span className="truncate">{getRoleConfig(u.role).label}</span>
              <span className="truncate">{facilityName(u.hospitalId)}</span>
              <span style={{ textAlign: 'end' }}>
                <SadbChip tone={u.isActive !== false ? 'green' : 'red'}>
                  {u.isActive !== false ? t('orgUsers.statusActive') : t('orgUsers.statusInactive')}
                </SadbChip>
              </span>
            </SadbGridRow>
          ))}
        </SadbGridList>
      </SadbCard>

      {/* Create user — dialog first, expand to the full page. The page is told
          to come BACK here: this form belongs to this tenant, and finishing it
          on the platform roster would drop the operator somewhere they never
          were. */}
      {showCreateUser && (
        <Modal onClose={() => setShowCreateUser(false)} width={560} labelledBy="org-create-user-title">
          <div className="sadb-modal" style={{ minHeight: 0, overflowY: 'auto', maxHeight: 'min(78vh, 720px)' }}>
            <div className="flex items-start justify-between gap-3 sadb-modal-copy">
              <h2 id="org-create-user-title" className="sadb-modal-title">{t('orgUsers.createUser')}</h2>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateUser(false);
                    router.push(`/admin/users/new?returnTo=${encodeURIComponent(`/admin/organizations/${org._id}`)}`);
                  }}
                  className="p-1.5 rounded-lg"
                  style={{ background: 'var(--overlay-subtle)' }}
                  aria-label={t('orgAdmin.openFullPage')}
                  title={t('orgAdmin.openFullPage')}
                  data-action="org-user-create-expand"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateUser(false)}
                  className="p-1.5 rounded-lg"
                  style={{ background: 'var(--overlay-subtle)' }}
                  aria-label={t('action.close')}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <UserForm
              onCancel={() => setShowCreateUser(false)}
              onSaved={({ handoff: h }) => {
                setShowCreateUser(false);
                void loadOrgDetail();
                setHandoff(h);
              }}
            />
          </div>
        </Modal>
      )}

      {showAddFacility && (
        <FacilityFormModal
          orgId={org._id}
          onClose={() => setShowAddFacility(false)}
          onSaved={hospital => {
            setShowAddFacility(false);
            showToast(t('orgHospitals.createdToast', { name: hospital.name }), 'success');
            // Facilities are written SERVER-side now, so the local changes
            // feed `useHospitals` listens to never fires for this create —
            // ask the hook to refetch alongside the org detail.
            void reloadHospitals();
            void loadOrgDetail();
          }}
          actor={{ _id: currentUser?._id, username: currentUser?.username }}
        />
      )}

      {handoff && (
        <CredentialHandoffModal
          title={t('adminUsers.handoffTitle')}
          description={t('adminUsers.handoffDescription')}
          username={handoff.username}
          password={handoff.password}
          invitation={handoff.invitation}
          onClose={() => setHandoff(null)}
        />
      )}
    </SadbPage>
  );
}
