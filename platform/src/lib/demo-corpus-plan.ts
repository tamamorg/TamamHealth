/**
 * Planning for the server-side demo corpus (scripts/seed-demo-corpus.mjs and
 * scripts/cleanup-stale-demo-seed.mjs).
 *
 * Pure functions, no I/O, so the rules that keep the shared stack safe are
 * unit-tested rather than trusted to a script:
 *   - the corpus is written ONCE and never over an existing document;
 *   - nothing is deleted unless it is demo seed output the current seed no
 *     longer produces.
 */
import { DATABASE_SYNC_CONFIGS } from './sync/sync-config';

export interface CorpusDoc {
  _id: string;
  _rev?: string;
  _deleted?: boolean;
  dataOrigin?: string;
  [key: string]: unknown;
}

/**
 * Databases the corpus is written to: every replicating database a device
 * could receive documents from. `push`-only ones (audit trails, sync events)
 * are device output, not reference data. `tamamhealth_users` is never in
 * `DATABASE_SYNC_CONFIGS` — accounts and credentials belong to the server's
 * own bootstrap, and the seed's staff records carry unusable password hashes.
 */
export function corpusDatabases(): string[] {
  return DATABASE_SYNC_CONFIGS
    .filter((config) => config.direction !== 'push')
    .map((config) => config.localName);
}

/**
 * Databases the stale-seed cleanup leaves alone: they hold configuration that
 * an administrator may have taken over (organisations, facilities, platform
 * settings), not generated clinical volume.
 */
export const CLEANUP_EXCLUDED_DATABASES: readonly string[] = [
  'tamamhealth_organizations',
  'tamamhealth_hospitals',
  'tamamhealth_platform_config',
];

/** A document as the server should first see it: no local revision. */
export function toServerDoc(doc: CorpusDoc): CorpusDoc {
  const { _rev: _ignored, _attachments: _attachments, ...rest } = doc as CorpusDoc & { _attachments?: unknown };
  void _ignored; void _attachments;
  return rest as CorpusDoc;
}

/**
 * The documents to create: every corpus document whose id the server does not
 * have. An id that exists on the server — in any revision, edited or not, or
 * deleted — is left exactly as it is, which is what makes a re-run a no-op and
 * keeps a clinician's changes to a demo record.
 */
export function planMissingDocs(corpus: readonly CorpusDoc[], existingIds: ReadonlySet<string>): CorpusDoc[] {
  return corpus
    .filter((doc) => doc._id && !doc._id.startsWith('_design/') && !existingIds.has(doc._id))
    .map(toServerDoc);
}

/**
 * The ids to remove: demo seed output (`dataOrigin: 'demo_seed'`) that the
 * current corpus does not contain. Real documents never carry the marker, and
 * documents the current seed still produces are never removed.
 */
export function planStaleDocs(
  serverDocs: readonly CorpusDoc[],
  corpusIds: ReadonlySet<string>,
): string[] {
  return serverDocs
    .filter((doc) => doc._id
      && !doc._id.startsWith('_design/')
      && doc.dataOrigin === 'demo_seed'
      && !corpusIds.has(doc._id))
    .map((doc) => doc._id);
}
