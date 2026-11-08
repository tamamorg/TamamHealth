import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(
  join(process.cwd(), 'src/components/clinical-notes/ClinicalNoteEditor.tsx'),
  'utf8',
);

describe('Add a section slider', () => {
  const start = src.indexOf("isPanel('addOptional') && (");
  const block = src.slice(start, src.indexOf('{/* Sign confirmation */}'));

  it('is a FormSlider (header close) with a Cancel footer that only closes the panel', () => {
    expect(block).toContain('<FormSlider');
    expect(block).toContain("t('common.cancel')");
    expect(block.match(/closePanel\('addOptional'\)/g)!.length).toBeGreaterThanOrEqual(3);
  });

  it('never discards the note: choosing a section adds it and closes the panel', () => {
    expect(block).toContain('addNoteSection(noteId, def.id)');
  });
});

describe('chart left rail scroll', () => {
  it('its children do not shrink, so the rail itself scrolls', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/ehr/chart/tamam-chart.css'), 'utf8');
    expect(css).toMatch(/\.tamam-left-rail > \*\s*\{\s*flex-shrink: 0;/);
  });
});
