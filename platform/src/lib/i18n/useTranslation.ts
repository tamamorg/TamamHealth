'use client';

import { useState, useEffect, useCallback } from 'react';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, loadTranslations, interpolate } from './index';
import type { Locale, TranslationMap } from './index';
import { CRITICAL_TRANSLATIONS } from './critical-translations';

const STORAGE_KEY = 'tamamhealth-locale';

let cachedLocale: Locale = DEFAULT_LOCALE;
let cachedTranslations: TranslationMap = CRITICAL_TRANSLATIONS[DEFAULT_LOCALE];
let pendingLocale: Locale | null = null;
let pendingLoad: Promise<void> | null = null;
const listeners: (() => void)[] = [];

function notifyListeners() {
  listeners.forEach(fn => fn());
}

/**
 * React hook for translations.
 *
 * Language is set at the organization/hospital level by org admins or hospital heads.
 * Individual users see the language their facility uses.
 *
 * Usage:
 *   const { t, locale, setLocale } = useTranslation();
 *   <span>{t('nav.dashboard')}</span>
 */
export function useTranslation() {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const listener = () => forceUpdate(n => n + 1);
    listeners.push(listener);
    return () => {
      const idx = listeners.indexOf(listener);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }, []);

  // Initialize: read from localStorage (which is set by org config on login)
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as Locale | null;
    const initial = saved || DEFAULT_LOCALE;
    if (initial !== cachedLocale || cachedTranslations === CRITICAL_TRANSLATIONS[cachedLocale]) {
      // Paint a usable sign-in shell immediately. The full lazy locale replaces
      // this map below; if its chunk is unavailable offline, these keys remain.
      cachedLocale = initial;
      cachedTranslations = CRITICAL_TRANSLATIONS[initial];
      notifyListeners();
      if (!pendingLoad || pendingLocale !== initial) {
        pendingLocale = initial;
        const load = loadTranslations(initial).then(map => {
          cachedLocale = initial;
          cachedTranslations = map;
          const localeConfig = SUPPORTED_LOCALES.find(l => l.code === initial);
          if (localeConfig) {
            document.documentElement.dir = localeConfig.dir;
            document.documentElement.lang = initial;
          }
          notifyListeners();
        }).catch(err => {
          // Keep the critical shell map. A later mount retries after the
          // network returns, while this rejection remains handled.
          console.warn('[i18n] full locale unavailable; using critical offline translations', err);
        }).finally(() => {
          if (pendingLocale === initial) {
            pendingLoad = null;
            pendingLocale = null;
          }
        });
        pendingLoad = load;
      }
    }
  }, []);

  const t = useCallback((key: string, vars?: Record<string, string | number>): string => {
    const template = cachedTranslations[key] || key;
    return vars ? interpolate(template, vars) : template;
  }, []);

  /**
   * Change the locale. This persists to localStorage and updates the UI globally.
   * Should only be called by org admin / hospital head via the settings UI.
   * Also writes to the OrganizationDoc so all users at that facility see the same language.
   */
  const setLocale = useCallback(async (locale: Locale) => {
    const map = await loadTranslations(locale);
    cachedLocale = locale;
    cachedTranslations = map;
    localStorage.setItem(STORAGE_KEY, locale);
    const localeConfig = SUPPORTED_LOCALES.find(l => l.code === locale);
    if (localeConfig) {
      document.documentElement.dir = localeConfig.dir;
      document.documentElement.lang = locale;
    }
    notifyListeners();
  }, []);

  return {
    t,
    locale: cachedLocale,
    setLocale,
  };
}

/**
 * Initialize locale from org config. Called once after login.
 * Sets the locale in localStorage so useTranslation picks it up.
 */
export function initLocaleFromOrg(orgLocale?: string) {
  if (orgLocale && SUPPORTED_LOCALES.some(l => l.code === orgLocale)) {
    localStorage.setItem(STORAGE_KEY, orgLocale);
  }
}
