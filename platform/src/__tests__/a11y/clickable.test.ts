/**
 * @jest-environment node
 *
 * A card you can only reach with a mouse is a card half your users cannot use.
 *
 * An audit on 2026-08-24 found 129 click handlers on plain `<div>`s and
 * `<section>`s across 43 files, none reachable from the keyboard. The worst
 * concentration was the patient chart, where the facesheet panels —
 * Medications, Safety alerts, and Latest observations — are each a
 * whole card you click to open its tab. Clinicians work keyboard-first when
 * they are fast, which on a shared ward workstation is most of the time.
 *
 * `clickable()` is the one helper those sites now spread. It returns props, so
 * it is tested as the pure function it is — this codebase deliberately has no
 * @testing-library/react (see clinical-notes/test-utils.tsx for why).
 */
import type { KeyboardEvent, SyntheticEvent } from 'react';
import { clickable, stopsClickPropagation } from '@/lib/a11y';

/** Minimal stand-in for React's synthetic keyboard event. */
function keyEvent(key: string) {
  return {
    key,
    defaultPrevented: false,
    preventDefault() { (this as { defaultPrevented: boolean }).defaultPrevented = true; },
  } as unknown as KeyboardEvent;
}

describe('clickable()', () => {
  it('announces itself as a button and takes a tab stop', () => {
    const props = clickable(() => {});
    expect(props.role).toBe('button');
    expect(props.tabIndex).toBe(0);
  });

  it.each(['Enter', ' '])('activates on %j', key => {
    const onActivate = jest.fn();
    clickable(onActivate).onKeyDown(keyEvent(key));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('does not let Space scroll the page instead of activating', () => {
    // A control that scrolls rather than activating is worse than one that
    // does nothing: the user believes they pressed something else.
    const event = keyEvent(' ');
    clickable(() => {}).onKeyDown(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it.each(['a', 'Tab', 'ArrowDown', 'Escape', 'Shift'])('ignores %j', key => {
    const onActivate = jest.fn();
    const event = keyEvent(key);
    clickable(onActivate).onKeyDown(event);
    expect(onActivate).not.toHaveBeenCalled();
    // Tab in particular must keep working, or the control becomes a focus trap.
    expect(event.defaultPrevented).toBe(false);
  });

  it('still activates on click, for everyone else', () => {
    const onActivate = jest.fn();
    const click = {} as SyntheticEvent;
    clickable(onActivate).onClick(click);
    expect(onActivate).toHaveBeenCalledWith(click);
  });

  it('takes an explicit label when the visible text is not enough', () => {
    expect(clickable(() => {}, { label: 'Open latest observations' }))
      .toMatchObject({ 'aria-label': 'Open latest observations' });
  });

  it('omits aria-label rather than emitting an empty one', () => {
    // An empty label is worse than none: it overrides the visible text with
    // nothing, so the control announces as an unnamed button.
    expect(clickable(() => {})).not.toHaveProperty('aria-label');
  });

  it('can be taken out of the tab order deliberately', () => {
    expect(clickable(() => {}, { focusable: false }).tabIndex).toBe(-1);
  });
});

describe('stopsClickPropagation', () => {
  it('keeps a click from reaching a parent handler', () => {
    const stopPropagation = jest.fn();
    stopsClickPropagation.onClick({ stopPropagation } as unknown as SyntheticEvent);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });

  it('is not announced as interactive, because it is not', () => {
    // Modal content that swallows a backdrop click has nothing to activate,
    // so a button role would advertise an action that does not exist.
    expect(stopsClickPropagation.role).toBe('presentation');
    expect(stopsClickPropagation).not.toHaveProperty('tabIndex');
    expect(stopsClickPropagation).not.toHaveProperty('onKeyDown');
  });
});
