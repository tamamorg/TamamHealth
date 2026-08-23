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

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import { useHospitals } from '@/lib/hooks/useHospitals';
import {
  SadbPage, SadbCard, SadbChip, SadbKpiTile, SadbKvRow, SadbGridList, SadbGridRow, SadbSearch, SadbHeadLink,
  statusChip, effectiveOrgStatus,
} from '@/components/admin/sadb-ui';
import { TENANT_ACTION_ICONS } from '@/components/admin/TenantCard';
import Select from '@/components/Select';
import { getRoleConfig } from '@/lib/permissions';
import type { UserDoc } from '@/lib/db-types';

/* Roster columns: Account (name + username) · Role · Facility · Status */
const USER_GRID = 'minmax(220px, 1.6fr) minmax(140px, 1fr) minmax(160px, 1.1fr) minmax(90px, 0.7fr)';

export default function AdminOrganizationDetailPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const orgId = params?.id;

  const { organizations, loading: orgsLoading } = useOrganizations();
  const { hospitals } = useHospitals();
  const org = organizations.find(o => o._id === orgId) ?? null;

  const [users, setUsers] = useState<UserDoc[]>([]);
  const [patientCount, setPatientCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  /** '' = all facilities (the default view). */
  const [facilityFilter, setFacilityFilter] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    (async () => {
      try {
        const [{ getAllUsers }, { getAllPatients }] = await Promise.all([
          import('@/modules/identity/services/user-service'),
          import('@/lib/services/patient-service'),
        ]);
        const [allUsers, allPatients] = await Promise.all([getAllUsers(), getAllPatients()]);
        if (cancelled) return;
        setUsers(allUsers.filter(u => u.orgId === orgId));
        setPatientCount(allPatients.filter(p => p.orgId === orgId).length);
      } catch (err) {
        console.error('Failed to load organization detail:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [orgId]);

  const orgFacilities = useMemo(
    () => hospitals.filter(h => h.orgId === orgId).sort((a, b) => a.name.localeCompare(b.name)),
    [hospitals, orgId],
  );

  const facilityName = (id?: string) =>
    (id && orgFacilities.find(h => h._id === id)?.name) || (id ? id : '—');

  /* A user belongs to a facility view through either attachment: `hospitalId`
     is the home site, `facilityIds` the extra sites they cover. */
  const worksAt = (u: UserDoc, hid: string) =>
    u.hospitalId === hid || (u.facilityIds || []).includes(hid);

  const visibleUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users
      .filter(u => (!facilityFilter || worksAt(u, facilityFilter)))
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
      {/* ═══ One-line header: identity left, actions right ═══ */}
      <div className="sadb-card" style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12, padding: '14px 16px' }}>
        <div className="min-w-0 flex items-center gap-3" style={{ flex: '1 1 320px' }}>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <h2 className="sadb-panel-title truncate">{org.name}</h2>
              <SadbChip tone={statusChip(status)}>{status}</SadbChip>
            </div>
            <p className="sadb-panel-note" style={{ marginTop: 2 }}>
              {org.orgType === 'public' ? t('orgAdmin.typePublic') : t('orgAdmin.typePrivate')}
              {onboardedLabel ? ` · onboarded ${onboardedLabel}` : ''}
              {` · ${org.subscriptionPlan}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => router.push('/hospitals?new=1')}>
            {TENANT_ACTION_ICONS.addFacility} {t('orgHospitals.addFacility')}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => router.push('/admin/users?new=1')}>
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

      {/* ═══ Tenant vitals — live counts against the plan's limits ═══ */}
      <div className="sadb-kpi-row">
        <SadbKpiTile label={t('government.colFacilities')} value={`${orgFacilities.length} / ${org.maxHospitals}`} />
        <SadbKpiTile label={t('breadcrumb.users')} value={loading ? '…' : `${users.length} / ${org.maxUsers}`} />
        <SadbKpiTile label={t('breadcrumb.patients')} value={patientCount === null ? '…' : patientCount.toLocaleString()} />
      </div>

      {/* ═══ This tenant's subscription & billing — merged from the retired
          /admin/billing page (2026-08-23). Facts only, all from the org doc
          and live counts; the fields are edited in the registry's Edit
          Organization form. ═══ */}
      <SadbCard
        title={t('adminBilling.title')}
        action={
          <SadbHeadLink onClick={() => router.push(`/admin/organizations?org=${org._id}&edit=1`)}>
            {t('orgAdmin.editOrganization')}
          </SadbHeadLink>
        }
      >
        <SadbKvRow label={t('adminBilling.colPlan')} chip={org.subscriptionPlan} chipTone={org.subscriptionPlan === 'basic' ? 'neutral' : 'blue'} />
        <SadbKvRow label={t('adminBilling.colStatus')} chip={status} chipTone={statusChip(status)} />
        <SadbKvRow
          label={t('adminBilling.kpiTotalLicensedUsers')}
          value={loading ? '…' : `${users.length} / ${org.maxUsers}`}
          valueTone={!loading && users.length >= org.maxUsers ? 'warn' : undefined}
        />
        <SadbKvRow
          label={t('adminBilling.colMaxHospitals')}
          value={`${orgFacilities.length} / ${org.maxHospitals}`}
          valueTone={orgFacilities.length >= org.maxHospitals ? 'warn' : undefined}
        />
      </SadbCard>

      {/* ═══ The roster — every account by default, one facility on demand ═══ */}
      <SadbCard
        title={selectedFacility ? selectedFacility.name : t('orgAdmin.allUsers')}
        meta={loading ? undefined : `${visibleUsers.length} of ${users.length}`}
        action={selectedFacility ? (
          /* The narrowed view offers the facility's own page — profile,
             wards, stock, staff: the create/update/retire surface. */
          <SadbHeadLink onClick={() => router.push(`/hospitals?facility=${encodeURIComponent(selectedFacility._id)}`)}>
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
              onClick={() => router.push(`/admin/users?user=${encodeURIComponent(u._id)}`)}
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
    </SadbPage>
  );
}
