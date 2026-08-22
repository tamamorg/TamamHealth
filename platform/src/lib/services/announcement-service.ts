import { announcementsDB } from '../db';
import type { AnnouncementDoc, UserRole } from '../db-types';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { findByType } from './db-query';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from './audit-service';

/** Roles allowed to post announcements. Everyone else is read-only. */
export const ANNOUNCEMENT_AUTHOR_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'medical_superintendent', 'hospital_manager', 'hrio', 'government',
];

export function canPostAnnouncements(role: UserRole): boolean {
  return ANNOUNCEMENT_AUTHOR_ROLES.includes(role);
}

interface Viewer {
  userId?: string;
  role: UserRole;
  hospitalId?: string;
}

/**
 * Announcements visible to a viewer: org-scoped, not expired, not dismissed,
 * and matching the audience (whole org, a specific facility, or specific
 * roles). Authors always see their own posts — otherwise an org admin who
 * targets a facility they don't belong to publishes into a void they can't
 * inspect.
 */
export async function getVisibleAnnouncements(scope: DataScope, viewer: Viewer): Promise<AnnouncementDoc[]> {
  const db = announcementsDB();
  const docs = await findByType<AnnouncementDoc>(db, 'announcement');
  const now = new Date().toISOString();
  const all = filterByScope(docs, scope);
  return all
    .filter(a => !a.expiresAt || a.expiresAt > now)
    .filter(a => !viewer.userId || !(a.dismissedBy || []).includes(viewer.userId))
    .filter(a => {
      if (!!viewer.userId && a.authorId === viewer.userId) return true;
      if (a.audience === 'organization') return true;
      // Fail closed: a facility-audience post with no facilityId used to show
      // to EVERY facility in the org — the exact opposite of what its author
      // chose. createAnnouncement now rejects that shape; legacy docs stay
      // visible only to their author.
      if (a.audience === 'facility') return !!a.facilityId && a.facilityId === viewer.hospitalId;
      if (a.audience === 'role') return (a.targetRoles || []).includes(viewer.role);
      return true;
    })
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export async function createAnnouncement(
  data: Omit<AnnouncementDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt' | 'dismissedBy'>,
): Promise<AnnouncementDoc> {
  if (!data.title?.trim() || !data.body?.trim()) {
    throw new Error('Title and message are required');
  }
  // A targeted audience must actually name its target, or visibility filters
  // have nothing to match and the post either leaks org-wide or vanishes.
  if (data.audience === 'facility' && !data.facilityId) {
    throw new Error('Choose which facility this announcement is for');
  }
  if (data.audience === 'role' && !(data.targetRoles || []).length) {
    throw new Error('Choose at least one role to announce to');
  }
  const db = announcementsDB();
  const now = new Date().toISOString();
  const doc: AnnouncementDoc = {
    _id: `ann-${uuidv4()}`,
    type: 'announcement',
    dismissedBy: [],
    ...data,
    title: data.title.trim(),
    body: data.body.trim(),
    createdAt: now,
    updatedAt: now,
  };
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  await logAuditSafe('CREATE_ANNOUNCEMENT', data.authorId, data.authorName,
    `Announcement "${doc.title}" (${data.audience}, ${data.priority})`);
  return doc;
}

/** Per-user dismissal — hides the announcement for that user only. */
export async function dismissAnnouncement(id: string, userId: string): Promise<void> {
  const db = announcementsDB();
  const existing = await db.get(id) as AnnouncementDoc;
  const dismissedBy = Array.from(new Set([...(existing.dismissedBy || []), userId]));
  const resp = await db.put({ ...existing, dismissedBy, updatedAt: new Date().toISOString() });
  void resp;
}
