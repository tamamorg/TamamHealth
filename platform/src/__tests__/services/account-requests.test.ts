/**
 * @jest-environment node
 *
 * Account-request routing (src/lib/services/account-request-service.ts).
 *
 * The routing rule IS the authorization boundary: it decides which
 * administrator is shown a request, and approving a request creates a real
 * account. So these tests are about who can see and decide what, not about
 * whether a form submits.
 */

export {};

const store = new Map<string, Record<string, unknown>>();

// A function declaration, not a const: `jest.mock` is hoisted above this file's
// bindings and the module under test is imported before a `const` would be
// initialised, so an arrow here fails with a temporal-dead-zone error. `store`
// is only touched when these methods run, which is after initialisation.
function accountRequestsDB() {
  return {
    async get(id: string) {
      if (store.has(id)) return store.get(id);
      const err = new Error('missing') as Error & { status: number };
      err.status = 404;
      throw err;
    },
    async put(doc: Record<string, unknown>) {
      store.set(doc._id as string, doc);
      return { ok: true, id: doc._id, rev: '2-x' };
    },
    async find({ selector }: { selector: Record<string, unknown> }) {
      const docs = [...store.values()].filter(d => d.type === selector.type);
      return { docs };
    },
    async createIndex() { return { result: 'created' }; },
  };
}

jest.mock('@/lib/db', () => ({ accountRequestsDB }));

import {
  createAccountRequest, listAccountRequests, canDecide, recordDecision,
  approverTierFor, suggestUsername, isRequestableRole,
} from '@/lib/services/account-request-service';
import type { DataScope } from '@/lib/services/data-scope';

const orgAdmin = (orgId?: string): DataScope => ({ role: 'org_admin', orgId });
const superAdmin: DataScope = { role: 'super_admin' };

beforeEach(() => store.clear());

describe('who must approve a request', () => {
  it('sends platform and national roles to the platform operator', () => {
    // These bypass org scoping in filterByScope, so an org admin granting one
    // would be handing out access to every other tenant's data.
    expect(approverTierFor('government', 'org-a')).toBe('super_admin');
    expect(approverTierFor('county_health_director', 'org-a')).toBe('super_admin');
    expect(approverTierFor('super_admin', 'org-a')).toBe('super_admin');
  });

  it('sends ordinary roles to the named organisation', () => {
    expect(approverTierFor('nurse', 'org-a')).toBe('org_admin');
    expect(approverTierFor('org_admin', 'org-a')).toBe('org_admin');
  });

  it('sends a request naming no organisation to the platform operator', () => {
    // Otherwise it is visible to nobody and simply rots.
    expect(approverTierFor('nurse', undefined)).toBe('super_admin');
  });

  it('refuses to let the platform operator role be requested at all', () => {
    expect(isRequestableRole('super_admin')).toBe(false);
    expect(isRequestableRole('nurse')).toBe(true);
  });
});

describe('what an approver can see', () => {
  const submit = (over: Partial<Parameters<typeof createAccountRequest>[0]> = {}) =>
    createAccountRequest({
      fullName: 'Mary Nyaboth', email: 'mary@example.org', requestedRole: 'nurse',
      orgId: 'org-a', orgName: 'Org A', ...over,
    });

  it('shows an org admin only their own tenant', async () => {
    await submit({ orgId: 'org-a' });
    await submit({ orgId: 'org-b', email: 'other@example.org' });

    const mine = await listAccountRequests(orgAdmin('org-a'));
    expect(mine).toHaveLength(1);
    expect(mine[0].orgId).toBe('org-a');
  });

  it('hides a national-role request from an org admin even in their own org', async () => {
    // The request carries orgId 'org-a', so an org check alone would pass it.
    // The tier check is what stops an org admin granting a cross-tenant role.
    await submit({ orgId: 'org-a', requestedRole: 'government' });
    expect(await listAccountRequests(orgAdmin('org-a'))).toHaveLength(0);
    expect(await listAccountRequests(superAdmin)).toHaveLength(1);
  });

  it('shows the platform operator everything', async () => {
    await submit({ orgId: 'org-a' });
    await submit({ orgId: 'org-b', email: 'b@example.org' });
    await submit({ orgId: undefined, email: 'c@example.org' });
    expect(await listAccountRequests(superAdmin)).toHaveLength(3);
  });

  it('fails closed for an org admin whose session carries no tenant', async () => {
    await submit({ orgId: 'org-a' });
    expect(await listAccountRequests(orgAdmin(undefined))).toHaveLength(0);
  });

  it('shows nothing to a role that cannot approve', async () => {
    await submit({ orgId: 'org-a' });
    expect(await listAccountRequests({ role: 'doctor', orgId: 'org-a' })).toHaveLength(0);
  });
});

describe('who can decide a request', () => {
  it('matches what the list shows', async () => {
    const doc = await createAccountRequest({
      fullName: 'Peter Deng', email: 'peter@example.org', requestedRole: 'nurse', orgId: 'org-a',
    });
    expect(canDecide(orgAdmin('org-a'), doc)).toBe(true);
    expect(canDecide(orgAdmin('org-b'), doc)).toBe(false);
    expect(canDecide(orgAdmin(undefined), doc)).toBe(false);
    expect(canDecide(superAdmin, doc)).toBe(true);
    expect(canDecide({ role: 'doctor', orgId: 'org-a' }, doc)).toBe(false);
  });
});

describe('deciding', () => {
  it('records who decided and what it produced', async () => {
    const doc = await createAccountRequest({
      fullName: 'Grace Lado', email: 'grace@example.org', requestedRole: 'nurse', orgId: 'org-a',
    });
    const updated = await recordDecision(doc._id, 'approved', { username: 'admin.a', name: 'Admin A' }, {
      createdUsername: 'grace.lado',
    });
    expect(updated.status).toBe('approved');
    expect(updated.decidedBy).toBe('admin.a');
    expect(updated.createdUsername).toBe('grace.lado');
  });

  it('refuses to decide the same request twice', async () => {
    // A double-click must not be able to mint two accounts for one request.
    const doc = await createAccountRequest({
      fullName: 'Grace Lado', email: 'grace@example.org', requestedRole: 'nurse', orgId: 'org-a',
    });
    await recordDecision(doc._id, 'approved', { username: 'admin.a' }, { createdUsername: 'grace.lado' });
    await expect(
      recordDecision(doc._id, 'rejected', { username: 'admin.b' }),
    ).rejects.toThrow(/already approved/);
  });
});

describe('the submitted claim', () => {
  it('will not accept a role that is not on the list', async () => {
    await expect(createAccountRequest({
      fullName: 'X', email: 'x@example.org', requestedRole: 'super_admin' as never,
    })).rejects.toThrow(/from the list/);
  });

  it('requires a name and a plausible email', async () => {
    await expect(createAccountRequest({
      fullName: '  ', email: 'a@b.co', requestedRole: 'nurse',
    })).rejects.toThrow(/name is required/);
    await expect(createAccountRequest({
      fullName: 'A', email: 'not-an-email', requestedRole: 'nurse',
    })).rejects.toThrow(/valid email/);
  });

  it('stores the tier it derived, never one the caller supplied', async () => {
    // A requester choosing their own approver — or arriving pre-approved —
    // would defeat the whole rule, so both are sent and both must be ignored.
    const forged = {
      fullName: 'A B', email: 'a@b.co', requestedRole: 'nurse', orgId: 'org-a',
      approverTier: 'org_admin', status: 'approved',
    } as unknown as Parameters<typeof createAccountRequest>[0];
    const doc = await createAccountRequest(forged);
    expect(doc.approverTier).toBe('org_admin');
    expect(doc.status).toBe('pending');
  });
});

describe('suggested usernames', () => {
  it('follows the convention already in the roster', () => {
    expect(suggestUsername('Mary Nyaboth', () => false)).toBe('mary.nyaboth');
    expect(suggestUsername('Dr. Wani', () => false)).toBe('dr.wani');
  });

  it('steps around a name already taken', () => {
    const taken = new Set(['mary.nyaboth', 'mary.nyaboth2']);
    expect(suggestUsername('Mary Nyaboth', n => taken.has(n))).toBe('mary.nyaboth3');
  });

  it('survives a name with nothing usable in it', () => {
    expect(suggestUsername('!!!', () => false)).toBe('user');
  });
});
