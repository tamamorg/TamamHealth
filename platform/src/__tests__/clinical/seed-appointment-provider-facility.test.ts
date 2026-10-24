/**
 * The demo seed must not book a doctor at a facility they do not work at.
 *
 * Facility scoping shows a clinician only their own facility's visits, so a
 * booking like that is invisible on the very board it was made for. The
 * workflow showcase booked Nyanut Chuol (registered at Bentiu) with Dr. Wani
 * (Juba) at Bentiu, and she never appeared on his list; her visit is now at
 * Juba, where Bentiu's emergency referral sent her.
 *
 * Runs the REAL seedDatabase() against in-memory PouchDB.
 */
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());
jest.mock('@/modules/identity/client', () => ({
  generateTempPassword: () => 'x',
  hashPassword: async () => 'hash',
}));

import { teardownTestDBs, createDBMock } from '../helpers/test-db';

type Doc = Record<string, unknown>;

afterEach(async () => {
  await teardownTestDBs();
});

describe('demo seed: appointment provider works at the appointment facility', () => {
  it('every seeded appointment with a known provider is at that provider’s facility', async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = 'true';
    const { seedDatabase } = await import('@/lib/db-seed');
    await seedDatabase();
    const db = createDBMock() as unknown as {
      usersDB: () => PouchDB.Database;
      appointmentsDB: () => PouchDB.Database;
    };
    const users = new Map((await db.usersDB().allDocs({ include_docs: true })).rows
      .map(r => [r.id, r.doc as unknown as Doc]));
    const appointments = (await db.appointmentsDB().allDocs({ include_docs: true })).rows
      .map(r => r.doc as unknown as Doc)
      .filter(d => d.type === 'appointment');
    expect(appointments.length).toBeGreaterThan(10);

    const mismatched = appointments.filter(a => {
      const provider = users.get(String(a.providerId));
      return provider?.hospitalId && provider.hospitalId !== a.facilityId;
    }).map(a => `${a._id}: provider ${a.providerId} at ${users.get(String(a.providerId))?.hospitalId}, booked at ${a.facilityId}`);
    expect(mismatched).toEqual([]);
  });

  it('Nyanut Chuol’s showcase visit is at Juba with Dr. Wani', async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = 'true';
    const { seedDatabase } = await import('@/lib/db-seed');
    await seedDatabase();
    const db = createDBMock() as unknown as { appointmentsDB: () => PouchDB.Database };
    const appt = await db.appointmentsDB().get('appointment-wf-pat-00304') as unknown as Doc;
    expect(appt.facilityId).toBe('hosp-001');
    expect(appt.providerId).toBe('user-dr.wani');
  });
});
