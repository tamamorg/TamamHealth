'use client';

/**
 * The draft keeper for full-page forms (registration, the `/new` pages a
 * popup expands to). It watches the page's main area, counting only fields
 * inside a `<form>`, so a list's search and filter boxes are not mistaken for
 * work. Popups and the chart drawer are their own regions and are skipped.
 */

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useDraftKeeper } from './useDraftKeeper';
import { pageDraftScope } from '@/lib/unsaved/draft-scope';

export default function PageDraftKeeper({ rootId = 'main-content' }: { rootId?: string }) {
  const pathname = usePathname();
  const rootRef = useRef<HTMLElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    rootRef.current = document.getElementById(rootId);
    setReady(!!rootRef.current);
  }, [rootId]);

  useDraftKeeper(rootRef, {
    active: ready,
    resetKey: pathname ?? '',
    onlyInForms: true,
    scope: () => `${pageDraftScope()}|page`,
  });

  return null;
}
