'use client';

import { useEffect, type ReactNode } from 'react';
import { dismissBackdrop } from '@/lib/a11y';

interface MobileBottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export default function MobileBottomSheet({ open, onClose, title, subtitle, children }: MobileBottomSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="mobile-sheet-scrim" {...dismissBackdrop(onClose)} />
      <div className="mobile-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="mobile-sheet-handle" />
        <div className="mobile-sheet-head">
          <b>{title}</b>
          {subtitle && <small>{subtitle}</small>}
        </div>
        <div className="mobile-sheet-body">{children}</div>
      </div>
    </>
  );
}
