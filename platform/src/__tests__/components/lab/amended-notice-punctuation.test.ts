import { readFileSync } from 'fs';
import { join } from 'path';

// The amendment reason is free text with no final full stop, so "…wrongly
// Verified by Dr. X" ran two sentences together on an approved correction.
describe('amended result notice', () => {
  const src = readFileSync(join(__dirname, '../../../components/lab/workflow/steps/LabSteps.tsx'), 'utf8');
  it('closes the reason sentence before the verified-by line', () => {
    expect(src).toMatch(/correctionVerifiedBy && !\/\[\.!\?\]\$\/\.test/);
  });
});
