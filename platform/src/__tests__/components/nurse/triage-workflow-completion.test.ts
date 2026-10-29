import fs from 'node:fs';
import path from 'node:path';

const source = (relative: string) =>
  fs.readFileSync(path.join(process.cwd(), 'src', relative), 'utf8');

describe('focused triage completion', () => {
  // The workflow is split across TriageWorkflow.tsx and components/nurse/triage/*.
  const workflowDir = path.join(process.cwd(), 'src', 'components', 'nurse', 'triage');
  const workflow = [
    source('components/nurse/TriageWorkflow.tsx'),
    ...fs.readdirSync(workflowDir).sort().map(file => source(`components/nurse/triage/${file}`)),
  ].join('\n');
  const page = source('app/(dashboard)/triage/[patientId]/page.tsx');

  test('returns to the safe dashboard target only after a successful save', () => {
    expect(workflow).toContain('if (onSaved) onSaved();');
    expect(workflow.indexOf('if (onSaved) onSaved();')).toBeGreaterThan(workflow.indexOf("showToast(t('nurse.triageSaved'"));
    expect(page).toContain('onSaved={() => router.replace(returnToFromSearch(window.location.search, backTarget))}');
  });

  test('a repeat triage saved over the open record becomes the latest assessment', () => {
    // A patient whose triage is still open is re-triaged in place (the form
    // loads the record for edit). The chart's SBAR reads the newest triage by
    // `triagedAt`, so the save must restamp when and by whom — or the handoff
    // keeps the first assessment's time and nurse — and drop the provider's
    // acknowledgement of the handoff it replaces.
    const editSave = workflow.slice(workflow.indexOf('if (editingTriageId) {'), workflow.indexOf('} else {', workflow.indexOf('if (editingTriageId) {')));
    expect(editSave).toContain('triagedAt: now');
    expect(editSave).toContain('triagedBy: currentUser?._id');
    expect(editSave).toContain('triagedByName: currentUser?.name');
    expect(editSave).toContain('acknowledgedAt: undefined');
    expect(editSave).toContain('...reassessment');
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
