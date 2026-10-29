'use client';

/**
 * A sub-view of a page (Visits / All encounters, Upcoming / Today / Past) kept
 * in the URL as `?view=`, so Back returns to the view the user was on and a
 * link or reload opens the same one. Switching views is a step the user
 * takes, so it pushes a history entry, as the chart's own tabs do.
 */
import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export function useUrlView<T extends string>(allowed: readonly T[], fallback: T, param = 'view'): [T, (next: T) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const raw = searchParams.get(param);
  const value = (raw && (allowed as readonly string[]).includes(raw) ? raw : fallback) as T;
  const setValue = useCallback((next: T) => {
    if (next === value) return;
    const params = new URLSearchParams(searchParams.toString());
    if (next === fallback) params.delete(param); else params.set(param, next);
    const qs = params.toString();
    router.push(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
  }, [router, pathname, searchParams, value, fallback, param]);
  return [value, setValue];
}
