import {
  buildClinicalAppointmentHref,
  buildClinicalDashboardHref,
  clinicalDashboardDay,
  clinicalDashboardLane,
} from '@/components/ehr/EhrClinicalDashboard';

describe('clinical dashboard URL state', () => {
  it('updates dashboard state without dropping unrelated query parameters', () => {
    const href = buildClinicalDashboardHref(
      '/dashboard',
      'locale=apd&day=2026-08-18&lane=scheduled',
      { day: '2026-08-19', lane: 'in_office', appointment: 'apt-42' },
    );

    expect(href).toBe('/dashboard?locale=apd&day=2026-08-19&lane=in_office&appointment=apt-42');
  });

  it('removes only the state being closed', () => {
    const href = buildClinicalDashboardHref(
      '/dashboard',
      'day=2026-08-19&lane=finished&appointment=apt-42&from=handoff',
      { appointment: null },
    );

    expect(href).toBe('/dashboard?day=2026-08-19&lane=finished&from=handoff');
  });

  it('falls back from invalid day and lane parameters', () => {
    expect(clinicalDashboardDay('day=2026-02-30', '2026-08-19')).toBe('2026-08-19');
    expect(clinicalDashboardDay('day=2026-08-17', '2026-08-19')).toBe('2026-08-17');
    expect(clinicalDashboardLane('lane=unknown')).toBe('scheduled');
    expect(clinicalDashboardLane('lane=in_office')).toBe('in_office');
  });

  it('keeps the complete dashboard state as the full-page return destination', () => {
    const href = buildClinicalAppointmentHref(
      'apt/42',
      '/dashboard?day=2026-08-19&lane=in_office&appointment=apt%2F42&locale=apd',
    );
    const url = new URL(href, 'https://tamamhealth.test');

    expect(url.pathname).toBe('/appointments');
    expect(url.searchParams.get('appointment')).toBe('apt/42');
    expect(url.searchParams.get('returnTo')).toBe(
      '/dashboard?day=2026-08-19&lane=in_office&appointment=apt%2F42&locale=apd',
    );
  });
});
