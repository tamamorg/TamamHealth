'use client';

import { useState, useCallback } from 'react';
import { usePouchLiveReload } from '@/lib/hooks/usePouchLiveReload';
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
      setError('Messages not loaded. Reload the page to try again.');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  // Live PouchDB subscription: re-load on any new/edited message.
  usePouchLiveReload({ load: loadMessages, database: messagesDB });

  const send = useCallback(async (data: Omit<MessageDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt' | 'status'>) => {
    const { createMessage } = await import('@/modules/communication/services/message-service');
    const msg = await createMessage(data);
    await loadMessages();
    return msg;
  }, [loadMessages]);

  return { messages, loading, error, send, reload: loadMessages };
}
