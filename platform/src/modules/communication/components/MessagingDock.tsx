'use client';

// Floating staff-messaging dock — a Messenger/Intercom-style launcher that lives
// bottom-right on the role dashboards (routes under /dashboard) so staff can
// read and reply to internal
// chat WITHOUT navigating away from their current task. It reuses the same
// `useStaffChat` data layer (and styling tokens) as the full /messages page, so
// the two stay in sync; the full page remains for power features (groups,
// reactions, presence, member management).

import { useState, useMemo, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useStaffChat } from '@/lib/hooks/useStaffChat';
import { useUsers } from '@/lib/hooks/useUsers';
import { useMessagingDock } from '@/modules/communication/components/messaging-dock-context';
import { getRoleConfig } from '@/lib/permissions';
import { initials, avatarTint } from '@/lib/patient-utils';
import { ROLE_LABEL } from '@/lib/role-display';
import type { ConversationDoc, UserRole, StaffPresence } from '@/lib/db-types';
import {
  MessageSquare, Minus, Plus, Search, Send, ArrowLeft, Users as UsersIcon,
  Paperclip, X, AlertTriangle, ArrowRightLeft, Check, UserPlus, Clock,
} from '@/components/icons/lucide';
import type { PatientTransferDoc, PatientTransferUrgency } from '@/lib/db-types';
import { dismissBackdrop } from '@/lib/a11y';

type Attachment = { name: string; mimeType: string; base64Data: string; sizeBytes: number };

// Same StaffPresence vocabulary + colors the full /messages page uses, so the
// dock's picker persists real presence (visible to other staff) instead of the
// old local-only status that reset on every reload.
const AVAILABILITY_LABELS: Record<StaffPresence, string> = {
  active: 'Active',
  busy: 'Busy',
  away: 'Away',
  on_call: 'On Call',
  in_clinic: 'In Clinic',
  offline: 'Offline',
};
const AVAILABILITY_COLORS: Record<StaffPresence, string> = {
  active:    'var(--color-success)',
  busy:      'var(--color-danger)',
  away:      'var(--color-warning)',
  on_call:   'var(--accent-primary)',
  in_clinic: 'var(--accent-primary)',
  offline:   'var(--text-muted)',
};

const NON_MESSAGEABLE_ROLES: UserRole[] = ['super_admin', 'government'];

/**
 * Ward-colour accent per transfer urgency. Used as a 3px rail on the card, not
 * a fill — a queue of six emergency transfers should read as urgent without the
 * panel becoming a wall of red, which is how alarm fatigue starts.
 */
const URGENCY_TINT: Record<PatientTransferUrgency, { rail: string; label: string; text: string }> = {
  emergency: { rail: 'var(--color-danger)',  label: 'Emergency', text: 'var(--color-danger-text)' },
  urgent:    { rail: 'var(--color-warning)', label: 'Urgent',    text: 'var(--color-warning-text)' },
  routine:   { rail: 'var(--accent-primary)', label: 'Routine',  text: 'var(--text-muted)' },
};

type DockTab = 'chats' | 'teams' | 'transfers';

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

function Avatar({ name, size = 36, group }: { name: string; size?: number; group?: boolean }) {
  return (
    <div
      className="flex items-center justify-center flex-shrink-0 font-bold"
      style={{ width: size, height: size, borderRadius: '50%', ...(group ? { background: 'var(--accent-primary)', color: '#fff' } : avatarTint(name)), fontSize: size * 0.36 }}
    >
      {group ? <UsersIcon style={{ width: size * 0.5, height: size * 0.5 }} /> : initials(name)}
    </div>
  );
}

export default function MessagingDock() {
  const pathname = usePathname();
  const chat = useStaffChat();
  const { users } = useUsers();
  const {
    currentUser, conversations, messages, activeId, setActiveId,
    activeConversation, send, startDM,
  } = chat;

  const { open, openDock, closeDock, pendingDM, clearPendingDM } = useMessagingDock();
  const [view, setView] = useState<'list' | 'new' | 'newTeam'>('list');
  const [tab, setTab] = useState<DockTab>('chats');
  const [composeOpen, setComposeOpen] = useState(false);

  // The compose menu closes by clicking its backdrop, which is a mouse-only
  // gesture. Escape is the keyboard equivalent, and without it a keyboard user
  // who opened this menu had no way to dismiss it — the backdrop covers the
  // screen, so it also swallowed every click target behind it.
  useEffect(() => {
    if (!composeOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setComposeOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [composeOpen]);
  const [teamName, setTeamName] = useState('');
  const [teamMembers, setTeamMembers] = useState<string[]>([]);
  // Transfers of care. Loaded here rather than through a hook because the dock
  // is the only consumer and the list is short-lived — a full hook would add a
  // subscription for a panel that is closed most of the time.
  const [transfers, setTransfers] = useState<{ incoming: PatientTransferDoc[]; outgoing: PatientTransferDoc[] }>({ incoming: [], outgoing: [] });
  const [transferBusy, setTransferBusy] = useState<string | null>(null);
  const [convSearch, setConvSearch] = useState('');
  const [staffSearch, setStaffSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [phiWarning, setPhiWarning] = useState(false);
  const [showAvailability, setShowAvailability] = useState(false);
  // Presence is persisted on the user doc (visible to other staff, survives
  // reload). Local state is only an optimistic mirror while the write lands.
  const persistedPresence = (users.find(u => u._id === currentUser?._id)?.presence as StaffPresence | undefined) || 'active';
  const [availabilityOverride, setAvailabilityOverride] = useState<StaffPresence | null>(null);
  const availability: StaffPresence = availabilityOverride ?? persistedPresence;
  const pickAvailability = (next: StaffPresence) => {
    setAvailabilityOverride(next);
    chat.setPresence(next).catch(err => console.warn('Failed to persist presence', err));
  };
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Conversations the user has opened in this session — used to clear the unread
  // dot locally as soon as they're read (the conversation doc has no per-user
  // read cursor, so this mirrors the read action client-side).
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const threadRef = useRef<HTMLDivElement>(null);

  // Drag-to-reposition for the floating launcher. The dock stays anchored at
  // its default bottom-right corner (right: 20, bottom: 20) and this offset is
  // applied on top via a transform, so dragging never touches layout — just a
  // translate, which is what lets us drag in real time without re-rendering.
  // The offset lives in state (not just a ref) so the expanded panel opens
  // from wherever the launcher was last left instead of snapping back to the
  // corner.
  const [dockOffset, setDockOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const draggedRef = useRef(false);
  const launcherRef = useRef<HTMLButtonElement>(null);

  const clampDockOffset = (x: number, y: number) => {
    const size = 56;
    const margin = 20;
    const originLeft = window.innerWidth - margin - size;
    const originTop = window.innerHeight - margin - size;
    return {
      x: Math.min(Math.max(x, -originLeft), window.innerWidth - size - originLeft),
      y: Math.min(Math.max(y, -originTop), window.innerHeight - size - originTop),
    };
  };

  const handleLauncherPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, originX: dockOffset.x, originY: dockOffset.y };
    draggedRef.current = false;
  };
  const handleLauncherPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) draggedRef.current = true;
    const { x, y } = clampDockOffset(drag.originX + dx, drag.originY + dy);
    // Mutate the DOM directly while dragging (no React re-render per pointermove)
    // for a 1:1, lag-free follow; the offset is only committed to state on release.
    if (launcherRef.current) launcherRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  };
  const handleLauncherPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    setDockOffset(clampDockOffset(drag.originX + dx, drag.originY + dy));
    dragRef.current = null;
  };
  const handleLauncherClick = () => {
    // A drag ending on release also fires a click — swallow it so dragging
    // the icon doesn't also pop the panel open.
    if (draggedRef.current) { draggedRef.current = false; return; }
    openDock();
  };

  // Load transfers whenever the dock opens on the Transfers tab. Scoped to the
  // signed-in user: incoming = awaiting THEIR decision, outgoing = ones they
  // raised that are still open.
  useEffect(() => {
    let cancelled = false;
    if (!open || tab !== 'transfers' || !currentUser?._id) return;
    (async () => {
      try {
        const svc = await import('@/lib/services/patient-transfer-service');
        const scope = { role: currentUser.role, orgId: currentUser.orgId, hospitalId: currentUser.hospitalId };
        const [incoming, outgoing] = await Promise.all([
          svc.getIncomingTransfers(
            { id: currentUser._id, department: currentUser.department, hospitalId: currentUser.hospitalId, role: currentUser.role },
            scope,
          ),
          svc.getOutgoingTransfers(currentUser._id, scope),
        ]);
        if (!cancelled) setTransfers({ incoming, outgoing });
      } catch (err) {
        // A transfer list that fails to load must not take the chat panel with
        // it — the dock's primary job is messaging.
        console.warn('[dock] could not load transfers', err);
        if (!cancelled) setTransfers({ incoming: [], outgoing: [] });
      }
    })();
    return () => { cancelled = true; };
  }, [open, tab, currentUser?._id, currentUser?.role, currentUser?.orgId, currentUser?.hospitalId, currentUser?.department, transferBusy]);

  const decideTransfer = async (id: string, decision: 'accept' | 'reject') => {
    if (!currentUser) return;
    setTransferBusy(id);
    try {
      const notes = decision === 'reject'
        ? window.prompt('Reason for rejecting this transfer')?.trim()
        : undefined;
      if (decision === 'reject' && !notes) return;
      const [svc, perms] = await Promise.all([
        import('@/lib/services/patient-transfer-service'),
        import('@/lib/services/patient-transfer-permissions'),
      ]);
      const transfer = await svc.getTransferById(id);
      if (!transfer) throw new Error('Transfer not found');
      const auth = {
        sub: currentUser._id,
        username: currentUser.username,
        role: currentUser.role,
        name: currentUser.name || currentUser.username,
        hospitalId: currentUser.hospitalId,
        orgId: currentUser.orgId,
      };
      const permission = perms.canDecideTransfer(auth, transfer);
      if (!permission.allowed) throw new Error(permission.reason || 'Transfer decision not permitted');
      const actor = { id: auth.sub, name: auth.name, role: auth.role };
      if (decision === 'accept') await svc.acceptTransfer(id, actor);
      else await svc.rejectTransfer(id, actor, notes);
    } catch (err) {
      console.warn('[dock] transfer decision failed', err);
    } finally {
      // Clearing this also re-runs the loader above, so the list reflects the
      // decision without a manual refresh.
      setTransferBusy(null);
    }
  };

  const meId = currentUser?._id || '';
  const meName = currentUser?.name || '';

  const roleLabelFor = (id: string) => {
    const u = users.find(x => x._id === id);
    return u ? (ROLE_LABEL[u.role] || '') : '';
  };

  const convTitle = (c: ConversationDoc): string => {
    if (c.kind === 'group') return c.name || 'Group chat';
    const i = c.participantIds.findIndex(id => id !== meId);
    return c.participantNames?.[i] || c.participantNames?.[0] || 'Direct message';
  };

  const isUnread = (c: ConversationDoc) =>
    !!c.lastMessageFromName && c.lastMessageFromName !== meName && c._id !== activeId && !seen.has(c._id);

  const filteredConvs = useMemo(() => {
    const q = convSearch.trim().toLowerCase();
    const list = q
      ? conversations.filter(c => convTitle(c).toLowerCase().includes(q) || (c.lastMessagePreview || '').toLowerCase().includes(q))
      : conversations;
    return [...list].sort((a, b) => (b.lastMessageAt || '').localeCompare(a.lastMessageAt || ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, convSearch, meId]);

  /** Conversations for the active tab. Teams = group chats, Chats = 1:1. */
  const tabbedConvs = useMemo(() => {
    if (tab === 'teams') return filteredConvs.filter(c => c.kind === 'group');
    if (tab === 'chats') return filteredConvs.filter(c => c.kind !== 'group');
    return filteredConvs;
  }, [filteredConvs, tab]);

  const teamCount = useMemo(() => conversations.filter(c => c.kind === 'group').length, [conversations]);
  const transferCount = transfers.incoming.length;

  const unreadCount = useMemo(() => conversations.filter(isUnread).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversations, activeId, seen, meName]);

  const messageableStaff = useMemo(() => {
    const q = staffSearch.trim().toLowerCase();
    return users
      .filter(u => u.type === 'user' && u._id !== meId && !NON_MESSAGEABLE_ROLES.includes(u.role))
      .filter(u => !q || u.name.toLowerCase().includes(q) || (ROLE_LABEL[u.role] || '').toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [users, meId, staffSearch]);

  // Auto-scroll the thread to the newest message.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, activeId, open]);

  // Mark a conversation seen locally when opened.
  useEffect(() => {
    if (activeId) setSeen(prev => (prev.has(activeId) ? prev : new Set(prev).add(activeId)));
  }, [activeId]);

  // A caller requested a DM with a specific person (e.g. a "Message" button on a
  // staff profile) — open that thread, then clear the request.
  useEffect(() => {
    if (!open || !pendingDM) return;
    (async () => { await startDM({ id: pendingDM.id, name: pendingDM.name }); setView('list'); clearPendingDM(); })();
  }, [open, pendingDM, startDM, clearPendingDM]);

  // The full /messages page already provides the whole experience — don't stack
  // the dock on top of it. Require an authenticated staff user whose role has
  // messaging access (same gating as the /messages route).
  const canMessage = !!currentUser && !!getRoleConfig(currentUser.role)?.allowedRoutes?.includes('/messages');
  // Dashboard-only: the floating launcher lives on the role dashboards, never
  // on the working pages (patients, settings, …) where it crowds the content.
  const onDashboard = pathname === '/dashboard' || pathname?.startsWith('/dashboard/');
  if (!canMessage || !onDashboard) return null;

  const handleSend = async () => {
    const body = draft.trim();
    if (!body && attachments.length === 0) return;
    if (attachments.length > 0 && !phiWarning) {
      setPhiWarning(true);
      return;
    }
    setDraft('');
    setAttachments([]);
    setPhiWarning(false);
    await send(body, undefined, attachments.length > 0 ? attachments : undefined, attachments.length > 0);
  };

  const handleFileAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach(file => {
      if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return;
      if (file.size > 5 * 1024 * 1024) return; // 5MB max
      const reader = new FileReader();
      reader.onload = ev => {
        const dataUrl = ev.target?.result as string;
        const base64Data = dataUrl.split(',')[1] || '';
        setAttachments(prev => [...prev, { name: file.name, mimeType: file.type, base64Data, sizeBytes: file.size }]);
      };
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const openConversation = (id: string) => { setActiveId(id); setView('list'); };

  // ─────────────────────────── Collapsed launcher ───────────────────────────
  if (!open) {
    return (
      <button
        ref={launcherRef}
        onClick={handleLauncherClick}
        onPointerDown={handleLauncherPointerDown}
        onPointerMove={handleLauncherPointerMove}
        onPointerUp={handleLauncherPointerUp}
        onPointerCancel={handleLauncherPointerUp}
        aria-label="Open messages"
        data-tour="messaging-dock"
        className="fixed z-[60] flex items-center justify-center rounded-full text-white shadow-lg"
        style={{
          right: 20, bottom: 20, width: 56, height: 56, background: 'var(--accent-primary)', boxShadow: 'var(--card-shadow-lg)',
          transform: `translate3d(${dockOffset.x}px, ${dockOffset.y}px, 0)`, touchAction: 'none', cursor: 'grab',
        }}
      >
        <MessageSquare className="w-6 h-6" color="#FFFFFF" />
        {unreadCount > 0 && (
          <span
            className="absolute flex items-center justify-center text-[10px] font-bold text-white rounded-full"
            style={{ top: -2, right: -2, minWidth: 20, height: 20, padding: '0 5px', background: 'var(--color-danger)', border: '2px solid var(--bg-card-solid)' }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
    );
  }

  const inThread = !!activeConversation && view === 'list';

  // ─────────────────────────── Expanded panel ───────────────────────────
  return (
    <div
      className="fixed z-[60] flex flex-col overflow-hidden"
      style={{
        right: 20, bottom: 20, width: 372, height: 540, maxHeight: 'calc(100vh - 40px)', maxWidth: 'calc(100vw - 40px)',
        // Flat, opaque clinical surface. The dock previously used a blurred
        // glass panel, which put whatever was behind it — often a patient
        // chart — dimly through the conversation list. Opaque is both the
        // platform's design direction and the right call for a panel that
        // floats over PHI.
        borderRadius: 'var(--card-radius)', border: '1px solid var(--border-light)',
        background: 'var(--bg-card-solid)',
        boxShadow: '0 12px 32px rgba(0, 29, 63, 0.16)',
        // Opens from wherever the launcher was last dragged to, instead of
        // snapping back to the default corner.
        transform: `translate3d(${dockOffset.x}px, ${dockOffset.y}px, 0)`,
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 flex-shrink-0" style={{ borderBottom: '1px solid var(--border-light)' }}>
        {inThread ? (
          <>
            <button onClick={() => setActiveId(null)} className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 hover:bg-[var(--overlay-subtle)]" style={{ color: 'var(--text-muted)' }} aria-label="Back">
              <ArrowLeft className="w-[18px] h-[18px]" />
            </button>
            <Avatar name={convTitle(activeConversation!)} size={30} group={activeConversation!.kind === 'group'} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold truncate" style={{ color: 'var(--text-primary)' }}>{convTitle(activeConversation!)}</p>
              <p className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>
                {activeConversation!.kind === 'group' ? `${activeConversation!.participantIds.length} members` : roleLabelFor(activeConversation!.participantIds.find(id => id !== meId) || '')}
              </p>
            </div>
          </>
        ) : view === 'new' || view === 'newTeam' ? (
          <>
            <button onClick={() => { setView('list'); setStaffSearch(''); }} className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 hover:bg-[var(--overlay-subtle)]" style={{ color: 'var(--text-muted)' }} aria-label="Back">
              <ArrowLeft className="w-[18px] h-[18px]" />
            </button>
            <h2 className="text-[15px] font-bold flex-1 truncate tracking-tight" style={{ color: 'var(--text-primary)' }}>
              {view === 'newTeam' ? 'New team conversation' : 'New message'}
            </h2>
          </>
        ) : (
          <>
            <MessageSquare className="w-[18px] h-[18px] flex-shrink-0" style={{ color: 'var(--accent-primary)' }} />
            <h2 className="text-[15px] font-bold flex-1 truncate tracking-tight" style={{ color: 'var(--text-primary)' }}>Messages</h2>
            {/* Availability status dot + picker */}
            <div className="relative">
              <button
                onClick={() => setShowAvailability(v => !v)}
                className="h-8 px-2 rounded-lg flex items-center gap-1.5 flex-shrink-0 hover:bg-[var(--overlay-subtle)]"
                title={`Status: ${AVAILABILITY_LABELS[availability]}`}
              >
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: AVAILABILITY_COLORS[availability] || 'var(--color-success-600)' }} />
                <span className="text-[11px] font-semibold hidden sm:inline" style={{ color: 'var(--text-secondary)' }}>{AVAILABILITY_LABELS[availability]}</span>
              </button>
              {showAvailability && (
                <div className="absolute end-0 top-full mt-1 z-50 py-1 rounded-xl shadow-xl min-w-[160px]" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-light)' }}>
                  {(Object.entries(AVAILABILITY_LABELS) as [StaffPresence, string][]).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => { pickAvailability(key); setShowAvailability(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-1.5 text-start hover:bg-[var(--overlay-subtle)]"
                    >
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: AVAILABILITY_COLORS[key] }} />
                      <span className="text-[12px]" style={{ color: availability === key ? 'var(--accent-primary)' : 'var(--text-secondary)', fontWeight: availability === key ? 700 : 600 }}>{label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="relative">
              <button
                onClick={() => setComposeOpen(o => !o)}
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--accent-light)', color: 'var(--accent-primary)' }}
                aria-label="Start something new"
                aria-expanded={composeOpen}
                title="Start something new"
              >
                <Plus className="w-4 h-4" />
              </button>
              {composeOpen && (
                <>
                  {/* Click-away. Sits behind the menu so a click anywhere else
                      closes it without also triggering what's underneath. */}
                  <div className="fixed inset-0 z-40" {...dismissBackdrop(() => setComposeOpen(false))} />
                  <div
                    className="absolute end-0 top-full mt-1.5 z-50 py-1 rounded-xl overflow-hidden min-w-[196px]"
                    style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-light)', boxShadow: '0 8px 24px rgba(0, 29, 63,0.14)' }}
                    role="menu"
                  >
                    {[
                      { key: 'dm',       icon: <UserPlus className="w-4 h-4" />,        label: 'Direct message', hint: 'One colleague' },
                      { key: 'team',     icon: <UsersIcon className="w-4 h-4" />,       label: 'Team conversation', hint: 'Ward, shift or unit' },
                      { key: 'transfer', icon: <ArrowRightLeft className="w-4 h-4" />,  label: 'Transfers of care', hint: 'Review hand-overs' },
                    ].map(item => (
                      <button
                        key={item.key}
                        role="menuitem"
                        onClick={() => {
                          setComposeOpen(false);
                          if (item.key === 'dm') { setView('new'); setStaffSearch(''); }
                          else if (item.key === 'team') { setView('newTeam'); setTeamName(''); setTeamMembers([]); setStaffSearch(''); }
                          else { setTab('transfers'); }
                        }}
                        className="w-full flex items-start gap-2.5 px-3 py-2 text-start hover:bg-[var(--overlay-subtle)]"
                      >
                        <span className="mt-0.5 flex-shrink-0" style={{ color: 'var(--accent-primary)' }}>{item.icon}</span>
                        <span className="min-w-0">
                          <span className="block text-[12.5px] font-semibold" style={{ color: 'var(--text-primary)' }}>{item.label}</span>
                          <span className="block text-[11px]" style={{ color: 'var(--text-muted)' }}>{item.hint}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </>
        )}
        <button onClick={closeDock} className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 hover:bg-[var(--overlay-subtle)]" style={{ color: 'var(--text-muted)' }} aria-label="Minimize" title="Minimize">
          <Minus className="w-[18px] h-[18px]" />
        </button>
      </div>

      {/* Body */}
      {inThread ? (
        // ── Thread ──
        <>
          <div ref={threadRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2" style={{ minHeight: 0, background: 'var(--bg-app)' }}>
            {messages.length === 0 ? (
              <p className="text-center text-[12px] py-8" style={{ color: 'var(--text-muted)' }}>No messages yet. Say hello 👋</p>
            ) : messages.map(m => {
              const mine = m.fromDoctorId === meId;
              if (m.deleted) {
                return (
                  <div key={m._id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <span className="text-[11px] italic px-3 py-1.5 rounded-2xl" style={{ color: 'var(--text-muted)', background: 'var(--bg-card-solid)', border: '1px solid var(--border-light)' }}>This message was deleted</span>
                  </div>
                );
              }
              return (
                <div key={m._id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div className="max-w-[78%]">
                    {!mine && activeConversation!.kind === 'group' && (
                      <p className="text-[10px] font-semibold mb-0.5 ms-1" style={{ color: 'var(--text-muted)' }}>{m.fromDoctorName}</p>
                    )}
                    <div
                      className="px-3 py-2 text-[13px] leading-snug"
                      style={{
                        borderRadius: mine ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                        background: mine ? 'var(--accent-primary)' : 'var(--bg-card-solid)',
                        color: mine ? '#fff' : 'var(--text-primary)',
                        border: mine ? 'none' : '1px solid var(--border-light)',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {m.body}
                      {m.attachments && m.attachments.length > 0 && (
                        <div className="mt-2 space-y-1.5">
                          {m.attachments.map((att, ai) => {
                            const isImage = att.mimeType.startsWith('image/');
                            return (
                              <div key={ai}>
                                {isImage ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={`data:${att.mimeType};base64,${att.base64Data}`} alt={att.name} className="max-w-full rounded-lg" style={{ maxHeight: 160, objectFit: 'cover' }} />
                                ) : (
                                  <a
                                    href={`data:${att.mimeType};base64,${att.base64Data}`}
                                    download={att.name}
                                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold"
                                    style={{ background: mine ? 'rgba(255,255,255,0.15)' : 'var(--overlay-subtle)', color: mine ? '#fff' : 'var(--text-secondary)' }}
                                  >
                                    <Paperclip className="w-3 h-3 flex-shrink-0" />
                                    <span className="truncate">{att.name}</span>
                                  </a>
                                )}
                              </div>
                            );
                          })}
                          {m.phiAcknowledged && (
                            <p className="text-[10px] italic" style={{ color: mine ? 'rgba(255,255,255,0.6)' : 'var(--text-muted)' }}>PHI — confidential</p>
                          )}
                        </div>
                      )}
                    </div>
                    <p className={`text-[10px] mt-0.5 ${mine ? 'text-end me-1' : 'ms-1'}`} style={{ color: 'var(--text-muted)' }}>
                      {clockTime(m.sentAt || m.createdAt)}{m.editedAt ? ' · edited' : ''}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
          {/* Composer */}
          <div className="flex-shrink-0" style={{ borderTop: '1px solid var(--border-light)' }}>
            {/* PHI Warning */}
            {phiWarning && (
              <div className="mx-2.5 mt-2.5 p-2.5 rounded-lg" style={{ background: 'rgba(230, 114, 0,0.12)', border: '1px solid rgba(230, 114, 0,0.3)' }}>
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: 'var(--color-warning-600)' }} />
                  <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                    This message may contain patient-identifiable information (PHI). Only share with authorized staff. Do you confirm?
                  </p>
                </div>
                <div className="flex gap-2 mt-2 justify-end">
                  <button onClick={() => setPhiWarning(false)} className="text-[11px] px-2.5 py-1 rounded-lg font-semibold" style={{ background: 'var(--overlay-subtle)', color: 'var(--text-muted)' }}>Cancel</button>
                  <button
                    onClick={async () => {
                      const body = draft.trim();
                      setDraft('');
                      setAttachments([]);
                      setPhiWarning(false);
                      await send(body, undefined, attachments.length > 0 ? attachments : undefined, true);
                    }}
                    className="text-[11px] px-2.5 py-1 rounded-lg font-semibold text-white"
                    style={{ background: 'var(--color-warning)' }}
                  >
                    Confirm &amp; Send
                  </button>
                </div>
              </div>
            )}
            {/* Attachments preview */}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-2.5 pt-2">
                {attachments.map((att, i) => (
                  <div key={i} className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-semibold" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
                    <Paperclip className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                    <span className="truncate max-w-[80px]" style={{ color: 'var(--text-secondary)' }}>{att.name}</span>
                    <button onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))} className="flex-shrink-0" style={{ color: 'var(--color-danger-text)' }}><X className="w-3 h-3" /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2 p-2.5">
              {/* File attach button */}
              <label className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 cursor-pointer hover:bg-[var(--overlay-subtle)]" title="Attach file (PDF, JPG, PNG · 5 MB max)" style={{ color: 'var(--text-muted)', border: '1px solid var(--border-light)' }}>
                <Paperclip className="w-4 h-4" />
                <input ref={fileInputRef} type="file" className="sr-only" accept=".pdf,image/jpeg,image/png,image/webp" multiple onChange={handleFileAttach} />
              </label>
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder="Type a message…"
                rows={1}
                className="flex-1 resize-none text-[13px] px-3 py-2 rounded-2xl"
                style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)', fontFamily: "var(--font-platform)", maxHeight: 96, outline: 'none' }}
              />
              <button
                onClick={handleSend}
                disabled={!draft.trim() && attachments.length === 0}
                className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-white transition-opacity disabled:opacity-40"
                style={{ background: 'var(--accent-primary)' }}
                aria-label="Send"
              >
                <Send className="w-[18px] h-[18px]" />
              </button>
            </div>
          </div>
        </>
      ) : view === 'newTeam' ? (
        // ── Team conversation builder ──
        // createGroupChat() existed in useStaffChat from the start but nothing
        // in the dock ever called it, so group conversations could be read but
        // never started from here.
        <>
          <div className="px-3 pt-2.5 pb-2 flex-shrink-0 space-y-2">
            <input
              value={teamName}
              onChange={e => setTeamName(e.target.value)}
              placeholder="Team name — e.g. Ward 3 night shift"
              className="w-full text-[13px] px-3 py-2 rounded-xl"
              style={{ background: 'var(--bg-app)', border: '1px solid var(--border-light)', color: 'var(--text-primary)', fontFamily: 'var(--font-platform)', outline: 'none' }}
            />
            <div className="relative">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
              <input
                value={staffSearch}
                onChange={e => setStaffSearch(e.target.value)}
                placeholder="Add colleagues…"
                className="w-full text-[13px] pe-3 py-2 rounded-xl"
                style={{ paddingInlineStart: 34, background: 'var(--bg-app)', border: '1px solid var(--border-light)', color: 'var(--text-primary)', fontFamily: 'var(--font-platform)', outline: 'none' }}
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-2 pb-2" style={{ minHeight: 0 }}>
            {messageableStaff.map(u => {
              const picked = teamMembers.includes(u._id);
              return (
                <button
                  key={u._id}
                  onClick={() => setTeamMembers(prev => picked ? prev.filter(id => id !== u._id) : [...prev, u._id])}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-colors hover:bg-[var(--overlay-subtle)] text-start"
                  aria-pressed={picked}
                >
                  <Avatar name={u.name} size={34} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{u.name}</p>
                    <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{ROLE_LABEL[u.role] || ''}</p>
                  </div>
                  <span
                    className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
                    style={{
                      background: picked ? 'var(--accent-primary)' : 'transparent',
                      border: picked ? 'none' : '1.5px solid var(--border-medium)',
                    }}
                  >
                    {picked && <Check className="w-3.5 h-3.5" style={{ color: '#fff' }} />}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex-shrink-0 p-2.5" style={{ borderTop: '1px solid var(--border-light)' }}>
            <button
              disabled={!teamName.trim() || teamMembers.length === 0}
              onClick={async () => {
                const picked = users
                  .filter(u => teamMembers.includes(u._id))
                  .map(u => ({ id: u._id, name: u.name }));
                await chat.createGroupChat(teamName.trim(), picked);
                setView('list');
                setTab('teams');
                setTeamName('');
                setTeamMembers([]);
                setStaffSearch('');
              }}
              className="w-full py-2 rounded-xl text-[13px] font-semibold text-white disabled:opacity-40"
              style={{ background: 'var(--accent-primary)' }}
            >
              {teamMembers.length === 0
                ? 'Select colleagues to add'
                : `Create team · ${teamMembers.length + 1} member${teamMembers.length === 0 ? '' : 's'}`}
            </button>
          </div>
        </>
      ) : view === 'new' ? (
        // ── New-message staff picker ──
        <>
          <div className="px-3 pt-2.5 pb-2 flex-shrink-0">
            <div className="relative">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
              <input
                value={staffSearch}
                onChange={e => setStaffSearch(e.target.value)}
                placeholder="Search staff…"
                className="w-full text-[13px] ps-9 pe-3 py-2 rounded-xl"
                style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)', fontFamily: "var(--font-platform)", outline: 'none' }}
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-2" style={{ minHeight: 0 }}>
            {messageableStaff.length === 0 ? (
              <p className="text-center text-[12px] py-8" style={{ color: 'var(--text-muted)' }}>No staff found</p>
            ) : messageableStaff.map(u => (
              <button
                key={u._id}
                onClick={async () => { await startDM({ id: u._id, name: u.name }); setView('list'); setStaffSearch(''); }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-colors hover:bg-[var(--overlay-subtle)] text-start"
              >
                <Avatar name={u.name} size={34} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{u.name}</p>
                  <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{ROLE_LABEL[u.role] || ''}</p>
                </div>
              </button>
            ))}
          </div>
        </>
      ) : (
        // ── Conversation list ──
        <>
          {/* Tabs. Teams and Transfers are separate destinations rather than
              filters in a dropdown because both are things staff come here to
              DO, not ways to narrow a list they are already reading. */}
          <div data-tour="dock-tabs" className="flex items-center gap-1 px-2 pt-2 flex-shrink-0" role="tablist">
            {([
              { key: 'chats',     label: 'Chats',     count: 0 },
              { key: 'teams',     label: 'Teams',     count: teamCount },
              { key: 'transfers', label: 'Transfers', count: transferCount },
            ] as { key: DockTab; label: string; count: number }[]).map(t => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.key)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold transition-colors"
                  style={{
                    background: active ? 'var(--accent-light)' : 'transparent',
                    color: active ? 'var(--accent-primary)' : 'var(--text-muted)',
                  }}
                >
                  {t.label}
                  {t.count > 0 && (
                    <span
                      className="inline-flex items-center justify-center min-w-[17px] h-[17px] px-1 rounded-full text-[10px] font-bold"
                      style={{
                        // Pending transfers are someone waiting on a decision,
                        // so they carry the alert tint; a team count is neutral.
                        background: t.key === 'transfers' ? 'var(--color-danger)' : 'var(--overlay-medium)',
                        color: t.key === 'transfers' ? '#fff' : 'var(--text-secondary)',
                      }}
                    >
                      {t.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {tab !== 'transfers' && (
            <div className="px-3 pt-2 pb-2 flex-shrink-0">
              <div className="relative">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                <input
                  value={convSearch}
                  onChange={e => setConvSearch(e.target.value)}
                  placeholder={tab === 'teams' ? 'Search teams…' : 'Search conversations…'}
                  className="w-full text-[13px] pe-3 py-2 rounded-xl"
                  // paddingLeft set inline, not via a utility class: a global
                  // input rule was overriding the Tailwind padding and the
                  // placeholder rendered underneath the search icon.
                  style={{ paddingInlineStart: 34, background: 'var(--bg-app)', border: '1px solid var(--border-light)', color: 'var(--text-primary)', fontFamily: 'var(--font-platform)', outline: 'none' }}
                />
              </div>
            </div>
          )}
          <div className="flex-1 overflow-y-auto px-2 pb-2" style={{ minHeight: 0 }}>
            {tab === 'transfers' ? (
              <TransfersPanel
                incoming={transfers.incoming}
                outgoing={transfers.outgoing}
                busyId={transferBusy}
                onDecide={decideTransfer}
              />
            ) : tabbedConvs.length === 0 ? (
              /* An empty screen is an invitation to act, not a dead end. */
              <div className="px-5 py-12 text-center">
                <div
                  className="mx-auto mb-3 flex items-center justify-center rounded-2xl"
                  style={{ width: 44, height: 44, background: 'var(--accent-light)', color: 'var(--accent-primary)' }}
                >
                  {tab === 'teams' ? <UsersIcon className="w-5 h-5" /> : <MessageSquare className="w-5 h-5" />}
                </div>
                <p className="text-[13px] font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                  {convSearch.trim()
                    ? 'Nothing matches that search'
                    : tab === 'teams' ? 'No team conversations yet' : 'No conversations yet'}
                </p>
                <p className="text-[11.5px] mb-3 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  {convSearch.trim()
                    ? 'Try a colleague’s name or a word from the message.'
                    : tab === 'teams'
                      ? 'Create one for a ward, a shift or an on-call group so hand-overs stay in one thread.'
                      : 'Start a direct message with a colleague on your team.'}
                </p>
                {!convSearch.trim() && (
                  <button
                    onClick={() => {
                      if (tab === 'teams') { setView('newTeam'); setTeamName(''); setTeamMembers([]); setStaffSearch(''); }
                      else { setView('new'); setStaffSearch(''); }
                    }}
                    className="text-[12px] font-semibold px-3 py-1.5 rounded-lg"
                    style={{ background: 'var(--accent-primary)', color: '#fff' }}
                  >
                    {tab === 'teams' ? 'Create a team conversation' : 'New message'}
                  </button>
                )}
              </div>
            ) : tabbedConvs.map(c => {
              const unread = isUnread(c);
              return (
                <button
                  key={c._id}
                  onClick={() => openConversation(c._id)}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-colors hover:bg-[var(--overlay-subtle)] text-start"
                >
                  <Avatar name={convTitle(c)} size={38} group={c.kind === 'group'} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{convTitle(c)}</span>
                      <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{relTime(c.lastMessageAt)}</span>
                    </div>
                    <p className="text-[12px] truncate mt-0.5" style={{ color: unread ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: unread ? 600 : 400 }}>
                      {c.lastMessagePreview || 'No messages yet'}
                    </p>
                  </div>
                  {unread && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: 'var(--color-danger)' }} />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Transfers of care awaiting or issued by this user.
 *
 * This is the one place in the dock that is deliberately not chat-shaped. A
 * transfer is a decision someone is waiting on, so the row leads with the
 * patient, states who it is coming from, and puts Accept/Decline in reach —
 * rather than burying it in a thread the receiver has to open and read.
 *
 * The urgency colour is a 3px rail, not a background fill: a queue of six
 * emergency transfers has to read as urgent without turning the panel into a
 * wall of red, which is how people learn to ignore it.
 */
function TransfersPanel({
  incoming, outgoing, busyId, onDecide,
}: {
  incoming: PatientTransferDoc[];
  outgoing: PatientTransferDoc[];
  busyId: string | null;
  onDecide: (id: string, decision: 'accept' | 'reject') => void;
}) {
  if (incoming.length === 0 && outgoing.length === 0) {
    return (
      <div className="px-5 py-12 text-center">
        <div
          className="mx-auto mb-3 flex items-center justify-center rounded-2xl"
          style={{ width: 44, height: 44, background: 'var(--accent-light)', color: 'var(--accent-primary)' }}
        >
          <ArrowRightLeft className="w-5 h-5" />
        </div>
        <p className="text-[13px] font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>No transfers of care</p>
        <p className="text-[11.5px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Hand-overs you send or receive appear here until they are accepted.
        </p>
      </div>
    );
  }

  const section = (title: string, rows: PatientTransferDoc[], actionable: boolean) => {
    if (rows.length === 0) return null;
    return (
      <div className="mb-1">
        <p className="px-2.5 pt-2 pb-1 text-[10.5px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          {title}
        </p>
        {rows.map(t => {
          const tint = URGENCY_TINT[t.urgency] ?? URGENCY_TINT.routine;
          const busy = busyId === t._id;
          return (
            <div
              key={t._id}
              className="mb-1.5 rounded-xl overflow-hidden"
              style={{ background: 'var(--bg-app)', border: '1px solid var(--border-light)' }}
            >
              <div className="flex">
                <span aria-hidden style={{ width: 3, background: tint.rail, flexShrink: 0 }} />
                <div className="min-w-0 flex-1 px-2.5 py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                      {t.patientName || 'Patient'}
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-wide flex-shrink-0" style={{ color: tint.text }}>
                      {tint.label}
                    </span>
                  </div>
                  {t.hospitalNumber && (
                    <p className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>{t.hospitalNumber}</p>
                  )}
                  <p className="text-[11.5px] mt-1 flex items-center gap-1 flex-wrap" style={{ color: 'var(--text-secondary)' }}>
                    <span className="truncate">{t.from?.providerName || t.from?.department || 'Unassigned'}</span>
                    <ArrowRightLeft className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                    <span className="truncate">{t.to?.providerName || t.to?.department || 'Unassigned'}</span>
                  </p>
                  {t.reason && (
                    <p className="text-[11.5px] mt-1 line-clamp-2" style={{ color: 'var(--text-muted)' }}>{t.reason}</p>
                  )}
                  {actionable ? (
                    <div className="flex items-center gap-1.5 mt-2">
                      <button
                        onClick={() => onDecide(t._id, 'accept')}
                        disabled={busy}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11.5px] font-semibold text-white disabled:opacity-50"
                        style={{ background: 'var(--accent-primary)' }}
                      >
                        <Check className="w-3.5 h-3.5" /> Accept
                      </button>
                      <button
                        onClick={() => onDecide(t._id, 'reject')}
                        disabled={busy}
                        className="px-2.5 py-1 rounded-lg text-[11.5px] font-semibold disabled:opacity-50"
                        style={{ background: 'transparent', border: '1px solid var(--border-medium)', color: 'var(--text-secondary)' }}
                      >
                        Decline
                      </button>
                    </div>
                  ) : (
                    <p className="flex items-center gap-1 text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                      <Clock className="w-3 h-3" /> Awaiting a decision
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="pt-1">
      {section('Awaiting your decision', incoming, true)}
      {section('You sent', outgoing, false)}
    </div>
  );
}
