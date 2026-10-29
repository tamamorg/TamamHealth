'use client';

/**
 * Where a form's own errors land: an inline notification above its action
 * bar, instead of a toast in the corner.
 *
 * A save that fails while the clinician is still in the form belongs to that
 * form — they are looking at it, and the corner is the one place they are not.
 * Mount this just above a footer; it registers the surface it sits in (the
 * dialog, slider or chart drawer) with the toast provider, and any error or
 * warning raised right after the user acted inside that surface is shown here
 * instead. Every `showToast(…, 'error')` call site follows without changes.
 *
 * `DialogFooter` mounts one, so every dialog and FormSlider has it already.
 */

import { useEffect, useRef, useState } from 'react';
import InlineBanner from '@/components/overlay/InlineBanner';
import { splitNotice, useNoticeHosts, type RoutedNotice } from '@/components/overlay/notice-hosts';

/** The surfaces a notice slot can claim, nearest first. */
const SCOPE = '[data-notice-scope], .tm-dialog, [role="dialog"], .tamam-drawer';

/** Two at most: the newest failure and the one before it. More is a log. */
const MAX_SHOWN = 2;

export default function FormNotices({ className = '' }: { className?: string }) {
  const hosts = useNoticeHosts();
  const ref = useRef<HTMLDivElement>(null);
  const [notices, setNotices] = useState<RoutedNotice[]>([]);

  useEffect(() => {
    const scope = ref.current?.parentElement?.closest<HTMLElement>(SCOPE);
    if (!hosts || !scope) return;
    return hosts.register({
      el: scope,
      push: notice => setNotices(prev => [
        ...prev.filter(n => !(n.message === notice.message && n.title === notice.title)),
        notice,
      ].slice(-MAX_SHOWN)),
    });
  }, [hosts]);

  return (
    <div ref={ref} className={`tm-form-notices${className ? ` ${className}` : ''}`} hidden={notices.length === 0}>
      {notices.map(notice => (
        <InlineBanner
          key={notice.id}
          tone={notice.type === 'error' ? 'danger' : 'warning'}
          title={notice.title}
          onDismiss={() => setNotices(prev => prev.filter(n => n.id !== notice.id))}
        >
          {notice.message}
        </InlineBanner>
      ))}
    </div>
  );
}

/**
 * A form's error that the form holds in its own state (`{error && …}`) —
 * the same inline notification as a routed one, with the message's first
 * sentence as the bold title. Place it just above the form's actions.
 */
export function FormError({ message, title, onDismiss, className }: {
  message: string;
  title?: string;
  onDismiss?: () => void;
  className?: string;
}) {
  const split = splitNotice(message, title);
  return (
    <InlineBanner tone="danger" title={split.title} onDismiss={onDismiss} className={className}>
      {split.message}
    </InlineBanner>
  );
}
