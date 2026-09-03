'use client';

import { useState, useEffect, useCallback } from 'react';
import { makeCoalescer } from '@/lib/hooks/live-reload';
import type { MessageDoc } from '@/lib/db-types';
import { messagesDB } from '@/lib/db';
import { useDataScope } from '@/lib/hooks/useDataScope';

export function useMessages() {
  const [messages, setMessages] = useState<MessageDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope = useDataScope();

  const loadMessages = useCallback(async () => {
    if (!scope) {
      setMessages([]);
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const { getAllMessages } = await import('@/modules/communication/services/message-service');
      const data = await getAllMessages(scope);
      setMessages(data);
    } catch (err) {
      console.error('Failed to load messages', err);
      setError('Failed to load messages');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  // Live PouchDB subscription: re-load on any new/edited message.
  useEffect(() => {
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) loadMessages(); });
    const changes = messagesDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger())
      .on('error', () => { /* swallow */ });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [loadMessages]);

  const send = useCallback(async (data: Omit<MessageDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt' | 'status'>) => {
    const { createMessage } = await import('@/modules/communication/services/message-service');
    const msg = await createMessage(data);
    await loadMessages();
    return msg;
  }, [loadMessages]);

  return { messages, loading, error, send, reload: loadMessages };
}
