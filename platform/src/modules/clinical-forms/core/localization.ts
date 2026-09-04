import type { ClinicalFormLocale, LocalizedClinicalText } from './types';

/** Resolves schema-authored text without silently falling back to untranslated UI copy. */
export function localizeClinicalText(
  text: LocalizedClinicalText,
  locale: ClinicalFormLocale,
): string {
  return text[locale];
}
