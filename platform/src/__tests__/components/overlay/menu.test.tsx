/**
 * The shared menu's contract: click to open, arrows to move, Escape to close
 * and return focus, disabled rows skipped, a dialog host raising the layer.
 */
import { act } from 'react';
import { mount } from '../clinical-notes/test-utils';
import Menu, { type MenuItem } from '@/components/overlay/Menu';

jest.mock('@/lib/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const key = (target: Element, k: string) => act(() => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
});

function items(onSelect: jest.Mock): MenuItem[] {
  return [
    { key: 'edit', label: 'Edit', onSelect: () => onSelect('edit') },
    { key: 'off', label: 'Disabled', disabled: true, onSelect: () => onSelect('off') },
    { key: 'del', label: 'Delete', tone: 'danger', group: 'exits', onSelect: () => onSelect('del') },
  ];
}

afterEach(() => { document.body.innerHTML = ''; });

describe('Menu', () => {
  it('opens on click with the accessible pattern and closes on outside press', () => {
    const onSelect = jest.fn();
    const { container, unmount } = mount(<Menu items={items(onSelect)} label="Row actions" />);
    const trigger = container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
    expect(trigger.getAttribute('aria-label')).toBe('Row actions');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    act(() => trigger.click());
    const panel = document.body.querySelector<HTMLElement>('[role="menu"]')!;
    expect(panel).not.toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.className).toContain('tm-elevated');
    expect(panel.querySelectorAll('[role="menuitem"]')).toHaveLength(3);
    expect(panel.querySelector('[data-tone="danger"]')?.textContent).toBe('Delete');
    expect(panel.querySelectorAll('.tm-menu__group')).toHaveLength(2);

    act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    unmount();
  });

  it('moves with the arrows, skips a disabled row, and selects with a click', () => {
    const onSelect = jest.fn();
    const { container, unmount } = mount(<Menu items={items(onSelect)} label="Row actions" />);
    const trigger = container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
    key(trigger, 'ArrowDown');
    const rows = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    expect(document.activeElement).toBe(rows[0]);
    key(rows[0], 'ArrowDown');
    expect(document.activeElement).toBe(rows[2]);   // the disabled row is skipped
    key(rows[2], 'ArrowDown');
    expect(document.activeElement).toBe(rows[0]);   // and it wraps
    key(rows[0], 'End');
    expect(document.activeElement).toBe(rows[2]);
    act(() => rows[2].click());
    expect(onSelect).toHaveBeenCalledWith('del');
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    unmount();
  });

  it('closes on Escape and hands focus back to the trigger', () => {
    const { container, unmount } = mount(<Menu items={items(jest.fn())} label="Row actions" />);
    const trigger = container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
    key(trigger, 'ArrowDown');
    const first = document.body.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
    key(first, 'Escape');
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    unmount();
  });

  it('raises above a dialog scrim when its trigger lives inside one', () => {
    const { container, unmount } = mount(
      <div className="modal-portal-backdrop"><Menu items={items(jest.fn())} label="In dialog" /></div>,
    );
    act(() => container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!.click());
    expect(document.body.querySelector('[role="menu"]')?.className).toContain('tm-menu--in-dialog');
    unmount();
  });

  it('says so when there is nothing to offer', () => {
    const { container, unmount } = mount(<Menu items={[]} label="Empty" />);
    act(() => container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!.click());
    expect(document.body.querySelector('.tm-menu__empty')?.textContent).toBe('overlay.menuEmpty');
    unmount();
  });
});
