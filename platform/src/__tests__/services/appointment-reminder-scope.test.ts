/**
 * The overdue, no-show and missed-follow-up views used to read every
 * organisation's appointments; only the upcoming view was scoped.
 */
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { getDB } from '@/lib/db';
import { getMissedFollowUps, getNoShowStats, getOverdueAppointments } from '@/lib/services/appointment-reminder-service';
import type { DataScope } from '@/lib/services/data-scope';

const scopeA = { orgId: 'org-a', hospitalId: 'h-a', role: 'org_admin' } as DataScope;
const appt = (id: string, orgId: string, extra: object) => putDoc(getDB('tamamhealth_appointments'), {
  _id: id, type: 'appointment', orgId, facilityId: orgId === 'org-a' ? 'h-a' : 'h-b', hospitalId: orgId === 'org-a' ? 'h-a' : 'h-b',
  patientId: `p-${id}`, patientName: 'X', appointmentDate: '2026-01-10', appointmentTime: '09:00', status: 'scheduled', ...extra,
} as never);

beforeEach(async () => {
  await appt('a1', 'org-a', {});
  await appt('b1', 'org-b', {});
  await appt('a2', 'org-a', { appointmentType: 'follow_up', status: 'no_show' });
  await appt('b2', 'org-b', { appointmentType: 'follow_up', status: 'no_show' });
});
afterEach(async () => { await teardownTestDBs(); });

it('overdue appointments are the caller organisation\'s only', async () => {
  expect((await getOverdueAppointments(undefined, scopeA)).map(a => a._id)).toEqual(['a1']);
});

it('missed follow-ups are the caller organisation\'s only', async () => {
  expect((await getMissedFollowUps(undefined, scopeA)).map(a => a._id)).toEqual(['a2']);
});

it('no-show statistics count the caller organisation only', async () => {
  const stats = await getNoShowStats({ start: '2026-01-01', end: '2026-01-31' }, undefined, scopeA);
  expect(stats.totalAppointments).toBe(2);
  expect(stats.noShowCount).toBe(1);
});
