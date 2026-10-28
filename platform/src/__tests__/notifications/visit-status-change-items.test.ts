/**
 * A status picked from any dashboard's dropdown reaches the people it asks
 * something of: the care team, the front desk, and the station the patient is
 * headed to next — never the person who made the change, and never a role the
 * change has nothing to do with.
 */
import { visitStatusChangeItems } from '@/modules/communication/notifications/visit-updates';
import type { AppointmentDoc, EncounterDoc } from '@/lib/db-types';

const NOW = Date.parse('2026-10-27T12:00:00.000Z');
const CHANGED_AT = '2026-10-27T11:30:00.000Z';

function appointment(overrides: Partial<AppointmentDoc> = {}): AppointmentDoc {
  return {
    _id: 'appt-1',
    type: 'appointment',
    patientId: 'patient-1',
    patientName: 'Nyandeng Deng',
    providerId: 'user-dr-1',
    appointmentDate: '2026-10-27',
    status: 'in_progress',
    reminderSent: false,
    statusHistory: [{ from: 'checked_in', to: 'in_progress', at: CHANGED_AT, by: 'user-lab-1', byName: 'Lab Tech Gatluak Puok' }],
    createdAt: '2026-10-27T08:00:00.000Z',
    updatedAt: CHANGED_AT,
    ...overrides,
  } as AppointmentDoc;
}

function encounter(status: EncounterDoc['status']): EncounterDoc {
  return {
    _id: 'enc-1', type: 'clinical_encounter', appointmentId: 'appt-1', patientId: 'patient-1',
    patientName: 'Nyandeng Deng', clinicianId: '', clinicianName: '', hospitalId: 'hosp-001',
    status, stageKey: 'clinic', snapshot: {}, labOrderIds: [], assignedNurseId: 'user-nurse-1',
    createdAt: '2026-10-27T08:00:00.000Z', updatedAt: CHANGED_AT,
  } as unknown as EncounterDoc;
}

const items = (viewer: { _id: string; role: string }, stage: EncounterDoc['status'] = 'with_clinician', appt = appointment()) =>
  visitStatusChangeItems([appt], [encounter(stage)], viewer, NOW, 10);

describe('visitStatusChangeItems audience', () => {
  it('tells the booked provider and the assigned nurse', () => {
    expect(items({ _id: 'user-dr-1', role: 'doctor' })).toHaveLength(1);
    expect(items({ _id: 'user-nurse-1', role: 'nurse' })).toHaveLength(1);
  });

  it('tells the whole front desk', () => {
    expect(items({ _id: 'user-desk-1', role: 'front_desk' })).toHaveLength(1);
    expect(items({ _id: 'user-clerk-1', role: 'clinic_clerk' })).toHaveLength(1);
  });

  it('tells only the station the encounter is waiting on', () => {
    expect(items({ _id: 'user-rx-1', role: 'pharmacist' }, 'awaiting_pharmacy')).toHaveLength(1);
    expect(items({ _id: 'user-rx-1', role: 'pharmacist' }, 'awaiting_labs')).toHaveLength(0);
    expect(items({ _id: 'user-cash-1', role: 'cashier' }, 'ready_for_clinic_checkout')).toHaveLength(1);
  });

  it('skips the person who made the change and unrelated clinicians', () => {
    expect(items({ _id: 'user-lab-1', role: 'lab_tech' }, 'awaiting_labs')).toHaveLength(0);
    expect(items({ _id: 'user-dr-2', role: 'doctor' })).toHaveLength(0);
  });

  it('skips the care team for stage projections they already heard about', () => {
    const projected = appointment({
      statusHistory: [{ from: 'checked_in', to: 'in_progress', at: CHANGED_AT, by: 'user-x', note: 'Projected from encounter stage with_clinician' }],
    });
    expect(items({ _id: 'user-dr-1', role: 'doctor' }, 'with_clinician', projected)).toHaveLength(0);
    expect(items({ _id: 'user-desk-1', role: 'front_desk' }, 'with_clinician', projected)).toHaveLength(1);
  });

  it('ages out after a day and mints a new item per change', () => {
    const old = appointment({ statusHistory: [{ from: 'checked_in', to: 'in_progress', at: '2026-10-25T08:00:00.000Z', by: 'user-lab-1' }] });
    expect(items({ _id: 'user-desk-1', role: 'front_desk' }, 'with_clinician', old)).toHaveLength(0);
    const [item] = items({ _id: 'user-desk-1', role: 'front_desk' });
    expect(item.id).toContain('in_progress');
    expect(item.subtitle).toContain('Lab Tech Gatluak Puok');
  });

  it('flags exits as warnings and carries the reason', () => {
    const cancelled = appointment({
      status: 'cancelled',
      statusHistory: [{ from: 'scheduled', to: 'cancelled', at: CHANGED_AT, by: 'user-desk-2', note: 'Patient travelled' }],
    });
    const [item] = items({ _id: 'user-dr-1', role: 'doctor' }, 'with_clinician', cancelled);
    expect(item.severity).toBe('warning');
    expect(item.subtitle).toContain('Patient travelled');
  });
});
