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
    ['app/(dashboard)/admin/page.tsx', 'org=', 'app/(dashboard)/admin/organizations/page.tsx', "get('org')"],
    ['app/(dashboard)/admin/page.tsx', 'log=', 'app/(dashboard)/admin/audit/page.tsx', "get('log')"],
    ['components/dashboards/SuperintendentDashboard.tsx', 'alert=', 'app/(dashboard)/surveillance/page.tsx', "get('alert')"],
    ['components/dashboards/FacilityManagementDashboard.tsx', 'inquiry=', 'app/(dashboard)/inquiries/page.tsx', "get('inquiry')"],
    ['components/dashboards/FacilityManagementDashboard.tsx', 'request=', 'app/(dashboard)/hr/leave/page.tsx', "get('request')"],
    ['components/dashboards/FacilityOverviewBand.tsx', 'panel=stock', 'app/(dashboard)/pharmacy/page.tsx', "get('panel')"],
    ['components/dashboards/FacilityOverviewBand.tsx', 'status=submitted', 'components/payments/BillingWorkspace.tsx', "get('status')"],
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

  it('routes the merged org-overview band through the host dashboard preview', () => {
    // The Org Overview page (/org-admin) was merged into Facility Management.
    // Its tiles must open the SAME `?preview=` dialog the rail metrics use —
    // a tile that called router.push directly would reintroduce the
    // navigate-on-click behaviour the rest of the suite forbids.
    const band = source('components/dashboards/FacilityOverviewBand.tsx');
    expect(band).toContain('onPreview(card.key)');
    expect(band).toContain('onPreview(tile.key)');
    expect(band).not.toContain('router.push');

    const host = source('components/dashboards/FacilityManagementDashboard.tsx');
    expect(host).toContain('overviewBandPreviewItems(band)');
    expect(host).toContain('onPreview={openMetricPreview}');
  });

  it('keeps admin preview URLs limited to validated opaque tokens', () => {
    const dashboard = source('app/(dashboard)/admin/page.tsx');
    expect(dashboard).toContain("openPreview(`tenant:${row.org._id}`)");
    expect(dashboard).toContain("openPreview(`audit:${log._id}`)");
    expect(dashboard).toContain("riskQueue.find(item => item.token === previewToken)");
    expect(dashboard).not.toContain('setPreview(');
  });
});
