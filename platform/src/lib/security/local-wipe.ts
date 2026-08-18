'use client';

/**
 * Local PHI wipe — the device-side half of "where does patient data live".
 *
 * PouchDB in the browser is plain, unencrypted IndexedDB opened by name with
 * no credential (see `lib/db.ts`). That is inherent to offline-first: the
 * record has to be readable with the network down. What we control is *how
 * long it stays there* — a facility tablet must not still hold a ward's
 * charts after the clinician signs out, after their session expires, or when
 * the next person on shift signs in.
 *
 * The wipe is therefore driven by three triggers (all wired in
 * `lib/context.tsx`): logout, no valid session at boot, and a different user
 * signing in on the device.
 *
 * ── The one rule that keeps this safe ────────────────────────────────────
 * A clinic works offline for hours. Local databases can hold writes that have
 * never reached CouchDB, and destroying those is destroying clinical work, not
 * protecting it. So a database is only wiped when it is **clean**: its current
 * `update_seq` matches the sequence recorded at the last successful sync
 * (`recordSyncedSequences()`, called by the sync manager). A database with
 * unsynced writes is kept, and the wipe is recorded as pending so the next
 * boot after a successful sync finishes the job.
 *
 * That trade is deliberate and it is a real limit: a device that never
 * reconnects keeps its unsynced records until someone signs in again. Silent
 * data loss is the worse failure for a health record.
 */

import { LOCAL_DATABASE_NAMES } from '../db';

export type WipeReason = 'logout' | 'session-expired' | 'user-changed' | 'pending';

export interface WipeResult {
  /** Databases destroyed by this call. */
  wiped: string[];
  /** Databases deliberately preserved because they hold unsynced writes. */
  kept: string[];
  /** Databases that should have gone but survived (destroy threw or blocked). */
  remaining: string[];
  /** True when nothing was left behind that should have been removed. */
  ok: boolean;
}

const SEQ_KEY = 'tamamhealth.sync.synced-seqs.v1';
const PENDING_KEY = 'tamamhealth.security.pending-wipe.v1';
const DEVICE_USER_KEY = 'tamamhealth.security.device-user.v1';
const POUCH_PREFIX = '_pouch_';

const IS_BROWSER = typeof window !== 'undefined';

function readJson<T>(key: string): T | null {
  if (!IS_BROWSER) return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (!IS_BROWSER) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked (private mode). The wipe still runs; only the
    // bookkeeping is lost, which degrades to "treat as dirty" — the safe side.
  }
}

/**
 * Every local database that actually exists on this device.
 *
 * `indexedDB.databases()` is the authoritative source (Chromium, Safari 14+,
 * and the Android WebView the field tablets run) and catches databases whose
 * names are not in `LOCAL_DATABASE_NAMES` — a feature removed from the code
 * still leaves its data on devices that were seeded while it existed. Firefox
 * does not implement it, so the static list is the floor, never the ceiling.
 */
export async function listLocalDatabases(): Promise<string[]> {
  if (!IS_BROWSER) return [];
  const found = new Set<string>();

  // Absence of the enumeration API means "cannot discover", never "nothing is
  // stored" — the static list below still has to be swept, or a browser
  // without it would report a clean device and wipe nothing at all.
  const enumerable = typeof indexedDB === 'undefined'
    ? undefined
    : (indexedDB as IDBFactory & { databases?: () => Promise<{ name?: string }[]> }).databases;
  if (typeof enumerable === 'function') {
    try {
      for (const entry of await enumerable.call(indexedDB)) {
        const name = entry?.name;
        if (!name) continue;
        if (name.startsWith(POUCH_PREFIX)) found.add(name.slice(POUCH_PREFIX.length));
        else if (name.startsWith('tamamhealth_')) found.add(name);
      }
    } catch {
      // Fall through to the static list.
    }
  }

  for (const name of LOCAL_DATABASE_NAMES) found.add(name);
  return Array.from(found);
}

/**
 * Snapshot each open database's `update_seq` as "synced up to here".
 *
 * Called by the sync manager when a replication cycle completes cleanly. The
 * value is only ever used to answer "has anything been written locally since
 * then" — it is not a checkpoint and replication does not read it.
 */
export async function recordSyncedSequences(): Promise<void> {
  if (!IS_BROWSER) return;
  const seqs: Record<string, string> = {};
  const { getDB } = await import('../db');
  for (const name of await listLocalDatabases()) {
    try {
      const info = await getDB(name).info();
      seqs[name] = String(info.update_seq);
    } catch {
      // A database that cannot be opened cannot be proven clean; leaving it
      // out of the snapshot makes it dirty, which is the conservative answer.
    }
  }
  writeJson(SEQ_KEY, seqs);
}

/**
 * Databases holding writes that have not been proven to reach the server.
 *
 * Unknown means dirty: no recorded sequence, an unreadable database, or sync
 * having never run all resolve to "keep it".
 */
export async function getDirtyDatabases(): Promise<string[]> {
  if (!IS_BROWSER) return [];
  const recorded = readJson<Record<string, string>>(SEQ_KEY) ?? {};
  const dirty: string[] = [];
  const { getDB } = await import('../db');

  for (const name of await listLocalDatabases()) {
    const known = recorded[name];
    if (known === undefined) {
      // Never synced, or a database created since the last sync. An empty one
      // holds nothing to lose, so only a non-empty unknown counts as dirty.
      try {
        const info = await getDB(name).info();
        if (info.doc_count > 0) dirty.push(name);
      } catch {
        dirty.push(name);
      }
      continue;
    }
    try {
      const info = await getDB(name).info();
      if (String(info.update_seq) !== known) dirty.push(name);
    } catch {
      dirty.push(name);
    }
  }
  return dirty;
}

/** A wipe that could not finish, to be completed at the next opportunity. */
export function markPendingWipe(reason: WipeReason, databases: string[]): void {
  if (!databases.length) return;
  writeJson(PENDING_KEY, { reason, databases, at: new Date().toISOString() });
}

export function getPendingWipe(): { reason: WipeReason; databases: string[]; at: string } | null {
  return readJson<{ reason: WipeReason; databases: string[]; at: string }>(PENDING_KEY);
}

export function clearPendingWipe(): void {
  if (!IS_BROWSER) return;
  try {
    window.localStorage.removeItem(PENDING_KEY);
  } catch {
    // Nothing to do — a stale flag only costs one extra wipe attempt.
  }
}

/**
 * Destroy the local databases, keeping any that still hold unsynced writes.
 *
 * `force` skips the dirty check. It exists for the one caller that has already
 * decided the data is expendable (a seed-version reset), never for the
 * security triggers.
 */
export async function wipeLocalData(
  reason: WipeReason,
  options: { force?: boolean; only?: string[] } = {},
): Promise<WipeResult> {
  if (!IS_BROWSER) return { wiped: [], kept: [], remaining: [], ok: true };

  const candidates = options.only ?? (await listLocalDatabases());
  const dirty = options.force ? new Set<string>() : new Set(await getDirtyDatabases());
  const targets = candidates.filter((name) => !dirty.has(name));
  const kept = candidates.filter((name) => dirty.has(name));

  const { destroyLocalDatabase } = await import('../db');
  const remaining: string[] = [];
  const wiped: string[] = [];

  for (const name of targets) {
    // One retry: IndexedDB refuses to delete while another tab or an
    // in-flight changes() feed still holds the database open, and that
    // window is short. A silent failure here is the bug this module exists
    // to prevent, so what survives is reported, not swallowed.
    let destroyed = false;
    for (let attempt = 0; attempt < 2 && !destroyed; attempt++) {
      try {
        await destroyLocalDatabase(name);
        destroyed = true;
      } catch {
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    (destroyed ? wiped : remaining).push(name);
  }

  if (remaining.length) markPendingWipe(reason, remaining);
  else if (!kept.length) clearPendingWipe();

  return { wiped, kept, remaining, ok: remaining.length === 0 };
}

/** Finish a wipe a previous session could not complete. Safe to call always. */
export async function completePendingWipe(): Promise<WipeResult | null> {
  const pending = getPendingWipe();
  if (!pending) return null;
  const result = await wipeLocalData(pending.reason, { only: pending.databases });
  if (result.ok && !result.kept.length) clearPendingWipe();
  return result;
}

/**
 * Identify the device's last signed-in user without storing who they were.
 *
 * A raw user id in localStorage tells anyone reading the device which
 * clinician used it; the digest answers the only question this module asks —
 * "same person as last time?" — and nothing else.
 */
async function digestUserId(userId: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    // No Web Crypto (http:// on an old Android WebView). FNV-1a is not a
    // security hash and is not used as one — it only has to tell two user
    // ids apart. The earlier fallback keyed on id *length*, which made every
    // same-length id look like the same person and silently skipped the
    // handover wipe on exactly the devices least likely to have crypto.
    let hash = 0x811c9dc5;
    for (let i = 0; i < userId.length; i++) {
      hash ^= userId.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `fnv:${hash.toString(16).padStart(8, '0')}`;
  }
  const bytes = new TextEncoder().encode(`tamamhealth-device:${userId}`);
  const hash = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

/**
 * Called on every successful login. If the device was last used by someone
 * else, that person's records are cleared before this session starts reading
 * and writing over the top of them.
 */
export async function enforceDeviceUser(userId: string): Promise<WipeResult | null> {
  if (!IS_BROWSER || !userId) return null;
  const digest = await digestUserId(userId);
  const previous = readJson<{ user: string }>(DEVICE_USER_KEY)?.user;
  writeJson(DEVICE_USER_KEY, { user: digest });
  if (!previous || previous === digest) return null;
  return wipeLocalData('user-changed');
}

/** Forget the device's user binding (used when the device is handed back). */
export function clearDeviceUser(): void {
  if (!IS_BROWSER) return;
  try {
    window.localStorage.removeItem(DEVICE_USER_KEY);
  } catch {
    // Best-effort; a stale digest only triggers one extra wipe.
  }
}
