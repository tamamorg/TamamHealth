type Translate = (key: string, vars?: Record<string, string | number>) => string;

/**
 * Lower-case status word for use inside a translated sentence, e.g.
 * "Condition marked {{value}}." Covers appointment, problem, programme,
 * procedure and allergy statuses (`statusWord.<code>` in the locales). A code
 * with no key falls back to its readable form instead of showing the key.
 */
export function statusWord(t: Translate, code: string): string {
  const key = `statusWord.${code}`;
  const word = t(key);
  return word === key ? code.replace(/_/g, ' ') : word;
}
