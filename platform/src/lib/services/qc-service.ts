/**
 * Laboratory QC service — implements a working subset of the
 * Westgard rules used to detect bench instrument drift before patient
 * samples are released.
 *
 * Rules implemented:
 *   1_3s   — single QC observation outside ±3 SD              → REJECT
 *   1_2s   — single QC observation outside ±2 SD              → WARNING
 *   2_2s   — two consecutive observations outside same ±2 SD  → REJECT
 *   R_4s   — range of two consecutive observations > 4 SD     → REJECT
 *   4_1s   — four consecutive observations on same side of 1 SD → REJECT
 *   10_x   — ten consecutive observations on same side of mean → REJECT
 *
 * A QC run is "in control" when no REJECT rule fires. WARNING fires
 * 1_2s alone — bench may proceed but the run is flagged for review.
 *
 * The service does not (yet) persist its own QC docs — it's a pure
 * validator the lab UI can call after each control measurement and
 * surface the verdict alongside the patient result.
 */

export type WestgardRule = '1_3s' | '1_2s' | '2_2s' | 'R_4s' | '4_1s' | '10_x';
export type QCVerdict = 'in_control' | 'warning' | 'out_of_control';

export interface QCMeasurement {
  /** ISO timestamp of the measurement */
  at: string;
  /** Numeric measured value */
  value: number;
}

export interface QCEvaluation {
  verdict: QCVerdict;
  triggered: WestgardRule[];
  zScore: number;          // current observation in standard-deviation units
  message: string;         // human-readable summary for the bench UI
}

export interface QCConfig {
  /** Mean of the in-control distribution (set during method validation). */
  targetMean: number;
  /** Standard deviation of the in-control distribution. */
  targetSD: number;
  /** Optional history of prior measurements for multi-rule evaluation. */
  history?: QCMeasurement[];
}

/**
 * Run all six Westgard rules against the latest measurement plus history.
 * `history` should be ordered oldest → newest, EXCLUDING the new measurement.
 */
export function evaluateWestgard(
  newMeasurement: QCMeasurement,
  config: QCConfig,
): QCEvaluation {
  const { targetMean, targetSD } = config;
  const history = config.history || [];
  if (targetSD <= 0) {
    return {
      verdict: 'out_of_control',
      triggered: [],
      zScore: 0,
      message: 'Cannot evaluate QC — targetSD must be greater than zero.',
    };
  }

  const zOf = (v: number) => (v - targetMean) / targetSD;
  const newZ = zOf(newMeasurement.value);
  const series = [...history, newMeasurement].map(m => zOf(m.value));
  const triggered: WestgardRule[] = [];

  // 1_3s — last z outside ±3 SD
  if (Math.abs(newZ) >= 3) triggered.push('1_3s');

  // 1_2s — last z outside ±2 SD (warning rule)
  if (Math.abs(newZ) >= 2) triggered.push('1_2s');

  // 2_2s — last two on same side, both > 2 SD same direction
  if (series.length >= 2) {
    const a = series[series.length - 2];
    const b = series[series.length - 1];
    if (Math.sign(a) === Math.sign(b) && Math.abs(a) >= 2 && Math.abs(b) >= 2) {
      triggered.push('2_2s');
    }
  }

  // R_4s — range between last two > 4 SD (one positive, one negative)
  if (series.length >= 2) {
    const a = series[series.length - 2];
    const b = series[series.length - 1];
    if (Math.abs(a - b) >= 4) triggered.push('R_4s');
  }

  // 4_1s — last four all on same side of 1 SD
  if (series.length >= 4) {
    const last4 = series.slice(-4);
    if (last4.every(z => z >= 1) || last4.every(z => z <= -1)) {
      triggered.push('4_1s');
    }
  }

  // 10_x — last ten all on same side of the mean
  if (series.length >= 10) {
    const last10 = series.slice(-10);
    if (last10.every(z => z > 0) || last10.every(z => z < 0)) {
      triggered.push('10_x');
    }
  }

  // Verdict logic
  const rejectFired = triggered.some(r => r !== '1_2s');
  const warnFired = triggered.includes('1_2s');
  const verdict: QCVerdict = rejectFired ? 'out_of_control' : warnFired ? 'warning' : 'in_control';

  let message: string;
  if (verdict === 'in_control') {
    message = `In control (z = ${newZ.toFixed(2)}). Safe to release patient results.`;
  } else if (verdict === 'warning') {
    message = `Warning (1_2s, z = ${newZ.toFixed(2)}). Run permitted but flagged for review.`;
  } else {
    const ruleList = triggered.filter(r => r !== '1_2s').join(', ');
    message = `Out of control — rules fired: ${ruleList}. Investigate before releasing patient results.`;
  }

  return { verdict, triggered, zScore: newZ, message };
}

/**
 * Convenience helper: evaluate a numeric patient result against the
 * configured reference range and return whether it counts as a critical
 * value that warrants an SMS alert to the ordering clinician.
 */
export interface CriticalValueRule {
  testName: string;
  /** Either a low cutoff, high cutoff, or both. */
  criticalLow?: number;
  criticalHigh?: number;
  /** Free-text rationale (e.g. "Hemorrhagic anemia risk"). */
  rationale?: string;
}

export function isCritical(value: number, rule: CriticalValueRule): boolean {
  if (rule.criticalLow != null && value <= rule.criticalLow) return true;
  if (rule.criticalHigh != null && value >= rule.criticalHigh) return true;
  return false;
}

/**
 * Default critical-value table for South Sudan reference labs.
 * Sourced from WHO basic lab handbook + KEMRI critical-value list.
 */
export const DEFAULT_CRITICAL_VALUES: CriticalValueRule[] = [
  { testName: 'Hemoglobin (g/dL)',           criticalLow: 5,    criticalHigh: 20,   rationale: 'Severe anemia / polycythemia' },
  { testName: 'White Blood Cell (×10⁹/L)',   criticalLow: 1,    criticalHigh: 50,   rationale: 'Severe leukopenia / leukemoid' },
  { testName: 'Platelets (×10⁹/L)',          criticalLow: 20,   criticalHigh: 1000, rationale: 'Bleeding risk / thrombosis' },
  { testName: 'Glucose (mmol/L)',            criticalLow: 2.2,  criticalHigh: 25,   rationale: 'Hypoglycemia / DKA' },
  { testName: 'Potassium (mmol/L)',          criticalLow: 2.8,  criticalHigh: 6.5,  rationale: 'Cardiac arrhythmia risk' },
  { testName: 'Sodium (mmol/L)',             criticalLow: 120,  criticalHigh: 160,  rationale: 'Severe hypo/hypernatremia' },
  { testName: 'Calcium (mmol/L)',            criticalLow: 1.5,  criticalHigh: 3.5,  rationale: 'Tetany / arrhythmia' },
  { testName: 'INR',                         criticalHigh: 5,                       rationale: 'Bleeding risk on anticoagulants' },
  { testName: 'Creatinine (µmol/L)',         criticalHigh: 600,                     rationale: 'Acute kidney injury' },
  { testName: 'Lactate (mmol/L)',            criticalHigh: 4,                       rationale: 'Severe sepsis / shock' },
  { testName: 'Lithium (mmol/L)',            criticalHigh: 1.5,                     rationale: 'Lithium toxicity' },
  { testName: 'Digoxin (ng/mL)',             criticalHigh: 2.5,                     rationale: 'Digoxin toxicity' },
];
