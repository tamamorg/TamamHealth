/**
 * @jest-environment node
 *
 * Server-side facility reads must consult the TENANT database, not only the
 * shared aggregate.
 *
 * The production failure this pins: with tenant databases enabled, a facility
 * registered in a clinic replicates to `tamamhealth_hospitals--<orgId>` and
 * never reaches `tamamhealth_hospitals` — while `/api/users` asked the
 * aggregate whether the facility exists before attaching an account to it.
 * The answer was no, forever: every facility-bound role (nurse, doctor,
 * receptionist…) became uncreatable, with the misleading message that the
 * facility "has not reached the server yet". Roles that need no facility kept
 * working, which made it look like a permissions problem.
 */

const databases = new Map<string, Map<string, Record<string, unknown>>>();

function fakeDb(name: string) {
  if (!databases.has(name)) databases.set(name, new Map());
  const store = databases.get(name)!;
  return {
    async get(id: string) {
      const doc = store.get(id);
      if (!doc) throw Object.assign(new Error('missing'), { status: 404 });
      return doc;
    },
    async allDocs() {
      return { rows: [...store.values()].map(doc => ({ doc })) };
    },
  };
}

jest.mock('@/lib/db', () => ({
  getDB: (name: string) => fakeDb(name),
  hospitalsDB: () => fakeDb('tamamhealth_hospitals'),
}));
jest.mock('@/lib/services/db-query', () => ({
  findByType: async (db: { allDocs: () => Promise<{ rows: { doc: Record<string, unknown> }[] }> }) =>
    (await db.allDocs()).rows.map(r => r.doc).filter(d => d.type === 'hospital'),
}));
jest.mock('@/lib/services/sync-event-service', () => ({ emitSyncEvent: jest.fn() }));

import { getHospitalById, getAllHospitals } from '@/lib/services/hospital-service';

const ORG = 'org-moh-ss';
const scope = { role: 'org_admin' as const, orgId: ORG };

beforeEach(() => {
  databases.clear();
  process.env.NEXT_PUBLIC_COUCHDB_TENANT_DATABASES_ENABLED = 'true';
  // Pre-cutover facility: lives in the aggregate only.
  databases.set('tamamhealth_hospitals', new Map([
    ['hosp-old', { _id: 'hosp-old', type: 'hospital', name: 'Juba Teaching Hospital', orgId: ORG }],
  ]));
  // Post-cutover facility: registered in a clinic, replicated to the tenant
  // database, absent from the aggregate.
  databases.set(`tamamhealth_hospitals--${ORG}`, new Map([
    ['hosp-new', { _id: 'hosp-new', type: 'hospital', name: 'New Rural Clinic', orgId: ORG }],
  ]));
});

afterAll(() => { delete process.env.NEXT_PUBLIC_COUCHDB_TENANT_DATABASES_ENABLED; });

describe('a facility registered after the tenant cutover', () => {
  it('is found by id, so an account can be attached to it', async () => {
    const found = await getHospitalById('hosp-new', scope);
    expect(found?.name).toBe('New Rural Clinic');
  });

  it('is listed alongside pre-cutover facilities', async () => {
    const names = (await getAllHospitals(scope)).map(h => h.name).sort();
    expect(names).toEqual(['Juba Teaching Hospital', 'New Rural Clinic']);
  });
});

describe('a facility from before the cutover', () => {
  it('is still found — the aggregate remains consulted', async () => {
    expect((await getHospitalById('hosp-old', scope))?.name).toBe('Juba Teaching Hospital');
  });
});

describe('the tenant database copy wins on id', () => {
  it('prefers the clinic-written copy over a stale aggregate row', async () => {
    databases.get('tamamhealth_hospitals')!.set('hosp-new',
      { _id: 'hosp-new', type: 'hospital', name: 'STALE NAME', orgId: ORG });
    expect((await getHospitalById('hosp-new', scope))?.name).toBe('New Rural Clinic');
    const listed = (await getAllHospitals(scope)).find(h => h._id === 'hosp-new');
    expect(listed?.name).toBe('New Rural Clinic');
  });
});

describe('without a scope, behaviour is unchanged', () => {
  it('reads the aggregate only — no orgId means no tenant database to name', async () => {
    expect(await getHospitalById('hosp-new')).toBeNull();
    expect((await getAllHospitals()).map(h => h._id)).toEqual(['hosp-old']);
  });
});
