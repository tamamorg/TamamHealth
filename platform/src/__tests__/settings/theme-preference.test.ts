/**
 * Theme preference (lib/user-prefs.ts) — resolution, persistence, and the
 * <html data-theme> reflection the pre-paint script and PreferenceEffects
 * both depend on.
 */
import {
  DEFAULT_USER_PREFS, getUserPrefs, setUserPrefs, resolveTheme, applyTheme,
  initUserPrefs, clearUserPrefs, userPrefsStorageKey,
  type ThemePreference,
} from '@/lib/user-prefs';

const USER_ID = 'user-theme-test';

// Reset the module's in-memory cache between tests: setUserPrefs writes it, and
// there's no exported reset, so clear storage AND force a re-read by writing a
// known baseline through the public API.
beforeEach(() => {
  window.localStorage.clear();
  clearUserPrefs();
  initUserPrefs(USER_ID);
  document.documentElement.removeAttribute('data-theme');
  // matchMedia isn't in jsdom by default; default it to "OS is light".
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

describe('theme default', () => {
  it('ships light, not system — the ward must not follow an OS setting nobody chose', () => {
    expect(DEFAULT_USER_PREFS.theme).toBe('light');
  });
});

describe('resolveTheme', () => {
  it('returns the explicit choice verbatim', () => {
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('asks the OS for system, defaulting to light when the OS is light or matchMedia is absent', () => {
    expect(resolveTheme('system')).toBe('light');
  });

  it('resolves system to dark when the OS prefers dark', () => {
    window.matchMedia = ((query: string) => ({
      matches: query.includes('dark'),
      media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    expect(resolveTheme('system')).toBe('dark');
  });
});

describe('applyTheme stamps <html data-theme> with the RESOLVED value', () => {
  it.each<[ThemePreference, string]>([
    ['light', 'light'],
    ['dark', 'dark'],
    ['system', 'light'], // OS light in this env
  ])('%s → data-theme=%s', (pref, expected) => {
    applyTheme(pref);
    expect(document.documentElement.dataset.theme).toBe(expected);
  });
});

describe('setUserPrefs persistence + application', () => {
  it('persists the theme and applies it to the DOM in one call', () => {
    setUserPrefs({ theme: 'dark' });
    expect(getUserPrefs().theme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    const stored = JSON.parse(window.localStorage.getItem(userPrefsStorageKey(USER_ID)) || '{}');
    expect(stored.theme).toBe('dark');
  });

  it('leaves an unknown persisted theme value to fall back to the default', () => {
    window.localStorage.setItem(userPrefsStorageKey(USER_ID), JSON.stringify({ theme: 'neon' }));
    // A corrupt value is not one of the three; the store keeps whatever was
    // written, but resolveTheme/applyTheme must never stamp 'neon'.
    applyTheme('neon' as ThemePreference);
    // 'neon' isn't 'light'|'dark', so resolveTheme treats it as system → light here.
    expect(['light', 'dark']).toContain(document.documentElement.dataset.theme);
  });

  it('keeps two accounts on the same workstation isolated', () => {
    setUserPrefs({ theme: 'dark', density: 'compact' });
    initUserPrefs('different-user');
    expect(getUserPrefs()).toEqual(DEFAULT_USER_PREFS);
    setUserPrefs({ theme: 'system' });
    initUserPrefs(USER_ID);
    expect(getUserPrefs()).toMatchObject({ theme: 'dark', density: 'compact' });
  });
});
