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
    // The queue left the Facility Management dashboard for its own page on
    // 2026-08-24; the deep links moved with it.
    ['app/(dashboard)/facility-management/queue/page.tsx', 'inquiry=', 'app/(dashboard)/inquiries/page.tsx', "get('inquiry')"],
    ['app/(dashboard)/facility-management/queue/page.tsx', 'request=', 'app/(dashboard)/hr/leave/page.tsx', "get('request')"],
    ['app/(dashboard)/dashboard/state/page.tsx', 'county=', 'components/facilities/FacilityNetworkView.tsx', "get('county')"],
  ])('pairs the %s deep link with a consuming target', (producer, emittedParam, consumer, consumedParam) => {
    expect(source(producer)).toContain(emittedParam);
    expect(source(consumer)).toContain(consumedParam);
  });

  it('focuses staff accounts in the shared people workspace', () => {
    const queue = source('app/(dashboard)/facility-management/queue/page.tsx');
    expect(queue).toContain("withFocus(staffListHref, 'user'");
    expect(source('modules/tenancy/components/ManagementWorkspace.tsx')).toContain("params.get('user')");
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

  it('admin dashboard navigates directly — no popup stops', () => {
    // 2026-08-23: the super-admin dashboard's preview dialog and tenant card
    // were removed. Every click lands on the page that owns the figure and
    // its actions.
    const dashboard = source('app/(dashboard)/admin/page.tsx');
    expect(dashboard).not.toContain('PreviewDialog');
    expect(dashboard).not.toContain("params.set('preview'");
    expect(dashboard).not.toContain('TenantCard');
    expect(dashboard).toContain('router.push(k.href!)');
    expect(dashboard).toContain("router.push('/admin/risk')");
    expect(dashboard).toContain('router.push(`/admin/organizations/${org._id}`)');
  });

  it('registry rows open the record itself — no menu in the way', () => {
    // 2026-08-24: the row click was briefly a menu at the pointer (edit, drill
    // down, deactivate, open full page). It is the record's own page again,
    // because that page already carries every one of those actions — and a
    // click that has already named a record should not then ask which of five
    // things it meant.
    //
    // Nothing is stranded by that: a facility is retired on the facility page,
    // a person is deactivated on theirs, the tenant page still hands its
    // Deactivate back here as ?deactivate=1, and a deactivated tenant is
    // restored from the Trash panel — which is the only list that holds one.
    const registry = source('modules/tenancy/components/ManagementWorkspace.tsx');
    expect(registry).not.toContain('TenantCard');
    expect(registry).not.toContain('RowActionsPopup');
    expect(registry).not.toContain('rowActionsAt');
    expect(registry).toContain('openRecord(organizationHref(org))');
    expect(registry).toContain('openRecord(facilityHref(facility))');
    expect(registry).toContain('openRecord(personHref(user._id))');
    // A role whose allow-list has no such page gets an inert row rather than a
    // link the Edge proxy bounces back to its dashboard.
    expect(registry).toContain("opensRecord('/admin/users')");
    expect(registry).toContain("params.has('deactivate')");
    expect(source('components/settings/TrashPanel.tsx')).toContain('restore(');
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
