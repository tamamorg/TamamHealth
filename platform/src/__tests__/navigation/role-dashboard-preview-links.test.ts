import fs from 'node:fs';
import path from 'node:path';

const source = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), 'src', relativePath), 'utf8');

describe('role dashboard preview links', () => {
  it.each([
    ['components/dashboards/SuperintendentDashboard.tsx', 'router.push(k.href)'],
    ['components/dashboards/FacilityManagementDashboard.tsx', 'router.push(m.href)'],
  ])('%s navigates straight to the page that owns a figure — no preview popup', (dashboard, push) => {
    // 2026-11-04 (user): "remove the chevron icon and the pop up, delete them
    // completely, when clicked they should take you to the entire place of
    // that data instead". The role dashboards now behave like /admin did
    // since 2026-08-23: a tile opens its page.
    const dashboardSource = source(dashboard);
    expect(dashboardSource).not.toContain('PreviewDialog');
    expect(dashboardSource).not.toContain("params.set('preview'");
    expect(dashboardSource).not.toMatch(/onExpand=\{onOpen\}/);
    expect(dashboardSource).toContain(push);
  });

  it.each([
    ['app/(dashboard)/admin/security/page.tsx', 'log=', 'app/(dashboard)/admin/audit/page.tsx', "get('log')"],
    ['components/dashboards/SuperintendentDashboard.tsx', 'alert=', 'app/(dashboard)/surveillance/page.tsx', "get('alert')"],
    // The queue left the Facility Management dashboard for its own page on
    // 2026-08-24; the deep links moved with it.
    ['app/(dashboard)/facility-management/queue/page.tsx', 'inquiry=', 'app/(dashboard)/inquiries/page.tsx', "get('inquiry')"],
    ['app/(dashboard)/facility-management/queue/page.tsx', 'request=', 'app/(dashboard)/hr/leave/page.tsx', "get('request')"],
    // The county drill-down's old consumer was the national facility list at
    // /hospitals, deleted with that route. It lands on the console root as a
    // facility search now, and `q` is matched against county there.
    ['app/(dashboard)/dashboard/state/page.tsx', 'q=', 'modules/tenancy/components/OrganizationDetail.tsx', "params.get('q')"],
  ])('pairs the %s deep link with a consuming target', (producer, emittedParam, consumer, consumedParam) => {
    expect(source(producer)).toContain(emittedParam);
    expect(source(consumer)).toContain(consumedParam);
  });

  it('focuses staff accounts in the shared people workspace', () => {
    const queue = source('app/(dashboard)/facility-management/queue/page.tsx');
    expect(queue).toContain("withFocus(staffListHref, 'user'");
    expect(source('modules/tenancy/components/ManagementWorkspace.tsx')).toContain("params.get('user')");
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

  it('every row opens the rung beneath it — no menu in the way', () => {
    // 2026-08-24: the row click was briefly a menu at the pointer (edit, drill
    // down, deactivate, open full page). It is the record's own page again,
    // because that page already carries every one of those actions — and a
    // click that has already named a record should not then ask which of five
    // things it meant.
    //
    // 2026-08-26: and the pages are a chain rather than three flat lists, so
    // this asserts each level opens the next rather than all three opening
    // from one registry.
    const registry = source('modules/tenancy/components/ManagementWorkspace.tsx');
    const organization = source('modules/tenancy/components/OrganizationDetail.tsx');
    const facility = source('components/facilities/FacilityProfile.tsx');
    for (const trace of ['TenantCard', 'RowActionsPopup', 'rowActionsAt']) {
      expect(registry).not.toContain(trace);
    }
    expect(registry).toContain('router.push(organizationHref(org))');
    expect(organization).toContain('router.push(facilityHref(facility))');
    expect(facility).toContain('/admin/users/');
    // A role whose allow-list has no tenant page gets an inert row rather than
    // a link the Edge proxy bounces back to its dashboard.
    expect(registry).toContain("isPathAllowed(currentUser.role, '/admin/organizations')");
    // Deactivating a tenant happens on the tenant, not on a list of every
    // other one — the bounce to ?deactivate=1 is gone.
    expect(organization).toContain('setConfirmDeactivate(true)');
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
