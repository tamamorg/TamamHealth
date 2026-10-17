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

// ===== Reference ranges + one-call result flagging =====

/**
 * Normal ranges for the single-value tests the lab dashboard's batch-entry
 * screen accepts. `unit` is what a technician types the result in; critical
 * thresholds are NOT stored here — they come from `DEFAULT_CRITICAL_VALUES`
 * (via `ruleName`), converted with `toRuleUnit`, so the dashboard and the
 * result-entry workflow can never disagree about what is critical.
 */
export interface LabReferenceRange {
  /** Matched case-insensitively as a substring of the order's test name. */
  test: string;
  unit: string;
  normalMin?: number;
  normalMax?: number;
  /** Qualitative tests: every result the entry picker offers. */
  qualitative?: string[];
  /** Qualitative tests: the subset of `qualitative` that reads as normal. */
  normalValues?: string[];
  /** QC rule to take critical thresholds from (matched like a test name). */
  ruleName?: string;
  /** Multiply an entered value by this to get the QC rule's unit. */
  toRuleUnit?: number;
  referenceStr: string;
}

export const LAB_REFERENCE_RANGES: LabReferenceRange[] = [
  { test: 'Hemoglobin', unit: 'g/dL', normalMin: 12, normalMax: 17, ruleName: 'Hemoglobin', toRuleUnit: 1, referenceStr: '12-17 g/dL' },
  // ×10⁹/L = 10³/µL, so /µL ÷ 1000 lands in the rule's unit.
  { test: 'WBC', unit: '/μL', normalMin: 4000, normalMax: 11000, ruleName: 'White Blood Cell', toRuleUnit: 1 / 1000, referenceStr: '4000-11000 /μL' },
  { test: 'Platelet', unit: '/μL', normalMin: 150000, normalMax: 400000, ruleName: 'Platelets', toRuleUnit: 1 / 1000, referenceStr: '150000-400000 /μL' },
  // 1 mmol/L glucose = 18 mg/dL.
  { test: 'Blood Glucose', unit: 'mg/dL', normalMin: 70, normalMax: 140, ruleName: 'Glucose', toRuleUnit: 1 / 18, referenceStr: '70-140 mg/dL' },
  // 1 mg/dL creatinine = 88.4 µmol/L.
  { test: 'Creatinine', unit: 'mg/dL', normalMin: 0.6, normalMax: 1.2, ruleName: 'Creatinine', toRuleUnit: 88.4, referenceStr: '0.6-1.2 mg/dL' },
  // Glycated haemoglobin; no QC critical rule, so it flags abnormal at most.
  { test: 'HbA1c', unit: '%', normalMin: 4, normalMax: 5.6, referenceStr: '4.0-5.6 %' },
  { test: 'Malaria RDT', unit: '', qualitative: ['Positive', 'Negative'], normalValues: ['Negative'], referenceStr: 'Negative' },
  { test: 'HIV', unit: '', qualitative: ['Reactive', 'Non-reactive'], normalValues: ['Non-reactive'], referenceStr: 'Non-reactive' },
];

export function getLabReferenceRange(testName: string): LabReferenceRange | undefined {
  const name = (testName || '').toLowerCase();
  return LAB_REFERENCE_RANGES.find(r => name.includes(r.test.toLowerCase()));
}

/** Critical bounds for a range, expressed in the range's own entry unit. */
export function criticalBoundsInEntryUnit(range: LabReferenceRange): { low?: number; high?: number } {
  const rule = range.ruleName ? matchCriticalRule(range.ruleName) : undefined;
  if (!rule) return {};
  const factor = range.toRuleUnit ?? 1;
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    low: rule.criticalLow != null ? round(rule.criticalLow / factor) : undefined,
    high: rule.criticalHigh != null ? round(rule.criticalHigh / factor) : undefined,
  };
}

/** '' = not evaluated: no range to judge against, so no claim either way. */
export type LabFlag = 'NORMAL' | 'ABNORMAL' | 'CRITICAL' | '';

/**
 * Flag a single entered result: critical per the QC table (inclusive bounds,
 * unit-converted), otherwise abnormal outside the normal range. A test with no
 * normal range (a panel such as Full Blood Count, or an unlisted analyte) is
 * never called NORMAL — a green pill there would vouch for a value nothing
 * checked. It can still be flagged CRITICAL when the QC table knows it.
 */
export function flagLabResult(testName: string, value: string): { flag: LabFlag; abnormal: boolean; critical: boolean } {
  const normal = { flag: 'NORMAL' as const, abnormal: false, critical: false };
  const range = getLabReferenceRange(testName);
  if (!range) {
    return evaluateCritical(testName, value).isCriticalValue
      ? { flag: 'CRITICAL', abnormal: true, critical: true }
      : { flag: '', abnormal: false, critical: false };
  }

  if (range.normalValues) {
    const v = value.trim().toLowerCase();
    return range.normalValues.some(n => n.toLowerCase() === v)
      ? normal
      : { flag: 'ABNORMAL', abnormal: true, critical: false };
  }

  const num = parseFloat(value);
  if (!Number.isFinite(num)) return { flag: '', abnormal: false, critical: false };

  const rule = range.ruleName ? matchCriticalRule(range.ruleName) : undefined;
  if (rule && isCritical(num * (range.toRuleUnit ?? 1), rule)) {
    return { flag: 'CRITICAL', abnormal: true, critical: true };
  }
  if (range.normalMin !== undefined && num < range.normalMin) return { flag: 'ABNORMAL', abnormal: true, critical: false };
  if (range.normalMax !== undefined && num > range.normalMax) return { flag: 'ABNORMAL', abnormal: true, critical: false };
  return normal;
}
