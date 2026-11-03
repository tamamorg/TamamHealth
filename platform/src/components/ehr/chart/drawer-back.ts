'use client';

/**
 * The chart drawer's → (Hide). A panel with a step inside it (an order form
 * in the basket, one order picked in Lab orders or Dispense) registers the
 * way back from that step; → takes it first, and otherwise goes back to the
 * panel underneath in the workspace stack. There is no Back text in a panel:
 * the header's → is the one way back.
 */

import { createContext, useContext, useEffect, useRef } from 'react';

export const DrawerBackContext = createContext<(back: (() => void) | null) => void>(() => {});

/** While `active`, the drawer's → runs `onBack` instead of leaving the panel. */
export function useDrawerBack(active: boolean, onBack: () => void) {
  const register = useContext(DrawerBackContext);
  const latest = useRef(onBack);
  useEffect(() => { latest.current = onBack; });
  useEffect(() => {
    if (!active) return;
    register(() => latest.current());
    return () => register(null);
  }, [active, register]);
}
