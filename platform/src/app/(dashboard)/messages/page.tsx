'use client';

import EhrPageTitle from '@/components/ehr/EhrPageTitle';

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
      ? <span key={i} className="msgs-mention">{part}</span>
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
    const m = new Map<string, { role: UserRole; presence: StaffPresence; department?: string }>();
    users.forEach(u => m.set(u._id, { role: u.role, presence: (u.presence as StaffPresence) || 'active', department: u.department }));
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
    const otherId = c.participantIds.find(id => id !== meId) || '';
    const u = userInfo.get(otherId);
    return [u ? (ROLE_LABEL[u.role] || '') : '', u?.department].filter(Boolean).join(' · ');
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
    const presence = c.kind === 'dm' ? otherPresence(c) : undefined;
    return (
      <button
        onClick={() => setActiveId(c._id)}
        className={`msgs-conv${isActive ? ' is-active' : ''}${hasUnread ? ' is-unread' : ''}`}
      >
        <span className="msgs-conv-top">
          <span className="msgs-conv-name">
            {presence && presence !== 'offline' && (
              <span className="msgs-presence-dot" style={{ background: PRESENCE[presence].color }} />
            )}
            {convTitle(c)}
            {muted && <BellOff className="w-3 h-3" />}
          </span>
          <span className="msgs-conv-time">
            {relTime(c.lastMessageAt)}
            {hasUnread && !muted && <span className="msgs-unread-dot" />}
          </span>
        </span>
        <p className="msgs-conv-preview">{c.lastMessagePreview || 'No messages yet'}</p>
      </button>
    );
  };

  const participants = activeConversation?.participantIds.map((id, i) => ({
    id, name: activeConversation.participantNames?.[i] || 'Member', role: roleLabelFor(id), presence: presenceFor(id),
  })) || [];

  return (
    <>
      <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <EhrPageTitle className="flex-shrink-0 mb-2">Messages</EhrPageTitle>
      <div className="msgs-shell">

        {/* ── Conversation list ── */}
        <section className="msgs-panel msgs-panel--list">
          <div className="msgs-list-head">
            <h2>Conversations</h2>
            <button onClick={() => setNewChatOpen(true)} title="New chat" aria-label="New chat" className="msgs-new-btn">
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <div className="msgs-search">
            <Search className="w-4 h-4" />
            <input
              type="search"
              value={convSearch}
              onChange={e => setConvSearch(e.target.value)}
              placeholder="Search conversations"
            />
          </div>

          <div className="msgs-conv-list">
            {filtered.length === 0 && <p className="text-center text-[12px] py-10" style={{ color: 'var(--ehr-muted)' }}>No conversations yet.</p>}
            {pinned.length > 0 && <p className="msgs-sec-label">Pinned</p>}
            {pinned.map(c => <ConvItem key={c._id} c={c} />)}
            {dms.length > 0 && <p className="msgs-sec-label">Direct messages</p>}
            {dms.map(c => <ConvItem key={c._id} c={c} />)}
            {groups.length > 0 && <p className="msgs-sec-label">Group chats</p>}
            {groups.map(c => <ConvItem key={c._id} c={c} />)}
          </div>

          {/* Current-user presence, tucked into the panel footer */}
          {currentUser && (
            <div className="msgs-me">
              <button onClick={() => setPresenceOpen(o => !o)} className="msgs-me-btn">
                <span className="ehr-patient-icon ehr-patient-icon--sm">{initials(currentUser.name)}</span>
                <span className="min-w-0 flex-1">
                  <p className="msgs-me-name">{currentUser.name}</p>
                  <p className="msgs-me-state">
                    <span className="msgs-presence-dot" style={{ background: PRESENCE[myPresence].color }} /> {PRESENCE[myPresence].label}
                  </p>
                </span>
                <ChevronDown className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--ehr-muted)', transform: presenceOpen ? 'none' : 'rotate(180deg)' }} />
              </button>
              {presenceOpen && (
                <div className="msgs-me-menu">
                  {(Object.keys(PRESENCE) as StaffPresence[]).map(p => (
                    <button key={p} onClick={() => { setPresence(p); setPresenceOpen(false); }}>
                      <span className="msgs-presence-dot" style={{ background: PRESENCE[p].color }} /> {PRESENCE[p].label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── Thread ── */}
        <section className="msgs-panel msgs-panel--thread">
          {activeConversation ? (
            <>
              {/* Header */}
              <div className="msgs-thread-head">
                <div className="min-w-0">
                  <h1 className="msgs-thread-title">{convTitle(activeConversation)}</h1>
                  <p className="msgs-thread-sub">{convSubtitle(activeConversation)}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => toggleMute(activeConversation._id)} title="Mute" className="msgs-iconbtn">{activeConversation.mutedBy?.includes(meId) ? <BellOff className="w-[18px] h-[18px]" /> : <Bell className="w-[18px] h-[18px]" />}</button>
                  <button onClick={() => setInfoOpen(o => !o)} title="Details" className={`msgs-iconbtn${infoOpen ? ' is-on' : ''}`}><Info className="w-[18px] h-[18px]" /></button>
                  <button onClick={() => setMenuOpen(o => !o)} title="More" className="msgs-iconbtn"><MoreVertical className="w-[18px] h-[18px]" /></button>
                </div>
                {menuOpen && (
                  <div className="msgs-menu">
                    <button onClick={() => { setMenuOpen(false); togglePin(activeConversation._id); }}><ShieldCheck className="w-4 h-4" /> {activeConversation.pinnedBy?.includes(meId) ? 'Unpin' : 'Pin to top'}</button>
                    {activeConversation.kind === 'group' && (
                      <>
                        <button onClick={() => { setMenuOpen(false); setInfoOpen(true); }}><Settings className="w-4 h-4" /> Group settings</button>
                        <button onClick={() => { setMenuOpen(false); setAddMembersOpen(true); }}><UserPlus className="w-4 h-4" /> Add members</button>
                        <button onClick={() => { setMenuOpen(false); leaveConversation(activeConversation._id); }}><LogOut className="w-4 h-4" /> Leave group</button>
                      </>
                    )}
                    <button className="is-danger" onClick={() => { setMenuOpen(false); deleteConversation(activeConversation._id); }}><Trash2 className="w-4 h-4" /> Delete conversation</button>
                  </div>
                )}
              </div>

              <div className="flex-1 min-h-0 flex">
                {/* Messages */}
                <div ref={threadRef} className="msgs-body">
                  {runs.map((run, ri) => {
                    const mine = run.fromId === meId;
                    const showSender = !mine && activeConversation.kind === 'group';
                    return (
                      <div key={ri} className={`msgs-run${mine ? ' msgs-run--mine' : ''}`}>
                        {showSender && (
                          <p className="msgs-run-sender"><b>{run.fromName}</b> {roleLabelFor(run.fromId)}</p>
                        )}
                        {run.items.map((m, mi) => {
                          const isLastOwn = mine && ri === runs.length - 1 && mi === run.items.length - 1;
                          const readByOther = (m.readBy || []).some(id => id !== meId);
                          const editable = mine && !m.deleted && (Date.now() - new Date(m.sentAt || m.createdAt).getTime() < 15 * 60 * 1000);
                          const replied = m.replyToId ? msgById.get(m.replyToId) : undefined;
                          const reactions = m.reactions || [];
                          const grouped = Object.entries(reactions.reduce((acc, r) => { acc[r.emoji] = (acc[r.emoji] || 0) + 1; return acc; }, {} as Record<string, number>));
                          const meta = [
                            clockTime(m.sentAt),
                            m.editedAt && !m.deleted ? 'edited' : '',
                            isLastOwn ? (readByOther ? 'Read' : 'Sent') : '',
                          ].filter(Boolean).join(' · ');
                          return (
                            <div key={m._id} className="msgs-msg">
                              {replied && (
                                <div className="msgs-quote">
                                  {replied.fromDoctorName}: {replied.deleted ? 'deleted message' : replied.body.slice(0, 60)}
                                </div>
                              )}
                              <div className="msgs-msg-row">
                                {editingId === m._id ? (
                                  <div className="msgs-edit-box">
                                    <textarea value={editDraft} onChange={e => setEditDraft(e.target.value)} rows={2} />
                                    <div className="flex gap-2 justify-end">
                                      <button onClick={() => setEditingId(null)} className="text-[11px] px-2 py-1 rounded" style={{ color: 'var(--ehr-muted)' }}>Cancel</button>
                                      <button onClick={saveEdit} className="btn btn-primary btn-sm">Save</button>
                                    </div>
                                  </div>
                                ) : (
                                  <div
                                    onCopy={e => e.preventDefault()}
                                    onContextMenu={e => e.preventDefault()}
                                    className={`msgs-bubble${m.deleted ? ' msgs-bubble--deleted' : mine ? ' msgs-bubble--mine' : ''}`}
                                  >
                                    {m.deleted ? 'This message was deleted' : renderBody(m.body)}
                                    {!m.deleted && <span className="msgs-bubble-time">{meta}</span>}
                                  </div>
                                )}

                                {/* hover action toolbar */}
                                {!m.deleted && editingId !== m._id && (
                                  <div className="msgs-msg-tools">
                                    <button onClick={() => { setReactingId(reactingId === m._id ? null : m._id); }} title="React">😀</button>
                                    <button onClick={() => { setReplyTo(m); }} title="Reply"><ArrowLeft className="w-3.5 h-3.5" /></button>
                                    {editable && <button onClick={() => startEdit(m)} title="Edit"><Edit3 className="w-3.5 h-3.5" /></button>}
                                    {mine && <button className="is-danger" onClick={() => deleteMessage(m._id)} title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>}
                                    {reactingId === m._id && (
                                      <div className="msgs-react-pop">
                                        {QUICK_REACTIONS.map(em => <button key={em} onClick={() => { react(m._id, em); setReactingId(null); }}>{em}</button>)}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>

                              {grouped.length > 0 && (
                                <div className="msgs-reactions">
                                  {grouped.map(([em, count]) => {
                                    const mineReacted = reactions.some(r => r.emoji === em && r.userId === meId);
                                    return (
                                      <button key={em} onClick={() => react(m._id, em)} className={`msgs-reaction${mineReacted ? ' is-mine' : ''}`}>
                                        <span>{em}</span><span>{count}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>

                {/* Right info panel */}
                {infoOpen && (
                  <aside className="msgs-info">
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-bold" style={{ color: 'var(--text-strong)' }}>Details</h3>
                        <button onClick={() => setInfoOpen(false)} className="msgs-iconbtn" aria-label="Close details"><X className="w-4 h-4" /></button>
                      </div>

                      {activeConversation.kind === 'group' && (
                        <div className="mb-4">
                          <p className="msgs-info-label">Group name</p>
                          <input
                            type="text"
                            defaultValue={activeConversation.name || ''}
                            onBlur={e => { if (e.target.value.trim() && e.target.value !== activeConversation.name) renameGroup(activeConversation._id, e.target.value); }}
                          />
                        </div>
                      )}

                      <p className="msgs-info-label">{participants.length} participant{participants.length === 1 ? '' : 's'}</p>
                      <div className="space-y-1 mb-4">
                        {participants.map(p => (
                          <div key={p.id} className="flex items-center gap-2.5 py-1">
                            <span className="ehr-patient-icon ehr-patient-icon--sm">{initials(p.name)}</span>
                            <div className="min-w-0 flex-1">
                              <p className="text-[12px] font-semibold truncate" style={{ color: 'var(--ehr-text)' }}>{p.name}{p.id === meId ? ' (you)' : ''}</p>
                              <p className="text-[10px] truncate" style={{ color: 'var(--ehr-muted)' }}>{p.role || PRESENCE[p.presence].label}</p>
                            </div>
                            {activeConversation.kind === 'group' && p.id !== meId && (
                              <button onClick={() => removeMember(activeConversation._id, p.id)} title="Remove" className="p-1 rounded" style={{ color: 'var(--ehr-muted)' }}><X className="w-3.5 h-3.5" /></button>
                            )}
                          </div>
                        ))}
                      </div>

                      {activeConversation.kind === 'group' && (
                        <button onClick={() => setAddMembersOpen(true)} className="w-full text-[12px] font-semibold flex items-center justify-center gap-1.5 py-2 rounded-lg mb-3" style={{ border: '1px solid var(--ehr-border)', color: 'var(--accent-primary)', background: 'transparent', cursor: 'pointer' }}>
                          <UserPlus className="w-4 h-4" /> Add members
                        </button>
                      )}

                      <div className="rounded-lg p-3 flex items-start gap-2" style={{ background: 'var(--ehr-head)' }}>
                        <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--color-success)' }} />
                        <p className="text-[11px]" style={{ color: 'var(--ehr-muted)' }}>End-to-end encrypted. Every message is audit-logged. Copying, forwarding, and screenshots are restricted for PHI safety.</p>
                      </div>
                    </div>
                  </aside>
                )}
              </div>

              {/* Composer */}
              <div className="msgs-composer">
                {replyTo && (
                  <div className="msgs-replying">
                    <span className="truncate">Replying to {replyTo.fromDoctorName}: {replyTo.body.slice(0, 50)}</span>
                    <button onClick={() => setReplyTo(null)} className="p-0.5" style={{ color: 'var(--ehr-muted)', background: 'transparent', border: 0, cursor: 'pointer' }} aria-label="Cancel reply"><X className="w-3.5 h-3.5" /></button>
                  </div>
                )}
                <div className="msgs-composer-row">
                  <div className="msgs-input">
                    <textarea
                      value={draft}
                      onChange={e => setDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                      rows={1}
                      placeholder="Write a message…"
                    />
                  </div>
                  <button
                    onClick={handleSend}
                    disabled={!draft.trim()}
                    title="Send message"
                    aria-label="Send message"
                    className="msgs-send"
                  >
                    <Send className="w-[18px] h-[18px]" />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center" style={{ color: 'var(--ehr-muted)' }}>
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
    <Modal onClose={onClose} width={460}>
      <div className="card-elevated" style={{ background: 'var(--bg-card-solid)', borderRadius: 12, overflow: 'hidden' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--ehr-border)' }}>
          <h2 className="text-base font-bold" style={{ color: 'var(--text-strong)' }}>{title}</h2>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg transition-colors hover:bg-[var(--ehr-hover)]" style={{ color: 'var(--ehr-muted)' }}><X className="w-4 h-4" /></button>
        </div>

        <div className="px-5 pt-4">
          {mode === 'new' && (
            <div className="grid grid-cols-2 gap-1 p-1 mb-3 rounded-xl keep-cols" style={{ background: 'var(--ehr-head)', border: '1px solid var(--ehr-border-soft)' }}>
              {(['dm', 'group'] as const).map(m => (
                <button key={m} onClick={() => setTab(m)} className="py-1.5 rounded-lg text-[12px] font-semibold transition-colors" style={{ background: tab === m ? 'var(--accent-primary)' : 'transparent', color: tab === m ? '#fff' : 'var(--ehr-muted)' }}>
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
                padding: '9px 12px', borderRadius: 8,
                background: 'var(--bg-card-solid)',
                border: '1px solid var(--ehr-border)',
                color: 'var(--ehr-text)',
                fontFamily: "var(--font-platform)",
                outline: 'none',
              }}
            />
          )}
          <div className="relative mb-2">
            <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--ehr-muted)' }} />
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search staff by name or role"
              className="w-full text-[13px]"
              style={{
                paddingInlineStart: 34, paddingTop: 9, paddingBottom: 9, borderRadius: 8,
                background: 'var(--bg-card-solid)',
                border: '1px solid var(--ehr-border)',
                color: 'var(--ehr-text)',
                fontFamily: "var(--font-platform)",
                outline: 'none',
              }}
            />
          </div>

          {/* Selected chips (multi-select) */}
          {multi && selectedList.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {selectedList.map(u => (
                <span key={u._id} className="inline-flex items-center gap-1 ps-1 pe-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: 'var(--ehr-info-bg)', color: 'var(--accent-text)' }}>
                  <Avatar name={u.name} seed={u.name} size={18} />
                  {u.name.split(' ')[0]}
                  <button onClick={() => toggle(u)} aria-label="Remove" className="ms-0.5"><X className="w-3 h-3" /></button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Staff list */}
        <div style={{ maxHeight: 300, overflowY: 'auto' }} className="px-2 pb-2">
          {filtered.length === 0 && <p className="text-center text-[12px] py-6" style={{ color: 'var(--ehr-muted)' }}>No staff found.</p>}
          {filtered.map(u => {
            const isSel = !!selected[u._id];
            const sub = [ROLE_LABEL[u.role] || '', u.department].filter(Boolean).join(' · ');
            return (
              <button
                key={u._id}
                onClick={() => (multi ? toggle(u) : onStartDM?.(u))}
                className="w-full text-start flex items-center gap-3 px-3 py-2 rounded-xl transition-colors hover:bg-[var(--ehr-hover)] focus:outline-none"
                style={{ background: isSel ? 'var(--ehr-info-bg)' : 'transparent' }}
              >
                <Avatar name={u.name} seed={u.name} size={36} presence={u.presence} />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--ehr-text)' }}>{u.name}</p>
                  <p className="text-[11px] truncate" style={{ color: 'var(--ehr-muted)' }}>{sub}</p>
                </div>
                {multi ? (
                  <span className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: isSel ? 'var(--accent-primary)' : 'transparent', border: isSel ? 'none' : '1.5px solid var(--ehr-border)' }}>
                    {isSel && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                  </span>
                ) : (
                  <ChevronDown className="w-4 h-4 -rotate-90 flex-shrink-0" style={{ color: 'var(--ehr-muted)' }} />
                )}
              </button>
            );
          })}
        </div>

        {/* Footer */}
        {multi ? (
          <div className="px-5 py-3 border-t flex items-center justify-between" style={{ borderColor: 'var(--ehr-border)' }}>
            <span className="text-[12px]" style={{ color: 'var(--ehr-muted)' }}>{selectedList.length} selected</span>
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
          <div className="px-5 py-2.5 border-t" style={{ borderColor: 'var(--ehr-border)' }}>
            <p className="text-[11px] text-center" style={{ color: 'var(--ehr-muted)' }}>Select a staff member to open a direct message.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
