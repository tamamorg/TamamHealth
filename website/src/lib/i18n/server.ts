import { cookies } from 'next/headers';
import { COOKIE_NAME, DEFAULT_LOCALE, isLocale, localeConfig, translate, translateDeep } from './index';
import type { Locale, Vars } from './index';
import { apd } from './apd';

const DICTIONARIES: Record<Locale, Record<string, string>> = { en: {}, apd };

/**
 * The language for this request.
 *
 * Reading a cookie opts the route into dynamic rendering — deliberate. The site
 * is served by a Node server (`output: "standalone"`), not a static CDN, so the
 * cost is a render per request rather than a cache miss, and it buys server-
 * rendered Arabic: the alternative, translating on the client, would ship every
 * page as English first and repaint it, which is worse for both readers and
 * crawlers.
 */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const value = store.get(COOKIE_NAME)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export interface ServerTranslator {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  /** Translate one literal string of copy; `vars` fills {{placeholders}}. */
  t: (text: string, vars?: Vars) => string;
  /** Translate a whole content object out of site-data. */
  content: <T>(value: T) => T;
}

export async function getTranslator(): Promise<ServerTranslator> {
  const locale = await getLocale();
  const dict = DICTIONARIES[locale] ?? {};
  return {
    locale,
    dir: localeConfig(locale).dir,
    t: (text: string, vars?: Vars) => translate(text, dict, vars),
    content: <T,>(value: T) => translateDeep(value, dict),
  };
}
