import { resolveRouteContext, routeContextBackHref } from '@/lib/navigation/route-context';

describe('route context navigation', () => {
  it.each([
    '/dashboard',
    '/patients',
    '/admin',
    '/org-admin',
    '/government',
    '/hr',
    '/settings',
  ])('does not add a bar to top-level route %s', pathname => {
    expect(resolveRouteContext(pathname)).toBeNull();
  });

  it('maps an administrative child to its real parent', () => {
    expect(resolveRouteContext('/admin/security')).toEqual({
      fallbackHref: '/admin',
      showBack: true,
      crumbs: [
        { href: '/admin', labelKey: 'breadcrumb.admin' },
        { labelKey: 'routeContext.security' },
      ],
    });
  });

  it('maps dynamic records without exposing their identifier as a label', () => {
    const patientId = 'patient-secret-123';
    const result = resolveRouteContext(`/patients/${patientId}`);

    expect(result).toEqual({
      fallbackHref: '/patients',
      showBack: false,
      crumbs: [
        { href: '/patients', labelKey: 'breadcrumb.patients' },
        { labelKey: 'routeContext.patientRecord' },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(patientId);
  });

  it('uses a validated returnTo before the parent fallback', () => {
    const context = resolveRouteContext('/patients/patient-1')!;
    expect(routeContextBackHref(context, '/dashboard?lane=in_office', '/patients/patient-1'))
      .toBe('/dashboard?lane=in_office');
  });

  it.each(['https://attacker.example', '//attacker.example', 'javascript:alert(1)'])
  ('rejects an unsafe returnTo: %s', returnTo => {
    const context = resolveRouteContext('/billing/bill-1')!;
    expect(routeContextBackHref(context, returnTo, '/billing/bill-1')).toBe('/billing');
  });

  it('does not create a self-referencing Back link', () => {
    const context = resolveRouteContext('/notes/note-1')!;
    expect(routeContextBackHref(context, '/notes/note-1?tab=history', '/notes/note-1'))
      .toBe('/notes');
  });

  it('ignores unknown nested paths instead of guessing navigation', () => {
    expect(resolveRouteContext('/admin/not-a-real-page')).toBeNull();
    expect(resolveRouteContext('/patients/patient-1/unknown')).toBeNull();
  });
});
