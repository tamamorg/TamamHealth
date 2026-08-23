'use client';

/**
 * Announcements — what the platform broadcasts to a tenant's staff.
 *
 * This was "Support Operations", a five-section console whose other four
 * sections were either somewhere else already or nowhere at all: tenant lookup
 * repeated /admin/organizations, user lookup repeated /admin/users, "support
 * access" was `/support|impersonat|emergency|break/` filtered out of the audit
 * log that /admin/audit shows in full, and the ticket queue was a hardcoded
 * zero with no store behind it. Announcements is the one thing only this page
 * did, so it is the whole page and the nav entry says so.
 */

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/context';
import { useToast } from '@/components/Toast';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import type { AnnouncementDoc, AnnouncementPriority } from '@/lib/db-types';
import {
  SadbPage, SadbPanelHeader, SadbCard, SadbQueueRow, SadbSettingGroup, type ChipTone,
} from '@/components/admin/sadb-ui';
import { formatWhen } from '@/components/admin/sa-ui';
import { Send } from '@/components/icons/lucide';
import Select from '@/components/Select';
import { canPostAnnouncements, createAnnouncement, getVisibleAnnouncements } from '@/modules/communication/services/announcement-service';

function priorityChipTone(p: AnnouncementPriority): ChipTone {
  return p === 'urgent' ? 'red' : p === 'important' ? 'yellow' : 'neutral';
}

export default function AdminAnnouncementsPage() {
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const { organizations } = useOrganizations();

  const [announcements, setAnnouncements] = useState<AnnouncementDoc[]>([]);
  const [announcementsLoading, setAnnouncementsLoading] = useState(true);

  const [annTitle, setAnnTitle] = useState('');
  const [annBody, setAnnBody] = useState('');
  const [annPriority, setAnnPriority] = useState<AnnouncementPriority>('normal');
  const [annOrgId, setAnnOrgId] = useState('');
  const [annPosting, setAnnPosting] = useState(false);

  const loadAnnouncements = useCallback(() => {
    if (!currentUser) return;
    setAnnouncementsLoading(true);
    getVisibleAnnouncements(
      { role: currentUser.role },
      { userId: currentUser._id, role: currentUser.role, hospitalId: currentUser.hospitalId }
    )
      .then(setAnnouncements)
      .catch(() => setAnnouncements([]))
      .finally(() => setAnnouncementsLoading(false));
  }, [currentUser]);

  useEffect(() => { loadAnnouncements(); }, [loadAnnouncements]);

  useEffect(() => {
    if (!annOrgId && organizations.length > 0) setAnnOrgId(organizations[0]._id);
  }, [organizations, annOrgId]);

  const handlePostAnnouncement = async () => {
    if (!currentUser || !annTitle.trim() || !annBody.trim() || !annOrgId) return;
    setAnnPosting(true);
    try {
      await createAnnouncement({
        title: annTitle,
        body: annBody,
        audience: 'organization',
        priority: annPriority,
        authorId: currentUser._id,
        authorName: currentUser.name,
        orgId: annOrgId,
      });
      setAnnTitle('');
      setAnnBody('');
      setAnnPriority('normal');
      loadAnnouncements();
      showToast('Announcement posted.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to post announcement.', 'error');
    } finally {
      setAnnPosting(false);
    }
  };

  return (
    <SadbPage>
      <SadbPanelHeader
        title="Announcements"
        note="Messages broadcast to tenant staff, newest first."
        tag={announcementsLoading ? undefined : `${announcements.length} visible`}
      />
      <SadbCard>
        {announcementsLoading ? (
          <p className="sadb-empty">Loading announcements…</p>
        ) : announcements.length === 0 ? (
          <p className="sadb-empty">No announcements are currently visible.</p>
        ) : (
          announcements.slice(0, 10).map(a => (
            <SadbQueueRow
              key={a._id}
              chip={a.priority}
              chipTone={priorityChipTone(a.priority)}
              title={a.title}
              sub={`${a.audience} · ${formatWhen(a.createdAt)}`}
            />
          ))
        )}
      </SadbCard>

      {currentUser && canPostAnnouncements(currentUser.role) && (
        <SadbSettingGroup title="Post an announcement" meta="Organization audience">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="sadb-setting-label" style={{ fontSize: 11.5 }}>Title</span>
              <input
                type="text"
                className="sadb-modal-input"
                placeholder="Announcement title"
                value={annTitle}
                onChange={e => setAnnTitle(e.target.value)}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="sadb-setting-label" style={{ fontSize: 11.5 }}>Message</span>
              <textarea
                className="sadb-modal-input"
                placeholder="Message"
                rows={3}
                value={annBody}
                onChange={e => setAnnBody(e.target.value)}
              />
            </label>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 200px' }}>
                <span className="sadb-setting-label" style={{ fontSize: 11.5 }}>Organization</span>
                <Select
                  className="sadb-modal-input"
                  value={annOrgId}
                  onChange={e => setAnnOrgId(e.target.value)}
                >
                  {organizations.map(o => <option key={o._id} value={o._id}>{o.name}</option>)}
                </Select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '0 0 160px' }}>
                <span className="sadb-setting-label" style={{ fontSize: 11.5 }}>Priority</span>
                <Select
                  className="sadb-modal-input"
                  value={annPriority}
                  onChange={e => setAnnPriority(e.target.value as AnnouncementPriority)}
                >
                  <option value="normal">Normal</option>
                  <option value="important">Important</option>
                  <option value="urgent">Urgent</option>
                </Select>
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handlePostAnnouncement}
                disabled={annPosting || !annTitle.trim() || !annBody.trim() || !annOrgId}
              >
                <Send className="w-3.5 h-3.5" /> {annPosting ? 'Posting…' : 'Post announcement'}
              </button>
            </div>
          </div>
        </SadbSettingGroup>
      )}
    </SadbPage>
  );
}
