// ============================================
// Performance Color Scales (WHO-style red→yellow→green)
// ============================================

/**
 * Discrete 4-stop colour: red(<40), amber(40-59), gold(60-79), green(80+).
 *
 * The stops read from `--perf-*`, a sequential ramp of its own rather than the
 * three status tokens: an ordered scale needs four values a reader can tell
 * apart, and status only offers three. Pointing the middle two at the same
 * amber silently turned a 4-band score into a 3-band one.
 */
export function getPerformanceColor(value: number): string {
  if (value < 40) return 'var(--perf-critical)';
  if (value < 60) return 'var(--perf-poor)';
  if (value < 80) return 'var(--perf-fair)';
  return 'var(--perf-good)';
}

export type PerformanceMetricKey = keyof typeof METRIC_LABELS;

/** Human-readable labels for each performance metric key */
export const METRIC_LABELS = {
  reportingCompleteness: 'Reporting',
  serviceReadinessScore: 'Readiness',
  tracerMedicineAvailability: 'Medicines',
  staffingScore: 'Staffing',
  opdVisitsPerMonth: 'OPD Visits',
  ancCoverage: 'ANC Coverage',
  immunizationCoverage: 'EPI Coverage',
  stockOutDays: 'Stock-out Days',
  qualityScore: 'Quality',
} as const;
