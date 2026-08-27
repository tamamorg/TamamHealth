import { formatVitals } from '@/lib/clinical-notes/chart-snapshot';

describe('triage vitals clinical-note snapshot', () => {
  test('includes triage height and derived BMI alongside weight', () => {
    const text = formatVitals({
      triageVitals: { weight: '65', height: '170', bmi: '22.5' },
    });

    expect(text).toContain('Wt: 65 kg');
    expect(text).toContain('Ht: 170 cm');
    expect(text).toContain('BMI: 22.5');
  });
});
