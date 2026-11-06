/**
 * The chart "Lab results" form (StructuredFormPanel) used to save every lab
 * result with abnormal:false, critical:false hardcoded, so a critical value
 * entered from the chart raised no critical-result task, no review-SLA
 * escalation, and the checkout/portal gates passed (security/data audit
 * 2026-11-05, §2.1 #4). It now flags the panel through the same critical-value
 * table the lab dashboard uses. This exercises that exact computation.
 */
import { buildLabObservations, CHEMISTRY_PROFILE } from '@/components/lab/workflow/lab-result-catalog';
import { evaluateCriticalObservations, flagLabResult } from '@/lib/services/lab-critical-flag';

// Mirror the component: build the observations, then compute the two flags.
function flagsFor(answers: Record<string, string>) {
  const observations = buildLabObservations(CHEMISTRY_PROFILE, answers);
  const critical = evaluateCriticalObservations(observations).isCriticalValue;
  const abnormal = critical || observations.some(o => flagLabResult(o.label, o.value).abnormal);
  return { critical, abnormal, observations };
}

describe('chart lab-results form flags values', () => {
  it('a critically high serum potassium is flagged critical (and abnormal)', () => {
    const { critical, abnormal, observations } = flagsFor({ 'chem.potassium': '7.2' });
    expect(observations.length).toBeGreaterThan(0);
    expect(critical).toBe(true);
    expect(abnormal).toBe(true);
  });

  it('an in-range serum potassium is neither critical nor abnormal', () => {
    const { critical, abnormal } = flagsFor({ 'chem.potassium': '4.2' });
    expect(critical).toBe(false);
    expect(abnormal).toBe(false);
  });
});
