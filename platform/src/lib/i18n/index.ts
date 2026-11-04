/**
 * Lightweight i18n system for TamamHealth EMR.
 *
 * Design decisions:
 *   - No heavy deps (next-i18next adds 40KB+). This is <2KB.
 *   - Translations are plain objects loaded lazily per locale.
 *   - Supports RTL (Juba Arabic) via the dir attribute on <html>.
 *   - Medical terms live in a separate namespace so clinicians can validate them.
 *
 * Supported locales — deliberately two, and both are carried end to end:
 *   - en  English       (LTR) — the source of truth for every key
 *   - apd Juba Arabic   (RTL) — the lingua franca of South Sudan
 *
 * Adding a locale means adding a file under ./locales that covers every key
 * in en.ts. Half-translated locales were removed rather than shipped, because
 * a partly translated screen reads worse than an English one.
 */

export type Locale = 'en' | 'apd';

export interface LocaleConfig {
  code: Locale;
  name: string;
  nativeName: string;
  dir: 'ltr' | 'rtl';
  region?: string;
}

export const SUPPORTED_LOCALES: LocaleConfig[] = [
  { code: 'en', name: 'English', nativeName: 'English', dir: 'ltr' },
  { code: 'apd', name: 'Arabic (Juba)', nativeName: 'عربي جوبا', dir: 'rtl', region: 'South Sudan' },
];

export const DEFAULT_LOCALE: Locale = 'en';

// Flat key-value translations. Nested keys use dot notation: "nav.dashboard"
export type TranslationMap = Record<string, string>;

/**
 * Load translations for a locale. Returns English as fallback for missing keys.
 */
export async function loadTranslations(locale: Locale): Promise<TranslationMap> {
  const base = (await import('./locales/en')).default;
  englishMap = base;
  if (locale === 'en') return base;

  try {
    const mod = await import(`./locales/${locale}`);
    // Merge: locale-specific overrides on top of English fallback
    return { ...base, ...mod.default };
  } catch {
    console.warn(`[i18n] Locale "${locale}" not found, falling back to English`);
    return base;
  }
}

// The English map and the map on screen, kept here so code outside React
// (describeError) can show an English sentence in the current language.
let englishMap: TranslationMap | null = null;
let activeMap: TranslationMap | null = null;
let keyByEnglish: Map<string, string> | null = null;

/** Called by useTranslation whenever the on-screen locale map changes. */
export function setActiveTranslations(map: TranslationMap): void {
  activeMap = map;
}

/**
 * The current-language version of an English sentence that is also a locale
 * value (a service error such as "Appointment not updated. Try again.").
 * Text with no matching key, or any text while English is showing, comes
 * back unchanged.
 */
export function localizeText(text: string): string {
  if (!englishMap || !activeMap || activeMap === englishMap) return text;
  if (!keyByEnglish) {
    keyByEnglish = new Map();
    for (const [key, value] of Object.entries(englishMap)) {
      if (!keyByEnglish.has(value)) keyByEnglish.set(value, key);
    }
  }
  const key = keyByEnglish.get(text);
  if (key) return activeMap[key] || text;
  return localizePattern(text, activeMap) ?? text;
}

// `err.*` sentences with {{placeholders}}, as anchored patterns, longest
// literal text first so "…in {{ward}}, bed {{bed}}." wins over "…in {{ward}}.".
let errPatterns: { key: string; names: string[]; pattern: RegExp; literal: number }[] | null = null;
// Captured values that are status codes, shown as the locale's status word.
const STATUS_VARS = new Set(['status', 'from', 'to']);

function localizePattern(text: string, map: TranslationMap): string | null {
  if (!englishMap) return null;
  if (!errPatterns) {
    errPatterns = Object.entries(englishMap)
      .filter(([key, value]) => key.startsWith('err.') && value.includes('{{'))
      .map(([key, value]) => {
        const names: string[] = [];
        const source = value.split(/\{\{(\w+)\}\}/).map((part, i) => {
          if (i % 2) { names.push(part); return '(.+?)'; }
          return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }).join('');
        return { key, names, pattern: new RegExp(`^${source}$`), literal: value.replace(/\{\{\w+\}\}/g, '').length };
      })
      .sort((a, b) => b.literal - a.literal);
  }
  for (const { key, names, pattern } of errPatterns) {
    const match = pattern.exec(text);
    if (!match || !map[key]) continue;
    const vars: Record<string, string> = {};
    names.forEach((name, i) => {
      const value = match[i + 1];
      vars[name] = (STATUS_VARS.has(name) && map[`statusWord.${value}`]) || value;
    });
    return interpolate(map[key], vars);
  }
  return null;
}

/**
 * Simple interpolation: replaces {{key}} placeholders in a translated string.
 *   t('greeting', { name: 'Deng' }) => "Hello, Deng"
 */
export function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? `{{${key}}}`));
}
