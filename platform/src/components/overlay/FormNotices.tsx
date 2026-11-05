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
  const { showToast, dismissToast } = useToast();
  // Held up for as long as the form holds the error, and taken down when it
  // clears or the form closes. A 10-second notice faded while the error stayed
  // in state, so a second failed Save set the same message, nothing changed,
  // and the user faced a dead button with nothing on screen.
  useEffect(() => {
    if (!message) return;
    const id = showToast(message, 'error', { title, sticky: true });
    return () => { if (typeof id === 'number') dismissToast?.(id); };
  }, [message, title, showToast, dismissToast]);
  return null;
}
