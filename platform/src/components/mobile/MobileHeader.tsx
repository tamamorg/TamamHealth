'use client';

import { useAuth, useSync } from '@/lib/context';
import Badge, { type BadgeTone } from '@/components/Badge';
import { Menu } from '@/components/icons/lucide';

function syncChip(opts: {
  isOnline: boolean;
  isNetworkUp: boolean;
  syncPaused: boolean;
  syncState: string | undefined;
}): { tone: BadgeTone; label: string } {
  const { isOnline, isNetworkUp, syncPaused, syncState } = opts;
  if (syncPaused && isNetworkUp) return { tone: 'neutral', label: 'Paused' };
  if (!isOnline) return { tone: 'warning', label: 'Offline' };
  if (syncState === 'syncing') return { tone: 'info', label: 'Syncing…' };
  if (syncState === 'error') return { tone: 'danger', label: 'Sync error' };
  return { tone: 'success', label: 'Synced' };
}

/**
 * Persistent mobile-shell header: greeting + facility + a standing sync
 * chip. Unlike ConnectivityNotice (a transient toast on state transitions),
 * this is always visible — the first persistent sync indicator in the app.
 */
export default function MobileHeader({ onOpenModules }: { onOpenModules: () => void }) {
  const { currentUser } = useAuth();
  const { isOnline, isNetworkUp, syncPaused, syncStatus, syncNow } = useSync();
  const chip = syncChip({ isOnline, isNetworkUp, syncPaused, syncState: syncStatus?.state });

  return (
    <header className="mobile-shell-header">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/assets/tamamhealth-logo-icon-white.svg" alt="" className="mobile-shell-header-logo" />
      <div className="mobile-shell-header-text">
        <p className="mobile-shell-header-greeting">Welcome, {currentUser?.name || 'there'}</p>
        <p className="mobile-shell-header-facility">{currentUser?.hospitalName || currentUser?.hospital?.name || ''}</p>
      </div>
      <button
        type="button"
        className="mobile-shell-header-sync"
        onClick={() => syncNow()}
        aria-label={`Sync status: ${chip.label}. Tap to sync now.`}
      >
        <Badge tone={chip.tone} size="sm">{chip.label}</Badge>
      </button>
      <button type="button" className="mobile-shell-header-modules" onClick={onOpenModules} title="All modules" aria-label="Open all modules">
        <Menu className="w-5 h-5" />
      </button>
    </header>
  );
}
