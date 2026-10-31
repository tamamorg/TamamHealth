/**
 * A filed result: the bell tells the orderer, so the lab has nothing left to
 * send, and the review the portal releases on belongs to the clinician alone.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (path: string) => readFileSync(join(process.cwd(), 'src', path), 'utf8');
const steps = read('components/lab/workflow/steps/LabSteps.tsx');
const panel = read('components/lab/workflow/LabWorkflowPanel.tsx');
const hook = read('components/lab/workflow/useLabWorkflow.ts');
const radiologyHook = read('components/radiology/workflow/useRadiologyWorkflow.ts');
const radiologySteps = read('components/radiology/workflow/steps/RadiologySteps.tsx');
const feed = read('modules/communication/hooks/useNotifications.ts');

test('the orderer hears from the bell, not a button', () => {
  expect(feed).toContain('ready to review');
  expect(hook).not.toContain('notifyClinician');
  expect(radiologyHook).not.toContain('notifyClinician');
  expect(steps).not.toContain('labFlow.handoffHeading');
});

test('only a clinician sees the review, on labs and imaging', () => {
  expect(steps).toMatch(/ctrl\.canCloseOut && \(\s*<div className="obf-section">/);
  expect(radiologySteps).toMatch(/ctrl\.canCloseOut && \(\s*<div className="labord-section">/);
  expect(steps).not.toContain('closeoutHelp');
});

test('the filed form shows the report; amending swaps in the result form', () => {
  expect(panel).toContain('{filed && !amending && <ReportStep');
  expect(panel).toContain('(!filed || amending) && <ResultStep');
  expect(panel).toContain('{filed && !amending && <FiledRecord');
  expect(panel).toContain('{!filed && <OrderStep');
});
