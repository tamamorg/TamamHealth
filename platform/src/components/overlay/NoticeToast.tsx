'use client';

/**
 * A form's status message ("Locked", "Complete these sections before
 * signing", "This time is in the past") shown as the bottom-left notification
 * rather than a banner inside the form. Mount it where the banner was: it
 * raises the notification when the message appears or its text changes, and
 * draws nothing. The same message again only restarts the visible one.
 */

import { useEffect } from 'react';
import { useToast, type ToastType } from '@/components/Toast';

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger';

const TYPE: Record<NoticeTone, ToastType> = {
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'error',
};

export default function NoticeToast({ tone = 'info', title, children }: {
  tone?: NoticeTone;
  title?: string;
  /** The detail under the title; plain text, as a notification holds. */
  children?: string | null | false;
}) {
  const { showToast } = useToast();
  const detail = typeof children === 'string' ? children.trim() : '';
  useEffect(() => {
    const message = detail || title || '';
    if (!message) return;
    showToast(message, TYPE[tone], { title: detail ? title : undefined });
  }, [showToast, tone, title, detail]);
  return null;
}
