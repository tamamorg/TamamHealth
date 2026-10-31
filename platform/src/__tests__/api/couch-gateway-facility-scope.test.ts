/** @jest-environment node
 *
 * /api/couch -- reads are scoped to the caller's facilities on the SERVER.
 *
 * The device applies the facility entitlement to its own replication, but a
 * modified client can simply not. The gateway is the only path to CouchDB, so
 * it rewrites `_changes` / `_find`, and filters `_all_docs`, `_bulk_get` and
 * single-document reads, with the same entitlement.
 */
const actor: Record<string, unknown> = {
  sub: 'user-ana', username: 'dr.ana', name: 'Dr. Ana', role: 'doctor', orgId: 'org-a', hospitalId: 'hosp-1',
};
jest.mock('@/modules/identity/core/api-auth', () => ({
  getAuthPayload: jest.fn(async () => actor),
  unauthorized: jest.fn(() => Response.json({ error: 'unauthorized' }, { status: 401 })),
  forbidden: jest.fn((error = 'forbidden') => Response.json({ error }, { status: 403 })),
  logApiError: jest.fn(),
}));
jest.mock('@/lib/sync/couch-auth', () => ({
  ensureCouchGatewayUser: jest.fn(async () => ({ username: 'gw', password: 'pw' })),
  ensureOrganizationProvisioned: jest.fn(async () => undefined),
  couchAdminAuthorization: () => 'Basic server',
}));
const logAuditSafe = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock('@/lib/services/audit-service', () => ({ logAuditSafe: (...args: unknown[]) => logAuditSafe(...args) }));

import { NextRequest } from 'next/server';
import { tenantDatabaseName } from '@/lib/sync/tenant-database';
import { GET, POST } from '@/app/api/couch/[...path]/route';
import {
  _resetAuditThrottleForTest,
  canReadFacilityDoc,
  facilityReadSelector,
  readEntitlementFor,
} from '@/lib/sync/read-scope';

const PATIENTS = tenantDatabaseName('tamamhealth_patients', 'org-a');
const BILLING = tenantDatabaseName('tamamhealth_billing', 'org-a');
const TRANSFERS = tenantDatabaseName('tamamhealth_patient_transfers', 'org-a');
const COUCH = 'http://couch.test:5984';

type Doc = Record<string, unknown> & { _id: string };
const mine: Doc = { _id: 'p-mine', _rev: '1-a', type: 'patient', orgId: 'org-a', registrationHospital: 'hosp-1' };
const theirs: Doc = { _id: 'p-theirs', _rev: '1-a', type: 'patient', orgId: 'org-a', registrationHospital: 'hosp-2' };
const shared: Doc = { _id: 'p-shared', _rev: '1-a', type: 'patient', orgId: 'org-a', registrationHospital: 'hosp-2', lastVisitHospital: 'hosp-1' };
const otherOrg: Doc = { _id: 'p-org-b', _rev: '1-a', type: 'patient', orgId: 'org-b' };
const gone: Doc = { _id: 'p-gone', _rev: '2-a', _deleted: true };
const bill = (id: string, hospitalId: string): Doc => ({ _id: id, _rev: '1-a', type: 'billing', orgId: 'org-a', hospitalId });

let store: Record<string, Doc[]> = {};
let upstreamCalls: Array<{ method: string; url: URL; body: Record<string, unknown> | null }> = [];

beforeEach(() => {
  process.env.NEXT_PUBLIC_COUCHDB_GATEWAY_ENABLED = 'true';
  process.env.COUCHDB_URL = COUCH;
  Object.assign(actor, { role: 'doctor', orgId: 'org-a', hospitalId: 'hosp-1', facilityIds: undefined, sub: 'user-ana' });
  _resetAuditThrottleForTest();
  store = {
    [PATIENTS]: [mine, theirs, shared, otherOrg, gone],
    [BILLING]: [bill('b-mine', 'hosp-1'), bill('b-theirs', 'hosp-2')],
    [TRANSFERS]: [
      { _id: 't-in', _rev: '1-a', type: 'patient_transfer', orgId: 'org-a', fromHospitalId: 'hosp-2', toHospitalId: 'hosp-1' },
      { _id: 't-other', _rev: '1-a', type: 'patient_transfer', orgId: 'org-a', fromHospitalId: 'hosp-2', toHospitalId: 'hosp-3' },
    ],
  };
  upstreamCalls = [];
  logAuditSafe.mockClear();
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method || 'GET').toUpperCase();
    const [, db, endpoint = ''] = url.pathname.split('/').map(decodeURIComponent);
    const raw = init?.body ? (typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body as ArrayBuffer)) : '';
    upstreamCalls.push({ method, url, body: raw ? JSON.parse(raw) : null });
    const docs = store[db] || [];
    const body = raw ? JSON.parse(raw) as Record<string, unknown> : null;
    if (endpoint === '_all_docs') {
      const keys = (body?.keys as string[] | undefined) ?? docs.map(d => d._id);
      const withDocs = url.searchParams.get('include_docs') === 'true';
      return Response.json({ rows: keys.map(key => {
        const doc = docs.find(d => d._id === key);
        if (!doc) return { key, error: 'not_found' };
        return { id: key, key, value: { rev: doc._rev }, ...(withDocs ? { doc: doc._deleted ? null : doc } : {}) };
      }) });
    }
    if (endpoint === '_bulk_get') {
      const wanted = body!.docs as Array<{ id: string }>;
      return Response.json({ results: wanted.map(({ id }) => ({ id, docs: [{ ok: docs.find(d => d._id === id) }] })) });
    }
    if (endpoint === '_changes') return Response.json({ results: [], last_seq: '0' });
    if (endpoint === '_find') return Response.json({ docs });
    const doc = docs.find(d => d._id === endpoint);
    return doc ? Response.json(doc) : Response.json({ error: 'not_found' }, { status: 404 });
  }) as unknown as typeof fetch;
});

function call(db: string, path: string[], init: { body?: unknown; query?: string } = {}) {
  const method = init.body ? 'POST' : 'GET';
  const request = new NextRequest(`http://localhost/api/couch/${db}/${path.join('/')}${init.query || ''}`, {
    method,
    ...(init.body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) } : {}),
  });
  return (method === 'GET' ? GET : POST)(request, { params: Promise.resolve({ path: [db, ...path] }) });
}
const ids = (rows: Array<{ id?: string; key?: string; error?: string }>) =>
  rows.filter(r => !r.error).map(r => r.id);

describe('change feed and queries are rewritten', () => {
  test('a facility user\'s feed carries the facility selector, even when the client sent none', async () => {
    await call(PATIENTS, ['_changes'], { query: '?since=7' });
    const [sent] = upstreamCalls;
    expect(sent.method).toBe('POST');
    expect(sent.url.searchParams.get('filter')).toBe('_selector');
    expect(sent.url.searchParams.get('since')).toBe('7');
    const text = JSON.stringify(sent.body!.selector);
    expect(text).toContain('"registrationHospital":{"$in":["hosp-1"]}');
    expect(text).toContain('"lastVisitHospital":{"$in":["hosp-1"]}');
    expect(text).toContain('org-a');
  });

  test('the client\'s own selector is kept and AND-ed, never replaced', async () => {
    await call(PATIENTS, ['_changes'], { body: { selector: { orgId: 'org-b' } }, query: '?filter=_selector' });
    const [client] = (upstreamCalls[0].body!.selector as { $and: unknown[] }).$and;
    expect(client).toEqual({ orgId: 'org-b' });
    expect(JSON.stringify(upstreamCalls[0].body!.selector)).toContain('hosp-1');
  });

  test('an organisation-wide role is narrowed to its organisation only', async () => {
    actor.role = 'org_admin';
    await call(PATIENTS, ['_changes']);
    const text = JSON.stringify(upstreamCalls[0].body!.selector);
    expect(text).toContain('org-a');
    expect(text).not.toContain('registrationHospital');
  });

  test('a custom change filter cannot step around the selector', async () => {
    const response = await call(PATIENTS, ['_changes'], { query: '?filter=app/everything' });
    expect(response.status).toBe(403);
    expect(upstreamCalls).toHaveLength(0);
  });

  test('_find is narrowed', async () => {
    await call(PATIENTS, ['_find'], { body: { selector: { type: 'patient' }, limit: 5 } });
    expect(JSON.stringify(upstreamCalls[0].body!.selector)).toContain('hosp-1');
    expect(upstreamCalls[0].body!.limit).toBe(5);
  });
});

describe('document reads are filtered', () => {
  test('_all_docs with bodies drops other facilities, other orgs; keeps shared care and tombstones', async () => {
    const response = await call(PATIENTS, ['_all_docs'], { query: '?include_docs=true' });
    const body = await response.json() as { rows: Array<{ id?: string; key?: string; error?: string }> };
    expect(ids(body.rows)).toEqual(['p-mine', 'p-shared', 'p-gone']);
    // A listing the client did not key never echoes the ids it refuses.
    expect(JSON.stringify(body)).not.toMatch(/p-theirs|p-org-b/);
  });

  test('a bare id listing is judged on the documents, and comes back without bodies', async () => {
    const response = await call(PATIENTS, ['_all_docs']);
    expect(upstreamCalls[0].url.searchParams.get('include_docs')).toBe('true');
    const body = await response.json() as { rows: Array<Record<string, unknown>> };
    expect(ids(body.rows as never)).toEqual(['p-mine', 'p-shared', 'p-gone']);
    expect(body.rows.every(row => !('doc' in row))).toBe(true);
    expect(JSON.stringify(body)).not.toContain('p-theirs');
  });

  test('_bulk_get replaces what is not yours with a forbidden marker', async () => {
    const response = await call(PATIENTS, ['_bulk_get'], { body: { docs: [{ id: 'p-mine' }, { id: 'p-theirs' }] } });
    const body = await response.json() as { results: Array<{ id: string; docs: Array<{ ok?: Doc; error?: unknown }> }> };
    expect(body.results[0].docs[0].ok?._id).toBe('p-mine');
    expect(body.results[1].docs[0].ok).toBeUndefined();
    expect(body.results[1].docs[0].error).toMatchObject({ error: 'forbidden' });
  });

  test('a single document by id is refused outside the facility and served inside it', async () => {
    expect((await call(PATIENTS, ['p-theirs'])).status).toBe(403);
    expect((await call(PATIENTS, ['p-mine'])).status).toBe(200);
    expect((await call(PATIENTS, ['p-shared'])).status).toBe(200);
  });

  test('an attachment follows its parent document', async () => {
    expect((await call(PATIENTS, ['p-theirs', 'scan.png'])).status).toBe(403);
    expect((await call(PATIENTS, ['p-mine', 'scan.png'])).status).toBe(200);
  });

  test('billing is facility-scoped; an org-wide role sees both facilities', async () => {
    let body = await (await call(BILLING, ['_all_docs'], { query: '?include_docs=true' })).json() as { rows: never[] };
    expect(ids(body.rows)).toEqual(['b-mine']);
    actor.role = 'hospital_manager';
    body = await (await call(BILLING, ['_all_docs'], { query: '?include_docs=true' })).json() as { rows: never[] };
    expect(ids(body.rows)).toEqual(['b-mine', 'b-theirs']);
  });

  test('a transfer is visible to both hospitals it names and to nobody else', async () => {
    const body = await (await call(TRANSFERS, ['_all_docs'], { query: '?include_docs=true' })).json() as { rows: never[] };
    expect(ids(body.rows)).toEqual(['t-in']);
  });
});

describe('audit', () => {
  test('an initial pull and a listing are audited once per window, not per request', async () => {
    await call(PATIENTS, ['_changes']);
    await call(BILLING, ['_changes'], { query: '?since=0' });
    await call(PATIENTS, ['_changes'], { query: '?since=55-abc' });
    await call(PATIENTS, ['_all_docs']);
    await call(PATIENTS, ['_all_docs']);
    const bulk = logAuditSafe.mock.calls.filter(c => c[0] === 'sync.gateway.bulk_read');
    expect(bulk.map(c => JSON.parse(String(c[3])).kind)).toEqual(['initial_pull', 'listing']);
    expect(bulk[0][5]).toMatchObject({ orgId: 'org-a', hospitalId: 'hosp-1' });
  });

  test('reaching for another facility is recorded, throttled', async () => {
    await call(PATIENTS, ['p-theirs']);
    await call(PATIENTS, ['p-theirs']);
    expect(logAuditSafe.mock.calls.filter(c => c[0] === 'sync.gateway.facility_read_blocked')).toHaveLength(1);
  });
});

describe('the entitlement helpers', () => {
  test('exempt types are organisation-wide; transfers are not', () => {
    const ent = readEntitlementFor({ role: 'nurse', orgId: 'org-a', hospitalId: 'hosp-1' });
    expect(canReadFacilityDoc(ent, { type: 'order_set', orgId: 'org-a', hospitalId: 'hosp-2' })).toBe(true);
    expect(canReadFacilityDoc(ent, { type: 'order_set', orgId: 'org-b', hospitalId: 'hosp-1' })).toBe(false);
    expect(canReadFacilityDoc(ent, { type: 'patient_transfer', orgId: 'org-a', fromHospitalId: 'x', toHospitalId: 'y' })).toBe(false);
  });

  test('a user with no facility sees only documents with no facility tie, never everything', () => {
    const ent = readEntitlementFor({ role: 'nurse', orgId: 'org-a' });
    expect(canReadFacilityDoc(ent, { type: 'patient', orgId: 'org-a', registrationHospital: 'hosp-1' })).toBe(false);
    expect(JSON.stringify(facilityReadSelector(ent))).toContain('"$exists":false');
  });

  test('without an organisation nothing matches', () => {
    expect(canReadFacilityDoc(readEntitlementFor({ role: 'nurse' }), { type: 'patient', orgId: 'org-a' })).toBe(false);
  });
});
