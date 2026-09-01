'use client';

import { useEffect, useState } from 'react';

/**
 * The current time, as a value React can reason about.
 *
 * Reading `Date.now()` during render is impure: two renders of the same props
 * disagree, so the render cannot be cached or replayed, and a memo that reads
 * the clock inside its body silently keeps whatever "now" it happened to be
 * built with. Taking the reading here instead makes the clock an input —
 * something a component depends on explicitly and re-renders for.
 *
 * `intervalMs` is for values that go stale on screen (a "recorded 3h ago"
 * badge, a countdown). Left off, the clock is read once when the component
 * mounts, which is the right choice for a threshold evaluated against data
 * that arrives with its own timestamps — a 30-day "recently visited" window
 * does not move meaningfully while someone reads the page.
 */
export function useNow(intervalMs?: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!intervalMs) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
