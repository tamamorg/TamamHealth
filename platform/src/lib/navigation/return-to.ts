const INTERNAL_ORIGIN = 'https://tamamhealth.internal';

/**
 * Accept only an application-local path for a return destination.
 *
 * `router.push` executes schemes such as `javascript:`, and protocol-relative
 * URLs (`//host`) can leave the application. Keeping this helper independent
 * of `window` also makes the same rule usable in client components and tests.
 */
export function safeReturnTo(
  returnTo: string | null | undefined,
  fallback: string,
): string {
  const safeFallback = isInternalPath(fallback) ? fallback : '/dashboard';
  return isInternalPath(returnTo) ? returnTo : safeFallback;
}

export function returnToFromSearch(
  search: string | URLSearchParams,
  fallback: string,
): string {
  const params = typeof search === 'string'
    ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    : search;
  return safeReturnTo(params.get('returnTo'), fallback);
}

export function withReturnTo(href: string, returnTo: string): string {
  if (!isInternalPath(href)) return '/dashboard';
  const url = new URL(href, INTERNAL_ORIGIN);
  url.searchParams.set('returnTo', safeReturnTo(returnTo, '/dashboard'));
  return `${url.pathname}${url.search}${url.hash}`;
}

function isInternalPath(value: string | null | undefined): value is string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return false;
  if (value.includes('\\') || /[\u0000-\u001F\u007F]/.test(value)) return false;

  try {
    const url = new URL(value, INTERNAL_ORIGIN);
    return url.origin === INTERNAL_ORIGIN && url.pathname.startsWith('/');
  } catch {
    return false;
  }
}
