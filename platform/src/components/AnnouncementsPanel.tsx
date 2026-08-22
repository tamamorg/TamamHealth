'use client';

/**
 * Announcements dropdown — opened from the TopBar megaphone button. Shows the
 * announcements visible to the current user (org/facility/role scoped, not
 * expired or dismissed) and, for authorised roles, an inline compose form.
 */
import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/context';
import type { AnnouncementDoc, AnnouncementAudience, AnnouncementPriority, UserRole } from '@/lib/db-types';
import type { DataScope } from '@/lib/services/data-scope';
import { ROLE_PERMISSIONS } from '@/lib/permissions';
import { Megaphone, X, Loader2, Send, Plus, Check } from '@/components/icons/lucide';
import Select from '@/components/Select';

/** Roles an announcement can target. National oversight roles are excluded —
 *  they are not an org's staff, so an org announcement can't reach them. */
const TARGETABLE_ROLES = (Object.keys(ROLE_PERMISSIONS) as UserRole[])
  .filter(r => r !== 'super_admin' && r !== 'government' && r !== 'county_health_director');

const PRIORITY_STYLE: Record<AnnouncementPriority, { color: string; bg: string; label: string }> = {
  normal: { color: 'var(--text-secondary)', bg: 'var(--overlay-medium)', label: 'Normal' },
  important: { color: 'var(--color-warning)', bg: 'var(--color-warning-bg)', label: 'Important' },
  urgent: { color: 'var(--color-danger-text)', bg: 'var(--color-danger-bg)', label: 'Urgent' },
};

export default function AnnouncementsPanel({ onClose, onUnreadChange }: { onClose: () => void; onUnreadChange?: (n: number) => void }) {
  const { currentUser } = useAuth();
  const [items, setItems] = useState<AnnouncementDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [canPost, setCanPost] = useState(false);

  // Compose state
  const [title, setTitle] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [audience, setAudience] = useState<AnnouncementAudience>('organization');
  const [priority, setPriority] = useState<AnnouncementPriority>('normal');
  const [targetRoles, setTargetRoles] = useState<UserRole[]>([]);
  // Facility-bound authors always post to their own facility. Org-level
  // authors (no hospitalId — org admins, HQ roles) must pick which facility
  // they mean, so the post can't fall through as facility-less and leak
  // org-wide.
  const [facilities, setFacilities] = useState<{ _id: string; name: string }[]>([]);
  const [facilityChoice, setFacilityChoice] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const isOrgLevelAuthor = !!currentUser && !currentUser.hospitalId;

  useEffect(() => {
    if (!composing || audience !== 'facility' || !isOrgLevelAuthor || facilities.length > 0 || !currentUser) return;
    let cancelled = false;
    (async () => {
      const { getAllHospitals } = await import('@/lib/services/hospital-service');
      const list = await getAllHospitals({
        role: currentUser.role,
        orgId: currentUser.orgId,
        hospitalId: currentUser.hospitalId,
      });
      if (!cancelled) setFacilities(list.map(h => ({ _id: h._id, name: h.name })));
    })().catch(() => { /* offline — the picker just stays empty */ });
    return () => { cancelled = true; };
  }, [composing, audience, isOrgLevelAuthor, facilities.length, currentUser]);

  const toggleRole = (role: UserRole) => {
    setTargetRoles(prev => prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]);
  };

  const load = useCallback(async () => {
    if (!currentUser) return;
    const { getVisibleAnnouncements, canPostAnnouncements } = await import('@/lib/services/announcement-service');
    setCanPost(canPostAnnouncements(currentUser.role));
    const scope: DataScope = {
      role: currentUser.role,
      orgId: currentUser.orgId,
      hospitalId: currentUser.hospitalId,
      payam: currentUser.payam,
    };
    const list = await getVisibleAnnouncements(scope, {
      userId: currentUser._id,
      role: currentUser.role,
      hospitalId: currentUser.hospitalId,
    });
    setItems(list);
    onUnreadChange?.(list.length);
    setLoading(false);
  }, [currentUser, onUnreadChange]);

  useEffect(() => { load(); }, [load]);

  const handlePost = async () => {
    setError('');
    if (!currentUser) return;
    if (!title.trim() || !bodyText.trim()) { setError('Title and message are required.'); return; }
    setSaving(true);
    try {
      const { createAnnouncement } = await import('@/lib/services/announcement-service');
      const chosenFacility = isOrgLevelAuthor
        ? facilities.find(h => h._id === facilityChoice)
        : { _id: currentUser.hospitalId as string, name: currentUser.hospitalName as string };
      await createAnnouncement({
        title,
        body: bodyText,
        audience,
        priority,
        targetRoles: audience === 'role' ? targetRoles : undefined,
        authorId: currentUser._id,
        authorName: currentUser.name,
        facilityId: audience === 'facility' ? chosenFacility?._id : undefined,
        facilityName: audience === 'facility' ? chosenFacility?.name : undefined,
        orgId: currentUser.orgId,
        payam: currentUser.payam,
      });
      setTitle(''); setBodyText(''); setAudience('organization'); setPriority('normal');
      setTargetRoles([]); setFacilityChoice('');
      setComposing(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post announcement.');
    } finally {
      setSaving(false);
    }
  };

  const handleDismiss = async (id: string) => {
    if (!currentUser) return;
    const { dismissAnnouncement } = await import('@/lib/services/announcement-service');
    await dismissAnnouncement(id, currentUser._id);
    await load();
  };

  return (
    <div
      className="absolute end-0 top-full mt-2 rounded-xl overflow-hidden z-50"
      style={{ width: 380, maxWidth: '92vw', background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)', boxShadow: '0 16px 48px rgba(0,0,0,0.2), 0 4px 12px rgba(0,0,0,0.06)' }}
    >
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
        <div className="flex items-center gap-2">
          <Megaphone className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
          <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Announcements</span>
        </div>
        <div className="flex items-center gap-1">
          {canPost && !composing && (
            <button onClick={() => setComposing(true)} className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-md" style={{ color: 'var(--accent-text)' }}>
              <Plus className="w-3.5 h-3.5" /> New
            </button>
          )}
          <button onClick={onClose} aria-label="Close" className="p-1"><X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} /></button>
        </div>
      </div>

      {composing && (
        <div className="px-4 py-3 space-y-2" style={{ borderBottom: '1px solid var(--border-light)', background: 'var(--overlay-subtle)' }}>
          {error && <div className="text-xs px-2 py-1.5 rounded" style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger-text)' }}>{error}</div>}
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" className="w-full px-2.5 py-1.5 rounded-md text-sm" style={inputStyle} />
          <textarea value={bodyText} onChange={e => setBodyText(e.target.value)} placeholder="Message…" rows={3} className="w-full px-2.5 py-1.5 rounded-md text-sm" style={inputStyle} />
          <div className="grid grid-cols-2 gap-2">
            <Select value={audience} onChange={e => setAudience(e.target.value as AnnouncementAudience)} className="px-2.5 py-1.5 rounded-md text-sm" style={inputStyle}>
              <option value="organization">Whole organization</option>
              <option value="facility">{isOrgLevelAuthor ? 'One facility' : 'My facility'}</option>
              <option value="role">Specific roles</option>
            </Select>
            <Select value={priority} onChange={e => setPriority(e.target.value as AnnouncementPriority)} className="px-2.5 py-1.5 rounded-md text-sm" style={inputStyle}>
              <option value="normal">Normal</option>
              <option value="important">Important</option>
              <option value="urgent">Urgent</option>
            </Select>
          </div>
          {audience === 'facility' && isOrgLevelAuthor && (
            <Select value={facilityChoice} onChange={e => setFacilityChoice(e.target.value)} className="w-full px-2.5 py-1.5 rounded-md text-sm" style={inputStyle}>
              <option value="">Choose a facility…</option>
              {facilities.map(h => <option key={h._id} value={h._id}>{h.name}</option>)}
            </Select>
          )}
          {audience === 'role' && (
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto py-0.5">
              {TARGETABLE_ROLES.map(role => {
                const on = targetRoles.includes(role);
                return (
                  <button
                    key={role}
                    type="button"
                    onClick={() => toggleRole(role)}
                    aria-pressed={on}
                    className="text-[11px] font-semibold px-2 py-1 rounded-full"
                    style={on
                      ? { background: 'var(--accent-primary)', color: 'var(--color-white)' }
                      : { background: 'var(--overlay-medium)', color: 'var(--text-secondary)' }}
                  >
                    {ROLE_PERMISSIONS[role].label}
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => { setComposing(false); setError(''); }} className="btn btn-secondary btn-sm">Cancel</button>
            <button onClick={handlePost} disabled={saving} className="btn btn-primary btn-sm">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Post
            </button>
          </div>
        </div>
      )}

      <div className="max-h-[360px] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--text-muted)' }} /></div>
        ) : items.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <Megaphone className="w-7 h-7 mx-auto mb-2" style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No announcements right now.</p>
          </div>
        ) : (
          items.map(a => {
            const p = PRIORITY_STYLE[a.priority];
            return (
              <div key={a._id} className="px-4 py-3 group" style={{ borderBottom: '1px solid var(--border-light)' }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{a.title}</span>
                    {a.priority !== 'normal' && (
                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: p.bg, color: p.color }}>{p.label}</span>
                    )}
                  </div>
                  <button onClick={() => handleDismiss(a._id)} className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" title="Dismiss">
                    <Check className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                  </button>
                </div>
                <p className="text-xs mt-1 whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>{a.body}</p>
                <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                  {a.authorName} · {a.createdAt ? new Date(a.createdAt).toLocaleDateString() : ''}
                  {a.audience === 'facility' && a.facilityName ? ` · ${a.facilityName}` : ''}
                  {a.audience === 'role' && (a.targetRoles || []).length > 0
                    ? ` · ${(a.targetRoles || []).map(r => ROLE_PERMISSIONS[r]?.label || r).join(', ')}`
                    : ''}
                </p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

const inputStyle = { background: 'var(--bg-input)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' } as const;
