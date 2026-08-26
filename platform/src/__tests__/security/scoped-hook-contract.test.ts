/**
 * Browser hooks read from a replica that may contain more than one tenant.
 * A scope-aware service treats an omitted scope as an intentional internal
 * read, so UI hooks must not call it while auth is still hydrating.
 */
import fs from 'node:fs';
import path from 'node:path';

const hooksDir = path.join(process.cwd(), 'src/lib/hooks');

describe('offline hook tenancy contract', () => {
  test('every hook using DataScope fails closed before loading local data', () => {
    const violations: string[] = [];

    for (const name of fs.readdirSync(hooksDir).filter(file => file.endsWith('.ts'))) {
      if (name === 'useDataScope.ts') continue;
      const source = fs.readFileSync(path.join(hooksDir, name), 'utf8');
      if (!source.includes('useDataScope()')) continue;

      // useUsers derives `mayRead` from scope?.role and exits before its API
      // call when that capability is absent; all local-replica hooks use an
      // explicit !scope guard.
      const failsClosed = source.includes('!scope') || (name === 'useUsers.ts' && source.includes('!mayRead'));
      if (!failsClosed) violations.push(name);
    }

    expect(violations).toEqual([]);
  });

  test('hooks use the canonical scope instead of rebuilding a partial one', () => {
    const violations: string[] = [];
    for (const name of fs.readdirSync(hooksDir).filter(file => file.endsWith('.ts'))) {
      if (name === 'useDataScope.ts') continue;
      const source = fs.readFileSync(path.join(hooksDir, name), 'utf8');
      if (/currentUser\s*\?\s*\{\s*orgId:\s*currentUser\.orgId/.test(source)) violations.push(name);
    }
    expect(violations).toEqual([]);
  });
});
