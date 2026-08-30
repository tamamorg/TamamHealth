/**
 * `mapsToUserRoles` is what turns a platform `UserRole` into a real
 * clinical-flow capability set (KAN-100 audit item 7). Four platform roles
 * held ZERO capabilities because they were missing from any clinical-flow
 * role's mapping: the `triage_nurse` and `rooming_nurse` UserRoles were
 * absent from their own same-named clinical-flow role, `midwife` (who
 * performs triage-style acuity assessment for maternity presentations —
 * role-routes.ts grants `/triage`) was absent entirely, and `super_admin`
 * (who lands on the shared `/dashboard` clinical workspace) had no
 * capabilities there either.
 */
import { capabilitiesForUserRole } from '@/lib/clinical-flow/capabilities';
import type { UserRole } from '@/lib/db-types';

describe('capabilitiesForUserRole — previously-uncovered platform roles', () => {
  const PREVIOUSLY_EMPTY: UserRole[] = ['triage_nurse', 'rooming_nurse', 'midwife', 'super_admin'];

  it.each(PREVIOUSLY_EMPTY)('%s holds at least one real clinical-flow capability', (role) => {
    expect(capabilitiesForUserRole(role).size).toBeGreaterThan(0);
  });

  it('the platform triage_nurse role gets triage + vitals capture', () => {
    const caps = capabilitiesForUserRole('triage_nurse');
    expect(caps.has('triage')).toBe(true);
    expect(caps.has('vitals_capture')).toBe(true);
    expect(caps.has('patient_routing')).toBe(true);
  });

  it('the platform rooming_nurse role gets rooming + vitals capture', () => {
    const caps = capabilitiesForUserRole('rooming_nurse');
    expect(caps.has('rooming')).toBe(true);
    expect(caps.has('vitals_capture')).toBe(true);
  });

  it('midwife retains triage capability for maternal acuity assessment', () => {
    expect(capabilitiesForUserRole('midwife').has('triage')).toBe(true);
  });

  it('super_admin holds both triage and rooming capabilities on the shared workspace', () => {
    const caps = capabilitiesForUserRole('super_admin');
    expect(caps.has('triage')).toBe(true);
    expect(caps.has('rooming')).toBe(true);
  });
});
