import fs from 'node:fs';
import path from 'node:path';

const source = (relative: string) =>
  fs.readFileSync(path.join(process.cwd(), 'src', relative), 'utf8');

describe('focused triage completion', () => {
  const workflow = source('components/nurse/TriageWorkflow.tsx');
  const page = source('app/(dashboard)/triage/[patientId]/page.tsx');

  test('returns to the safe dashboard target only after a successful save', () => {
    expect(workflow).toContain('if (onSaved) onSaved();');
    expect(workflow.indexOf('if (onSaved) onSaved();')).toBeGreaterThan(workflow.indexOf("showToast(t('nurse.triageSaved'"));
    expect(page).toContain('onSaved={() => router.replace(returnToFromSearch(window.location.search, backTarget))}');
  });

  test('captures the South Sudan-relevant IITT screen and anthropometrics', () => {
    expect(workflow).toContain('IITT_RED_CRITERIA');
    expect(workflow).toContain('IITT_YELLOW_CRITERIA');
    expect(workflow).toContain('INFECTION_RISK_SIGNS');
    expect(workflow).toContain("height: triageVitals.height || undefined");
    expect(workflow).toContain('bmi: calculatedBmi || undefined');
    expect(workflow).toContain('capillaryRefillSeconds');
    expect(workflow).toContain('pregnancyStatus');
    expect(workflow).toContain('immediateInterventions');
  });
});
