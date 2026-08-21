import fs from 'node:fs';
import path from 'node:path';

const source = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), 'src', relativePath), 'utf8');

describe('role dashboard preview links', () => {
  it('keeps preview actions explicit instead of navigating data cards immediately', () => {
    const dashboards = [
      'app/(dashboard)/admin/page.tsx',
      'components/dashboards/SuperintendentDashboard.tsx',
      'components/dashboards/FacilityManagementDashboard.tsx',
    ];

    for (const dashboard of dashboards) {
      expect(source(dashboard)).toContain('Open full page');
    }
  });

  it.each([
    ['app/(dashboard)/admin/security/page.tsx', 'log=', 'app/(dashboard)/admin/audit/page.tsx', "get('log')"],
    ['components/dashboards/SuperintendentDashboard.tsx', 'alert=', 'app/(dashboard)/surveillance/page.tsx', "get('alert')"],
    ['components/dashboards/FacilityManagementDashboard.tsx', 'inquiry=', 'app/(dashboard)/inquiries/page.tsx', "get('inquiry')"],
    ['components/dashboards/FacilityManagementDashboard.tsx', 'request=', 'app/(dashboard)/hr/leave/page.tsx', "get('request')"],
    ['app/(dashboard)/dashboard/state/page.tsx', 'county=', 'app/(dashboard)/hospitals/page.tsx', "get('county')"],
  ])('pairs the %s deep link with a consuming target', (producer, emittedParam, consumer, consumedParam) => {
    expect(source(producer)).toContain(emittedParam);
    expect(source(consumer)).toContain(consumedParam);
  });

  it('focuses staff accounts on both role-specific user pages', () => {
    const dashboard = source('components/dashboards/FacilityManagementDashboard.tsx');
    expect(dashboard).toContain("withFocus(staffListHref, 'user'");
    expect(source('app/(dashboard)/admin/users/page.tsx')).toContain("params.get('user')");
    expect(source('app/(dashboard)/org-admin/users/page.tsx')).toContain("params.get('user')");
  });

  it.each([
    'app/(dashboard)/admin/page.tsx',
    'components/dashboards/SuperintendentDashboard.tsx',
    'components/dashboards/FacilityManagementDashboard.tsx',
  ])('stores %s previews in the URL and closes in-page previews with browser Back', dashboard => {
    const dashboardSource = source(dashboard);
    expect(dashboardSource).toContain("params.set('preview'");
    expect(dashboardSource).toContain('router.back()');
    expect(dashboardSource).toContain("params.delete('preview')");
  });

  it('keeps admin preview URLs limited to validated opaque tokens', () => {
    const dashboard = source('app/(dashboard)/admin/page.tsx');
    expect(dashboard).toContain("openPreview(`kpi:${k.key}`)");
    expect(dashboard).toContain("openPreview('signal:risk')");
    // Every token is resolved back to current dashboard data, never rendered
    // from the URL — a stale or fabricated token yields no preview at all.
    expect(dashboard).toContain("kpis.find(item => `kpi:${item.key}` === previewToken");
    expect(dashboard).not.toContain('setPreview(');
  });

  it('keeps the queues the dashboard dropped reachable from their own modules', () => {
    const dashboard = source('app/(dashboard)/admin/page.tsx');
    // The risk queue and the security watchlist are owned by Risk Center and
    // Security & Compliance now — the dashboard keeps only the signals.
    expect(dashboard).not.toContain('title="Risk & incident queue"');
    expect(dashboard).not.toContain('title="Security watchlist"');
    expect(dashboard).toContain("href: '/admin/risk'");
    expect(dashboard).toContain("router.push('/admin/sync')");
    // The 14-day activity trend the dashboard used to draw lives on Analytics.
    expect(dashboard).not.toContain('ComposedChart');
    expect(source('app/(dashboard)/admin/analytics/page.tsx')).toContain("t('analytics.platformActivity')");
    expect(source('app/(dashboard)/admin/risk/page.tsx')).toContain('title="Risk & incident queue"');
    expect(source('app/(dashboard)/admin/security/page.tsx')).toContain('title="Security watchlist"');
  });
});
