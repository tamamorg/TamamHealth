'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Modal from '@/components/Modal';
import { useStaffChat } from '@/lib/hooks/useStaffChat';
import { useUsers } from '@/lib/hooks/useUsers';
import { ROLE_LABEL } from '@/lib/role-display';
import { initials, avatarTint } from '@/lib/patient-utils';
import type { ConversationDoc, MessageDoc, UserRole, StaffPresence } from '@/lib/db-types';
import {
  MessageSquare, Plus, Search, Send, Users as UsersIcon,
  MoreVertical, Info, UserPlus, X, ChevronDown, Check, ShieldCheck,
  Trash2, Edit3, ArrowLeft, Bell, BellOff, LogOut, Settings,
} from '@/components/icons/lucide';

/* ─────────────────────────── constants ─────────────────────────── */

const PRESENCE: Record<StaffPresence, { label: string; color: string }> = {
  active: { label: 'Active', color: 'var(--color-success)' },
  busy: { label: 'Busy', color: 'var(--color-danger)' },
  away: { label: 'Away', color: 'var(--color-warning)' },
  on_call: { label: 'On Call', color: 'var(--accent-primary)' },
  in_clinic: { label: 'In Clinic', color: 'var(--accent-primary)' },
  offline: { label: 'Offline', color: 'var(--text-muted)' },
};
const QUICK_REACTIONS = ['👍', '✅', '❤️', '👀', '🙏', '😀'];

/* ─────────────────────────── helpers ─────────────────────────── */

function relTime(iso?: string): string {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}
function clockTime(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
/** Render message text with @mentions highlighted. */
function renderBody(text: string) {
  return text.split(/(@[\w.]+)/g).map((part, i) =>
    part.startsWith('@')
      ? <span key={i} className="font-semibold" style={{ color: 'var(--accent-primary)' }}>{part}</span>
      : <span key={i}>{part}</span>,
  );
}

function Avatar({ name, size = 38, seed, group, presence }: { name: string; size?: number; seed: string; group?: boolean; presence?: StaffPresence }) {
  return (
    <div
      className="relative flex items-center justify-center flex-shrink-0 font-bold"
      style={{ width: size, height: size, borderRadius: '50%', ...(group ? { background: 'var(--accent-primary)', color: '#fff' } : avatarTint(seed)), fontSize: size * 0.36 }}
    >
      {group ? <UsersIcon className="text-white" style={{ width: size * 0.5, height: size * 0.5 }} /> : initials(name)}
      {!group && (
        <span
          className="absolute rounded-full"
          style={{ width: size * 0.28, height: size * 0.28, background: PRESENCE[presence || 'active'].color, border: '2px solid var(--bg-card-solid)', right: 0, bottom: 0 }}
        />
      )}
    </div>
  );
}

interface StaffUser { _id: string; name: string; role: UserRole; department?: string; presence?: StaffPresence }

// National / cross-org accounts that aren't messageable facility staff.
const NON_MESSAGEABLE_ROLES: UserRole[] = ['super_admin', 'government'];

/* ─────────────────────────── page ─────────────────────────── */

export default function MessagesPage() {
  const chat = useStaffChat();
  const {
    currentUser, conversations, messages, activeId, setActiveId,
    activeConversation, send, startDM, createGroupChat,
    togglePin, toggleMute, editMessage, deleteMessage, react,
    renameGroup, addMembers, removeMember, leaveConversation, deleteConversation, setPresence,
  } = chat;
  const { users } = useUsers();

  const [draft, setDraft] = useState('');
  const [convSearch, setConvSearch] = useState('');
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [addMembersOpen, setAddMembersOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [replyTo, setReplyTo] = useState<MessageDoc | null>(null);
  const [reactingId, setReactingId] = useState<string | null>(null);
  const [presenceOpen, setPresenceOpen] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  const meId = currentUser?._id || '';

  const userInfo = useMemo(() => {
    const m = new Map<string, { role: UserRole; presence: StaffPresence }>();
    users.forEach(u => m.set(u._id, { role: u.role, presence: (u.presence as StaffPresence) || 'active' }));
    return m;
  }, [users]);
  const roleLabelFor = (id: string) => { const u = userInfo.get(id); return u ? (ROLE_LABEL[u.role] || '') : ''; };
  const presenceFor = (id: string): StaffPresence => userInfo.get(id)?.presence || 'active';
  const myPresence = presenceFor(meId);

  // Messageable facility staff: real staff at this facility, minus the current
  // user and national/cross-org accounts.
  const messageableStaff = useMemo<StaffUser[]>(() =>
    users
      .filter(u => u.type === 'user' && u._id !== meId && !NON_MESSAGEABLE_ROLES.includes(u.role))
      .map(u => ({ _id: u._id, name: u.name, role: u.role, department: u.department, presence: (u.presence as StaffPresence) || 'active' }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [users, meId],
  );

  useEffect(() => { if (!activeId && conversations.length > 0) setActiveId(conversations[0]._id); }, [conversations, activeId, setActiveId]);
  useEffect(() => { const el = threadRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages, activeId]);
  useEffect(() => { setMenuOpen(false); setEditingId(null); setReplyTo(null); }, [activeId]);

  const convTitle = (c: ConversationDoc): string => {
    if (c.kind === 'group') return c.name || 'Group chat';
    const i = c.participantIds.findIndex(id => id !== meId);
    return c.participantNames?.[i] || c.participantNames?.[0] || 'Direct message';
  };
  const convSubtitle = (c: ConversationDoc): string => {
    if (c.kind === 'group') return `${c.participantIds.length} members`;
    return roleLabelFor(c.participantIds.find(id => id !== meId) || '');
  };
  const convSeed = (c: ConversationDoc): string => {
    if (c.kind === 'group') return c._id;
    const i = c.participantIds.findIndex(id => id !== meId);
    return c.participantNames?.[i] || c._id;
  };
  const otherPresence = (c: ConversationDoc): StaffPresence => presenceFor(c.participantIds.find(id => id !== meId) || '');

  const filtered = useMemo(() => {
    const q = convSearch.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(c => convTitle(c).toLowerCase().includes(q) || (c.lastMessagePreview || '').toLowerCase().includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, convSearch, meId]);

  const pinned = filtered.filter(c => c.pinnedBy?.includes(meId));
  const dms = filtered.filter(c => c.kind === 'dm' && !c.pinnedBy?.includes(meId));
  const groups = filtered.filter(c => c.kind === 'group' && !c.pinnedBy?.includes(meId));

  const handleSend = async () => {
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    const rid = replyTo?._id;
    setReplyTo(null);
    await send(body, rid);
  };

  const msgById = useMemo(() => { const m = new Map<string, MessageDoc>(); messages.forEach(x => m.set(x._id, x)); return m; }, [messages]);

  const runs = useMemo(() => {
    const out: { fromId: string; fromName: string; items: MessageDoc[] }[] = [];
    for (const m of messages) {
      const last = out[out.length - 1];
      if (last && last.fromId === m.fromDoctorId) last.items.push(m);
      else out.push({ fromId: m.fromDoctorId, fromName: m.fromDoctorName, items: [m] });
    }
    return out;
  }, [messages]);

  const startEdit = (m: MessageDoc) => { setEditingId(m._id); setEditDraft(m.body); setReactingId(null); };
  const saveEdit = async () => { if (editingId) { await editMessage(editingId, editDraft); setEditingId(null); } };

  const ConvItem = ({ c }: { c: ConversationDoc }) => {
    const isActive = c._id === activeId;
    const hasUnread = !!c.lastMessageFromName && c.lastMessageFromName !== currentUser?.name && c._id !== activeId;
    const muted = c.mutedBy?.includes(meId);
    return (
      <button
        onClick={() => setActiveId(c._id)}
        className="w-full text-left flex items-start gap-3 px-3 py-2.5 rounded-xl transition-colors hover:bg-[var(--overlay-subtle)]"
        style={{ background: isActive ? 'var(--accent-light)' : 'transparent' }}
      >
        <Avatar name={convTitle(c)} seed={convSeed(c)} group={c.kind === 'group'} size={40} presence={c.kind === 'dm' ? otherPresence(c) : undefined} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-semibold truncate flex items-center gap-1" style={{ color: 'var(--text-primary)' }}>
              {convTitle(c)}
              {muted && <BellOff className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />}
            </span>
            <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{relTime(c.lastMessageAt)}</span>
          </div>
          <p className="text-[12px] truncate mt-0.5" style={{ color: hasUnread ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: hasUnread ? 600 : 400 }}>
            {c.lastMessagePreview || 'No messages yet'}
          </p>
        </div>
        {hasUnread && !muted && <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style={{ background: 'var(--color-danger)' }} />}
      </button>
    );
  };

  const participants = activeConversation?.participantIds.map((id, i) => ({
    id, name: activeConversation.participantNames?.[i] || 'Member', role: roleLabelFor(id), presence: presenceFor(id),
  })) || [];

  return (
    <>
      <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <span className="flex-shrink-0 mb-2" style={{ fontFamily: 'var(--font-platform)', fontWeight: 500, fontSize: 24, lineHeight: '100%', letterSpacing: 0, color: 'var(--text-primary)' }}>
        Messages
      </span>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden', borderRadius: 'var(--card-radius)', border: '1px solid var(--glass-border)', boxShadow: 'var(--card-shadow), var(--glass-highlight)', background: 'var(--glass-bg)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>

        {/* ── Conversation list ── */}
        <section className="flex flex-col flex-shrink-0" style={{ width: 320, borderRight: '1px solid var(--glass-border)', background: 'var(--glass-bg-strong)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
          <div className="px-3 pt-3 pb-2 flex items-center justify-between">
            <h2 className="text-[11px] font-bold truncate uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Conversations</h2>
            <button onClick={() => setNewChatOpen(true)} title="New chat" className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--accent-light)', color: 'var(--accent-primary)' }}>
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {/* Current-user presence selector */}
          <div className="mx-3 mb-2 relative">
            <button onClick={() => setPresenceOpen(o => !o)} className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
              {currentUser && <Avatar name={currentUser.name} seed={currentUser.name} size={34} presence={myPresence} />}
              <div className="min-w-0 flex-1 text-left">
                <p className="text-[12px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{currentUser?.name}</p>
                <p className="text-[10px] flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: PRESENCE[myPresence].color }} /> {PRESENCE[myPresence].label}
                </p>
              </div>
              <ChevronDown className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            </button>
            {presenceOpen && (
              <div className="absolute left-0 right-0 mt-1 rounded-xl py-1 z-20" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)', boxShadow: 'var(--card-shadow-lg)' }}>
                {(Object.keys(PRESENCE) as StaffPresence[]).map(p => (
                  <button key={p} onClick={() => { setPresence(p); setPresenceOpen(false); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-[var(--overlay-subtle)]" style={{ color: 'var(--text-primary)' }}>
                    <span className="w-2 h-2 rounded-full" style={{ background: PRESENCE[p].color }} /> {PRESENCE[p].label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Search */}
          <div className="px-3 mb-2">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
              <input
                type="search"
                value={convSearch}
                onChange={e => setConvSearch(e.target.value)}
                placeholder="Search conversations"
                className="w-full text-[13px]"
                style={{
                  paddingLeft: 34, paddingTop: 8, paddingBottom: 8,
                  background: 'var(--bg-card-solid)',
                  border: '1px solid var(--border-medium)',
                  borderRadius: 10,
                  color: 'var(--text-primary)',
                  fontFamily: "var(--font-platform)",
                }}
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
            {filtered.length === 0 && <p className="text-center text-[12px] py-10" style={{ color: 'var(--text-muted)' }}>No conversations yet.</p>}
            {pinned.length > 0 && <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Pinned</p>}
            {pinned.map(c => <ConvItem key={c._id} c={c} />)}
            {dms.length > 0 && <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Direct messages</p>}
            {dms.map(c => <ConvItem key={c._id} c={c} />)}
            {groups.length > 0 && <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Group chats</p>}
            {groups.map(c => <ConvItem key={c._id} c={c} />)}
          </div>
        </section>

        {/* ── Thread ── */}
        <section className="flex flex-col flex-1 min-w-0" style={{ background: 'transparent' }}>
          {activeConversation ? (
            <>
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3 flex-shrink-0 relative" style={{ borderBottom: '1px solid var(--glass-border)', background: 'var(--glass-bg-strong)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar name={convTitle(activeConversation)} seed={convSeed(activeConversation)} group={activeConversation.kind === 'group'} size={40} presence={activeConversation.kind === 'dm' ? otherPresence(activeConversation) : undefined} />
                  <div className="min-w-0">
                    <p className="text-base font-bold truncate" style={{ color: 'var(--text-primary)' }}>{convTitle(activeConversation)}</p>
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{convSubtitle(activeConversation)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                  <button onClick={() => toggleMute(activeConversation._id)} title="Mute" className="p-2 rounded-lg hover:bg-[var(--overlay-subtle)]">{activeConversation.mutedBy?.includes(meId) ? <BellOff className="w-[18px] h-[18px]" /> : <Bell className="w-[18px] h-[18px]" />}</button>
                  <button onClick={() => setInfoOpen(o => !o)} title="Details" className="p-2 rounded-lg hover:bg-[var(--overlay-subtle)]" style={{ color: infoOpen ? 'var(--accent-primary)' : 'inherit' }}><Info className="w-[18px] h-[18px]" /></button>
                  <button onClick={() => setMenuOpen(o => !o)} title="More" className="p-2 rounded-lg hover:bg-[var(--overlay-subtle)]"><MoreVertical className="w-[18px] h-[18px]" /></button>
                </div>
                {menuOpen && (
                  <div className="absolute right-4 top-14 rounded-xl py-1 z-20 w-48" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)', boxShadow: 'var(--card-shadow-lg)' }}>
                    <button onClick={() => { setMenuOpen(false); togglePin(activeConversation._id); }} className="w-full text-left px-3 py-2 text-[12px] flex items-center gap-2 hover:bg-[var(--overlay-subtle)]" style={{ color: 'var(--text-primary)' }}><ShieldCheck className="w-4 h-4" /> {activeConversation.pinnedBy?.includes(meId) ? 'Unpin' : 'Pin to top'}</button>
                    {activeConversation.kind === 'group' && (
                      <>
                        <button onClick={() => { setMenuOpen(false); setInfoOpen(true); }} className="w-full text-left px-3 py-2 text-[12px] flex items-center gap-2 hover:bg-[var(--overlay-subtle)]" style={{ color: 'var(--text-primary)' }}><Settings className="w-4 h-4" /> Group settings</button>
                        <button onClick={() => { setMenuOpen(false); setAddMembersOpen(true); }} className="w-full text-left px-3 py-2 text-[12px] flex items-center gap-2 hover:bg-[var(--overlay-subtle)]" style={{ color: 'var(--text-primary)' }}><UserPlus className="w-4 h-4" /> Add members</button>
                        <button onClick={() => { setMenuOpen(false); leaveConversation(activeConversation._id); }} className="w-full text-left px-3 py-2 text-[12px] flex items-center gap-2 hover:bg-[var(--overlay-subtle)]" style={{ color: 'var(--text-primary)' }}><LogOut className="w-4 h-4" /> Leave group</button>
                      </>
                    )}
                    <button onClick={() => { setMenuOpen(false); deleteConversation(activeConversation._id); }} className="w-full text-left px-3 py-2 text-[12px] flex items-center gap-2 hover:bg-[var(--overlay-subtle)]" style={{ color: 'var(--color-danger-text)' }}><Trash2 className="w-4 h-4" /> Delete conversation</button>
                  </div>
                )}
              </div>

              <div className="flex-1 min-h-0 flex">
                {/* Messages */}
                <div ref={threadRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4" style={{ minHeight: 0, background: 'var(--bg-secondary)' }}>
                  {runs.map((run, ri) => {
                    const mine = run.fromId === meId;
                    return (
                      <div key={ri} className={`flex gap-2.5 ${mine ? 'flex-row-reverse' : ''}`}>
                        {!mine && <Avatar name={run.fromName} seed={run.fromName} size={32} presence={presenceFor(run.fromId)} />}
                        <div className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`} style={{ maxWidth: '68%' }}>
                          {!mine && (
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>{run.fromName}</span>
                              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{roleLabelFor(run.fromId)}</span>
                            </div>
                          )}
                          {run.items.map((m, mi) => {
                            const isLastOwn = mine && ri === runs.length - 1 && mi === run.items.length - 1;
                            const readByOther = (m.readBy || []).some(id => id !== meId);
                            const editable = mine && !m.deleted && (Date.now() - new Date(m.sentAt || m.createdAt).getTime() < 15 * 60 * 1000);
                            const replied = m.replyToId ? msgById.get(m.replyToId) : undefined;
                            const reactions = m.reactions || [];
                            const grouped = Object.entries(reactions.reduce((acc, r) => { acc[r.emoji] = (acc[r.emoji] || 0) + 1; return acc; }, {} as Record<string, number>));
                            return (
                              <div key={m._id} className="group/msg flex flex-col mb-1.5" style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
                                {replied && (
                                  <div className="text-[10px] px-2 py-1 mb-1 rounded-md max-w-full truncate" style={{ background: 'var(--overlay-subtle)', color: 'var(--text-muted)', borderLeft: '2px solid var(--accent-primary)' }}>
                                    {replied.fromDoctorName}: {replied.deleted ? 'deleted message' : replied.body.slice(0, 60)}
                                  </div>
                                )}
                                <div className="flex items-center gap-1" style={{ flexDirection: mine ? 'row-reverse' : 'row' }}>
                                  {editingId === m._id ? (
                                    <div className="flex flex-col gap-1" style={{ minWidth: 220 }}>
                                      <textarea
                                        value={editDraft}
                                        onChange={e => setEditDraft(e.target.value)}
                                        rows={2}
                                        className="text-[13px] resize-none"
                                        style={{
                                          padding: '8px 12px',
                                          background: 'var(--bg-card-solid)',
                                          border: '1px solid var(--border-medium)',
                                          borderRadius: 10,
                                          color: 'var(--text-primary)',
                                          fontFamily: "var(--font-platform)",
                                          outline: 'none',
                                        }}
                                      />
                                      <div className="flex gap-2 justify-end">
                                        <button onClick={() => setEditingId(null)} className="text-[11px] px-2 py-1 rounded" style={{ color: 'var(--text-muted)' }}>Cancel</button>
                                        <button onClick={saveEdit} className="text-[11px] px-2 py-1 rounded text-white" style={{ background: 'var(--accent-primary)' }}>Save</button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div
                                      onCopy={e => e.preventDefault()}
                                      onContextMenu={e => e.preventDefault()}
                                      className="px-3.5 py-2 text-[13px] leading-snug select-none"
                                      style={{
                                        background: m.deleted ? 'transparent' : mine ? 'var(--accent-primary)' : 'var(--bg-card-solid)',
                                        color: m.deleted ? 'var(--text-muted)' : mine ? '#fff' : 'var(--text-primary)',
                                        border: m.deleted ? '1px dashed var(--border-medium)' : mine ? 'none' : '1px solid var(--border-light)',
                                        borderRadius: mine ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                                        fontStyle: m.deleted ? 'italic' : 'normal',
                                        userSelect: 'none',
                                      }}
                                    >
                                      {m.deleted ? 'This message was deleted' : renderBody(m.body)}
                                    </div>
                                  )}

                                  {/* hover action toolbar */}
                                  {!m.deleted && editingId !== m._id && (
                                    <div className="opacity-0 group-hover/msg:opacity-100 transition-opacity flex items-center gap-0.5 relative">
                                      <button onClick={() => { setReactingId(reactingId === m._id ? null : m._id); }} title="React" className="w-6 h-6 rounded flex items-center justify-center text-[12px] hover:bg-[var(--overlay-subtle)]">😀</button>
                                      <button onClick={() => { setReplyTo(m); }} title="Reply" className="w-6 h-6 rounded flex items-center justify-center hover:bg-[var(--overlay-subtle)]" style={{ color: 'var(--text-muted)' }}><ArrowLeft className="w-3.5 h-3.5" /></button>
                                      {editable && <button onClick={() => startEdit(m)} title="Edit" className="w-6 h-6 rounded flex items-center justify-center hover:bg-[var(--overlay-subtle)]" style={{ color: 'var(--text-muted)' }}><Edit3 className="w-3.5 h-3.5" /></button>}
                                      {mine && <button onClick={() => deleteMessage(m._id)} title="Delete" className="w-6 h-6 rounded flex items-center justify-center hover:bg-[var(--overlay-subtle)]" style={{ color: 'var(--color-danger-text)' }}><Trash2 className="w-3.5 h-3.5" /></button>}
                                      {reactingId === m._id && (
                                        <div className="absolute top-7 right-0 flex gap-1 px-2 py-1 rounded-full z-20" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)', boxShadow: 'var(--card-shadow-lg)' }}>
                                          {QUICK_REACTIONS.map(em => <button key={em} onClick={() => { react(m._id, em); setReactingId(null); }} className="text-[15px] transition-transform">{em}</button>)}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>

                                {grouped.length > 0 && (
                                  <div className="flex gap-1 mt-1" style={{ flexDirection: mine ? 'row-reverse' : 'row' }}>
                                    {grouped.map(([em, count]) => {
                                      const mineReacted = reactions.some(r => r.emoji === em && r.userId === meId);
                                      return (
                                        <button key={em} onClick={() => react(m._id, em)} className="text-[11px] px-1.5 py-0.5 rounded-full flex items-center gap-0.5" style={{ background: mineReacted ? 'var(--accent-light)' : 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
                                          <span>{em}</span><span style={{ color: 'var(--text-muted)' }}>{count}</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}

                                <div className="flex items-center gap-1 mt-0.5">
                                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{clockTime(m.sentAt)}</span>
                                  {m.editedAt && !m.deleted && <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>· edited</span>}
                                  {isLastOwn && <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>· {readByOther ? 'Read' : 'Sent'}</span>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Right info panel */}
                {infoOpen && (
                  <aside className="flex-shrink-0 overflow-y-auto" style={{ width: 280, borderLeft: '1px solid var(--glass-border)', background: 'var(--glass-bg-strong)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Details</h3>
                        <button onClick={() => setInfoOpen(false)} className="p-1 rounded" style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
                      </div>

                      {activeConversation.kind === 'group' && (
                        <div className="mb-4">
                          <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Group name</label>
                          <input
                            type="text"
                            defaultValue={activeConversation.name || ''}
                            onBlur={e => { if (e.target.value.trim() && e.target.value !== activeConversation.name) renameGroup(activeConversation._id, e.target.value); }}
                            className="w-full text-[13px] mt-1"
                            style={{
                              padding: '8px 12px',
                              background: 'var(--bg-card-solid)',
                              border: '1px solid var(--border-medium)',
                              borderRadius: 10,
                              color: 'var(--text-primary)',
                              fontFamily: "var(--font-platform)",
                              outline: 'none',
                            }}
                          />
                        </div>
                      )}

                      <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>{participants.length} participant{participants.length === 1 ? '' : 's'}</p>
                      <div className="space-y-1 mb-4">
                        {participants.map(p => (
                          <div key={p.id} className="flex items-center gap-2.5 py-1">
                            <Avatar name={p.name} seed={p.name} size={30} presence={p.presence} />
                            <div className="min-w-0 flex-1">
                              <p className="text-[12px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>{p.name}{p.id === meId ? ' (you)' : ''}</p>
                              <p className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>{p.role || PRESENCE[p.presence].label}</p>
                            </div>
                            {activeConversation.kind === 'group' && p.id !== meId && (
                              <button onClick={() => removeMember(activeConversation._id, p.id)} title="Remove" className="p-1 rounded" style={{ color: 'var(--text-muted)' }}><X className="w-3.5 h-3.5" /></button>
                            )}
                          </div>
                        ))}
                      </div>

                      {activeConversation.kind === 'group' && (
                        <button onClick={() => setAddMembersOpen(true)} className="w-full text-[12px] font-semibold flex items-center justify-center gap-1.5 py-2 rounded-lg mb-3" style={{ border: '1px solid var(--border-medium)', color: 'var(--accent-primary)' }}>
                          <UserPlus className="w-4 h-4" /> Add members
                        </button>
                      )}

                      <div className="rounded-lg p-3 flex items-start gap-2" style={{ background: 'var(--overlay-subtle)' }}>
                        <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--color-success)' }} />
                        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>End-to-end encrypted. Every message is audit-logged. Copying, forwarding, and screenshots are restricted for PHI safety.</p>
                      </div>
                    </div>
                  </aside>
                )}
              </div>

              {/* Composer */}
              <div className="px-4 py-3 flex-shrink-0" style={{ borderTop: '1px solid var(--glass-border)', background: 'var(--glass-bg-strong)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
                {replyTo && (
                  <div className="flex items-center justify-between mb-2 px-3 py-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)', borderLeft: '2px solid var(--accent-primary)' }}>
                    <span className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>Replying to {replyTo.fromDoctorName}: {replyTo.body.slice(0, 50)}</span>
                    <button onClick={() => setReplyTo(null)} className="p-0.5" style={{ color: 'var(--text-muted)' }}><X className="w-3.5 h-3.5" /></button>
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <div className="flex-1 flex items-center gap-2 px-4 py-2" style={{ border: '1px solid var(--border-medium)', background: 'var(--bg-card-solid)', borderRadius: 22 }}>
                    <textarea
                      value={draft}
                      onChange={e => setDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                      rows={1}
                      placeholder="Type a message…"
                      className="flex-1 bg-transparent text-[13px] resize-none outline-none border-none"
                      style={{ maxHeight: 120, padding: 0, lineHeight: 1.6, fontFamily: "var(--font-platform)", color: 'var(--text-primary)' }}
                    />
                  </div>
                  <button
                    onClick={handleSend}
                    disabled={!draft.trim()}
                    title="Send message"
                    aria-label="Send message"
                    className="flex items-center justify-center flex-shrink-0 transition-all"
                    style={{
                      width: 42, height: 42, borderRadius: '50%',
                      background: draft.trim() ? 'var(--accent-primary)' : 'var(--overlay-subtle)',
                      color: draft.trim() ? '#fff' : 'var(--text-muted)',
                      boxShadow: draft.trim() ? '0 2px 8px color-mix(in srgb, var(--accent-primary) 35%, transparent)' : 'none',
                      cursor: draft.trim() ? 'pointer' : 'default',
                    }}
                  >
                    <Send className="w-[18px] h-[18px]" />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center" style={{ color: 'var(--text-muted)' }}>
              <MessageSquare className="w-12 h-12 mb-3" style={{ opacity: 0.3 }} />
              <p className="text-sm">Select a conversation or start a new chat.</p>
            </div>
          )}
        </section>
      </div>
      </main>

      {newChatOpen && currentUser && (
        <StaffPickerModal
          title="New conversation"
          mode="new"
          staff={messageableStaff}
          onClose={() => setNewChatOpen(false)}
          onStartDM={async (u) => { setNewChatOpen(false); await startDM({ id: u._id, name: u.name }); }}
          onCreateGroup={async (name, members) => { setNewChatOpen(false); await createGroupChat(name, members.map(u => ({ id: u._id, name: u.name }))); }}
        />
      )}

      {addMembersOpen && activeConversation && (
        <StaffPickerModal
          title="Add members"
          mode="add"
          staff={messageableStaff.filter(u => !activeConversation.participantIds.includes(u._id))}
          onClose={() => setAddMembersOpen(false)}
          onAdd={async (members) => { setAddMembersOpen(false); await addMembers(activeConversation._id, members.map(u => ({ id: u._id, name: u.name }))); }}
        />
      )}
    </>
  );
}

/* ─────────────────────────── staff picker modal ─────────────────────────── */

function StaffPickerModal({
  title, mode, staff, onClose, onStartDM, onCreateGroup, onAdd,
}: {
  title: string;
  mode: 'new' | 'add';
  staff: StaffUser[];
  onClose: () => void;
  onStartDM?: (u: StaffUser) => void;
  onCreateGroup?: (name: string, members: StaffUser[]) => void;
  onAdd?: (members: StaffUser[]) => void;
}) {
  const [tab, setTab] = useState<'dm' | 'group'>(mode === 'add' ? 'group' : 'dm');
  const [search, setSearch] = useState('');
  const [groupName, setGroupName] = useState('');
  const [selected, setSelected] = useState<Record<string, StaffUser>>({});

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? staff.filter(u => u.name.toLowerCase().includes(q) || (ROLE_LABEL[u.role] || '').toLowerCase().includes(q)) : staff;
    return list.slice(0, 80);
  }, [staff, search]);

  const selectedList = Object.values(selected);
  const multi = mode === 'add' || tab === 'group';
  const toggle = (u: StaffUser) => setSelected(prev => { const n = { ...prev }; if (n[u._id]) delete n[u._id]; else n[u._id] = u; return n; });

  const canCreate = mode === 'add' ? selectedList.length > 0 : (selectedList.length > 0 && groupName.trim().length > 0);

  return (
    <Modal onClose={onClose} width={460} align="top">
      <div className="card-elevated" style={{ background: 'var(--bg-card-solid)', borderRadius: 16, overflow: 'hidden' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border-light)' }}>
          <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg transition-colors hover:bg-[var(--overlay-subtle)]" style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
        </div>

        <div className="px-5 pt-4">
          {mode === 'new' && (
            <div className="grid grid-cols-2 gap-1 p-1 mb-3 rounded-xl keep-cols" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
              {(['dm', 'group'] as const).map(m => (
                <button key={m} onClick={() => setTab(m)} className="py-1.5 rounded-lg text-[12px] font-semibold transition-colors" style={{ background: tab === m ? 'var(--accent-primary)' : 'transparent', color: tab === m ? '#fff' : 'var(--text-muted)' }}>
                  {m === 'dm' ? 'Direct message' : 'Group chat'}
                </button>
              ))}
            </div>
          )}
          {multi && mode === 'new' && (
            <input
              type="text"
              value={groupName}
              onChange={e => setGroupName(e.target.value)}
              placeholder="Group name (e.g. Morning RN Shift)"
              className="w-full text-[13px] mb-2.5"
              style={{
                padding: '9px 12px', borderRadius: 10,
                background: 'var(--bg-card-solid)',
                border: '1px solid var(--border-medium)',
                color: 'var(--text-primary)',
                fontFamily: "var(--font-platform)",
                outline: 'none',
              }}
            />
          )}
          <div className="relative mb-2">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search staff by name or role"
              className="w-full text-[13px]"
              style={{
                paddingLeft: 34, paddingTop: 9, paddingBottom: 9, borderRadius: 10,
                background: 'var(--bg-card-solid)',
                border: '1px solid var(--border-medium)',
                color: 'var(--text-primary)',
                fontFamily: "var(--font-platform)",
                outline: 'none',
              }}
            />
          </div>

          {/* Selected chips (multi-select) */}
          {multi && selectedList.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {selectedList.map(u => (
                <span key={u._id} className="inline-flex items-center gap-1 pl-1 pr-2 py-0.5 rounded-full text-[11px] font-medium" style={{ background: 'var(--accent-light)', color: 'var(--accent-text)' }}>
                  <Avatar name={u.name} seed={u.name} size={18} />
                  {u.name.split(' ')[0]}
                  <button onClick={() => toggle(u)} aria-label="Remove" className="ml-0.5"><X className="w-3 h-3" /></button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Staff list */}
        <div style={{ maxHeight: 300, overflowY: 'auto' }} className="px-2 pb-2">
          {filtered.length === 0 && <p className="text-center text-[12px] py-6" style={{ color: 'var(--text-muted)' }}>No staff found.</p>}
          {filtered.map(u => {
            const isSel = !!selected[u._id];
            const sub = [ROLE_LABEL[u.role] || '', u.department].filter(Boolean).join(' · ');
            return (
              <button
                key={u._id}
                onClick={() => (multi ? toggle(u) : onStartDM?.(u))}
                className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-xl transition-colors hover:bg-[var(--overlay-subtle)] focus:outline-none"
                style={{ background: isSel ? 'var(--accent-light)' : 'transparent' }}
              >
                <Avatar name={u.name} seed={u.name} size={36} presence={u.presence} />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{u.name}</p>
                  <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{sub}</p>
                </div>
                {multi ? (
                  <span className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: isSel ? 'var(--accent-primary)' : 'transparent', border: isSel ? 'none' : '1.5px solid var(--border-medium)' }}>
                    {isSel && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                  </span>
                ) : (
                  <ChevronDown className="w-4 h-4 -rotate-90 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                )}
              </button>
            );
          })}
        </div>

        {/* Footer */}
        {multi ? (
          <div className="px-5 py-3 border-t flex items-center justify-between" style={{ borderColor: 'var(--border-light)' }}>
            <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{selectedList.length} selected</span>
            {mode === 'add' ? (
              <button onClick={() => onAdd?.(selectedList)} disabled={!canCreate} className="btn btn-primary btn-sm" style={{ opacity: canCreate ? 1 : 0.5 }}>
                <UserPlus className="w-4 h-4" /> Add{selectedList.length > 0 ? ` ${selectedList.length}` : ''}
              </button>
            ) : (
              <button onClick={() => onCreateGroup?.(groupName.trim(), selectedList)} disabled={!canCreate} className="btn btn-primary btn-sm" style={{ opacity: canCreate ? 1 : 0.5 }}>
                <Plus className="w-4 h-4" /> Create group
              </button>
            )}
          </div>
        ) : (
          <div className="px-5 py-2.5 border-t" style={{ borderColor: 'var(--border-light)' }}>
            <p className="text-[11px] text-center" style={{ color: 'var(--text-muted)' }}>Select a staff member to open a direct message.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
