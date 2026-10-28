/**
 * The CouchDB validator enforces the same status moves the app does
 * (canRoleMoveAppointment), so a client that skips the app — a raw PouchDB
 * write replicated up — still cannot reopen a cancelled visit or check a
 * patient in from the lab bench.
 */
import { ORG_SCOPED_VALIDATE_FN } from '@/lib/sync/validate-doc-update';
import { APPOINTMENT_STATUS_TRANSITIONS } from '@/lib/sync/write-permissions';
import { canRoleMoveAppointment } from '@/lib/appointment-status';
import type { AppointmentStatus, UserRole } from '@/lib/db-types';

type Validate = (n: Record<string, unknown>, o: Record<string, unknown> | null, u: { roles: string[] }, s?: unknown) => void;
const validate = new Function(`return (${ORG_SCOPED_VALIDATE_FN});`)() as Validate;

const user = (role: string) => ({ roles: ['org:org-a', `role:${role}`, `user:user-${role}`, 'facility:hosp-a'] });
const appt = (status: string, extra: Record<string, unknown> = {}) => ({
  _id: 'appt-1', _rev: '3-x', type: 'appointment', orgId: 'org-a', facilityId: 'hosp-a',
  patientId: 'p-1', status, ...extra,
});
function refusal(role: string, from: string, to: string): string | null {
  try {
    validate(appt(to, { updatedAt: 'later' }), appt(from), user(role), {});
    return null;
  } catch (error) {
    return (error as { forbidden?: string }).forbidden ?? 'thrown';
  }
}

describe('appointment status moves at the validator', () => {
  it('refuses a station reopening a cancelled visit or checking a patient in', () => {
    expect(refusal('lab_tech', 'cancelled', 'in_progress')).toMatch(/may not move an appointment from cancelled to in_progress/);
    expect(refusal('cashier', 'scheduled', 'in_progress')).toMatch(/may not move/);
    expect(refusal('pharmacist', 'checked_in', 'no_show')).toMatch(/may not move/);
  });

  it('accepts a station moving a checked-in patient along its own rungs', () => {
    expect(refusal('lab_tech', 'checked_in', 'in_progress')).toBeNull();
    expect(refusal('pharmacist', 'in_progress', 'completed')).toBeNull();
  });

  it('refuses a clinician reopening a no-show, accepts a forward move', () => {
    expect(refusal('doctor', 'no_show', 'checked_in')).toMatch(/may not move/);
    expect(refusal('nurse', 'checked_in', 'triaged')).toBeNull();
  });

  it('leaves reception unconstrained and ignores edits that keep the status', () => {
    expect(refusal('front_desk', 'cancelled', 'scheduled')).toBeNull();
    expect(refusal('lab_tech', 'cancelled', 'cancelled')).toBeNull();
  });

  it('is generated from the same rule the app applies', () => {
    for (const [role, moves] of Object.entries(APPOINTMENT_STATUS_TRANSITIONS)) {
      for (const [from, tos] of Object.entries(moves)) {
        for (const to of tos) {
          if (to !== from) expect(canRoleMoveAppointment(role as UserRole, from as AppointmentStatus, to as AppointmentStatus)).toBe(true);
        }
      }
    }
    expect(APPOINTMENT_STATUS_TRANSITIONS.front_desk).toBeUndefined();
    expect(APPOINTMENT_STATUS_TRANSITIONS.lab_tech).toBeDefined();
  });
});
