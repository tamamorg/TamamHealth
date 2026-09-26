/**
 * Tooltips show on focus as well as hover, describe the control only while
 * visible, and leave on blur, Escape or a press.
 */
import { act } from 'react';
import { mount } from '../clinical-notes/test-utils';
import Tooltip from '@/components/overlay/Tooltip';

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); document.body.innerHTML = ''; });

function render() {
  const mounted = mount(
    <Tooltip content="Calendar" shortcut="C">
      <button type="button" aria-label="Calendar">c</button>
    </Tooltip>,
  );
  const button = mounted.container.querySelector<HTMLButtonElement>('button')!;
  return { ...mounted, button };
}

// React's onFocus/onBlur/onMouseEnter/onMouseLeave are driven by the
// bubbling native events below, not by the non-bubbling ones they are named for.
const NATIVE: Record<string, string> = { focus: 'focusin', blur: 'focusout', mouseenter: 'mouseover', mouseleave: 'mouseout' };
const fire = (el: Element, type: string) => act(() => {
  el.dispatchEvent(new Event(NATIVE[type] ?? type, { bubbles: true }));
  jest.advanceTimersByTime(400);
});

describe('Tooltip', () => {
  it('appears on keyboard focus after the delay and describes the control', () => {
    const { button, unmount } = render();
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
    expect(button.getAttribute('aria-describedby')).toBeNull();

    fire(button, 'focus');
    const tip = document.body.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(tip).not.toBeNull();
    expect(tip.textContent).toContain('Calendar');
    expect(tip.querySelector('.tm-tooltip__kbd')?.textContent).toBe('C');
    expect(button.getAttribute('aria-describedby')).toBe(tip.id);

    fire(button, 'blur');
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
    expect(button.getAttribute('aria-describedby')).toBeNull();
    unmount();
  });

  it('does not flash when the pointer merely crosses the control', () => {
    const { button, unmount } = render();
    act(() => {
      button.dispatchEvent(new Event('mouseover', { bubbles: true }));
      jest.advanceTimersByTime(100);
      button.dispatchEvent(new Event('mouseout', { bubbles: true }));
      jest.advanceTimersByTime(500);
    });
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
    unmount();
  });

  it('hides on Escape and on a press', () => {
    const { button, unmount } = render();
    fire(button, 'mouseenter');
    expect(document.body.querySelector('[role="tooltip"]')).not.toBeNull();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();

    fire(button, 'mouseenter');
    expect(document.body.querySelector('[role="tooltip"]')).not.toBeNull();
    act(() => { button.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
    unmount();
  });
});
