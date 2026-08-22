'use client';

import { useMemo } from 'react';
import { Loader2 } from '@/components/icons/lucide';
import EmptyState from '@/components/EmptyState';
import { useAuth } from '@/lib/context';

import { initials, avatarTint } from '@/lib/patient-utils';
import { useMessages } from '@/modules/communication/client';

export default function MobileInboxView() {
  const { currentUser } = useAuth();
  const { messages, loading } = useMessages();

  const sorted = useMemo(
    () => [...messages].sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime()),
    [messages]
  );

  if (loading) {
    return (
      <div className="mobile-shell-loading">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  if (sorted.length === 0) {
    return <EmptyState title="No messages" message="Messages will appear here." />;
  }

  return (
    <div className="mobile-inbox">
      {sorted.map((m) => {
        const isOwn = m.fromDoctorId === currentUser?._id;
        const displayName = isOwn ? m.patientName : m.fromDoctorName;
        const unread = !isOwn && !(m.readBy || []).includes(currentUser?._id || '');
        return (
          <button key={m._id} type="button" className="mobile-inbox-row">
            <span className="mobile-inbox-avatar" style={avatarTint(displayName)}>
              {initials(displayName)}
            </span>
            <span className="mobile-inbox-meta">
              <span className="mobile-inbox-top">
                <strong style={{ fontWeight: unread ? 800 : 700 }}>{displayName}</strong>
                <small>{new Date(m.sentAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small>
              </span>
              <small className="mobile-inbox-preview" style={{ fontWeight: unread ? 700 : 500 }}>{m.subject || m.body}</small>
            </span>
            {unread && <i className="mobile-inbox-dot" />}
          </button>
        );
      })}
    </div>
  );
}
