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

/**
 * Simple interpolation: replaces {{key}} placeholders in a translated string.
 *   t('greeting', { name: 'Deng' }) => "Hello, Deng"
 */
export function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? `{{${key}}}`));
}
