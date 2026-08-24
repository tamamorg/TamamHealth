/**
 * Facility writes route through /api/hospitals from the browser.
 *
 * The production failure this pins: the platform console (super_admin) wrote
 * facilities to its local replica and waited for push replication — but a
 * super_admin session has no orgId, so its device deliberately syncs no
 * org-scoped database. The facility stayed on that device forever while
 * /api/users kept answering "Facility … has not reached the server yet" about
 * a record the server could never receive.
 *
 * `isBrowserRuntime()` treats a Jest worker as the server, so these tests
 * clear JEST_WORKER_ID to become "the browser" and restore it after.
 */

jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());
jest.mock('@/lib/api-fetch', () => ({ apiFetch: jest.fn() }));

import { teardownTestDBs } from '../helpers/test-db';
import { apiFetch } from '@/lib/api-fetch';
import {
  createHospital, updateHospitalStatus, getAllHospitals, getHospitalById,
} from '@/lib/services/hospital-service';
import type { HospitalDoc } from '@/lib/db-types';

const apiFetchMock = apiFetch as jest.Mock;
const WORKER_ID = process.env.JEST_WORKER_ID;

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  delete process.env.JEST_WORKER_ID;
  apiFetchMock.mockReset();
});

afterEach(async () => {
  process.env.JEST_WORKER_ID = WORKER_ID;
  await teardownTestDBs();
});

describe('createHospital in the browser', () => {
  it('POSTs to /api/hospitals and returns the server document', async () => {
    const serverDoc = { _id: 'hosp-srv1', type: 'hospital', name: 'Tamam Hospital', orgId: 'org-a' };
    apiFetchMock.mockResolvedValue(response(201, { hospital: serverDoc }));

    const created = await createHospital(
      { name: 'Tamam Hospital', state: 'Central Equatoria', lga: 'Juba', orgId: 'org-a' } as never,
    );

    expect(created).toEqual(serverDoc);
    const [url, init] = apiFetchMock.mock.calls[0];
    expect(url).toBe('/api/hospitals');
    expect(JSON.parse(init.body).name).toBe('Tamam Hospital');
  });

  it('surfaces the server validation message, and NEVER falls back to a local write', async () => {
    apiFetchMock.mockResolvedValue(response(400, { error: '"Tamam Hospital" is already registered in Juba.' }));
    await expect(createHospital(
      { name: 'Tamam Hospital', state: 'CE', lga: 'Juba', orgId: 'org-a' } as never,
    )).rejects.toThrow('already registered');
  });

  it('reports offline as "requires a connection", not as success', async () => {
    apiFetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(createHospital(
      { name: 'Remote Clinic', state: 'CE', lga: 'Juba', orgId: 'org-a' } as never,
    )).rejects.toThrow(/require(s)? a connection/i);
  });
});

describe('updateHospitalStatus in the browser', () => {
  it('routes through the API and keeps the null-on-failure contract', async () => {
    const updated = { _id: 'hosp-1', type: 'hospital', name: 'X', beds: 40 };
    apiFetchMock.mockResolvedValue(response(200, { hospital: updated }));
    expect(await updateHospitalStatus('hosp-1', { beds: 40 } as Partial<HospitalDoc>)).toEqual(updated);
    expect(JSON.parse(apiFetchMock.mock.calls[0][1].body)).toMatchObject({ action: 'update', id: 'hosp-1', beds: 40 });

    apiFetchMock.mockResolvedValue(response(404, { error: 'Hospital not found' }));
    expect(await updateHospitalStatus('hosp-gone', { beds: 1 } as Partial<HospitalDoc>)).toBeNull();
  });
});

describe('browser reads', () => {
  it('prefer server truth — the console that writes server-side must read server-side', async () => {
    const hospitals = [{ _id: 'hosp-1', type: 'hospital', name: 'A', orgId: 'org-a' }];
    apiFetchMock.mockResolvedValue(response(200, { hospitals }));
    expect(await getAllHospitals()).toEqual(hospitals);
  });

  it('fall back to the local replica when offline', async () => {
    apiFetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    // The replica is empty in this test — the point is that it ANSWERS.
    expect(await getAllHospitals()).toEqual([]);
  });

  it('getHospitalById returns null on a server 404 without touching the replica', async () => {
    apiFetchMock.mockResolvedValue(response(404, {}));
    expect(await getHospitalById('hosp-nope')).toBeNull();
  });
});
