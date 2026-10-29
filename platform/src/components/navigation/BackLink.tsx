'use client';

/**
 * A Back control that returns to the screen the user came from — browser
 * history when there is an in-app page behind this one — and to `fallbackHref`
 * (the page's logical parent) only when there is not: a link opened in a new
 * tab, a bookmark, a fresh load. It stays a real link to `fallbackHref`, so
 * middle-click and "open in new tab" still work.
 */
import Link from 'next/link';
import type { ReactNode, MouseEvent } from 'react';
import { useGoBack } from '@/lib/navigation/nav-history';

export default function BackLink({ fallbackHref, className, children, ariaLabel, style }: {
  fallbackHref: string;
  className?: string;
  children: ReactNode;
  ariaLabel?: string;
  style?: React.CSSProperties;
}) {
  const goBack = useGoBack(fallbackHref);
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // Let modified clicks (new tab, new window) follow the link itself.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    goBack();
  };
  return (
    <Link href={fallbackHref} className={className} aria-label={ariaLabel} style={style} onClick={onClick}>
      {children}
    </Link>
  );
}
