/**
 * Announcement targeting (lib/services/announcement-service.ts).
 *
 * An announcement's audience is a promise about who sees it. The old facility
 * filter failed OPEN — `audience: 'facility'` with no facilityId (what an org
 * admin's "My facility" produced, having no facility) showed the post to every
 * facility in the org. These tests pin the fail-closed behaviour, the author's
 * own visibility, role targeting, and the create-time validation that stops
 * the underspecified shapes from being written at all.
 */
export {};

const store = new Map<string, Record<string, unknown>>();

function announcementsDB() {
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
      return { docs: [...store.values()].filter(d => d.type === selector.type) };
    },
    async createIndex() { return { result: 'created' }; },
  };
}

jest.mock('@/lib/db', () => ({ announcementsDB }));
jest.mock('@/lib/services/audit-service', () => ({ logAuditSafe: jest.fn() }));

import { createAnnouncement, getVisibleAnnouncements } from '@/modules/communication/services/announcement-service';
import type { DataScope } from '@/lib/services/data-scope';
import type { AnnouncementDoc, UserRole } from '@/lib/db-types';

const ORG = 'org-1';

function scopeFor(role: UserRole, hospitalId?: string): DataScope {
  return { role, orgId: ORG, hospitalId };
}

function seed(partial: Partial<AnnouncementDoc> & Pick<AnnouncementDoc, '_id' | 'audience'>) {
  const doc = {
    type: 'announcement',
    title: 'T', body: 'B', priority: 'normal',
    authorId: 'user-author', authorName: 'Author',
    orgId: ORG,
    createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
    dismissedBy: [],
    ...partial,
  };
  store.set(doc._id, doc as unknown as Record<string, unknown>);
}

beforeEach(() => store.clear());

describe('facility-targeted announcements', () => {
  it('reach only the targeted facility', async () => {
    seed({ _id: 'ann-a', audience: 'facility', facilityId: 'hosp-1' });
    const atTarget = await getVisibleAnnouncements(scopeFor('nurse', 'hosp-1'), {
      userId: 'u1', role: 'nurse', hospitalId: 'hosp-1',
    });
    const elsewhere = await getVisibleAnnouncements(scopeFor('nurse', 'hosp-2'), {
      userId: 'u2', role: 'nurse', hospitalId: 'hosp-2',
    });
    expect(atTarget.map(a => a._id)).toEqual(['ann-a']);
    expect(elsewhere).toHaveLength(0);
  });

  it('fails closed when the post names no facility (legacy shape)', async () => {
    seed({ _id: 'ann-b', audience: 'facility' });
    const viewer = await getVisibleAnnouncements(scopeFor('nurse', 'hosp-1'), {
      userId: 'u1', role: 'nurse', hospitalId: 'hosp-1',
    });
    expect(viewer).toHaveLength(0);
  });

  it('stays visible to its own author even when misdirected', async () => {
    seed({ _id: 'ann-c', audience: 'facility', authorId: 'user-author' });
    const author = await getVisibleAnnouncements(scopeFor('org_admin'), {
      userId: 'user-author', role: 'org_admin',
    });
    expect(author.map(a => a._id)).toEqual(['ann-c']);
  });
});

describe('role-targeted announcements', () => {
  it('reach exactly the named roles', async () => {
    seed({ _id: 'ann-d', audience: 'role', targetRoles: ['pharmacist', 'nurse'] });
    const pharmacist = await getVisibleAnnouncements(scopeFor('pharmacist', 'hosp-1'), {
      userId: 'u1', role: 'pharmacist', hospitalId: 'hosp-1',
    });
    const doctor = await getVisibleAnnouncements(scopeFor('doctor', 'hosp-1'), {
      userId: 'u2', role: 'doctor', hospitalId: 'hosp-1',
    });
    expect(pharmacist.map(a => a._id)).toEqual(['ann-d']);
    expect(doctor).toHaveLength(0);
  });

  it('an empty target list shows to nobody but the author', async () => {
    seed({ _id: 'ann-e', audience: 'role', targetRoles: [] });
    const nurse = await getVisibleAnnouncements(scopeFor('nurse', 'hosp-1'), {
      userId: 'u1', role: 'nurse', hospitalId: 'hosp-1',
    });
    expect(nurse).toHaveLength(0);
  });
});

describe('org-wide announcements', () => {
  it('reach every facility in the org, and stay inside the org', async () => {
    seed({ _id: 'ann-f', audience: 'organization' });
    seed({ _id: 'ann-other-org', audience: 'organization', orgId: 'org-2' });
    const viewer = await getVisibleAnnouncements(scopeFor('nurse', 'hosp-2'), {
      userId: 'u1', role: 'nurse', hospitalId: 'hosp-2',
    });
    expect(viewer.map(a => a._id)).toEqual(['ann-f']);
  });
});

describe('per-user state', () => {
  it('a dismissal hides the post for that user only', async () => {
    seed({ _id: 'ann-g', audience: 'organization', dismissedBy: ['u1'] });
    const dismissedFor = await getVisibleAnnouncements(scopeFor('nurse', 'hosp-1'), {
      userId: 'u1', role: 'nurse', hospitalId: 'hosp-1',
    });
    const stillShownTo = await getVisibleAnnouncements(scopeFor('nurse', 'hosp-1'), {
      userId: 'u2', role: 'nurse', hospitalId: 'hosp-1',
    });
    expect(dismissedFor).toHaveLength(0);
    expect(stillShownTo.map(a => a._id)).toEqual(['ann-g']);
  });
});

describe('creating a targeted announcement requires its target', () => {
  const base = {
    title: 'T', body: 'B', priority: 'normal' as const,
    authorId: 'u1', authorName: 'A', orgId: ORG,
  };

  it('rejects a facility audience without a facility', async () => {
    await expect(createAnnouncement({ ...base, audience: 'facility' }))
      .rejects.toThrow(/facility/i);
  });

  it('rejects a role audience without roles', async () => {
    await expect(createAnnouncement({ ...base, audience: 'role', targetRoles: [] }))
      .rejects.toThrow(/role/i);
  });

  it('accepts fully-specified targets', async () => {
    const fac = await createAnnouncement({ ...base, audience: 'facility', facilityId: 'hosp-1' });
    const rol = await createAnnouncement({ ...base, audience: 'role', targetRoles: ['nurse'] });
    expect(fac.facilityId).toBe('hosp-1');
    expect(rol.targetRoles).toEqual(['nurse']);
  });
});
