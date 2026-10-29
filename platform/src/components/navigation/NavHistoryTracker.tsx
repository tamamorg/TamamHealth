'use client';

import { useNavHistoryTracker } from '@/lib/navigation/nav-history';

/** Renders nothing; keeps the in-app history index current (nav-history.ts). */
export default function NavHistoryTracker() {
  useNavHistoryTracker();
  return null;
}
