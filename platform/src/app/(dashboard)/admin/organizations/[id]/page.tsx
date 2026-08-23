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
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import { useHospitals } from '@/lib/hooks/useHospitals';
import {
  SadbPage, SadbCard, SadbChip, SadbKpiTile, SadbGridList, SadbGridRow, SadbSearch, SadbHeadLink,
  statusChip, effectiveOrgStatus,
} from '@/components/admin/sadb-ui';
import { TENANT_ACTION_ICONS } from '@/components/admin/TenantCard';
import { getPerformanceColor } from '@/lib/performance-colors';
import { Maximize2 } from '@/components/icons/lucide';
import Select from '@/components/Select';
import { getRoleConfig } from '@/lib/permissions';
import type { UserDoc } from '@/lib/db-types';

/* Roster columns: Account (name + username) · Role · Facility · Status */
const USER_GRID = 'minmax(220px, 1.6fr) minmax(140px, 1fr) minmax(160px, 1.1fr) minmax(90px, 0.7fr)';

/* Facility columns: Facility · Reporting · Readiness · Beds · Status.
   The name column is wider for its two lines; the rest share the width
   evenly — the per-row Performance link column is gone (2026-08-23), its
   destination promoted to the card head's expand icon. */
const FACILITY_GRID = 'minmax(200px, 1.6fr) repeat(4, minmax(110px, 1fr))';

/**
 * One performance score, as a bar and a number.
 *
 * The number alone makes a reader compare digits across rows; the bar makes
 * the same comparison pre-attentive — four facilities at 82 / 64 / 41 / 90 sort
 * themselves before you have read any of them. Colour comes from the shared
 * four-band WHO ramp, so a score means the same here as on every other
 * performance surface in the product.
 *
 * `null` renders as an empty track and an em dash: a facility that has never
 * been assessed has no score, and drawing that as a zero-length red bar would
 * report a failing facility where there is simply no measurement.
 */
function ScoreMeter({ value, label }: { value: number | null; label: string }) {
  return (
    <span className="orgfac-meter" title={value === null ? `${label}: not assessed` : `${label}: ${value}%`}>
      <span className="orgfac-meter-track">
        {value !== null && (
          <span
            className="orgfac-meter-fill"
            style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: getPerformanceColor(value) }}
          />
        )}
      </span>
      <b className="orgfac-meter-value" style={{ color: value === null ? 'var(--text-muted)' : getPerformanceColor(value) }}>
        {value === null ? '—' : `${value}%`}
      </b>
    </span>
  );
}

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

  /**
   * The tenant's own performance, rolled up from its facilities.
   *
   * Averaged over the facilities that HAVE been assessed, not over all of
   * them: counting an unassessed facility as zero would report a tenant as
   * failing for not having been visited yet. `assessed` is carried alongside
   * so the card can say what the average is actually over.
   */
  const perf = useMemo(() => {
    const assessed = orgFacilities.filter(h => h.performance);
    const mean = (pick: (p: NonNullable<typeof assessed[number]['performance']>) => number | undefined) => {
      const values = assessed.map(h => pick(h.performance!)).filter((v): v is number => typeof v === 'number');
      return values.length ? Math.round(values.reduce((sum, v) => sum + v, 0) / values.length) : null;
    };
    const functional = orgFacilities.filter(h => h.operationalStatus === 'functional').length;
    return {
      assessed: assessed.length,
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
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => router.push('/admin/organizations?new=1')}>
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
        {/* The facilities tile carries the tenant's readiness and scrolls to
            the list it summarises — a count that answers "how many" and a
            delta that answers "how well", which is the pair an operator
            opening a tenant page is actually asking about. */}
        <SadbKpiTile
          label={t('government.colFacilities')}
          value={`${orgFacilities.length} / ${org.maxHospitals}`}
          delta={perf.readiness === null
            ? (orgFacilities.length ? 'not yet assessed' : undefined)
            : `${perf.readiness}% avg readiness · ${perf.pctFunctional}% functional`}
          deltaTone={perf.readiness !== null && perf.readiness < 60 ? 'warn' : 'up'}
          onClick={() => document.getElementById('org-facilities')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        />
        <SadbKpiTile label={t('breadcrumb.users')} value={loading ? '…' : `${users.length} / ${org.maxUsers}`} />
        <SadbKpiTile label={t('breadcrumb.patients')} value={patientCount === null ? '…' : patientCount.toLocaleString()} />
      </div>

      {/* ═══ Facilities and how they are performing ═══
          The Health Facility Performance page answers this for the whole
          country; a tenant page has to answer it for one tenant, and sending
          the operator to a national list to filter their way back to the
          organization they were already looking at is not an answer. Same
          scores, same four-band ramp, same destination on click — scoped to
          the org, and read from the facility documents rather than recomputed
          differently here. ═══ */}
      <div id="org-facilities">
        <SadbCard
          title={t('orgAdmin.facilitiesPerformance')}
          meta={orgFacilities.length === 0
            ? undefined
            : perf.assessed === orgFacilities.length
              ? t('orgAdmin.allAssessed', { count: orgFacilities.length })
              : t('orgAdmin.someAssessed', { assessed: perf.assessed, total: orgFacilities.length })}
          action={
            /* Expand, not a text link — same head affordance as the
               dashboard's Organizations card. One destination at card
               level: the facility network scoped to this org. */
            <button
              type="button"
              className="p-1.5 rounded-md flex-shrink-0"
              onClick={() => router.push(`/admin/organizations?org=${encodeURIComponent(org._id)}`)}
              aria-label={t('orgAdmin.openFacilityNetwork')}
              title={t('orgAdmin.openFacilityNetwork')}
              data-action="org-facilities-expand"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          }
        >
          <SadbGridList
            template={FACILITY_GRID}
            minWidth={760}
            head={[
              t('government.colFacilities'),
              t('hospitals.kpiReporting'),
              t('hospitals.kpiReadiness'),
              t('orgAdmin.beds'),
              t('orgUsers.colStatus'),
            ]}
            alignEndLast
            empty={t('orgAdmin.noFacilities')}
          >
            {/* One link per row now: the name opens the facility (whose own
                page carries the performance tab). The old trailing
                Performance link column held mostly whitespace; card-level
                navigation lives in the head's expand icon instead. */}
            {orgFacilities.map(h => (
              <SadbGridRow key={h._id} template={FACILITY_GRID}>
                <span className="min-w-0">
                  <Link href={`/admin/organizations?facility=${encodeURIComponent(h._id)}`} className="orgfac-name truncate">
                    {h.name}
                  </Link>
                  <span className="sadb-tenant-sub truncate">
                    {[h.county, h.state].filter(Boolean).join(' · ') || h.town || '—'}
                  </span>
                </span>
                <ScoreMeter value={h.performance?.reportingCompleteness ?? null} label={t('hospitals.kpiReporting')} />
                <ScoreMeter value={h.performance?.serviceReadinessScore ?? null} label={t('hospitals.kpiReadiness')} />
                <span className="sadb-tenant-num">{h.totalBeds ? h.totalBeds.toLocaleString() : '—'}</span>
                <span style={{ textAlign: 'end' }}>
                  <SadbChip tone={h.operationalStatus === 'functional' ? 'green' : h.operationalStatus === 'non_functional' ? 'red' : 'yellow'}>
                    {h.operationalStatus || 'unknown'}
                  </SadbChip>
                </span>
              </SadbGridRow>
            ))}
          </SadbGridList>
        </SadbCard>
      </div>

      {/* ═══ The roster — every account by default, one facility on demand ═══ */}
      <SadbCard
        title={selectedFacility ? selectedFacility.name : t('orgAdmin.allUsers')}
        meta={loading ? undefined : `${visibleUsers.length} of ${users.length}`}
        action={selectedFacility ? (
          /* The narrowed view offers the facility's own page — profile,
             wards, stock, staff: the create/update/retire surface. */
          <SadbHeadLink onClick={() => router.push(`/admin/organizations?facility=${encodeURIComponent(selectedFacility._id)}`)}>
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
