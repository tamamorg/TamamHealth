'use client';

/**
 * Ask the browser not to throw the clinic's record away.
 *
 * ## The problem this addresses
 *
 * Every local database is IndexedDB (`lib/db.ts`), and by default IndexedDB is
 * **best-effort**: under storage pressure a browser evicts it, origin by
 * origin, with no prompt and no event. On a low-storage field tablet that is a
 * realistic Tuesday, not an edge case — and what it deletes is a shift's worth
 * of charts that never reached CouchDB, plus the offline sign-in credential,
 * which is the thing that lets the device be used at all with the network down.
 *
 * Nothing in the platform asked for better than best-effort. `local-wipe.ts`
 * is careful never to destroy a database holding unsynced writes, but that
 * care only governs wipes *we* perform. Eviction is the browser's decision and
 * runs no application code.
 *
 * The Storage Standard's answer is to mark the origin `persistent`, which
 * exempts it from automatic eviction. That is one call, and it is the whole
 * mitigation available to a web app.
 *
 * ## What this does not do
 *
 * It does not survive a person deliberately clearing site data. "Clear cookies
 * and other site data" (and Safari's "Remove All Website Data") removes a
 * persisted origin like any other, and no web API can refuse that — correctly,
 * since it is the user's device. A cleared device is a device that must reach
 * the network once before anyone can sign in on it again, and whose unsynced
 * writes are gone. Persistence narrows the silent, automatic case; the
 * deliberate one is answered by syncing often, not by storage flags.
 *
 * ## Why the grant is not worth blocking on
 *
 * Chrome decides silently from engagement/installation signals, Firefox may
 * prompt, and some contexts refuse outright. A refusal leaves the app exactly
 * where it already was, so this never gates sign-in and never throws.
 */

export type PersistenceOutcome =
  | 'persisted'      // durable, now or already
  | 'denied'         // the browser said no — best-effort, as before
  | 'unsupported';   // no Storage API (older WebView)

/** Module-level latch: the browser's answer does not change within a session. */
let settled: Promise<PersistenceOutcome> | null = null;

async function request(): Promise<PersistenceOutcome> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return 'unsupported';
  try {
    // Already granted on a previous visit? Asking again is harmless but
    // pointless, and on Firefox it can re-prompt.
    if (await navigator.storage.persisted?.()) return 'persisted';
    return (await navigator.storage.persist()) ? 'persisted' : 'denied';
  } catch {
    // Private mode and sandboxed contexts throw rather than resolving false.
    return 'unsupported';
  }
}

/**
 * Request durable local storage. Idempotent, never throws, safe to call at
 * boot and again after sign-in — the first call's answer is reused.
 */
export function ensurePersistentStorage(): Promise<PersistenceOutcome> {
  settled ??= request().then(outcome => {
    if (outcome !== 'persisted') {
      // Worth saying once: it changes what an operator should expect from a
      // device that is offline for days, and it is invisible otherwise.
      console.warn(
        `[storage] Local data is evictable (${outcome}). Unsynced records could be `
        + 'dropped by the browser under storage pressure — sync this device regularly.',
      );
    }
    return outcome;
  });
  return settled;
}

/** Reset the latch. Tests only. */
export function _resetPersistenceForTest(): void {
  settled = null;
}
