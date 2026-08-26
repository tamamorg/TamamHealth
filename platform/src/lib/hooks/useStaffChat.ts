'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { makeCoalescer } from './live-reload';
import { conversationsDB, messagesDB } from '../db';
import type { ConversationDoc, MessageDoc } from '../db-types';
import { useAuth } from '../context';

interface Participant { id: string; name: string }

/**
 * Drives the internal clinical staff chat screen: the current user's
 * conversation list plus the live message stream for whichever conversation
 * is open. Patient communication is intentionally NOT handled here.
 */
export function useStaffChat() {
  const { currentUser } = useAuth();
  const [conversations, setConversations] = useState<ConversationDoc[]>([]);
  const [messages, setMessages] = useState<MessageDoc[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const me: Participant | null = useMemo(
    () => (currentUser ? { id: currentUser._id, name: currentUser.name } : null),
    [currentUser],
  );
  const ctx = useMemo(
    () => ({ hospitalId: currentUser?.hospitalId, hospitalName: currentUser?.hospitalName, orgId: currentUser?.orgId }),
    [currentUser?.hospitalId, currentUser?.hospitalName, currentUser?.orgId],
  );

  const loadConversations = useCallback(async () => {
    if (!currentUser) return;
    try {
      const { getConversationsForUser } = await import('@/modules/communication/services/conversation-service');
      const data = await getConversationsForUser(currentUser._id, {
        role: currentUser.role,
        orgId: currentUser.orgId,
        hospitalId: currentUser.hospitalId,
      });
      setConversations(data);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  const loadMessages = useCallback(async (conversationId: string | null) => {
    if (!conversationId) { setMessages([]); return; }
    const { getConversationMessages } = await import('@/modules/communication/services/conversation-service');
    setMessages(await getConversationMessages(conversationId));
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);
  useEffect(() => { loadMessages(activeId); }, [activeId, loadMessages]);

  // Live updates on both stores.
  useEffect(() => {
    let cancelled = false;
    const reload = makeCoalescer(() => {
      if (cancelled) return;
      loadConversations();
      loadMessages(activeId);
    });
    const c1 = conversationsDB().changes({ since: 'now', live: true, include_docs: false }).on('change', () => reload.trigger()).on('error', () => {});
    const c2 = messagesDB().changes({ since: 'now', live: true, include_docs: false }).on('change', () => reload.trigger()).on('error', () => {});
    return () => {
      cancelled = true;
      reload.cancel();
      try { c1.cancel(); } catch {}
      try { c2.cancel(); } catch {}
    };
  }, [loadConversations, loadMessages, activeId]);

  // Mark the open conversation read whenever its messages change.
  useEffect(() => {
    if (!activeId || !currentUser || messages.length === 0) return;
    const hasUnread = messages.some(m => m.fromDoctorId !== currentUser._id && !m.readBy?.includes(currentUser._id));
    if (!hasUnread) return;
    (async () => {
      const { markConversationRead } = await import('@/modules/communication/services/conversation-service');
      await markConversationRead(activeId, currentUser._id);
    })();
  }, [activeId, messages, currentUser]);

  const activeConversation = useMemo(
    () => conversations.find(c => c._id === activeId) || null,
    [conversations, activeId],
  );

  const send = useCallback(async (
    body: string,
    replyToId?: string,
    attachments?: Array<{ name: string; mimeType: string; base64Data: string; sizeBytes: number; phiWarningAcknowledged?: boolean }>,
    phiAcknowledged?: boolean,
  ) => {
    if (!me || !activeConversation || (!body.trim() && !attachments?.length)) return;
    const { sendConversationMessage } = await import('@/modules/communication/services/conversation-service');
    await sendConversationMessage({
      conversationId: activeConversation._id,
      conversationName: activeConversation.name || activeConversation.participantNames?.join(', ') || 'Chat',
      fromId: me.id,
      fromName: me.name,
      body: body.trim(),
      ...(replyToId ? { replyToId } : {}),
      ...(attachments?.length ? { attachments } : {}),
      ...(phiAcknowledged ? { phiAcknowledged } : {}),
      ...ctx,
    });
    await loadMessages(activeConversation._id);
    await loadConversations();
  }, [me, activeConversation, ctx, loadMessages, loadConversations]);

  const startDM = useCallback(async (other: Participant) => {
    if (!me) return;
    const { getOrCreateDM } = await import('@/modules/communication/services/conversation-service');
    const conv = await getOrCreateDM(me, other, ctx);
    await loadConversations();
    setActiveId(conv._id);
    return conv;
  }, [me, ctx, loadConversations]);

  const createGroupChat = useCallback(async (name: string, participants: Participant[]) => {
    if (!me) return;
    const { createGroup } = await import('@/modules/communication/services/conversation-service');
    const conv = await createGroup({ name, participants, createdBy: me, ...ctx });
    await loadConversations();
    setActiveId(conv._id);
    return conv;
  }, [me, ctx, loadConversations]);

  const togglePin = useCallback(async (conversationId: string) => {
    if (!me) return;
    const { togglePinConversation } = await import('@/modules/communication/services/conversation-service');
    await togglePinConversation(conversationId, me.id);
    await loadConversations();
  }, [me, loadConversations]);

  const toggleMute = useCallback(async (conversationId: string) => {
    if (!me) return;
    const { toggleMuteConversation } = await import('@/modules/communication/services/conversation-service');
    await toggleMuteConversation(conversationId, me.id);
    await loadConversations();
  }, [me, loadConversations]);

  const editMessage = useCallback(async (messageId: string, body: string) => {
    if (!me) return;
    const svc = await import('@/modules/communication/services/conversation-service');
    await svc.editMessage(messageId, me.id, body);
    if (activeId) await loadMessages(activeId);
  }, [me, activeId, loadMessages]);

  const deleteMessage = useCallback(async (messageId: string) => {
    if (!me) return;
    const svc = await import('@/modules/communication/services/conversation-service');
    await svc.deleteMessage(messageId, me.id);
    if (activeId) { await loadMessages(activeId); await loadConversations(); }
  }, [me, activeId, loadMessages, loadConversations]);

  const react = useCallback(async (messageId: string, emoji: string) => {
    if (!me) return;
    const svc = await import('@/modules/communication/services/conversation-service');
    await svc.toggleReaction(messageId, emoji, me.id);
    if (activeId) await loadMessages(activeId);
  }, [me, activeId, loadMessages]);

  const renameGroup = useCallback(async (conversationId: string, name: string) => {
    const svc = await import('@/modules/communication/services/conversation-service');
    await svc.renameGroup(conversationId, name);
    await loadConversations();
  }, [loadConversations]);

  const addMembers = useCallback(async (conversationId: string, members: Participant[]) => {
    const svc = await import('@/modules/communication/services/conversation-service');
    await svc.addMembers(conversationId, members);
    await loadConversations();
  }, [loadConversations]);

  const removeMember = useCallback(async (conversationId: string, userId: string) => {
    const svc = await import('@/modules/communication/services/conversation-service');
    await svc.removeMember(conversationId, userId);
    await loadConversations();
  }, [loadConversations]);

  const leaveConversation = useCallback(async (conversationId: string) => {
    if (!me) return;
    const svc = await import('@/modules/communication/services/conversation-service');
    await svc.removeMember(conversationId, me.id);
    if (activeId === conversationId) setActiveId(null);
    await loadConversations();
  }, [me, activeId, loadConversations]);

  const deleteConversation = useCallback(async (conversationId: string) => {
    const svc = await import('@/modules/communication/services/conversation-service');
    await svc.deleteConversation(conversationId);
    if (activeId === conversationId) setActiveId(null);
    await loadConversations();
  }, [activeId, loadConversations]);

  const setPresence = useCallback(async (presence: import('../db-types').StaffPresence) => {
    if (!me) return;
    const svc = await import('@/modules/communication/services/conversation-service');
    await svc.setPresence(me.id, presence);
  }, [me]);

  return {
    currentUser,
    conversations,
    messages,
    activeId,
    setActiveId,
    activeConversation,
    loading,
    send,
    startDM,
    createGroupChat,
    togglePin,
    toggleMute,
    editMessage,
    deleteMessage,
    react,
    renameGroup,
    addMembers,
    removeMember,
    leaveConversation,
    deleteConversation,
    setPresence,
  };
}
