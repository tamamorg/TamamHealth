import fs from 'node:fs';
import path from 'node:path';

const chartDir = path.resolve(process.cwd(), 'src/components/ehr/chart');
const chartShell = fs.readFileSync(path.join(chartDir, 'TamamChartShell.tsx'), 'utf8');
const chartCss = fs.readFileSync(path.join(chartDir, 'tamam-chart.css'), 'utf8');

describe('patient chart note workspace', () => {
  it('does not repeat the standalone note context sidebar', () => {
    expect(chartShell).toContain('showContextSidebar={false}');
  });

  it('opens wide and expands to the entire viewport', () => {
    expect(chartShell).toContain("activePanel.id === CLINICAL_NOTE_PANEL.id ? 'is-note-editor' : ''");
    expect(chartCss).toMatch(/\.tamam-drawer\.is-note-editor\s*{[\s\S]*?width:\s*min\(960px, 92vw\)/);
    expect(chartCss).toMatch(/\.tamam-drawer\.is-maximized\s*{[\s\S]*?width:\s*100vw/);
  });
});
