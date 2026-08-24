/** @jest-environment node */
/**
 * A settings page has to belong to the person reading it.
 *
 * `specForRole` derived five specs by spreading another and overwriting the
 * title. That changed the heading and nothing else, so three roles were served
 * another profession's controls:
 *
 *   Radiologist    = { ...LAB }    — a *Bench filter* of "Chemistry ·
 *                                    Microscopy / Haematology / Serology", a
 *                                    *Reject reason list*, and *Barcode label
 *                                    at collection*, for a discipline that
 *                                    handles no samples. Start-up screen: the
 *                                    lab worklist.
 *   Midwife        = { ...NURSE }  — a general-nursing ward list
 *                                    (Medical / Surgical / Maternity /
 *                                    Pediatric) and a scope note about triage
 *                                    scales.
 *   Health authority = { ...ADMIN }— facility profile, clinical policy and
 *                                    offline-sync configuration, handed to a
 *                                    ministry account that runs no facility.
 *
 * Clinical Officer ≈ Doctor and Billing ≈ Front desk are genuine overlaps and
 * still share a spec. These tests pin the three that were not.
 */
import { specForRole } from '@/lib/role-settings';
import type { RoleSettingRow } from '@/lib/role-settings';
import { LANDING_ROUTES } from '@/lib/user-prefs';
import { ROLE_ROUTE_TABLE, isPathAllowed } from '@/lib/role-routes';
import type { UserRole } from '@/lib/db-types';

const textOf = (role: UserRole) => {
  const spec = specForRole(role);
  return [
    spec.subtitle, spec.scope, ...spec.chips,
    ...spec.sections.flatMap(s => [s.title, s.note,
      ...s.rows.flatMap(r => [r.label, r.hint, ...(r.kind === 'select' ? r.options : [])])]),
  ].join(' ').toLowerCase();
};

const keysOf = (role: UserRole) => specForRole(role).sections
  .flatMap(s => s.rows as RoleSettingRow[])
  .filter(r => r.kind === 'toggle' || r.kind === 'select')
  .map(r => (r as { key: string }).key);

describe('a radiologist is not a laboratory technician', () => {
  it('is offered no sample-handling controls', () => {
    const text = textOf('radiologist');
    for (const word of ['bench', 'sample', 'specimen', 'reagent', 'haematology', 'serology']) {
      expect(text).not.toContain(word);
    }
  });

  it('keeps only the worklist keys that describe any reporting queue', () => {
    // Sharing `lab.sort` / `lab.statTop` / `lab.tat` with the lab is deliberate
    // — one worklist concept, one stored preference. Sharing the bench filter
    // was not.
    expect(keysOf('radiologist')).not.toContain('lab.bench');
  });

  it('does not send them to the lab worklist at sign-in', () => {
    expect(textOf('radiologist')).not.toContain('lab worklist');
  });
});

describe('a midwife works in a maternity area', () => {
  it('is offered maternity areas, not the general ward list', () => {
    const ward = specForRole('midwife').sections
      .flatMap(s => s.rows as RoleSettingRow[])
      .find(r => 'key' in r && r.key === 'ward.default');
    expect(ward).toBeDefined();
    expect(ward!.kind).toBe('select');
    const options = (ward as { options: string[] }).options;
    expect(options).toEqual(expect.arrayContaining(['Labour ward', 'Postnatal']));
    expect(options).not.toContain('Surgical');
  });

  it('has its own spec, not the nurse one relabelled', () => {
    expect(specForRole('midwife')).not.toBe(specForRole('nurse'));
    expect(specForRole('midwife').subtitle).not.toBe(specForRole('nurse').subtitle);
  });
});

describe('a health authority runs no facility', () => {
  it.each(['government', 'county_health_director'] as UserRole[])(
    '%s is offered no facility configuration', role => {
      const ids = specForRole(role).sections.map(s => s.id);
      for (const id of ['facility', 'clinical', 'reporting', 'integrations', 'users']) {
        expect(ids).not.toContain(id);
      }
    });

  it('still gets the surveillance alert that is the job', () => {
    expect(keysOf('government')).toContain('notify.surveillance');
  });
});

describe('every role', () => {
  const ROLES = Object.keys(ROLE_ROUTE_TABLE) as UserRole[];

  it.each(ROLES)('%s is offered only start-up screens it can enter', role => {
    const landing = specForRole(role).sections
      .flatMap(s => s.rows as RoleSettingRow[])
      .find(r => 'key' in r && r.key === 'account.landing');
    if (!landing || landing.kind !== 'select') return;
    // An option absent from LANDING_ROUTES resolves to the role's default
    // dashboard, which is fine. An option that maps to a route the proxy would
    // refuse is a dropdown entry that silently does nothing.
    const unreachable = landing.options
      .filter(o => LANDING_ROUTES[o])
      .filter(o => !isPathAllowed(role, LANDING_ROUTES[o]));
    expect(unreachable).toEqual([]);
  });
});
