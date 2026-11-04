/**
 * Whether a free-text qualitative result reads as positive.
 *
 * The negative forms contain the positive words ("Non-reactive" contains
 * "reactive", "Not detected" contains "detected"), so they are ruled out
 * first. A plain substring test counted every negative HIV rapid test and
 * every suppressed viral load as positive in the HIV programme report.
 */
const NEGATIVE = /\b(non[-\s]?reactive|not\s+detected|undetect(?:ed|able)|negative|nil|absent)\b/i;
const POSITIVE = /\b(positive|reactive|detected)\b/i;

export function isPositiveResult(result: string | null | undefined): boolean {
  const text = (result || '').trim();
  if (!text || NEGATIVE.test(text)) return false;
  return POSITIVE.test(text);
}
