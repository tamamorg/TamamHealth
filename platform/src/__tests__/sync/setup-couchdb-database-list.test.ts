/**
 * scripts/setup-couchdb.sh keeps a hand-written list of databases to create.
 * It drifted: tamamhealth_specialty_care replicated from every browser but was
 * never created on a fresh server, so the tenant migration died on it
 * ("db_not_found") and its documents had nowhere to land. Every replicating
 * database must be on the list. (The list may hold extra server-only ones.)
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DATABASE_SYNC_CONFIGS } from '@/lib/sync/sync-config';

test('setup-couchdb.sh creates every replicating database', () => {
  const script = readFileSync(path.join(process.cwd(), 'scripts/setup-couchdb.sh'), 'utf8');
  const start = script.indexOf('DATABASES=(');
  const block = script.slice(start, script.indexOf(')', start));
  const listed = new Set(block.match(/tamamhealth_[a-z_]+/g) ?? []);
  const missing = DATABASE_SYNC_CONFIGS.map(c => c.localName).filter(name => !listed.has(name));
  expect(missing).toEqual([]);
});
