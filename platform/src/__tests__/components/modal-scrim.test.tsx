/**
 * The portal modal's backdrop scrim.
 *
 * Pinned because of how it broke: a brand pass find-and-replaced every
 * `rgba(15, 31, 29, …)` in the codebase with the brand green `rgba(8, 87, 58,
 * …)`. At the 0.14–0.28 alphas used for drop shadows that is invisible; this
 * one is a 70%-opacity layer over the ENTIRE viewport, so every dialog in the
 * app — Book Appointment was the reported case — washed the page behind it
 * sage green instead of dimming it.
 *
 * A scrim's job is to remove colour from what is behind it so the dialog reads
 * as the only live surface. It is deliberately near-neutral ink, and it is not
 * a brand slot.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import Modal from '@/components/Modal';

// Same switch the boot-integrity guard's test flips: React 19 warns on every
// act() call without it.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderModal() {
  act(() => {
    root.render(<Modal onClose={() => {}}><p>body</p></Modal>);
  });
  const backdrop = document.querySelector<HTMLElement>('.modal-portal-backdrop');
  if (!backdrop) throw new Error('backdrop did not render');
  return backdrop;
}

/** rgb/rgba channels, whatever spacing the DOM normalises the value to. */
function channels(color: string): [number, number, number] {
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`not an rgb(a) colour: ${color}`);
  const [r, g, b] = m[1].split(',').map(part => Number(part.trim()));
  return [r, g, b];
}

describe('modal backdrop scrim', () => {
  it('marks the viewport-bounded dialog for shared tablet alignment', () => {
    const backdrop = renderModal();
    const dialog = backdrop.querySelector<HTMLElement>('.modal-portal-dialog');

    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.style.width).toBe('100%');
  });

  it('centres the dialog below app chrome and bounds both viewport edges', () => {
    const backdrop = renderModal();
    const dialog = backdrop.querySelector<HTMLElement>('.modal-portal-dialog');

    expect(backdrop.style.alignItems).toBe('center');
    expect(backdrop.style.padding).toContain('var(--app-overlay-top-inset, 0px)');
    expect(dialog?.style.maxHeight).toContain('100dvh - 32px');
    expect(dialog?.style.maxHeight).toContain('var(--app-overlay-top-inset, 0px)');
    expect(dialog?.style.margin).toBe('0px');
  });

  it('dims with near-neutral ink rather than a brand hue', () => {
    const backdrop = renderModal();
    const [r, g, b] = channels(backdrop.style.background || backdrop.style.backgroundColor);

    // Near-neutral: no channel may run away from the others the way a brand
    // colour does. Green at rgb(8, 87, 58) spreads 79; this spreads 16.
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    expect(spread).toBeLessThan(24);
    // And dark enough to actually dim the page behind it.
    expect(Math.max(r, g, b)).toBeLessThan(60);
  });

  it('keeps the scrim opaque enough to separate dialog from page', () => {
    const backdrop = renderModal();
    const alpha = Number((backdrop.style.background || backdrop.style.backgroundColor).match(/rgba?\([^)]*,\s*([\d.]+)\)/)?.[1] ?? '1');
    expect(alpha).toBeGreaterThanOrEqual(0.6);
    expect(alpha).toBeLessThanOrEqual(0.8);
  });
});
