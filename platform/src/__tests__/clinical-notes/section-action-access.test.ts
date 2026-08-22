/**
 * @jest-environment node
 *
 * A note action that navigates must not be offered to a role that cannot
 * follow it.
 *
 * Every plan action opens a dialog over the note except "Vaccines", which
 * pushes to `/immunizations?patientId=…`. It was listed for everyone who can
 * write a note, so a role without that module got the button like anyone else
 * and landed on "Access Restricted" halfway through documenting a visit.
 */

import { actionsForSection } from '@/lib/clinical-notes/section-actions';
import { ROLE_ROUTE_TABLE, isPathAllowed } from '@/lib/role-routes';
import type { UserRole } from '@/lib/db-types';

const NOTE_ROLES = (Object.keys(ROLE_ROUTE_TABLE) as UserRole[])
  .filter(role => isPathAllowed(role, '/notes'));

const ids = (section: string, role?: string) => actionsForSection(section, role).map(a => a.id);

describe('note plan actions respect route access', () => {
  test('the roles that write notes are the ones this gate is about', () => {
    // Guards the premise: if /notes access changes, this suite should be re-read.
    expect(NOTE_ROLES.length).toBeGreaterThan(0);
  });

  test.each(NOTE_ROLES)('%s is offered Vaccines only with the immunizations module', role => {
    const offered = ids('plan', role).includes('order_vaccine');
    expect(offered).toBe(isPathAllowed(role, '/immunizations'));
  });

  test('the dialog actions are never gated — they leave nothing to navigate to', () => {
    for (const role of NOTE_ROLES) {
      expect(ids('plan', role)).toEqual(
        expect.arrayContaining(['prescribe', 'order_lab', 'patient_education', 'refer']),
      );
    }
  });

  test('no role argument returns the full catalogue', () => {
    // Server-side and catalogue callers keep every action.
    expect(ids('plan')).toContain('order_vaccine');
  });

  test('a role without the module loses only that action', () => {
    const supt = ids('plan', 'medical_superintendent');
    const doctor = ids('plan', 'doctor');
    expect(doctor).toContain('order_vaccine');
    expect(supt).not.toContain('order_vaccine');
    expect(supt).toEqual(doctor.filter(id => id !== 'order_vaccine'));
  });
});
