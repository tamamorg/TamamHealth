/**
 * Refused writes, caught before they leave the device and named when they do.
 *
 *  - fieldsOutsideAmendGrant mirrors the validator's amend-only rule, so a
 *    clinical role's reschedule is refused at save time instead of landing in
 *    local PouchDB and sitting behind a "Sync error" banner.
 *  - describeDenial reads PouchDB's 'denied' payload, which is a plain object:
 *    the old `instanceof Error` check reduced every refusal to "Access denied".
 */
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { appointmentsDB } from '@/lib/db';
import type { AppointmentDoc } from '@/lib/db-types';
import { fieldsOutsideAmendGrant } from '@/lib/sync/write-permissions';
import { describeDenial } from '@/lib/sync/sync-service';
import {
  updateAppointment, rescheduleAppointment, AppointmentAmendNotAllowedError,
} from '@/lib/services/appointment-service';
import { teardownTestDBs } from '../helpers/test-db';

const booked: AppointmentDoc = {
  _id: 'apt-amend', type: 'appointment', patientId: 'patient-1', patientName: 'Patient One',
  providerId: 'doctor-1', providerName: 'Doctor One', facilityId: 'facility-1', facilityName: 'Hospital One',
  facilityLevel: 'county', appointmentDate: '2026-10-20', appointmentTime: '09:00', duration: 30,
  appointmentType: 'follow_up', priority: 'routine', department: 'OPD', reason: 'Review', status: 'scheduled',
  reminderSent: false, isRecurring: false, bookedBy: 'doctor-1', bookedByName: 'Doctor One',
  state: 'Central Equatoria', orgId: 'org-1', createdAt: '2026-10-17T08:00:00Z', updatedAt: '2026-10-17T08:00:00Z',
  // On the server already: a pull or a push has confirmed it.
  offlineSync: { status: 'synced', lastSyncedAt: '2026-10-17T08:01:00Z' },
};

afterEach(async () => { await teardownTestDBs(); });

describe('fieldsOutsideAmendGrant', () => {
  const before = booked as unknown as Record<string, unknown>;

  it('lets reception change anything', () => {
    expect(fieldsOutsideAmendGrant('appointment', 'front_desk', before, { ...before, appointmentTime: '11:00' })).toEqual([]);
  });

  it('names the scheduling fields a doctor may not amend', () => {
    const after = { ...before, appointmentDate: '2026-10-21', appointmentTime: '11:00', notes: 'ok' };
    expect(fieldsOutsideAmendGrant('appointment', 'doctor', before, after).sort())
      .toEqual(['appointmentDate', 'appointmentTime']);
  });

  it('allows a doctor the status and note fields', () => {
    const after = { ...before, status: 'checked_in', notes: 'arrived', updatedAt: 'x' };
    expect(fieldsOutsideAmendGrant('appointment', 'doctor', before, after)).toEqual([]);
  });

  it('counts a removed field the way the validator does', () => {
    const after = { ...before };
    delete after.providerName;
    expect(fieldsOutsideAmendGrant('appointment', 'doctor', before, after)).toEqual(['providerName']);
  });
});

describe('appointment writes refuse what the server would refuse', () => {
  it('a doctor rescheduling a synced booking is stopped before the local write', async () => {
    await appointmentsDB().put(booked);
    await expect(rescheduleAppointment(booked._id, '2026-10-21', '11:00', 'doctor'))
      .rejects.toBeInstanceOf(AppointmentAmendNotAllowedError);
    const stored = await appointmentsDB().get(booked._id) as AppointmentDoc;
    expect(stored.appointmentDate).toBe('2026-10-20');
  });

  it('the refusal message names the fields in words, not keys', async () => {
    await appointmentsDB().put(booked);
    await expect(updateAppointment(booked._id, { appointmentTime: '11:00' }, 'doctor'))
      .rejects.toThrow('Only the front desk can change the time of a booked appointment');
  });

  it('a doctor may still edit the note on their booking', async () => {
    await appointmentsDB().put(booked);
    const updated = await updateAppointment(booked._id, { notes: 'Bring results' }, 'doctor');
    expect(updated?.notes).toBe('Bring results');
  });

  it('reception reschedules freely', async () => {
    await appointmentsDB().put(booked);
    const updated = await updateAppointment(booked._id, { appointmentTime: '11:00' }, 'front_desk');
    expect(updated?.appointmentTime).toBe('11:00');
  });

  it('a booking this device created and never pushed is still a create, so its author may reshape it', async () => {
    await appointmentsDB().put({ ...booked, offlineSync: { status: 'pending', lastLocalChangeAt: '2026-10-17T08:00:00Z' } });
    const updated = await updateAppointment(booked._id, { appointmentTime: '11:00' }, 'doctor');
    expect(updated?.appointmentTime).toBe('11:00');
  });
});

describe('describeDenial', () => {
  it('keeps the document id and the validator reason from the PouchDB payload', () => {
    const d = describeDenial({ id: 'apt-1', error: 'forbidden', reason: 'role doctor may not amend appointmentDate on appointment', status: 403 }, 'now');
    expect(d).toEqual({ id: 'apt-1', reason: 'role doctor may not amend appointmentDate on appointment', at: 'now' });
  });

  it('falls back to a generic reason for an empty payload', () => {
    expect(describeDenial(undefined, 'now')).toEqual({ id: '', reason: 'Access denied', at: 'now' });
  });
});

describe('fieldsOutsideAmendGrant — roles with no grant at all', () => {
  it('a role with neither full write nor an amend grant may change nothing', () => {
    const before = booked as unknown as Record<string, unknown>;
    expect(fieldsOutsideAmendGrant('appointment', 'government', before, { ...before, notes: 'x' })).toEqual(['notes']);
  });
});
