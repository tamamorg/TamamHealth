/**
 * Bridge between the lab result-entry UI and the QC service's critical-value
 * table. The lab UI carries free-text test names ("Full Blood Count",
 * "Hemoglobin (g/dL)") and string-typed result values, while
 * `DEFAULT_CRITICAL_VALUES` keys on a friendly analyte name with numeric
 * thresholds. These helpers do the fuzzy name match and numeric coercion so
 * the page can flag critical values without duplicating QC logic.
 *
 * Two shapes of result reach this module:
 *   - a PLAIN single value ("Hemoglobin" → "4.1") — `evaluateCritical`.
 *   - STRUCTURED observations from a panel (Full Blood Count, Chemistry,
 *     Urinalysis, Stool — see `lab-result-catalog.ts`), where every analyte
 *     is its own labelled, unit-tagged field — `evaluateCriticalObservations`.
 * Both funnel through the same `matchCriticalRule` name match and `isCritical`
 * threshold check, so there is exactly one place that decides what counts as
 * a critical value.
 */
import { DEFAULT_CRITICAL_VALUES, isCritical, type CriticalValueRule } from './qc-service';

/**
 * Match a free-text lab test name against the QC critical-value table by
 * comparing the leading analyte word in either direction (so "Hemoglobin",
 * "Hemoglobin (g/dL)" and "Full Blood Count — Hemoglobin" all resolve).
 *
 * This is also what structured-observation matching uses, passing an
 * observation's label ("White blood cells (WBC)") in place of a test name —
 * the comparison is the same free-text fuzzy match either way.
 */
export function matchCriticalRule(testName: string): CriticalValueRule | undefined {
  const name = (testName || '').toLowerCase();
  if (!name) return undefined;
  return DEFAULT_CRITICAL_VALUES.find(rule => {
    const analyte = rule.testName.split(' (')[0].toLowerCase();
    return name.includes(analyte) || analyte.includes(name);
  });
}

export interface CriticalCheck {
  rule?: CriticalValueRule;
  isCriticalValue: boolean;
}

/**
 * Run an entered result value through the matched critical-value rule. Only
 * numeric values are evaluated — qualitative results return not-critical.
 */
export function evaluateCritical(testName: string, value: string): CriticalCheck {
  const rule = matchCriticalRule(testName);
  if (!rule) return { isCriticalValue: false };
  const num = parseFloat(value);
  if (!Number.isFinite(num)) return { rule, isCriticalValue: false };
  return { rule, isCriticalValue: isCritical(num, rule) };
}

/** Extract the unit a rule's name encodes, e.g. "Hemoglobin (g/dL)" → "g/dL". */
function ruleUnit(rule: CriticalValueRule): string | undefined {
  return rule.testName.match(/\(([^)]+)\)/)?.[1];
}

/**
 * Unit spellings that are numerically identical despite different notation.
 * WBC and platelet counts are the one place the catalogue's unit (`10³/µL`)
 * and the QC table's unit (`×10⁹/L`) disagree in spelling while meaning the
 * exact same number — 10⁹ per litre is 10³ per microlitre by definition, so
 * these need no conversion factor, just recognising they're the same unit.
 */
const UNIT_EQUIVALENCE_GROUPS: string[][] = [
  ['x10^9/l', '10^3/ul'],
];

function normalizeUnit(raw?: string): string {
  return (raw || '')
    .toLowerCase()
    .replace(/[µμ]/g, 'u')
    .replace(/×/g, 'x')
    .replace(/⁹/g, '^9')
    .replace(/³/g, '^3')
    .replace(/\s+/g, '');
}

function canonicalUnit(raw?: string): string {
  const normalized = normalizeUnit(raw);
  if (!normalized) return '';
  const group = UNIT_EQUIVALENCE_GROUPS.find(members => members.includes(normalized));
  return group ? group[0] : normalized;
}

/**
 * Whether an observation's recorded unit and the rule's expected unit can be
 * compared directly. Neither side is converted — that mirrors `evaluateCritical`,
 * which never looks at units at all — this only decides whether the two
 * numbers mean the same thing before comparing them. A rule with no unit in
 * its name (only "INR" today) can't disagree with anything; an observation
 * with no recorded unit is given the benefit of the doubt.
 *
 * This is what stops, say, a fasting glucose entered in mg/dL (chemistry
 * panels carry several glucose fields in different units) from being checked
 * against the Glucose rule's mmol/L thresholds — 90 mg/dL is normal, but read
 * as 90 mmol/L it would blow past the critical-high cutoff of 25.
 */
function unitsCompatible(observedUnit: string | undefined, expectedUnit: string | undefined): boolean {
  if (!expectedUnit || !observedUnit) return true;
  return canonicalUnit(observedUnit) === canonicalUnit(expectedUnit);
}

/** Which bound an observation breached, formatted for display next to it. */
function describeBreach(value: number, rule: CriticalValueRule): string | undefined {
  if (rule.criticalLow != null && value <= rule.criticalLow) return `≤ ${rule.criticalLow}`;
  if (rule.criticalHigh != null && value >= rule.criticalHigh) return `≥ ${rule.criticalHigh}`;
  return undefined;
}

export interface CriticalObservationInput {
  /** Catalogue field id, e.g. `cbc.hemoglobin`. */
  id: string;
  /** Human-readable analyte name, matched the same way a plain test name is. */
  label: string;
  value: string;
  unit?: string;
}

export interface CriticalObservationHit extends CriticalObservationInput {
  rule: CriticalValueRule;
  /** e.g. "≥ 6.0" — the bound that tripped, for a "Potassium 6.8 (≥ 6.0)" line. */
  comparison: string;
}

export interface ObservationsCriticalCheck {
  isCriticalValue: boolean;
  /** Every observation that tripped a threshold, in input order. */
  hits: CriticalObservationHit[];
}

/**
 * The structured-panel sibling of `evaluateCritical`: run every analyte in a
 * Full Blood Count / Chemistry / Urinalysis / Stool draft through the same
 * critical-value table, instead of the single plain result field. A draft is
 * critical overall if ANY observation is — one deranged electrolyte in an
 * otherwise-normal chemistry panel is still a phone call.
 *
 * An observation with no matching rule (unknown analyte), a non-numeric
 * value, or a unit that doesn't match what the rule expects is skipped
 * without flagging — silence here means "not evaluable", never "safe".
 */
export function evaluateCriticalObservations(
  observations: CriticalObservationInput[],
): ObservationsCriticalCheck {
  const hits: CriticalObservationHit[] = [];
  for (const observation of observations) {
    const rule = matchCriticalRule(observation.label);
    if (!rule) continue;
    if (!unitsCompatible(observation.unit, ruleUnit(rule))) continue;
    const num = parseFloat(observation.value);
    if (!Number.isFinite(num)) continue;
    const comparison = describeBreach(num, rule);
    if (comparison) hits.push({ ...observation, rule, comparison });
  }
  return { isCriticalValue: hits.length > 0, hits };
}
