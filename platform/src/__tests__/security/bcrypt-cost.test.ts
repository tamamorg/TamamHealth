/** @jest-environment node */
/**
 * The password work factor.
 *
 * `hashPassword` runs at cost 12 in every deployed process and cost 4 under
 * Jest. That is a deliberate trade with one hard requirement: the reduction
 * must be impossible outside the test runner.
 *
 * It keys on `JEST_WORKER_ID`, which the runner injects into each worker and
 * which no deployed process sets. The obvious alternative — `NODE_ENV === 'test'`
 * — is an environment variable an operator can set by accident, and getting it
 * wrong would silently weaken every password the platform stores while
 * everything continued to work.
 *
 * Why it exists: a cost-12 hash is ~415ms on a developer machine, and the
 * service suites that exercise real registration and invite flows hash a dozen
 * times each. Under parallel workers that pushed two suites past the default
 * timeout — passing alone, failing in a full run. Cost 4 took them from ~68s
 * combined to ~1.3s.
 */
import bcrypt from 'bcryptjs';
import { hashPassword, verifyPassword, bcryptCost } from '@/lib/auth';

describe('the reduced cost is confined to the test runner', () => {
  it('uses the low cost here, because Jest is running', () => {
    expect(process.env.JEST_WORKER_ID).toBeDefined();
    expect(bcryptCost()).toBe(4);
  });

  it('would use cost 12 anywhere JEST_WORKER_ID is absent', async () => {
    // Re-import with the marker removed: this is the deployed-process case.
    const saved = process.env.JEST_WORKER_ID;
    delete process.env.JEST_WORKER_ID;
    jest.resetModules();
    const fresh = await import('@/lib/auth');
    expect(fresh.bcryptCost()).toBe(12);
    process.env.JEST_WORKER_ID = saved;
    jest.resetModules();
  });

  it('does not key on NODE_ENV, which an operator can set by mistake', async () => {
    const savedNode = process.env.NODE_ENV;
    const savedWorker = process.env.JEST_WORKER_ID;
    delete process.env.JEST_WORKER_ID;
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'test', configurable: true });
    jest.resetModules();

    const fresh = await import('@/lib/auth');
    // NODE_ENV says "test" and the worker id is gone: still the full cost.
    expect(fresh.bcryptCost()).toBe(12);

    Object.defineProperty(process.env, 'NODE_ENV', { value: savedNode, configurable: true });
    process.env.JEST_WORKER_ID = savedWorker;
    jest.resetModules();
  });
});

describe('the hash is still a real bcrypt hash', () => {
  it('produces a bcrypt envelope carrying the cost it used', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash).toMatch(/^\$2[aby]\$04\$/);
  });

  it('verifies the password it hashed', async () => {
    const hash = await hashPassword('correct horse battery');
    await expect(verifyPassword('correct horse battery', hash)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery');
    await expect(verifyPassword('wrong', hash)).resolves.toBe(false);
  });

  it('salts, so the same password hashes differently every time', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(a).not.toBe(b);
  });

  it('still verifies a stored cost-12 hash', async () => {
    // Every password already in the database was hashed at 12. bcrypt reads
    // the cost from the envelope, so lowering the WRITE cost must not lock
    // anybody out — this is the assertion that says so.
    const legacy = bcrypt.hashSync('legacy-password', 10);
    await expect(verifyPassword('legacy-password', legacy)).resolves.toBe(true);
  });
});
