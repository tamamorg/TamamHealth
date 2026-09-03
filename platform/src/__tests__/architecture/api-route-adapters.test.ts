import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');

const MIGRATED_ROUTES: Record<string, string> = {
  'app/api/users/route.ts': "export { GET, POST } from '@/modules/identity/api/users-route';",
  'app/api/sync/route.ts': "export { GET, POST } from '@/modules/analytics/api/sync-route';",
};

describe('migrated API route adapters', () => {
  test.each(Object.entries(MIGRATED_ROUTES))('%s stays a named, logic-free re-export', (relativePath, expected) => {
    const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .trim();
    expect(source).toBe(expected);
  });
});
