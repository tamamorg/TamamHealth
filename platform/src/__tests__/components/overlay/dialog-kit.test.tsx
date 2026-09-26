/**
 * The dialog kit's accessibility wiring and the section's disclosure.
 */
import { act } from 'react';
import { mount } from '../clinical-notes/test-utils';
import { DialogBody, DialogFooter, DialogFrame, DialogHeader, DialogSection } from '@/components/overlay/Dialog';

jest.mock('@/lib/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('DialogHeader', () => {
  it('names the dialog, opts out of the structural band, and labels its controls', () => {
    const onClose = jest.fn();
    const onExpand = jest.fn();
    const { container, unmount } = mount(
      <DialogFrame>
        <DialogHeader titleId="t1" title="Create order" description="Nothing is placed yet" descriptionId="d1" onClose={onClose} onExpand={onExpand} />
        <DialogBody>body</DialogBody>
        <DialogFooter note="note"><button type="button">Go</button></DialogFooter>
      </DialogFrame>,
    );
    const head = container.querySelector('header')!;
    expect(head.className).toContain('modal-no-headband');
    // The frame opts out too — the band rule also matches a first-child div
    // holding an h2 and no form control (a confirm), which painted the whole
    // panel blue with white-on-white text before this was pinned.
    expect(container.querySelector('.tm-dialog')!.className).toContain('modal-no-headband');
    expect(head.className).toContain('tm-dialog__head--plain');
    expect(container.querySelector('#t1')?.textContent).toBe('Create order');
    expect(container.querySelector('#d1')?.textContent).toBe('Nothing is placed yet');

    const close = container.querySelector<HTMLButtonElement>('[data-action="popup-close"]')!;
    expect(close.getAttribute('aria-label')).toBe('overlay.close');
    act(() => close.click());
    expect(onClose).toHaveBeenCalledTimes(1);

    const expand = container.querySelector<HTMLButtonElement>('[data-action="popup-expand"]')!;
    expect(expand.getAttribute('aria-label')).toBe('overlay.expand');
    act(() => expand.click());
    expect(onExpand).toHaveBeenCalledTimes(1);

    expect(container.querySelector('.tm-dialog__foot-note')?.textContent).toBe('note');
    unmount();
  });

  it('paints the danger and brand tones as classes, never as inline colour', () => {
    const { container, unmount } = mount(
      <>
        <DialogHeader titleId="a" title="Delete" tone="danger" onClose={() => {}} />
        <DialogHeader titleId="b" title="Facility" tone="brand" onClose={() => {}} />
      </>,
    );
    const heads = container.querySelectorAll('header');
    expect(heads[0].className).toContain('tm-dialog__head--danger');
    expect(heads[1].className).toContain('tm-dialog__head--brand');
    expect(container.querySelector('[style]')).toBeNull();
    unmount();
  });

  it('shows a busy wash that announces itself while a save is in flight', () => {
    const { container, unmount } = mount(<DialogFrame busy><DialogBody>x</DialogBody></DialogFrame>);
    expect(container.querySelector('.tm-dialog')?.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelector('.tm-dialog__busy')?.getAttribute('role')).toBe('status');
    unmount();
  });
});

describe('DialogSection', () => {
  it('folds and unfolds with the right disclosure state', () => {
    const { container, unmount } = mount(
      <DialogSection title="Drug info" collapsible defaultOpen>
        <p>fields</p>
      </DialogSection>,
    );
    const section = container.querySelector('.tm-dialog__section')!;
    const toggle = container.querySelector<HTMLButtonElement>('.tm-dialog__section-head')!;
    const body = container.querySelector<HTMLElement>('.tm-dialog__section-body')!;
    expect(section.getAttribute('data-open')).toBe('true');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe(body.id);
    expect(body.hidden).toBe(false);

    act(() => toggle.click());
    expect(section.getAttribute('data-open')).toBe('false');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(body.hidden).toBe(true);
    unmount();
  });

  it('is a plain heading when it cannot fold', () => {
    const { container, unmount } = mount(<DialogSection title="Pharmacy"><p>x</p></DialogSection>);
    expect(container.querySelector('button.tm-dialog__section-head')).toBeNull();
    expect(container.querySelector('div.tm-dialog__section-head')).not.toBeNull();
    unmount();
  });
});
