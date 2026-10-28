import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const example = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
const setup = fs.readFileSync(path.join(root, 'scripts/setup.mjs'), 'utf8');

function activeValue(name: string): string | undefined {
  const match = example.match(new RegExp(`^${name}=(.*)$`, 'm'));
  return match?.[1];
}

describe('fresh-install environment contract', () => {
  it('defaults the documented no-Docker quick start to a seeded standalone demo', () => {
    expect(activeValue('NEXT_PUBLIC_DEMO_MODE')).toBe('true');
    expect(activeValue('NEXT_PUBLIC_SYNC_ENABLED')).toBe('false');
    expect(activeValue('NEXT_PUBLIC_COUCHDB_URL')).toBeUndefined();
    expect(activeValue('COUCHDB_ADMIN_USER')).toBeUndefined();
    expect(activeValue('COUCHDB_ADMIN_PASSWORD')).toBeUndefined();
  });

  it('does not opt a fresh clone into PostgreSQL with placeholder credentials', () => {
    expect(activeValue('DATABASE_URL')).toBeUndefined();
    expect(activeValue('DATABASE_DIRECT_URL')).toBeUndefined();
  });

  it('has the guided setup replace every required local secret', () => {
    expect(setup).toContain("'JWT_SECRET=change-me-to-a-random-secret'");
    expect(setup).toContain("'PHI_ENCRYPTION_KEY='");
    expect(setup).toContain("'ORG_DATA_KEY_SECRET='");
    expect(setup).not.toContain("'NEXT_PUBLIC_JWT_SECRET=change-me-to-a-random-secret'");
  });

  it('uncomments both PostgreSQL URLs only when the operator opts in', () => {
    expect(setup).toContain("'# DATABASE_URL=postgresql://tamamhealth:password@localhost:5432/safeguard_junub'");
    expect(setup).toContain("'# DATABASE_DIRECT_URL=postgresql://tamamhealth:password@localhost:5432/safeguard_junub'");
    expect(setup).toContain('const hasDb = /^DATABASE_URL=.+$/m.test(envFile)');
  });
});
