import { journeyTourForRole } from '@/lib/tour/journey-tours';
import type { UserRole } from '@/lib/db-types';

const NURSING_ROLES: UserRole[] = ['nurse', 'midwife', 'triage_nurse', 'rooming_nurse'];
const SHARED_DASHBOARD = '/dashboard';

// The standalone nurse station (/dashboard/nurse and its /ward, /mar,
// /triage, /handoff sub-routes) is retired: those paths are now redirect
// stubs to /dashboard, /wards, /wards, /dashboard, and /wards/handoff
// respectively (see the page.tsx files under app/(dashboard)/dashboard/nurse).
// A tour step that still routed to '/dashboard/nurse' used to cause an
// infinite redirect loop — the stub pushes to /dashboard, the tour effect
// sees the pathname change and pushes back to /dashboard/nurse, forever.
// Every assertion below exists to keep that regression from coming back.
const NURSE_STATION_ROUTE_PATTERN = /^\/dashboard\/nurse(\/|$)/;

describe.each(NURSING_ROLES)('%s guided journey', role => {
  const tour = journeyTourForRole(role);

  it('is defined and never routes through the retired nurse station', () => {
    expect(tour).toBeDefined();
    expect(tour!.steps.length).toBeGreaterThanOrEqual(3);
    for (const step of tour!.steps) {
      expect(step.route).not.toMatch(NURSE_STATION_ROUTE_PATTERN);
    }
  });

  it('lands the worklist and outstanding-items steps on the shared dashboard', () => {
    const worklist = tour!.steps.find(s => s.id === 'worklist');
    const outstanding = tour!.steps.find(s => s.id === 'dash-outstanding');
    expect(worklist?.route).toBe(SHARED_DASHBOARD);
    expect(worklist?.target).toBe('.ehr-appointment-list');
    expect(outstanding?.route).toBe(SHARED_DASHBOARD);
    expect(outstanding?.target).toBe('.ehr-outstanding-card');
  });

  it('describes triage and rooming narratively, with no per-patient route', () => {
    const step = tour!.steps.find(s => s.id === 'triage-rooming');
    expect(step).toBeDefined();
    expect(step!.route).toBe(SHARED_DASHBOARD);
    // No real anchor exists for this on /dashboard (triage/rooming both
    // require a real patient id) — it must render as a centred narrative
    // card, not point at an invented selector.
    expect(step!.target).toBe('');
    expect(step!.preClickSelector).toBeUndefined();
  });

  it('sends the ward-board step to the real /wards route', () => {
    const step = tour!.steps.find(s => s.id === 'ward-board');
    expect(step?.route).toBe('/wards');
  });

  it('anchors the handoff step on the dedicated /wards/handoff page', () => {
    const step = tour!.steps.find(s => s.id === 'handoff');
    expect(step?.route).toBe('/wards/handoff');
    expect(step?.target).toBe('[data-tour="handoff-sbar"]');
  });

  it('runs search, messaging, and finish on the shared dashboard', () => {
    const search = tour!.steps.find(s => s.id === 'search');
    const messaging = tour!.steps.find(s => s.id === 'messaging');
    const finish = tour!.steps.find(s => s.id === 'finish');
    expect(search?.route).toBe(SHARED_DASHBOARD);
    expect(messaging?.route).toBe(SHARED_DASHBOARD);
    expect(finish?.route).toBe(SHARED_DASHBOARD);
  });
});
