import fs from 'node:fs';
import path from 'node:path';

describe('national analytics projection schema contract', () => {
  const route = fs.readFileSync(path.join(process.cwd(), 'src/modules/analytics/api/sync-route.ts'), 'utf8');
  const migrationsDir = path.join(process.cwd(), 'src/lib/db/migrations');
  const migrations = fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .map(file => fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
    .join('\n');

  const objectBody = (name: string, until = '\n};') => {
    const start = route.indexOf(`const ${name}`);
    const bodyStart = route.indexOf('{', start);
    const end = route.indexOf(until, bodyStart);
    if (start < 0 || bodyStart < 0 || end < 0) throw new Error(`Could not parse ${name}`);
    return route.slice(bodyStart + 1, end);
  };

  it('has a migrated PostgreSQL table and mapper for every projected database/table', () => {
    const mapBody = objectBody('DB_TABLE_MAP');
    const fanoutBody = objectBody('WARDS_DB_TABLES');
    const mapped = new Set(
      [...mapBody.matchAll(/:\s*'([a-z_]+)'/g), ...fanoutBody.matchAll(/:\s*'([a-z_]+)'/g)]
        .map(match => match[1]),
    );
    const created = new Set([...migrations.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+([a-z_]+)/gi)].map(match => match[1]));
    const mapperBody = objectBody('FIELD_MAPPERS', '\n};\n\ninterface ChangeEntry');
    const mappers = new Set([...mapperBody.matchAll(/^  ([a-z_]+): \(doc\)/gm)].map(match => match[1]));

    expect([...mapped].filter(table => !created.has(table))).toEqual([]);
    expect([...mapped].filter(table => !mappers.has(table))).toEqual([]);
    expect([...mappers].filter(table => !mapped.has(table))).toEqual([]);
  });
});
