/**
 * @jest-environment node
 *
 * `buildOverviewBand` — the pure combiner behind the organization headline band
 * on the Facility Management dashboard
 * (components/dashboards/FacilityOverviewBand.tsx).
 *
 * This band is the former standalone Org Overview page (/org-admin), merged in
 * and deleted on 2026-08-19, so these cases pin the behaviour that page owned:
 * the local-vs-UTC date split (a visit is a calendar day, an admission and a
 * payment are ISO instants), the 14-day trend series, and the deep link behind
 * every tile. Every input is already resolved and already scope-filtered, and
 * both "today" values are passed in, so nothing here reads the wall clock.
 */

import {
  buildOverviewBand,
  overviewBandPreviewItems,
  type OverviewBandInput,
} from '@/components/dashboards/FacilityOverviewBand';

const TODAY = '2026-08-13';
const YESTERDAY = '2026-08-12';

/** The 14 days ending at `end`, oldest first — mirrors `trailingDays` on the host. */
const trailing = (end: string, count = 14): string[] => {
  const ms = new Date(`${end}T00:00:00Z`).getTime();
  return Array.from({ length: count }, (_, i) =>
    new Date(ms - (count - 1 - i) * 86400000).toISOString().slice(0, 10));
};

function input(over: Partial<OverviewBandInput> = {}): OverviewBandInput {
  return {
    today: TODAY,
    todayUtc: TODAY,
    last14Local: trailing(TODAY),
    last14Utc: trailing(TODAY),
    hospitals: [],
    appointments: [],
    admissions: [],
    activeAdmissionCount: 0,
    users: [],
    usersUnavailable: false,
    usersHref: '/org-admin/users',
    payments: [],
    claims: [],
    stockAlerts: { low: 0, critical: 0, expired: 0 },
    billing: null,
    totalBeds: 0,
    availableBeds: 0,
    occupancyRate: 0,
    brandColor: 'var(--accent-primary)',
    ...over,
  };
}

const kpi = (out: ReturnType<typeof buildOverviewBand>, key: string) =>
  out.kpis.find(k => k.key === key)!;
const tile = (out: ReturnType<typeof buildOverviewBand>, key: string) =>
  out.statusTiles.find(t => t.key === key)!;

describe('headline KPIs', () => {
  it('counts today by the semantics each record was written with', () => {
    // `appointmentDate` is a calendar day; admission/payment timestamps are
    // ISO instants. Feeding the same day in both shapes must produce 1, not 0.
    const out = buildOverviewBand(input({
      appointments: [
        { appointmentDate: TODAY },
        { appointmentDate: YESTERDAY },
      ],
      admissions: [
        { admissionDate: `${TODAY}T06:30:00.000Z` },
        { admissionDate: `${YESTERDAY}T06:30:00.000Z`, dischargeDate: `${TODAY}T11:00:00.000Z` },
      ],
      activeAdmissionCount: 1,
      payments: [
        { amount: 500, status: 'posted', processedAt: `${TODAY}T09:00:00.000Z` },
        { amount: 300, status: 'posted', processedAt: `${YESTERDAY}T09:00:00.000Z` },
        { amount: 999, status: 'reversed', processedAt: `${TODAY}T09:00:00.000Z` },
      ],
    }));

    expect(kpi(out, 'kpi-visits').value).toBe('1');
    // One admitted today, one discharged today.
    expect(kpi(out, 'kpi-inpatients').sub).toBe('1 admitted · 1 discharged today');
    // Reversed payments are not collected revenue.
    expect(kpi(out, 'kpi-revenue').value).toBe('SSP 500');
    expect(kpi(out, 'kpi-revenue').delta?.text).toBe('+SSP 200 vs yesterday');
  });

  it('plots a 14-point trend that ends on today', () => {
    const out = buildOverviewBand(input({
      appointments: [
        { appointmentDate: TODAY }, { appointmentDate: TODAY },
        { appointmentDate: YESTERDAY },
      ],
    }));

    const trend = kpi(out, 'kpi-visits').trend!;
    expect(trend).toHaveLength(14);
    expect(trend[13]).toBe(2);
    expect(trend[12]).toBe(1);
    expect(trend.slice(0, 12).every(v => v === 0)).toBe(true);
  });

  it('carries the inpatient census forward across the stay, not just the admission day', () => {
    const out = buildOverviewBand(input({
      admissions: [{ admissionDate: '2026-08-10T08:00:00.000Z' }],
    }));

    const census = kpi(out, 'kpi-inpatients').trend!;
    // index 13 is TODAY (08-13), so index 10 is the 10th — the admission day.
    // Nothing before it, and the stay is still open on every day after.
    expect(census[9]).toBe(0);
    expect(census[10]).toBe(1);
    expect(census[13]).toBe(1);
  });

  it('reads staff accounts as unknown, never zero, when the users fetch failed', () => {
    const out = buildOverviewBand(input({ users: [], usersUnavailable: true }));
    const staff = kpi(out, 'kpi-staff-active');

    expect(staff.value).toBe('—');
    expect(staff.sub).toBe('Staff accounts could not be loaded');
  });

  it('splits active from inactive accounts', () => {
    const out = buildOverviewBand(input({
      users: [{ isActive: true }, { isActive: false }, {}],
    }));
    const staff = kpi(out, 'kpi-staff-active');

    // An absent `isActive` means enabled — same rule buildFacilityOverview uses.
    expect(staff.value).toBe('2');
    expect(staff.sub).toBe('1 inactive account');
    expect(staff.meterPct).toBeCloseTo((2 / 3) * 100);
  });
});

describe('operational status tiles', () => {
  it('escalates tone with bed occupancy', () => {
    const at = (rate: number) => tile(buildOverviewBand(input({ occupancyRate: rate })), 'ops-beds').tone;
    expect(at(50)).toBe('ok');
    expect(at(80)).toBe('warning');
    expect(at(95)).toBe('danger');
  });

  it('breaks stock alerts down by severity', () => {
    const out = buildOverviewBand(input({ stockAlerts: { critical: 2, low: 3, expired: 1 } }));
    const stock = tile(out, 'ops-stock');

    expect(stock.value).toBe(6);
    expect(stock.detail).toBe('2 critical · 3 low · 1 expired');
    // Counts are spelled out in `detail`, so colour is never the only channel.
    expect(stock.segments?.map(s => s.value)).toEqual([2, 3, 1]);
  });

  it('counts only submitted claims as pending', () => {
    const out = buildOverviewBand(input({
      claims: [{ status: 'submitted' }, { status: 'submitted' }, { status: 'paid' }],
    }));

    expect(tile(out, 'ops-claims').value).toBe(2);
    expect(tile(out, 'ops-claims').detail).toBe('3 total claims submitted');
    expect(tile(out, 'ops-claims').meterPct).toBeCloseTo((2 / 3) * 100);
  });

  it('renders the billing tile from the summary, in the org currency', () => {
    const out = buildOverviewBand(input({
      billing: {
        totalRevenue: 9000, totalOutstanding: 1200, totalWaived: 0,
        billCount: 10, paidCount: 7, pendingCount: 3, currency: 'USD',
      },
    }));

    expect(tile(out, 'ops-billing').value).toBe('USD 1,200');
    expect(tile(out, 'ops-billing').detail).toBe('3 of 10 bills pending or partial');
    // The currency is the org's, on every money figure the band shows.
    expect(kpi(out, 'kpi-revenue').value).toBe('USD 0');
  });
});

describe('deep links', () => {
  it('sends every tile to a real page', () => {
    const out = buildOverviewBand(input());
    for (const item of overviewBandPreviewItems(out)) {
      expect(item.href.startsWith('/')).toBe(true);
      expect(item.detail).toEqual(expect.any(String));
    }
  });

  it('points the staff figure at the roster this role actually has', () => {
    const out = buildOverviewBand(input({ usersHref: '/admin/users' }));
    expect(kpi(out, 'kpi-staff-active').href).toBe('/admin/users');
  });

  it('namespaces its preview keys away from the rail metrics', () => {
    // The band and the Facility Overview rail share one `?preview=` param, and
    // both carry a beds figure — a bare 'beds' key on either side would make
    // one tile open the other's dialog.
    const keys = overviewBandPreviewItems(buildOverviewBand(input())).map(i => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('ops-beds');
    expect(keys).not.toContain('beds');
  });
});
