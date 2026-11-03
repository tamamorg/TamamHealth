'use client';

/**
 * Asks before the app reloads itself while something is unsaved, and keeps
 * the device's draft store tidy.
 *
 * The app reloads on its own in a few places (fresh assets after a failed
 * stylesheet, a transferred chart that has just arrived). With nothing
 * unsaved those still reload at once. Otherwise `requestReload` lands here
 * and the user gets a notification with "Reload now"; closing it means
 * "later", and the page stays as it is.
 */

import { useEffect } from 'react';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { purgeExpiredDrafts } from '@/lib/unsaved/draft-store';
import {
  dismissReloadRequest, pendingReloadReason, reloadNow, setLeaveMessage, subscribeReloadRequests,
} from '@/lib/unsaved/unsaved-registry';

export default function ReloadPrompt() {
  const { showToast } = useToast();
  const { t } = useTranslation();

  useEffect(() => { setLeaveMessage(t('unsaved.leave')); }, [t]);
  useEffect(() => { purgeExpiredDrafts(); }, []);

  useEffect(() => {
    const show = (reason: string | null) => {
      if (!reason) return;
      showToast(t('reload.keepTyping'), 'info', {
        title: t(reason),
        sticky: true,
        placement: 'corner',
        action: { label: t('reload.now'), onClick: () => reloadNow() },
      });
      // The notification now carries the question; a later request asks again.
      dismissReloadRequest();
    };
    show(pendingReloadReason());
    return subscribeReloadRequests(show);
  }, [showToast, t]);

  return null;
}
