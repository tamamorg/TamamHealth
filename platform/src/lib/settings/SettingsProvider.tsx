'use client';

/**
 * Makes the current facility settings reactive across the whole app.
 *
 * On mount (and whenever the logged-in user's facility changes) it loads the
 * facility settings doc, pushes it into the singleton store, and subscribes to
 * the PouchDB change feed for that doc. Any edit — by this user, another tab,
 * or another device via sync — re-hydrates the store and re-renders every
 * consumer of useSettings(). This is the mechanism that makes "change a setting
 * once, see it everywhere" work without a refresh or re-login.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../context';
import {
  DEFAULT_FACILITY_SETTINGS,
  mergeFacilitySettings,
  type FacilitySettings,
} from './facility-settings';
import { getSettings, setSettings, subscribeSettings } from './settings-store';
import { getFacilitySettings, subscribeFacilitySettingsDoc } from './settings-service';

interface SettingsContextValue {
  settings: FacilitySettings;
  hospitalId?: string;
  orgId?: string;
  /** True once the facility settings have been loaded from storage. */
  loaded: boolean;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_FACILITY_SETTINGS,
  loaded: false,
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { currentUser } = useAuth();
  const hospitalId = currentUser?.hospitalId;
  const orgId = currentUser?.orgId;

  const [settings, setSettingsState] = useState<FacilitySettings>(getSettings());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // No facility (super-admin / org-admin / government) → defaults.
    if (!hospitalId) {
      const d = mergeFacilitySettings(null);
      setSettings(d);
      setSettingsState(d);
      setLoaded(true);
      return;
    }

    setLoaded(false);
    const hydrate = async () => {
      const s = await getFacilitySettings(hospitalId);
      if (cancelled) return;
      setSettings(s);        // singleton store (for non-React services)
      setSettingsState(s);   // React state (for this provider tree)
      setLoaded(true);
    };

    hydrate();

    // Re-hydrate on any write to the doc (local save or sync from elsewhere).
    const cancelFeed = subscribeFacilitySettingsDoc(hospitalId, () => { hydrate(); });
    // Keep React state in lock-step with the store (e.g. a service-side save()).
    const unsubStore = subscribeSettings((s) => { if (!cancelled) setSettingsState(s); });

    return () => {
      cancelled = true;
      cancelFeed();
      unsubStore();
    };
  }, [hospitalId]);

  // Memoize so useSettings()/useSettingsContext() consumers only re-render when
  // the settings (or facility/org id) actually change, not on every render.
  const value = useMemo<SettingsContextValue>(
    () => ({ settings, hospitalId, orgId, loaded }),
    [settings, hospitalId, orgId, loaded],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

/** Reactive current facility settings. */
export function useSettings(): FacilitySettings {
  return useContext(SettingsContext).settings;
}

/** Full settings context (settings + facility/org ids + loaded flag). */
export function useSettingsContext(): SettingsContextValue {
  return useContext(SettingsContext);
}
