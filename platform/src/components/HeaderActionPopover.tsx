'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { notificationPopoverPosition, type NotificationPopoverPosition } from './NotificationsPanel';

/** Same anchor geometry as notifications, without a modal backdrop. */
export default function HeaderActionPopover({ anchorRef, onClose, id, labelledBy, children }: {
  anchorRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  id: string;
  labelledBy: string;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<NotificationPopoverPosition | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      setPosition(notificationPopoverPosition(rect, window.innerWidth,
        anchor.closest('.ehr-top-rail')?.getBoundingClientRect().bottom ?? rect.bottom));
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchorRef]);
  useEffect(() => {
    const outside = (event: MouseEvent) => {
      const target = event.target as Element;
      // Select menus are portaled separately; choosing an option is inside
      // this workflow even though it is not a DOM descendant of the panel.
      if (target.closest('.tsel-menu') || panel.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      onClose();
      anchorRef.current?.focus();
    };
    document.addEventListener('mousedown', outside);
    window.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', outside);
      window.removeEventListener('keydown', escape);
    };
  }, [anchorRef, onClose]);
  if (!position) return null;
  return createPortal(<div ref={panel} id={id} role="dialog" aria-labelledby={labelledBy}
    className="notifications-popover" style={{ left: position.left, top: position.top, width: position.width,
      maxHeight: `calc(100dvh - ${position.top + 10}px)` }}>
    <span className="notifications-popover-pointer" style={{ left: position.pointerLeft }} aria-hidden="true" />
    <div style={{ overflowY: 'auto', minHeight: 0, borderRadius: 'inherit' }}>{children}</div>
  </div>, document.body);
}
