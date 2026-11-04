import fs from 'node:fs';
import path from 'node:path';

const chartDir = path.resolve(process.cwd(), 'src/components/ehr/chart');
const chartShell = fs.readFileSync(path.join(chartDir, 'TamamChartShell.tsx'), 'utf8');
const chartCss = fs.readFileSync(path.join(chartDir, 'tamam-chart.css'), 'utf8');

describe('patient chart note workspace', () => {
  it('does not repeat the standalone note context sidebar', () => {
    expect(chartShell).toContain('showContextSidebar={false}');
  });

  it('takes the one chart slider size; × closes completely, → (Hide) only when there is somewhere to go back to', () => {
    expect(chartShell).toContain('onClick={() => void dismiss(closeAllWorkspaces)}><X />');
    expect(chartShell).toMatch(/\(innerBack \|\| stack\.length > 1\) && \(\s*<Tooltip content=\{t\('overlay\.hide'\)\}>/);
    // No Back on the left any more.
    expect(chartShell).not.toContain('tamam-drawer-back');
    expect(chartShell).not.toContain('tamam-drawer-leave');
    // Docked beside the chart (it narrows the chart rather than covering it).
    expect(chartCss).toMatch(/\.tamam-drawer\s*{[\s\S]*?width:\s*min\(var\(--chart-slider-w\), 100vw\)/);
    expect(chartShell).not.toContain('DrawerResizeHandle');
  });

  it('asks before a half-filled order is lost, whichever way the drawer closes', () => {
    for (const leaving of ['togglePanel', 'closeDrawer', 'closeAllWorkspaces']) {
      expect(chartShell).toMatch(new RegExp(`const ${leaving} = async [\\s\\S]*?if \\(!await leaveOrderForm\\(\\)\\) return;`));
    }
    expect(chartShell).toContain('formEditedRef={orderFormEditedRef}');
  });

  it('notes have no page of their own: expand stays in the chart, /notes/[id] opens the chart', () => {
    expect(chartShell).not.toMatch(/router\.push\(`\/notes\//);
    const notePage = fs.readFileSync(path.resolve(process.cwd(), 'src/app/(dashboard)/notes/[id]/page.tsx'), 'utf8');
    expect(notePage).toContain('router.replace(`/patients/');
    expect(notePage).toContain('?note=');
    expect(notePage).not.toContain('ClinicalNoteEditor');
  });

  it('opens notes as O3 forms with a way back to the forms list', () => {
    expect(chartShell).toContain('layout="workspace"');
    expect(chartShell).toContain('onBack={closeDrawer}');
  });

  it('stacks workspaces: closing the top one reveals the one beneath', () => {
    expect(chartShell).toContain('setStack(prev => prev.slice(0, -1))');
    expect(chartShell).toMatch(/prev\.filter\(e => !\(e\.kind === 'rail' && e\.id === entry\.id\)\)/);
  });
});
