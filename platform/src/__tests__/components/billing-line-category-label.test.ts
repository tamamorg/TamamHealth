import { readFileSync } from 'fs';
import { join } from 'path';

// A bed charge showed its stored code ("bed_charge") under the visit line.
describe('billing line categories', () => {
  const src = readFileSync(join(__dirname, '../../components/patients/BillingTab.tsx'), 'utf8');
  it('turns stored category codes into plain words', () => {
    expect(src).toMatch(/line\.categories\.map\(c => c\.replace\(\/_\/g, ' '\)\)/);
  });
});
