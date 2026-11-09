import { readFileSync } from 'fs';
import { join } from 'path';

// The Actions menu used to ignore Escape (only a backdrop click closed it).
describe('ChartHeader actions menu', () => {
  const src = readFileSync(join(__dirname, '../../components/ehr/chart/ChartHeader.tsx'), 'utf8');
  it('closes on Escape while open', () => {
    expect(src).toMatch(/e\.key === 'Escape'\) setMenuOpen\(false\)/);
    expect(src).toMatch(/if \(!menuOpen\) return;/);
  });
});
