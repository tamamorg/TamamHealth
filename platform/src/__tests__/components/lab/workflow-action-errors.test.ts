/**
 * A failed lab, pharmacy or radiology step names its real reason. The panels read the
 * error right after the action resolves, when React state still holds the
 * previous render's value, so they must read the ref the hook writes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(process.cwd(), 'src', path), 'utf8');

describe.each([
  ['lab', 'components/lab/workflow/LabWorkflowPanel.tsx', 'components/lab/workflow/useLabWorkflow.ts'],
  ['pharmacy', 'components/pharmacy/workflow/PharmacyWorkflowPanel.tsx', 'components/pharmacy/workflow/usePharmacyWorkflow.ts'],
  ['radiology', 'components/radiology/workflow/RadiologyWorkflowPanel.tsx', 'components/radiology/workflow/useRadiologyWorkflow.ts'],
])('%s workflow toast', (_name, panel, hook) => {
  it('reads the latest error, not the stale render value', () => {
    expect(read(panel)).toContain('ctrl.lastError.current');
    expect(read(panel)).not.toContain('t(ctrl.error');
    expect(read(hook)).toContain('lastError.current = message');
  });

  it('shows a step outcome in the corner toast', () => {
    expect(read(panel)).toContain("{ placement: 'corner' }");
  });
});
