/**
 * POST /api/crypto/rekey — re-seal a record for the organisation it now
 * belongs to (a patient re-homed by a cross-organisation referral).
 * Only a member of an organisation the record is addressed to may ask; a
 * stranger gets the same answer as for a record that does not exist.
 */
import { rawTestDB, teardownTestDBs } from '../helpers/test-db';

jest.mock('@/lib/db', () => ({ ...require('../helpers/test-db').createDBMock(), LOCAL_DATABASE_NAMES: ['tamamhealth_patients'] }));
const actor: { sub: string; username: string; name: string; role: string; orgId?: string } = {
  sub: 'u-b', username: 'dr.b', name: 'Dr. B', role: 'doctor', orgId: 'org-b',
};
jest.mock('@/modules/identity/core/api-auth', () => {
  const actual = jest.requireActual('@/modules/identity/core/api-auth');
  return { ...actual, getAuthPayload: jest.fn(async () => actor) };
});
jest.mock('@/lib/services/audit-service', () => ({ logAuditSafe: jest.fn() }));
// As in billing-scope.test.ts: next/server needs undici's fetch classes in jsdom.
jest.mock('next/server', () => {
  const { ReadableStream, WritableStream, TransformStream } = require('node:stream/web');
  const { MessageChannel, MessagePort } = require('node:worker_threads');
  Object.assign(globalThis, { ReadableStream, WritableStream, TransformStream, MessageChannel, MessagePort });
  const undici = require('undici');
  Object.assign(globalThis, { Response: undici.Response, Request: undici.Request, Headers: undici.Headers, fetch: undici.fetch });
  return jest.requireActual('next/server');
});
jest.setTimeout(30000);

import type { NextRequest } from 'next/server';
import { patientsDB } from '@/lib/db';
import { POST } from '@/app/api/crypto/rekey/route';
import { envelopeOrgIds } from '@/lib/org-data-cipher';

const post = (body: unknown) => POST(new Request('http://localhost/api/crypto/rekey', {
  method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
}) as unknown as NextRequest);

async function rehomedPatient() {
  await patientsDB().put({ _id: 'pat-1', type: 'patient', orgId: 'org-a', firstName: 'Achol', surname: 'Deng' });
  // The receiving device moves it: it can change orgId but cannot re-seal.
  const raw = rawTestDB('tamamhealth_patients');
  const stored = await raw.get('pat-1') as Record<string, unknown>;
  await raw.put({ ...stored, orgId: 'org-b' });
}

afterEach(async () => { await teardownTestDBs(); actor.orgId = 'org-b'; actor.role = 'doctor'; });

test('re-seals a re-homed record for its new organisation', async () => {
  await rehomedPatient();
  const res = await post({ db: 'tamamhealth_patients', id: 'pat-1' });
  expect(await res.json()).toEqual({ rekeyed: true });
  const stored = await rawTestDB('tamamhealth_patients').get('pat-1') as Record<string, unknown>;
  expect(envelopeOrgIds(stored.firstName as string)).toEqual(['org-b']);
  expect((await patientsDB().get('pat-1') as Record<string, unknown>).firstName).toBe('Achol');
});

test('a member of another organisation is answered as if the record did not exist', async () => {
  await rehomedPatient();
  actor.orgId = 'org-c';
  expect((await post({ db: 'tamamhealth_patients', id: 'pat-1' })).status).toBe(404);
  const stored = await rawTestDB('tamamhealth_patients').get('pat-1') as Record<string, unknown>;
  expect(envelopeOrgIds(stored.firstName as string)).toEqual(['org-a']);
});

test('refuses unknown databases and local ids', async () => {
  expect((await post({ db: 'tamamhealth_users', id: 'x' })).status).toBe(400);
  expect((await post({ db: 'tamamhealth_patients', id: '_local/x' })).status).toBe(400);
});

test('a record already sealed for its organisation is left alone', async () => {
  await patientsDB().put({ _id: 'pat-2', type: 'patient', orgId: 'org-b', firstName: 'Nyibol' });
  expect(await (await post({ db: 'tamamhealth_patients', id: 'pat-2' })).json()).toEqual({ rekeyed: false });
});
