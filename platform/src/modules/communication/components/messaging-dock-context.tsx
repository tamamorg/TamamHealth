'use client';

// Shared open/close state for the floating MessagingDock so any entry point —
// quick-action tiles, the sidebar "Messages" nav item, the Alt+M shortcut, etc.
// — can pop the dock open in-context instead of navigating to /messages. An
// optional `pendingDM` lets a caller request a direct message with a specific
// staff member; the dock consumes and clears it on open.

import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';

export interface DockPerson { id: string; name: string }

interface MessagingDockValue {
  open: boolean;
  pendingDM: DockPerson | null;
  openDock: () => void;
  openDockWith: (person: DockPerson) => void;
  closeDock: () => void;
  clearPendingDM: () => void;
}

const noop = () => {};
const FALLBACK: MessagingDockValue = {
  open: false,
  pendingDM: null,
  openDock: noop,
  openDockWith: noop,
  closeDock: noop,
  clearPendingDM: noop,
};

const MessagingDockContext = createContext<MessagingDockValue | null>(null);

export function MessagingDockProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pendingDM, setPendingDM] = useState<DockPerson | null>(null);

  const openDock = useCallback(() => setOpen(true), []);
  const openDockWith = useCallback((person: DockPerson) => { setPendingDM(person); setOpen(true); }, []);
  const closeDock = useCallback(() => setOpen(false), []);
  const clearPendingDM = useCallback(() => setPendingDM(null), []);

  const value = useMemo<MessagingDockValue>(
    () => ({ open, pendingDM, openDock, openDockWith, closeDock, clearPendingDM }),
    [open, pendingDM, openDock, openDockWith, closeDock, clearPendingDM],
  );

  return <MessagingDockContext.Provider value={value}>{children}</MessagingDockContext.Provider>;
}

/** Returns the dock controls. Safe no-op outside the provider. */
export function useMessagingDock(): MessagingDockValue {
  return useContext(MessagingDockContext) ?? FALLBACK;
}
