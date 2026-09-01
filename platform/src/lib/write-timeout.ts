/**
 * Shared ceiling for critical clinical writes.
 *
 * The failure mode this exists for showed up three times before it got a
 * shared home (walk-in check-in — DEF-1; patient registration — DEF-2; the
 * lab-order submit observed hanging on "Creating…" in the 2026-08 QA pass):
 * on a device still completing its initial sync, a local PouchDB/IndexedDB
 * write can stall indefinitely under contention, and an unbounded `await`
 * turns that into a spinner that never ends — no error, no retry, and on an
 * intake screen an invitation to click again. Every caller had its own copy
 * of the same guard; new write paths (orders, triage) had none.
 *
 * `withTimeout` rejects after `ms` so the caller's existing error handling
 * (every clinical form already has a catch + toast) surfaces a retryable
 * failure instead of hanging. The underlying write is NOT cancelled — PouchDB
 * promises can't be — so it may still land after the timeout fires; that is
 * the accepted trade-off (same as DEF-1): a duplicate the user can see beats
 * a record silently lost behind a spinner.
 *
 * The default ceiling is far above any healthy local write (sub-second in
 * steady state) so a legitimately slow device is never tripped — only a
 * genuinely stuck one.
 */
export const CLINICAL_WRITE_TIMEOUT_MS = 30_000;

/** Rejects with `message` after `ms` if `promise` has not settled by then. */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}
