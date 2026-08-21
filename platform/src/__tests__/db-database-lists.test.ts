/**
 * The three descriptions of "which databases exist" must agree.
 *
 *   1. `DATABASE_SYNC_CONFIGS`   — what replicates, and in which direction.
 *   2. `DATABASE_DOCUMENT_TYPES` — which document types each may hold.
 *   3. `LOCAL_DATABASE_NAMES`    — what a device holds, so it can be wiped.
 *
 * They were maintained by hand and drifted by eight databases, including
 * `tamamhealth_clinical_notes` (signed encounter notes — PHI). `LOCAL_DATABASE_NAMES`
 * is now derived from (1), so this suite mostly guards the seam that is still
 * manual: the non-replicating extras, and any database opened by a bare
 * `getDB('…')` call somewhere in the tree rather than declared here.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { LOCAL_DATABASE_NAMES } from '@/lib/db';
import { DATABASE_SYNC_CONFIGS, DATABASE_DOCUMENT_TYPES } from '@/lib/sync/sync-config';

const SYNCED = DATABASE_SYNC_CONFIGS.map(config => config.localName);

describe('database list parity', () => {
  it('gives every synced database a document-type allowlist', () => {
    expect(Object.keys(DATABASE_DOCUMENT_TYPES).sort()).toEqual([...SYNCED].sort());
  });

  it('includes every synced database in the local wipe list', () => {
    const missing = SYNCED.filter(name => !LOCAL_DATABASE_NAMES.includes(name));
    expect(missing).toEqual([]);
  });

  it('has no duplicate entries', () => {
    expect(new Set(LOCAL_DATABASE_NAMES).size).toBe(LOCAL_DATABASE_NAMES.length);
  });

  it('names only tamamhealth_ databases', () => {
    for (const name of LOCAL_DATABASE_NAMES) expect(name).toMatch(/^tamamhealth_[a-z0-9_]+$/);
  });
});

describe('databases opened anywhere in the tree are wipeable', () => {
  /**
   * Every `getDB('tamamhealth_…')` literal in the source.
   *
   * This is the check that would have caught the drift: `clinical_notes`,
   * `text_shortcuts` and `facility_census` are opened by module-local accessors
   * (`clinical-notes/note-service.ts`, `services/facility-census-service.ts`)
   * rather than by an accessor in `db.ts`, so nothing connected them to the
   * wipe list.
   */
  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__' && entry.name !== 'node_modules') sourceFiles(full, out);
      } else if (/\.tsx?$/.test(entry.name)) {
        out.push(full);
      }
    }
    return out;
  }

  function openedDatabaseNames(): string[] {
    const found = new Set<string>();
    for (const file of sourceFiles(path.join(process.cwd(), 'src'))) {
      const source = readFileSync(file, 'utf8');
      for (const [, name] of source.matchAll(/getDB\(\s*'(tamamhealth_[a-z0-9_]+)'\s*\)/g)) {
        found.add(name);
      }
    }
    return [...found].sort();
  }

  it('lists every database the code actually opens', () => {
    const unlisted = openedDatabaseNames().filter(name => !LOCAL_DATABASE_NAMES.includes(name));
    expect(unlisted).toEqual([]);
  });
});
