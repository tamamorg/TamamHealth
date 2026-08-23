/**
 * How many units a prescription's full course needs.
 *
 * The dispense workflow used to read `rx.quantityToDispense || 1` — and only
 * ONE of the prescribing surfaces (the clinical-notes PrescribeModal, which has
 * an explicit quantity field) ever set that field. Every prescription written
 * from the chart header or the consultation flow fell through to the literal 1:
 * a "1000 mg TDS × 3 days" course — eighteen 500 mg tablets — sailed through a
 * green stock check reading "1 needed", dispensed one tablet, and deducted one
 * from inventory. The workflow looked complete; the patient left with a
 * eighteenth of their course and the stock ledger drifted seventeen tablets per
 * course. Found live on the first dispense of a fresh tenant.
 *
 * The estimate multiplies three parses, each with an honest fallback:
 *
 *   units per dose  ← dose amount ÷ strength in the medication name
 *                     ("1000 mg" ÷ "Paracetamol 500mg" = 2); 1 when either
 *                     side is missing or their units differ
 *   doses per day   ← the frequency code (OD 1 · BD 2 · TDS 3 · QDS 4 · "every
 *                     N hours" → 24/N); 1 when unrecognised
 *   days            ← the leading number of the duration ("3", "3 days",
 *                     "5 days — take after meals"); 1 when missing
 *
 * A liquid ("5 ml TDS", strength "125mg/5ml") or anything else unparseable
 * degrades to the same per-field fallbacks, never to an error: the estimate is
 * a floor for the stock gate and the deduction, and the pharmacist can always
 * dispense a different amount deliberately. An explicit `quantityToDispense`
 * on the document always wins — it is the prescriber's own answer.
 */

export interface CourseQuantityInput {
  medication?: string;
  dose?: string;
  frequency?: string;
  duration?: string;
  quantityToDispense?: number;
}

/** "every 6 hours", "q6h", "6 hourly" → 6. */
const EVERY_N_HOURS = /(?:every\s+(\d{1,2})\s*(?:hours|hrs|h)\b|q\s*(\d{1,2})\s*h\b|(\d{1,2})\s*hourly)/i;

/** Doses per day for the frequency vocabularies the prescribe forms offer. */
export function dosesPerDay(frequency: string | undefined): number {
  if (!frequency) return 1;
  const f = frequency.toUpperCase();
  if (/\bQDS\b|\bQID\b|FOUR TIMES/.test(f)) return 4;
  if (/\bTDS\b|\bTID\b|THREE TIMES/.test(f)) return 3;
  if (/\bBD\b|\bBID\b|TWICE/.test(f)) return 2;
  if (/\bOD\b|\bONCE\b|DAILY|NOCTE|\bON\b|MANE/.test(f)) return 1;
  const hours = frequency.match(EVERY_N_HOURS);
  if (hours) {
    const n = Number(hours[1] || hours[2] || hours[3]);
    if (n >= 1 && n <= 24) return Math.max(1, Math.round(24 / n));
  }
  return 1;
}

/** Leading day-count of a duration note ("3", "3 days", "5 days — after meals"). */
export function courseDays(duration: string | undefined): number {
  if (!duration) return 1;
  const m = duration.match(/(\d+(?:\.\d+)?)\s*(week|wk)?/i);
  if (!m) return 1;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return m[2] ? Math.round(n * 7) : Math.round(n);
}

/** First amount+unit in a string: "1000 mg" → {1000,'mg'}; null when absent. */
function parseAmount(text: string | undefined): { value: number; unit: string } | null {
  if (!text) return null;
  const m = text.match(/(\d+(?:\.\d+)?)\s*(mg|mcg|µg|g|ml|iu|units?)\b/i);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  let unit = m[2].toLowerCase();
  if (unit === 'µg') unit = 'mcg';
  if (unit === 'units') unit = 'unit';
  return { value, unit };
}

/** Units per single dose — dose amount over the strength in the name. */
export function unitsPerDose(medication: string | undefined, dose: string | undefined): number {
  const doseAmt = parseAmount(dose);
  const strength = parseAmount(medication);
  if (!doseAmt || !strength || doseAmt.unit !== strength.unit) return 1;
  const ratio = doseAmt.value / strength.value;
  if (!Number.isFinite(ratio) || ratio <= 0) return 1;
  // Ceil: half a tablet still costs a tablet from stock.
  return Math.max(1, Math.ceil(ratio));
}

export function estimateCourseQuantity(rx: CourseQuantityInput): number {
  if (typeof rx.quantityToDispense === 'number' && rx.quantityToDispense > 0) {
    return Math.round(rx.quantityToDispense);
  }
  return unitsPerDose(rx.medication, rx.dose) * dosesPerDay(rx.frequency) * courseDays(rx.duration);
}
