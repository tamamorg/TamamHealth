/** @jest-environment node */

import { GET } from '@/app/api/health/route';

const originalEnv = process.env;

afterEach(() => {
  process.env = originalEnv;
});

test('health identifies the exact build a deploy is probing', async () => {
  process.env = {
    ...originalEnv,
    NEXT_PUBLIC_BUILD_ID: 'abc1234',
    COUCHDB_URL: '',
    NEXT_PUBLIC_COUCHDB_URL: '',
    DATABASE_URL: '',
  };

  const response = await GET();
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    status: 'ok',
    service: 'tamamhealth-platform',
    release: 'abc1234',
    checks: { server: 'ok', couchdb: 'not-configured', database: 'not-configured' },
  });
});
