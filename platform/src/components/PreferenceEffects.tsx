'use client';

/**
 * Applies per-user UI preferences app-wide:
 *  - the signed-in user's role settings, hydrated into the live store so every
 *    consumer (queue order, prescribing prompts, MAR, notifications…) reads
 *    the same effective values without a reload;
 *  - spacing density → <html data-density> (CSS targets it)
 *  - desktop notifications for new staff chat messages addressed to the
 *    current user while the tab is in the background.
 *
 * Renders nothing; mounted once inside the dashboard shell.
 */
import { useEffect } from 'react';
import { useAuth } from '@/lib/context';
import {
  getUserPrefs, applyDensity, applyTheme, subscribeUserPrefs,
  initUserPrefs, clearUserPrefs, userPrefsStorageKey,
} from '@/lib/user-prefs';
import { initRoleSettings, clearRoleSettings } from '@/lib/settings/role-settings-store';
import { messagesDB } from '@/lib/db';
import type { MessageDoc } from '@/lib/db-types';
import { setDisabledApps } from '@/lib/settings/disabled-apps';
import { systemConfigScope } from '@/lib/services/system-config-service';

export default function PreferenceEffects() {
  const { currentUser } = useAuth();
  const userId = currentUser?._id;
  const role = currentUser?.role;
  const orgId = currentUser?.orgId;

  // Role settings: hydrate the store for whoever is signed in, and re-hydrate
  // when another tab writes them (localStorage `storage` fires cross-tab only).
  useEffect(() => {
    if (!userId || !role) { clearRoleSettings(); clearUserPrefs(); return; }
    initRoleSettings(userId, role);
    initUserPrefs(userId);
    const onStorage = (event: StorageEvent) => {
      if (event.key === `tamamhealth.roleSettings.${userId}`) initRoleSettings(userId, role);
      if (event.key === userPrefsStorageKey(userId)) initUserPrefs(userId);
    };
    const onOnline = () => {
      void import('@/lib/settings/user-settings-sync')
        .then(({ retryPendingUserPreferences }) => retryPendingUserPreferences(userId));
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('online', onOnline);
    };
  }, [userId, role]);

  // The users database is server-only, so account preference updates do not
  // arrive through browser PouchDB replication. Pull the tiny preference bag
  // periodically and on focus; pending offline changes still win in the
  // hydrator until they have been accepted by the server.
  useEffect(() => {
    if (!userId || !role) return;
    const pull = () => {
      void import('@/lib/settings/user-settings-sync')
        .then(({ pullUserPreferences }) => pullUserPreferences(userId, role));
    };
    const timer = window.setInterval(pull, 30_000);
    window.addEventListener('focus', pull);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', pull);
    };
  }, [userId, role]);

  // Organization/system module settings: load once and follow replicated
  // changes so another administrator's update reaches active sessions.
  useEffect(() => {
    const scope = systemConfigScope(orgId, role);
    if (!scope) { setDisabledApps({}); return; }
    let cancelled = false;
    const hydrate = async () => {
      const { getSystemConfig } = await import('@/lib/services/system-config-service');
      const config = await getSystemConfig(scope);
      if (!cancelled) setDisabledApps(config.appOverrides);
    };
    void hydrate();
    let stop = () => {};
    void import('@/lib/services/system-config-service').then(({ subscribeSystemConfig }) => {
      if (!cancelled) stop = subscribeSystemConfig(scope, () => { void hydrate(); });
    });
    return () => { cancelled = true; stop(); };
  }, [orgId, role]);

  // Density: apply on mount and whenever it changes.
  useEffect(() => {
    applyDensity(getUserPrefs().density);
    return subscribeUserPrefs(p => applyDensity(p.density));
  }, []);

  // Theme: the layout's inline script already stamped <html data-theme>
  // before first paint; this re-applies on change and arms the live
  // OS-preference listener for users on 'system'.
  useEffect(() => {
    applyTheme(getUserPrefs().theme);
    return subscribeUserPrefs(p => applyTheme(p.theme));
  }, []);

  // Desktop notifications for new staff messages addressed to me.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    let feed: { cancel: () => void } | null = null;
    try {
      feed = messagesDB()
        .changes({ since: 'now', live: true, include_docs: true })
        .on('change', (change: { doc?: unknown }) => {
          if (cancelled) return;
          const prefs = getUserPrefs();
          if (!prefs.messageNotifications) return;
          if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
          if (typeof document !== 'undefined' && !document.hidden) return; // only when not focused
          const doc = change.doc as MessageDoc | undefined;
          if (!doc || doc.type !== 'message' || doc.recipientType !== 'staff') return;
          if (doc.patientId !== userId) return;     // not addressed to me
          if (doc.fromDoctorId === userId) return;  // my own message echoing back
          try {
            const n = new Notification(doc.fromDoctorName || 'New message', {
              body: (doc.body || 'You have a new message').slice(0, 140),
              tag: doc.conversationId || doc._id,
            });
            n.onclick = () => { try { window.focus(); } catch { /* noop */ } n.close(); };
          } catch { /* notification failed — ignore */ }
        })
        .on('error', () => { /* swallow */ }) as unknown as { cancel: () => void };
    } catch {
      feed = null;
    }
    return () => { cancelled = true; try { feed?.cancel(); } catch { /* noop */ } };
  }, [userId]);

  return null;
}
