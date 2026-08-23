/**
 * @jest-environment node
 *
 * Trash, and the one rule that makes a permanent delete safe.
 *
 * Deleting an organization document does NOT delete what it owns. Facilities,
 * staff accounts and patient charts carry the `orgId` as a plain string, and
 * `filterByScope` matches on it — so removing the parent leaves every one of
 * those documents pointing at a tenant that no longer exists: invisible to
 * every scoped query, unreachable from any screen, and still on disk holding
 * patient data. An empty tenant is the only one that can be removed without
 * creating that, which is why `purgeOrganization` counts first and refuses.
 */

const orgDoc = {
  _id: 'org-a', _rev: '1-x', type: 'organization', name: 'Mercy Health', slug: 'mercy',
  isActive: false, subscriptionStatus: 'trial',
};
const removed: string[] = [];
const put: Record<string, unknown>[] = [];
/** What the tenant still owns, as `getOrganizationStats` will count it. */
let owned = { users: 0, hospitals: 0, patients: 0 };

/** Every `_deleted: true` document written by the cascade, by database. */
const bulkDeleted: Record<string, string[]> = { user: [], hospital: [], patient: [] };

const rows = (label: string, n: number) => ({
  docs: Array.from({ length: n }, (_, i) => ({ _id: `${label}-${i}`, _rev: `1-${i}` })),
});
const findDb = (label: string, count: () => number) => ({
  createIndex: jest.fn(async () => ({ result: 'created' })),
  find: jest.fn(async () => rows(label, count())),
  bulkDocs: jest.fn(async (docs: Array<{ _id: string; _deleted?: boolean }>) => {
    for (const d of docs) if (d._deleted) bulkDeleted[label].push(d._id);
    return docs.map(d => ({ ok: true, id: d._id }));
  }),
});

jest.mock('@/lib/db', () => ({
  organizationsDB: () => ({
    get: jest.fn(async () => ({ ...orgDoc })),
    put: jest.fn(async (doc: Record<string, unknown>) => { put.push(doc); return { rev: '2-y' }; }),
    remove: jest.fn(async (id: string) => { removed.push(id); return { ok: true }; }),
  }),
  usersDB: () => findDb('user', () => owned.users),
  hospitalsDB: () => findDb('hospital', () => owned.hospitals),
  patientsDB: () => findDb('patient', () => owned.patients),
}));
jest.mock('@/lib/services/audit-service', () => ({ logAudit: jest.fn(async () => undefined) }));
jest.mock('@/lib/services/sync-event-service', () => ({ emitSyncEvent: jest.fn() }));

import { purgeOrganization, restoreOrganization } from '@/lib/services/organization-service';

beforeEach(() => {
  removed.length = 0; put.length = 0;
  for (const key of Object.keys(bulkDeleted)) bulkDeleted[key].length = 0;
  owned = { users: 0, hospitals: 0, patients: 0 };
});

describe('deleting a tenant permanently', () => {
  it('removes one that owns nothing', async () => {
    await purgeOrganization('org-a', 'admin-1', 'operator');
    expect(removed).toEqual(['org-a']);
  });

  it.each([
    ['facilities', { hospitals: 3 }],
    ['staff accounts', { users: 2 }],
    ['patients', { patients: 41 }],
  ])('refuses one that still owns %s, and says what it holds', async (_label, extra) => {
    owned = { ...owned, ...extra };
    await expect(purgeOrganization('org-a')).rejects.toMatchObject({
      name: 'OrganizationNotEmptyError',
    });
    // The document is untouched: a refused delete must not half-apply.
    expect(removed).toEqual([]);
  });

  it('reports the counts on the error, so the operator is told what is in the way', async () => {
    owned = { users: 2, hospitals: 3, patients: 41 };
    await expect(purgeOrganization('org-a')).rejects.toMatchObject({
      counts: { hospitalCount: 3, userCount: 2, patientCount: 41 },
    });
  });

  it('marks a facilities/staff refusal as one the operator can cascade past', async () => {
    owned = { users: 2, hospitals: 3, patients: 0 };
    await expect(purgeOrganization('org-a')).rejects.toMatchObject({ cascadable: true });
  });

  it('marks a patient refusal as one no cascade clears', async () => {
    owned = { users: 0, hospitals: 0, patients: 41 };
    await expect(purgeOrganization('org-a')).rejects.toMatchObject({ cascadable: false });
  });
});

describe('offboarding a tenant with the cascade', () => {
  it('deletes its facilities and staff accounts with it', async () => {
    owned = { users: 2, hospitals: 3, patients: 0 };
    await purgeOrganization('org-a', 'admin-1', 'operator', { cascade: true });

    expect(bulkDeleted.hospital).toEqual(['hospital-0', 'hospital-1', 'hospital-2']);
    expect(bulkDeleted.user).toEqual(['user-0', 'user-1']);
    // And the tenant itself, last — nothing is left pointing at a document
    // that is already gone.
    expect(removed).toEqual(['org-a']);
  });

  it('still refuses while the tenant holds patients, cascade or not', async () => {
    // A chart is spread across ~70 databases keyed by patientId. Deleting the
    // patient document would strand the clinical record rather than remove it,
    // which is the exact harm the guard exists to prevent — so this is the one
    // refusal the platform operator cannot override from Trash.
    owned = { users: 2, hospitals: 3, patients: 41 };
    await expect(purgeOrganization('org-a', 'admin-1', 'operator', { cascade: true }))
      .rejects.toMatchObject({ name: 'OrganizationNotEmptyError', cascadable: false });

    // Nothing half-applied: the facilities and staff are still there.
    expect(bulkDeleted.hospital).toEqual([]);
    expect(bulkDeleted.user).toEqual([]);
    expect(removed).toEqual([]);
  });

  it('is a no-op on an empty tenant — no bulk write, just the delete', async () => {
    await purgeOrganization('org-a', 'admin-1', 'operator', { cascade: true });
    expect(bulkDeleted.hospital).toEqual([]);
    expect(bulkDeleted.user).toEqual([]);
    expect(removed).toEqual(['org-a']);
  });
});

describe('restoring a tenant', () => {
  it('only flips isActive, so the plan it was on survives the round trip', async () => {
    await restoreOrganization('org-a', 'admin-1', 'operator');
    expect(put).toHaveLength(1);
    expect(put[0]).toMatchObject({
      _id: 'org-a',
      isActive: true,
      // Deactivation never touched these, and restore must not either.
      subscriptionStatus: 'trial',
      name: 'Mercy Health',
      slug: 'mercy',
    });
  });
});
