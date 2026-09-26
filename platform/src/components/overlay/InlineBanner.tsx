'use client';

/**
 * A message that belongs to the surface it sits on — "eLabs are not enabled
 * for this facility", "consent is required before viewing", "this change
 * could not be saved" — as opposed to a toast, which belongs to the moment.
 *
 * Four tones on the status pairs; an optional action at the trailing edge
 * and an optional dismiss. Danger announces itself (`role="alert"`); the
 * others are polite.
 */

import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';

export type BannerTone = 'info' | 'success' | 'warning' | 'danger';

export default function InlineBanner({
  tone = 'info',
  title,
  children,
  action,
  onDismiss,
  dismissLabel,
  compact = false,
  icon,
  className = '',
}: {
  tone?: BannerTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: { label: string; onClick: () => void };
  onDismiss?: () => void;
  dismissLabel?: string;
  compact?: boolean;
  icon?: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const Glyph = tone === 'success' ? CheckCircle2 : tone === 'info' ? Info : AlertTriangle;
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={`tm-banner tm-banner--${tone}${compact ? ' tm-banner--compact' : ''}${className ? ` ${className}` : ''}`}
    >
      <span className="tm-banner__icon" aria-hidden="true">{icon ?? <Glyph />}</span>
      <div className="tm-banner__body">
        {title && <span className="tm-banner__title">{title}</span>}
        {children && <span className="tm-banner__text">{children}</span>}
      </div>
      {action && (
        <button type="button" className="tm-banner__action" onClick={action.onClick}>{action.label}</button>
      )}
      {onDismiss && (
        <button type="button" className="tm-banner__dismiss" onClick={onDismiss} aria-label={dismissLabel || t('overlay.dismiss')}>
          <X aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
