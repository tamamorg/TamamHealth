'use client';

/**
 * A form's error that the form holds in its own state (`{error && …}`).
 *
 * It used to draw an inline banner above the form's actions; errors now show
 * as the bottom-left notification like every other message, so this raises
 * one when the message appears or changes and draws nothing in the form.
 */

import { useEffect } from 'react';
import { useToast } from '@/components/Toast';

export function FormError({ message, title }: {
  message: string;
  title?: string;
  /** Unused: the notification carries its own close button. */
  onDismiss?: () => void;
  className?: string;
}) {
  const { showToast } = useToast();
  useEffect(() => {
    if (message) showToast(message, 'error', { title });
  }, [message, title, showToast]);
  return null;
}
