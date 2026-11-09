/**
 * The chart dialog skin outlines `.btn-secondary` on hover with blue ink. On
 * the filled slider footer (white label on slate) that left a blue label on
 * slate for the focused Cancel / Back button. A footer-specific hover rule
 * must keep the label white.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

describe('slider footer secondary buttons', () => {
  const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8');

  it('keeps the label white on hover inside .tamam-dialog', () => {
    const m = css.match(
      /\.tamam-dialog \.tm-dialog__foot > :is\(\.btn-secondary, \.btn-ghost, \.btn-outline\):hover:not\(:disabled\) \{([^}]*)\}/,
    );
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/color:\s*#fff/);
  });
});
