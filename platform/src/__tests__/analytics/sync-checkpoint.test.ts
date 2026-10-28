import type { NextRequest } from 'next/server';

const query = jest.fn();
const upsertDocument = jest.fn();
const deleteDocument = jest.fn();
const mockLogApiError = jest.fn();

// jsdom's Response implementation has an instance json() method but not the
// static Response.json() used internally by NextResponse in Next 16.
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));
jest.mock('@/modules/identity', () => ({ logApiError: (...args: unknown[]) => mockLogApiError(...args) }));
jest.mock('@/lib/sync-auth', () => ({
  verifySyncMachineRequest: jest.fn(async () => ({ ok: true })),
}));
jest.mock('@/lib/db/postgres', () => ({
  query: (...args: unknown[]) => query(...args),
  upsertDocument: (...args: unknown[]) => upsertDocument(...args),
  deleteDocument: (...args: unknown[]) => deleteDocument(...args),
  ConflictPolicy: { APPEND_ONLY: 'APPEND_ONLY' },
  TABLE_CONFLICT_POLICY: {},
}));
jest.mock('@/lib/encrypted-db', () => ({
  decryptDocument: jest.fn(async (doc: Record<string, unknown>) => doc),
}));
jest.mock('@/lib/org-data-cipher', () => ({
  blindIndex: jest.fn(async (value: string) => `blind:${value}`),
  encryptForOrg: jest.fn(async (value: string) => `sealed:${value}`),
}));

import { POST } from '@/modules/analytics/api/sync-route';

function patient(id: string) {
  return {
    _id: id,
    type: 'patient',
    firstName: 'Asha',
    middleName: '',
    surname: 'Deng',
    gender: 'Female',
    dateOfBirth: '1990-01-01',
    registrationHospital: 'hosp-1',
    orgId: 'org-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function request(changes: Array<Record<string, unknown>>) {
  const rawBody = JSON.stringify({ db: 'tamamhealth_patients', changes });
  return {
    text: async () => rawBody,
    headers: new Headers(),
    method: 'POST',
    url: 'http://localhost/api/sync',
  } as unknown as NextRequest;
}

describe('analytics sync checkpoint integrity', () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(() => { process.env.DATABASE_URL = 'postgres://configured-for-test'; });
  afterAll(() => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });
  beforeEach(() => {
    mockLogApiError.mockReset();
    query.mockReset().mockResolvedValue({ rows: [] });
    upsertDocument.mockReset().mockResolvedValue(undefined);
    deleteDocument.mockReset().mockResolvedValue(undefined);
  });

  it('never advances the recovery checkpoint beyond the first failed document', async () => {
    upsertDocument.mockImplementation(async (_table: string, row: { id?: string }) => {
      if (row.id === 'pat-bad') throw new Error('simulated constraint failure');
    });

    const response = await POST(request([
      { id: 'pat-good-1', seq: '1-a', doc: patient('pat-good-1') },
      { id: 'pat-bad', seq: '2-b', doc: patient('pat-bad') },
      { id: 'pat-good-3', seq: '3-c', doc: patient('pat-good-3') },
    ]));
    const body = await response.json();

    expect(mockLogApiError).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ processed: 1, errors: 1, lastSeq: '1-a' });
    expect(upsertDocument).toHaveBeenCalledTimes(2);
    expect(upsertDocument.mock.calls.map((call) => call[1].id)).toEqual(['pat-good-1', 'pat-bad']);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO sync_metadata'), [
      'tamamhealth_patients', '1-a',
    ]);
  });

  it('advances past design documents without trying to project them', async () => {
    const response = await POST(request([
      { id: '_design/indexes', seq: '4-d', doc: { _id: '_design/indexes' } },
    ]));
    const body = await response.json();

    expect(mockLogApiError).not.toHaveBeenCalled();
    expect(body).toMatchObject({ processed: 1, errors: 0, lastSeq: '4-d' });
    expect(upsertDocument).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO sync_metadata'), [
      'tamamhealth_patients', '4-d',
    ]);
  });
});
