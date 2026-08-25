'use client';

/**
 * The Expand control's other half.
 *
 * Every create/add popup carries a control that promotes it to its full page
 * (see `PopupHeader`). Two things have to be true for that to be a promotion
 * rather than a detour: the page must know where the operator came from, and
 * "back" must not drop them onto the trigger that reopens the popup.
 */

import { useEffect, useState } from 'react';
import { returnToFromSearch, withReturnTo } from './return-to';

/**
 * Where the operator is standing right now, as a return destination.
 *
 * `?new=1` is stripped deliberately. The top rail's Add menu opens these
 * popups by putting that parameter on whatever page you are already on; carry
 * it into `returnTo` and closing the full page reopens the popup you just
 * expanded out of, forever.
 */
export function currentReturnTo(fallback = '/dashboard'): string {
  if (typeof window === 'undefined') return fallback;
  const url = new URL(window.location.href);
  url.searchParams.delete('new');
  return `${url.pathname}${url.search}`;
}

/** `href` with a `returnTo` pointing back at the current page. */
export function expandHref(href: string): string {
  return withReturnTo(href, currentReturnTo());
}

/**
 * The `returnTo` this page was opened with.
 *
 * Read after mount rather than during render: a client-side `router.push`
 * commits its URL after the destination's first render, so reading the search
 * string inline resolves to the fallback and sends the operator somewhere they
 * were not. Same reason `/admin/users/new` does it this way.
 */
export function useReturnTo(fallback: string): string {
  const [returnTo, setReturnTo] = useState(fallback);
  useEffect(() => {
    setReturnTo(returnToFromSearch(window.location.search, fallback));
  }, [fallback]);
  return returnTo;
}
