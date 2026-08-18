'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useMemo } from 'react';
import {
  COOKIE_MAX_AGE,
  COOKIE_NAME,
  STORAGE_KEY,
  localeConfig,
  translate,
  translateDeep,
} from './index';
import type { Dictionary, Locale } from './index';
import { apd } from './apd';

const DICTIONARIES: Record<Locale, Dictionary> = {
  en: {}, // English is the source text; nothing to look up.
  apd,
};

interface LanguageValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  /** Translate one literal string of UI copy. */
  t: (text: string) => string;
  /** Translate a whole content object from site-data. */
  content: <T>(value: T) => T;
}

const LanguageContext = createContext<LanguageValue | null>(null);

/**
 * The locale comes down as a prop from the root layout, which read it from the
 * cookie on the server. Client components therefore render the same language
 * the server did on the very first pass — no flash, no hydration mismatch, and
 * no second source of truth to drift.
 */
export function LanguageProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const router = useRouter();

  const setLocale = useCallback(
    (next: Locale) => {
      if (next === locale) return;
      document.cookie = `${COOKIE_NAME}=${next}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
      // Mirrored for the platform app, which is client-rendered and reads this
      // key, so a visitor who signs in lands in the language they picked here.
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* private mode — the cookie still carries the choice */
      }
      // Paint the new direction immediately; the refresh below re-renders the
      // server tree with the translated copy a moment later.
      const config = localeConfig(next);
      document.documentElement.lang = next;
      document.documentElement.dir = config.dir;
      // Every page is a server component, so the copy only changes once the
      // server re-renders. Without this the language picker would flip the
      // layout and leave the words alone.
      router.refresh();
    },
    [locale, router],
  );

  const value = useMemo<LanguageValue>(() => {
    const dict = DICTIONARIES[locale] ?? {};
    return {
      locale,
      setLocale,
      t: (text: string) => translate(text, dict),
      content: <T,>(v: T) => translateDeep(v, dict),
    };
  }, [locale, setLocale]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used inside <LanguageProvider>');
  return ctx;
}
