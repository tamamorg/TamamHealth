import fs from 'node:fs';
import path from 'node:path';

const source = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), 'src', relativePath), 'utf8');

describe('role dashboard preview links', () => {
  it('keeps preview actions explicit instead of navigating data cards immediately', () => {
    // The super-admin dashboard is deliberately NOT in this list: its popups
    // were removed 2026-08-23 — a tile, the risk signal, and a tenant row
    // navigate straight to the page where the thing is acted on (see the
    // direct-navigation test below). The role dashboards keep their previews.
    const dashboards = [
      'components/dashboards/SuperintendentDashboard.tsx',
      'components/dashboards/FacilityManagementDashboard.tsx',
    ];

    for (const dashboard of dashboards) {
      // The action, not the wording: it moved into the card head as an icon
      // (the footer used to repeat the head's expand and close). What must
      // not change is that a preview offers an explicit way to open the page
      // instead of navigating the moment you click a card.
      expect(source(dashboard)).toContain('data-action="preview-expand"');
    }
  });

  it.each([
    ['app/(dashboard)/admin/security/page.tsx', 'log=', 'app/(dashboard)/admin/audit/page.tsx', "get('log')"],
    ['components/dashboards/SuperintendentDashboard.tsx', 'alert=', 'app/(dashboard)/surveillance/page.tsx', "get('alert')"],
    ['components/dashboards/FacilityManagementDashboard.tsx', 'inquiry=', 'app/(dashboard)/inquiries/page.tsx', "get('inquiry')"],
    ['components/dashboards/FacilityManagementDashboard.tsx', 'request=', 'app/(dashboard)/hr/leave/page.tsx', "get('request')"],
    ['app/(dashboard)/dashboard/state/page.tsx', 'county=', 'components/facilities/FacilityNetworkView.tsx', "get('county')"],
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
    'components/dashboards/SuperintendentDashboard.tsx',
    'components/dashboards/FacilityManagementDashboard.tsx',
  ])('stores %s previews in the URL and closes in-page previews with browser Back', dashboard => {
    const dashboardSource = source(dashboard);
    expect(dashboardSource).toContain("params.set('preview'");
    expect(dashboardSource).toContain('router.back()');
    expect(dashboardSource).toContain("params.delete('preview')");
  });

  it('admin dashboard and registry navigate directly — no popup stops', () => {
    // 2026-08-23: the super-admin dashboard's preview dialog and tenant card,
    // and the registry's tenant pop card, were all removed. Every click lands
    // on the page that owns the figure and its actions.
    const dashboard = source('app/(dashboard)/admin/page.tsx');
    expect(dashboard).not.toContain('PreviewDialog');
    expect(dashboard).not.toContain("params.set('preview'");
    expect(dashboard).not.toContain('TenantCard');
    expect(dashboard).toContain('router.push(k.href!)');
    expect(dashboard).toContain("router.push('/admin/risk')");
    expect(dashboard).toContain('router.push(`/admin/organizations/${org._id}`)');

    const registry = source('app/(dashboard)/admin/organizations/page.tsx');
    expect(registry).not.toContain('TenantCard');
    expect(registry).toContain('router.push(`/admin/organizations/${org._id}`)');
    // The org page reaches the registry-owned deactivate confirm by deep link.
    expect(registry).toContain("params.has('deactivate')");
    expect(source('app/(dashboard)/admin/organizations/[id]/page.tsx')).toContain('&deactivate=1');
  });

  it('keeps the queues the dashboard dropped reachable from their own modules', () => {
    const dashboard = source('app/(dashboard)/admin/page.tsx');
    // The risk queue and the security watchlist are owned by Risk Center and
    // Security & Compliance now — the dashboard keeps only the signals.
    expect(dashboard).not.toContain('title="Risk & incident queue"');
    expect(dashboard).not.toContain('title="Security watchlist"');
    expect(dashboard).toContain("router.push('/admin/risk')");
    expect(dashboard).toContain("router.push('/admin/sync')");
    // The 14-day activity trend the dashboard used to draw lives on Analytics.
    expect(dashboard).not.toContain('ComposedChart');
    expect(source('app/(dashboard)/admin/analytics/page.tsx')).toContain("t('analytics.platformActivity')");
    expect(source('app/(dashboard)/admin/risk/page.tsx')).toContain('title="Risk & incident queue"');
    expect(source('app/(dashboard)/admin/security/page.tsx')).toContain('title="Security watchlist"');
  });
});
