/**
 * Announcements (broadcast notices to staff).
 */
import type { BaseDoc, UserRole } from './db-types';

export type AnnouncementAudience = 'organization' | 'facility' | 'role';
export type AnnouncementPriority = 'normal' | 'important' | 'urgent';

export interface AnnouncementDoc extends BaseDoc {
  type: 'announcement';
  title: string;
  body: string;
  audience: AnnouncementAudience;
  /** When audience === 'role', the roles this announcement targets. */
  targetRoles?: UserRole[];
  priority: AnnouncementPriority;
  authorId: string;
  authorName: string;
  facilityId?: string;
  facilityName?: string;
  /** Optional auto-expiry (ISO). After this the announcement is hidden. */
  expiresAt?: string;
  /** User IDs that have dismissed this announcement. */
  dismissedBy?: string[];
  orgId?: string;
  payam?: string;
}
