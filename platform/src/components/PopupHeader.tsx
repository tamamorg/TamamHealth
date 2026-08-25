'use client';

import type { ReactNode } from 'react';
import { Maximize2, X } from '@/components/icons/lucide';

/**
 * Shared chrome for resource-editor popups.
 *
 * Expand promotes the compact editor to its corresponding full page. It does
 * not fake fullscreen inside the dialog: the full page has room for section
 * navigation, preserves a useful URL, and behaves correctly with Back.
 */
export default function PopupHeader({
  title,
  titleId,
  subtitle,
  onExpand,
  onClose,
  expandLabel = 'Open full page',
  closeLabel = 'Close',
}: {
  title: ReactNode;
  titleId: string;
  subtitle?: ReactNode;
  onExpand: () => void;
  onClose: () => void;
  expandLabel?: string;
  closeLabel?: string;
}) {
  return (
    <header className="popup-resource-header modal-no-headband">
      <div className="popup-resource-header__copy">
        <h2 id={titleId} className="popup-resource-header__title">{title}</h2>
        {subtitle && <p className="popup-resource-header__subtitle">{subtitle}</p>}
      </div>
      <div className="popup-resource-header__actions">
        <button
          type="button"
          className="popup-resource-header__button"
          onClick={onExpand}
          aria-label={expandLabel}
          title={expandLabel}
          data-action="popup-expand"
        >
          <Maximize2 className="w-4 h-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="popup-resource-header__button"
          onClick={onClose}
          aria-label={closeLabel}
          title={closeLabel}
          data-action="popup-close"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
