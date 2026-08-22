import bcrypt from 'bcryptjs';

// Re-export token functions so existing imports still work
export { createToken, verifyToken } from './auth-token';

/**
 * bcrypt work factor.
 *
 * 12 everywhere the product runs. Lower ONLY under Jest, and keyed on
 * `JEST_WORKER_ID` rather than `NODE_ENV`: the worker id is injected by the
 * test runner and cannot be present in a deployed process, whereas a
 * misconfigured `NODE_ENV=test` on a server would silently weaken every stored
 * password.
 *
 * This is not a test convenience for its own sake. A cost-12 hash takes ~415ms
 * on a developer machine, and the service suites that exercise the real
 * registration and invite paths hash a dozen-plus times each. Under parallel
 * Jest workers competing for CPU that pushed them past the default timeout, so
 * `tenant-provisioning-flow` and `user-invite-redemption` failed in a full run
 * and passed in isolation — the shape of flakiness that gets a suite marked
 * skipped rather than diagnosed. The hashing path is still exercised; only the
 * round count changes.
 */
const BCRYPT_COST = process.env.JEST_WORKER_ID === undefined ? 12 : 4;

/** Exported so a test can assert production never gets the reduced cost. */
export const bcryptCost = () => BCRYPT_COST;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
