import fs from 'node:fs';
import path from 'node:path';

const chartDir = path.resolve(process.cwd(), 'src/components/ehr/chart');
const chartShell = fs.readFileSync(path.join(chartDir, 'TamamChartShell.tsx'), 'utf8');
const chartCss = fs.readFileSync(path.join(chartDir, 'tamam-chart.css'), 'utf8');

describe('patient chart note workspace', () => {
  it('does not repeat the standalone note context sidebar', () => {
    expect(chartShell).toContain('showContextSidebar={false}');
  });

  it('opens wide; the header arrow closes every panel, the ✕ steps back one', () => {
    expect(chartShell).toContain('onClick={closeAllWorkspaces}');
    expect(chartShell).toContain("activePanel.id === CLINICAL_NOTE_PANEL.id || (activePanel.id === PAGE_WORKSPACE_ID && workspace?.wide) ? 'is-note-editor' : ''");
    // Docked beside the chart (it narrows the chart rather than covering it),
    // so the note gets a wide column, not the viewport.
    expect(chartCss).toMatch(/\.tamam-drawer\.is-note-editor\s*{[\s\S]*?width:\s*clamp\(480px, 50vw, 860px\)/);
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
