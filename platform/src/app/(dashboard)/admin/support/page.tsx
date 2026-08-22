'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/context';
import { useToast } from '@/components/Toast';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { usePlatformConfig } from '@/lib/hooks/usePlatformConfig';
import { getAllUsers } from '@/lib/services/user-service';
import { getRecentAuditLogs } from '@/lib/services/audit-service';
import {
  getVisibleAnnouncements, createAnnouncement, canPostAnnouncements,
} from '@/lib/services/announcement-service';
import type { UserDoc, AuditLogDoc, AnnouncementDoc, AnnouncementPriority } from '@/lib/db-types';
import {
  SadbPage, SadbShell, useSadbTab, SadbPanelHeader, SadbCard, SadbChip, SadbKvRow,
  SadbQueueRow, SadbSearch, SadbSettingGroup, statusChip, type ChipTone,
} from '@/components/admin/sadb-ui';
import { SaTable, formatWhen } from '@/components/admin/sa-ui';
import { Send, Building2, Users, ShieldCheck, Megaphone, ClipboardList } from '@/components/icons/lucide';
import Select from '@/components/Select';

const SUPPORT_ACTION_RE = /support|impersonat|emergency|break/i;

function priorityChipTone(p: AnnouncementPriority): ChipTone {
  return p === 'urgent' ? 'red' : p === 'important' ? 'yellow' : 'neutral';
}

export default function AdminSupportPage() {
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const { organizations, loading: orgsLoading } = useOrganizations();
  const { hospitals, loading: hospitalsLoading } = useHospitals();
  const { config } = usePlatformConfig();

  const [users, setUsers] = useState<UserDoc[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [auditLogs, setAuditLogs] = useState<AuditLogDoc[]>([]);
  const [announcements, setAnnouncements] = useState<AnnouncementDoc[]>([]);
  const [announcementsLoading, setAnnouncementsLoading] = useState(true);

  const [orgQuery, setOrgQuery] = useState('');
  const [userQuery, setUserQuery] = useState('');

  const [annTitle, setAnnTitle] = useState('');
  const [annBody, setAnnBody] = useState('');
  const [annPriority, setAnnPriority] = useState<AnnouncementPriority>('normal');
  const [annOrgId, setAnnOrgId] = useState('');
  const [annPosting, setAnnPosting] = useState(false);

  // Section switching is URL-backed (?tab=) via useSadbTab, so every one of
  // the five support topics (tenant lookup, user lookup, access policy,
  // announcements, tickets) is deep-linkable, replacing the old page-local
  // saside rail.
  const [activeSection, setActiveSection] = useSadbTab('tenants');

  useEffect(() => {
    getAllUsers().then(setUsers).catch(() => setUsers([])).finally(() => setUsersLoading(false));
  }, []);

  useEffect(() => {
    getRecentAuditLogs(500).then(setAuditLogs).catch(() => setAuditLogs([]));
  }, []);

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

  const orgById = useMemo(() => {
    const map: Record<string, typeof organizations[number]> = {};
    for (const o of organizations) map[o._id] = o;
    return map;
  }, [organizations]);

  const lastActivityByOrg = useMemo(() => {
    const map: Record<string, string> = {};
    for (const log of auditLogs) {
      if (!log.orgId) continue;
      if (!map[log.orgId]) map[log.orgId] = log.createdAt;
    }
    return map;
  }, [auditLogs]);

  const filteredOrgs = useMemo(() => {
    const q = orgQuery.trim().toLowerCase();
    if (!q) return organizations;
    return organizations.filter(o =>
      o.name.toLowerCase().includes(q) ||
      o.slug.toLowerCase().includes(q) ||
      o.contactEmail.toLowerCase().includes(q)
    );
  }, [organizations, orgQuery]);

  const filteredUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase();
    const base = !q ? users : users.filter(u =>
      u.name.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
      (u.phone || '').toLowerCase().includes(q)
    );
    return base.slice(0, 50);
  }, [users, userQuery]);

  const supportEvents = useMemo(
    () => auditLogs.filter(l => SUPPORT_ACTION_RE.test(l.action)).slice(0, 25),
    [auditLogs]
  );

  const policies = config?.superAdminPolicies;

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

  const railGroups = [{
    title: 'Support Operations',
    items: [
      { id: 'tenants', label: 'Tenant lookup', icon: Building2, count: organizations.length },
      { id: 'users', label: 'User lookup', icon: Users, count: users.length },
      { id: 'access', label: 'Support access', icon: ShieldCheck, count: supportEvents.length },
      { id: 'announcements', label: 'Announcements', icon: Megaphone, count: announcements.length },
      { id: 'tickets', label: 'Ticket queue', icon: ClipboardList, count: 0 },
    ],
  }];

  return (
    <SadbPage>
      <SadbShell groups={railGroups} active={activeSection} onSelect={setActiveSection}>
        {activeSection === 'tenants' && (
          <>
            <SadbPanelHeader
              title="Tenant lookup & diagnostics"
              note="Search organizations by name, slug, or contact email for account and billing diagnostics."
              tag={`${filteredOrgs.length} of ${organizations.length}`}
            />
            <SadbCard>
              <div className="sadb-search-row">
                <SadbSearch
                  value={orgQuery}
                  onChange={setOrgQuery}
                  placeholder="Search organizations by name, slug, or contact email"
                  ariaLabel="Search organizations"
                />
              </div>
              <SaTable
                columns={[
                  { label: 'Organization', w: 2 }, { label: 'Status', w: 0.9 }, { label: 'Plan', w: 0.9 },
                  { label: 'Users', w: 0.7 }, { label: 'Facilities', w: 0.9 },
                  { label: 'Last activity', w: 1.2 }, { label: '', w: 0.7 },
                ]}
                empty={orgsLoading ? 'Loading organizations…' : 'No organizations match this search.'}
                minWidth={860}
              >
                {filteredOrgs.map(org => {
                  const userCount = users.filter(u => u.orgId === org._id).length;
                  const facilityCount = hospitals.filter(h => h.orgId === org._id).length;
                  return (
                    <tr key={org._id}>
                      <td>
                        <strong>{org.name}</strong>
                        <div style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 600 }}>{org.contactEmail}</div>
                      </td>
                      <td><SadbChip tone={statusChip(org.subscriptionStatus)}>{org.subscriptionStatus}</SadbChip></td>
                      <td>{org.subscriptionPlan}</td>
                      <td className="sa-num">{usersLoading ? '…' : userCount}</td>
                      <td className="sa-num">{hospitalsLoading ? '…' : facilityCount}</td>
                      <td>{formatWhen(lastActivityByOrg[org._id])}</td>
                      <td>
                        <Link href="/admin/organizations" className="sa-btn">Open</Link>
                      </td>
                    </tr>
                  );
                })}
              </SaTable>
            </SadbCard>
          </>
        )}

        {activeSection === 'users' && (
          <>
            <SadbPanelHeader
              title="User lookup"
              note="Search users by name, username, or phone."
              tag={`up to 50 of ${users.length}`}
            />
            <SadbCard>
              <div className="sadb-search-row">
                <SadbSearch
                  value={userQuery}
                  onChange={setUserQuery}
                  placeholder="Search users by name, username, or phone"
                  ariaLabel="Search users"
                />
              </div>
              <SaTable
                columns={[
                  { label: 'User', w: 1.6 }, { label: 'Role', w: 1.1 }, { label: 'Organization', w: 1.4 },
                  { label: 'Facility', w: 1.3 }, { label: 'Status', w: 0.8 },
                ]}
                empty={usersLoading ? 'Loading users…' : 'No users match this search.'}
                minWidth={720}
              >
                {filteredUsers.map(u => (
                  <tr key={u._id}>
                    <td>
                      <strong>{u.name}</strong>
                      <div style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 600 }}>{u.username}</div>
                    </td>
                    <td>{u.role.replace(/_/g, ' ')}</td>
                    <td>{u.orgId ? (orgById[u.orgId]?.name || u.orgId) : '—'}</td>
                    <td>{u.hospitalName || '—'}</td>
                    <td><SadbChip tone={u.isActive ? 'green' : 'neutral'}>{u.isActive ? 'Active' : 'Inactive'}</SadbChip></td>
                  </tr>
                ))}
              </SaTable>
            </SadbCard>
          </>
        )}

        {activeSection === 'access' && (
          <>
            <SadbPanelHeader
              title="Support access & impersonation"
              note="Platform policies governing support session access, plus the audit trail of support-access events."
            />
            <SadbCard title="Access policy">
              {!policies ? (
                <p className="sadb-empty">Loading policy configuration…</p>
              ) : (
                <>
                  <SadbKvRow
                    label="Support access requires ticket"
                    chip={policies.supportAccessRequiresTicket ? 'Required' : 'Not required'}
                    chipTone={policies.supportAccessRequiresTicket ? 'green' : 'yellow'}
                  />
                  <SadbKvRow
                    label="Impersonation"
                    chip={policies.impersonationEnabled ? `Enabled · max ${policies.impersonationMaxMinutes}m` : 'Disabled'}
                    chipTone={policies.impersonationEnabled ? 'yellow' : 'neutral'}
                  />
                  <SadbKvRow
                    label="Emergency access"
                    chip={policies.emergencyAccessEnabled ? `Enabled · review within ${policies.emergencyAccessReviewHours}h` : 'Disabled'}
                    chipTone={policies.emergencyAccessEnabled ? 'yellow' : 'neutral'}
                  />
                </>
              )}
            </SadbCard>
            <SadbCard title="Support session audit trail">
              <SaTable
                columns={[
                  { label: 'When', w: 0.9 }, { label: 'User', w: 1.2 },
                  { label: 'Action', w: 1.6 }, { label: 'Result', w: 0.9 },
                ]}
                empty="No support-access events recorded."
                minWidth={620}
              >
                {supportEvents.map(log => (
                  <tr key={log._id}>
                    <td>{formatWhen(log.createdAt)}</td>
                    <td>{log.username || '—'}</td>
                    <td>{log.action}</td>
                    <td><SadbChip tone={log.success ? 'green' : 'red'}>{log.success ? 'Success' : 'Failed'}</SadbChip></td>
                  </tr>
                ))}
              </SaTable>
            </SadbCard>
          </>
        )}

        {activeSection === 'announcements' && (
          <>
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
          </>
        )}

        {activeSection === 'tickets' && (
          <>
            <SadbPanelHeader title="Ticket queue" note="Support tickets, if a helpdesk integration is connected." />
            <SadbCard>
              <p className="sadb-empty">No ticket store is configured — support tickets are tracked in your external helpdesk.</p>
            </SadbCard>
          </>
        )}
      </SadbShell>
    </SadbPage>
  );
}
