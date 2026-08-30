'use client';

/**
 * Facility Management Overview — a facility-scoped mirror of the Ministry of
 * Health national dashboard. Facility-management roles see the same kind of
 * KPIs, trends and performance gauges the Ministry sees, but only for their own
 * facility (every data hook is auto-scoped by `useDataScope`).
 *
 * This is the review tier of the reporting pipeline: clinical staff enter data
 * → it collects here at the facility level → facility management reviews it and
 * submits to the Ministry of Health. Only submitted facilities are counted in
 * the national dashboard (see the government dashboard's reporting gate).
 *
 * Restyled onto the sadb-* admin-console kit (2026-08-30) to match every other
 * admin/facility-management surface: navy greeting header (via SadbPage),
 * KPI tiles for the census/staffing glance, a card for vital events & care
 * programs, status/performance cards, and the visits trend inside a SadbCard.
 * `RoleGuard` is folded into `SadbPage`'s own `roles` prop — the exact role
 * set `/facility-overview` allows in `lib/role-routes.ts` (super_admin is
 * always allowed there via its wildcard).
 */
import { useState, useCallback } from 'react';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { useBirths } from '@/lib/hooks/useBirths';
import { useDeaths } from '@/lib/hooks/useDeaths';
import { useANC } from '@/lib/hooks/useANC';
import { useImmunizations } from '@/lib/hooks/useImmunizations';
import { useReferrals } from '@/lib/hooks/useReferrals';
import { useSurveillance } from '@/lib/hooks/useSurveillance';
import { useFacilityCensus } from '@/lib/hooks/useFacilityCensus';
import { censusFor } from '@/lib/services/facility-census';
import { Building2, AlertTriangle, Send, Loader2 } from '@/components/icons/lucide';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { tooltipStyle as chartTooltipStyle, axisTick } from '@/components/ChartCard';
import { SadbPage, SadbCard, SadbKpiTile, SadbKvRow, SadbChip, type ChipTone } from '@/components/admin/sadb-ui';
import type { UserRole } from '@/lib/db-types';

/* The exact role set `lib/role-routes.ts` grants `/facility-overview`
 * (org_admin, medical_superintendent, hospital_manager), plus super_admin's
 * standing wildcard — folded from the bare `<RoleGuard>` this page used to
 * wrap itself in. */
const FACILITY_OVERVIEW_ROLES: UserRole[] = ['org_admin', 'medical_superintendent', 'hospital_manager', 'super_admin'];

const OP_STATUS_TONE: Record<string, ChipTone> = {
  functional: 'green',
  partially_functional: 'yellow',
  non_functional: 'red',
  closed: 'neutral',
};

export default function FacilityOverviewPage() {
  return <FacilityOverview />;
}

function FacilityOverview() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { hospitals, loading: hospitalsLoading, update } = useHospitals();
  // Real counts — HospitalDoc.patientCount/todayVisits are write-once-zero
  // registry fields nothing recomputes (2026-08 hardcoded-data sweep).
  const { census: facilityCensus } = useFacilityCensus();
  const { births } = useBirths();
  const { deaths } = useDeaths();
  const { visits: ancVisits } = useANC();
  const { immunizations } = useImmunizations();
  const { referrals } = useReferrals();
  const { alerts } = useSurveillance();

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const hospitalId = currentUser?.hospitalId;
  const hospital = hospitals.find(h => h._id === hospitalId);

  const handleSubmit = useCallback(async () => {
    if (!hospitalId) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await update(hospitalId, {
        mohSubmission: {
          submittedAt: new Date().toISOString(),
          submittedBy: currentUser?._id || '',
          submittedByName: currentUser?.name,
        },
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not submit to the Ministry of Health.');
    } finally {
      setSubmitting(false);
    }
  }, [hospitalId, update, currentUser]);

  // Not assigned to a facility — the dashboard has nothing to scope to.
  if (!hospitalId) {
    return (
      <SadbPage roles={FACILITY_OVERVIEW_ROLES}>
        <SadbCard>
          <div className="p-8 text-center max-w-md mx-auto">
            <Building2 className="w-12 h-12 mx-auto mb-4" style={{ color: 'var(--text-muted)' }} />
            <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>{t('myFacility.notAssignedTitle')}</h2>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('myFacility.notAssignedDesc')}</p>
          </div>
        </SadbCard>
      </SadbPage>
    );
  }

  if (hospitalsLoading && !hospital) {
    return (
      <SadbPage roles={FACILITY_OVERVIEW_ROLES}>
        <p className="sadb-empty" aria-live="polite">
          <Loader2 className="w-4 h-4 inline-block me-2 animate-spin" style={{ verticalAlign: -3 }} />
          Loading facility data…
        </p>
      </SadbPage>
    );
  }

  // ── Facility-scoped aggregates ───────────────────────────────────────────
  const staff = (hospital?.doctors || 0) + (hospital?.nurses || 0) + (hospital?.clinicalOfficers || 0);
  // `performance` exists only on seeded demo records — no service ever writes
  // it. Absent means "never measured", which must render as such, not as 0%.
  const perf = hospital?.performance;
  const dataQuality = perf?.qualityScore ?? perf?.reportingCompleteness ?? null;

  const referralsOut = referrals.filter(r => r.fromHospitalId === hospitalId).length;
  const referralsIn = referrals.filter(r => r.toHospitalId === hospitalId).length;
  const activeAlerts = alerts.filter(a => a.alertLevel === 'emergency' || a.alertLevel === 'warning').length;

  const MONTH_ABBR: Record<string, string> = {
    '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr', '05': 'May', '06': 'Jun',
    '07': 'Jul', '08': 'Aug', '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dec',
  };
  const trend = (hospital?.monthlyTrends || []).map(r => ({
    month: MONTH_ABBR[r.month?.slice(5)] || r.month,
    'OPD Visits': r.opdVisits || 0,
    'ANC Visits': r.ancVisits || 0,
    'Immunizations': r.immunizations || 0,
  }));

  const opStatusLabel: Record<string, string> = {
    functional: t('myFacility.statusFunctional'),
    partially_functional: t('myFacility.statusPartiallyFunctional'),
    non_functional: t('myFacility.statusNonFunctional'),
    closed: t('myFacility.statusClosed'),
  };
  const opStatus = hospital?.operationalStatus || 'functional';

  // ── Ministry of Health submission state ──────────────────────────────────
  const submission = hospital?.mohSubmission;
  const submittedAt = submission?.submittedAt;
  const hasPendingChanges = !!submittedAt && !!hospital?.updatedAt && hospital.updatedAt > submittedAt;
  const mohTone: ChipTone = !submittedAt ? 'neutral' : hasPendingChanges ? 'yellow' : 'green';
  const mohLabel = !submittedAt ? 'Not yet submitted' : hasPendingChanges ? 'Changes pending submission' : 'Submitted to Ministry of Health';

  return (
    <SadbPage roles={FACILITY_OVERVIEW_ROLES} greeting="Facility overview">

      {/* ═══ MINISTRY OF HEALTH SUBMISSION GATE ═══ */}
      <SadbCard
        title="Ministry of Health Reporting"
        action={
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || (!!submittedAt && !hasPendingChanges)}
            className="btn btn-primary btn-sm inline-flex items-center gap-1.5"
          >
            {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {submittedAt && !hasPendingChanges ? 'Submitted' : 'Submit to Ministry of Health'}
          </button>
        }
      >
        <div className="p-4 flex flex-col gap-2.5">
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Review your facility&apos;s data below, then submit it to the Ministry of Health. Data is reported
            only when you submit it here — it is not sent automatically.
          </p>
          <div>
            <SadbChip tone={mohTone}>{mohLabel}</SadbChip>
          </div>
          {submittedAt && (
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Last submitted {new Date(submittedAt).toLocaleString()}
              {submission?.submittedByName ? ` by ${submission.submittedByName}` : ''}.
            </p>
          )}
          {submitError && (
            <span className="text-xs font-bold flex items-center gap-1" style={{ color: 'var(--color-danger-text)' }}>
              <AlertTriangle className="w-3.5 h-3.5" /> {submitError}
            </span>
          )}
        </div>
      </SadbCard>

      {/* ═══ KEY METRICS — operational stats + vital events & care programs ═══ */}
      <div data-tour="facility-overview-metrics" className="flex flex-col gap-3.5">
        <div className="sadb-kpi-row">
          <SadbKpiTile
            label="Patients"
            value={facilityCensus && hospitalId ? String(censusFor(facilityCensus, hospitalId).patients) : '…'}
          />
          <SadbKpiTile label="Beds" value={String(hospital?.totalBeds ?? 0)} />
          <SadbKpiTile label="Clinical Staff" value={String(staff)} />
          <SadbKpiTile
            label="Today's Visits"
            value={facilityCensus && hospitalId ? String(censusFor(facilityCensus, hospitalId).todayVisits) : '…'}
          />
          <SadbKpiTile label="Referrals (in / out)" value={`${referralsIn} / ${referralsOut}`} />
          <SadbKpiTile
            label="Active Alerts"
            value={String(activeAlerts)}
            delta={activeAlerts > 0 ? 'Needs attention' : undefined}
            deltaTone={activeAlerts > 0 ? 'warn' : undefined}
          />
          {/* '—' when never measured — a red 0% would assert a measurement
              that was never taken. */}
          <SadbKpiTile
            label="Data Quality"
            value={dataQuality === null ? '—' : `${Math.round(dataQuality)}%`}
            delta={dataQuality !== null && dataQuality < 80 ? 'Below target' : undefined}
            deltaTone={dataQuality !== null && dataQuality < 80 ? 'warn' : undefined}
          />
        </div>

        <SadbCard title="Vital Events & Care Programs">
          <SadbKvRow label="Births Registered" value={String(births.length)} />
          <SadbKvRow label="Deaths Registered" value={String(deaths.length)} />
          <SadbKvRow label="ANC Visits" value={String(ancVisits.length)} />
          <SadbKvRow label="Immunizations" value={String(immunizations.length)} />
        </SadbCard>
      </div>

      {/* ═══ OPERATIONAL STATUS + PERFORMANCE GAUGES ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-3.5">
        <SadbCard title="Operational Status">
          <div className="p-4">
            <SadbChip tone={OP_STATUS_TONE[opStatus] ?? 'neutral'}>{opStatusLabel[opStatus] ?? opStatus}</SadbChip>
          </div>
        </SadbCard>

        <SadbCard title="Facility Performance">
          {perf ? (
            <div className="grid grid-cols-3 gap-4 p-4">
              <Gauge label="Reporting" value={perf.reportingCompleteness ?? 0} />
              <Gauge label="Service Readiness" value={perf.serviceReadinessScore ?? 0} />
              <Gauge label="Immunization Coverage" value={perf.immunizationCoverage ?? 0} />
            </div>
          ) : (
            <p className="sadb-empty">No performance data recorded for this facility yet.</p>
          )}
        </SadbCard>
      </div>

      {/* ═══ HEALTH VISITS TREND ═══ */}
      <SadbCard title="Health Visits Trend" meta="Monthly">
        <div className="px-3 pt-3 pb-1">
          {trend.length === 0 ? (
            <p className="sadb-empty">No monthly trend data recorded for this facility yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={trend} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="gOpd" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--accent-primary)" stopOpacity={0.4} /><stop offset="95%" stopColor="var(--accent-primary)" stopOpacity={0} /></linearGradient>
                  <linearGradient id="gAnc" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.4} /><stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0} /></linearGradient>
                  <linearGradient id="gImm" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--color-success)" stopOpacity={0.4} /><stop offset="95%" stopColor="var(--color-success)" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" />
                <XAxis dataKey="month" tick={axisTick} />
                <YAxis tick={axisTick} />
                <Tooltip {...chartTooltipStyle} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '0.75rem', paddingTop: '4px' }} />
                <Area type="monotone" dataKey="OPD Visits" stroke="var(--accent-primary)" fill="url(#gOpd)" strokeWidth={2} />
                <Area type="monotone" dataKey="ANC Visits" stroke="var(--chart-2)" fill="url(#gAnc)" strokeWidth={2} />
                <Area type="monotone" dataKey="Immunizations" stroke="var(--color-success)" fill="url(#gImm)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </SadbCard>

    </SadbPage>
  );
}

function Gauge({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const r = 30;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  const color = pct >= 80 ? 'var(--color-success)' : pct >= 50 ? 'var(--color-warning)' : 'var(--color-danger)';
  return (
    <div className="flex flex-col items-center text-center">
      <svg width="80" height="80" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r={r} fill="none" stroke="var(--border-light)" strokeWidth="8" />
        <circle
          cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={offset} transform="rotate(-90 40 40)"
        />
        <text x="40" y="45" textAnchor="middle" style={{ fontSize: 16, fontWeight: 700, fill: 'var(--text-primary)' }}>{pct}%</text>
      </svg>
      <span className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>{label}</span>
    </div>
  );
}
