/**
 * Site i18n.
 *
 * Two languages, both carried end to end:
 *   en   English      (LTR)
 *   apd  Arabic (Juba) (RTL) — the lingua franca of South Sudan
 *
 * The site's copy lives in `site-data.ts` as structured English content, not as
 * key/value pairs, and it is read by ~25 components. Rewriting all of it into a
 * keyed catalogue would mean touching every one of those call sites and keeping
 * two parallel object trees in step forever.
 *
 * So translation is an *overlay* instead: `apd.ts` maps English source strings
 * to their Juba Arabic equivalent, and `translateDeep` walks any content object
 * swapping the strings it recognises. English stays the single source of truth
 * for structure; a new language is one more dictionary file; and an untranslated
 * string falls back to English rather than rendering a blank or a raw key.
 *
 * The cost of keying on English text is that editing a source string silently
 * un-translates it. `npm run i18n:check` in this package exists to catch that —
 * it reports every user-facing string with no entry in a locale dictionary.
 */

export type Locale = 'en' | 'apd';

export interface LocaleConfig {
  code: Locale;
  /** English name, for the html lang/aria plumbing. */
  name: string;
  /** What the language calls itself — what the picker shows. */
  nativeName: string;
  dir: 'ltr' | 'rtl';
}

export const SUPPORTED_LOCALES: LocaleConfig[] = [
  { code: 'en', name: 'English', nativeName: 'English', dir: 'ltr' },
  { code: 'apd', name: 'Arabic (Juba)', nativeName: 'عربي جوبا', dir: 'rtl' },
];

export const DEFAULT_LOCALE: Locale = 'en';

/**
 * The cookie is the source of truth, not localStorage: every page on this site
 * is a server component, so the server has to know the language before it can
 * render a word of it. localStorage is written alongside it only so the
 * platform app (which is client-rendered and reads the same key) picks up the
 * same choice when a visitor crosses over.
 */
export const COOKIE_NAME = 'tamamhealth-locale';
export const STORAGE_KEY = 'tamamhealth-locale';
/** A language preference should outlive the session. One year, refreshed on set. */
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const localeConfig = (code: Locale): LocaleConfig =>
  SUPPORTED_LOCALES.find((l) => l.code === code) ?? SUPPORTED_LOCALES[0];

export const isLocale = (value: unknown): value is Locale =>
  typeof value === 'string' && SUPPORTED_LOCALES.some((l) => l.code === value);

export type Dictionary = Record<string, string>;

/**
 * Translate one string. Whitespace either side is preserved, so copy that pads
 * a value for layout ("  Juba ") still matches its trimmed dictionary entry.
 */
export function translate(text: string, dict: Dictionary): string {
  const trimmed = text.trim();
  if (!trimmed) return text;
  const hit = dict[trimmed];
  if (hit === undefined) return text;
  return text.replace(trimmed, hit);
}

/**
 * Walk a content value and translate every string in it.
 *
 * Keys that name a machine value rather than copy — slugs, hrefs, colours,
 * image paths, ISO dates — are skipped: translating "/products/records" would
 * break routing, and translating "#015697" would break the palette.
 */
const OPAQUE_KEYS = new Set([
  'slug', 'href', 'src', 'image', 'accent', 'color', 'dateISO', 'id', 'key',
  'icon', 'value', 'code', 'email', 'phone', 'url', 'name_en',
  // `focus` is a CSS object-position ("center 27%"); `lifecycle` is the set of
  // machine stage names the platform stores; `idPlaceholder` is a sample login
  // id. Translating any of them would reframe an image, rename a stored state,
  // or tell a user to type Arabic into a username field.
  'focus', 'lifecycle', 'idPlaceholder',
]);

export function translateDeep<T>(value: T, dict: Dictionary): T {
  if (typeof value === 'string') return translate(value, dict) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => translateDeep(v, dict)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = OPAQUE_KEYS.has(k) ? v : translateDeep(v, dict);
    }
    return out as T;
  }
  return value;
}
