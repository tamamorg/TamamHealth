/**
 * SegmentedControl, FormField, InlineBanner, Skeleton and EmptyState —
 * the small primitives' semantics.
 */
import { act } from 'react';
import { mount } from '../clinical-notes/test-utils';
import SegmentedControl from '@/components/overlay/SegmentedControl';
import FormField from '@/components/overlay/FormField';
import InlineBanner from '@/components/overlay/InlineBanner';
import { Skeleton, SkeletonRows } from '@/components/overlay/Skeleton';
import EmptyState from '@/components/EmptyState';

jest.mock('@/lib/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('SegmentedControl', () => {
  const options = [
    { value: 'labs', label: 'Labs', count: 3 },
    { value: 'imaging', label: 'Imaging' },
    { value: 'off', label: 'Off', disabled: true },
  ] as const;

  it('marks the chosen segment pressed, with a check, and one tab stop', () => {
    const onChange = jest.fn();
    const { container, unmount } = mount(
      <SegmentedControl options={[...options]} value="labs" onChange={onChange} label="Order type" />,
    );
    const group = container.querySelector('[role="group"]')!;
    expect(group.getAttribute('aria-label')).toBe('Order type');
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button'));
    expect(buttons.map(b => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    expect(buttons.map(b => b.tabIndex)).toEqual([0, -1, -1]);
    expect(buttons[0].querySelector('.tm-segmented__count')?.textContent).toBe('3');
    act(() => buttons[1].click());
    expect(onChange).toHaveBeenCalledWith('imaging');
    act(() => buttons[0].click());
    expect(onChange).toHaveBeenCalledTimes(1);   // pressing the chosen one is a no-op
    unmount();
  });

  it('moves the choice with the arrow keys, skipping a disabled segment', () => {
    const onChange = jest.fn();
    const { container, unmount } = mount(
      <SegmentedControl options={[...options]} value="imaging" onChange={onChange} label="Order type" />,
    );
    const group = container.querySelector<HTMLElement>('[role="group"]')!;
    act(() => { group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
    expect(onChange).toHaveBeenLastCalledWith('labs');   // wraps past the disabled one
    act(() => { group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); });
    expect(onChange).toHaveBeenLastCalledWith('labs');
    unmount();
  });
});

describe('FormField', () => {
  it('wires the caption, hint and error to the control', () => {
    const { container, root, unmount } = mount(
      <FormField id="drug" label="Drug name" required hint="Brand or generic">
        {control => <input {...control} />}
      </FormField>,
    );
    const input = container.querySelector<HTMLInputElement>('input')!;
    expect(container.querySelector('label')?.getAttribute('for')).toBe('drug');
    expect(input.getAttribute('aria-describedby')).toBe('drug-hint');
    expect(input.getAttribute('aria-required')).toBe('true');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(container.querySelector('.tm-field__req')?.getAttribute('aria-label')).toBe('overlay.required');

    act(() => {
      root.render(
        <FormField id="drug" label="Drug name" required hint="Brand or generic" error="Pick a drug">
          {control => <input {...control} />}
        </FormField>,
      );
    });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('drug-error');
    expect(container.querySelector('#drug-error')?.getAttribute('role')).toBe('alert');
    expect(container.querySelector('.tm-field__hint')).toBeNull();   // the error replaces the hint
    unmount();
  });
});

describe('InlineBanner', () => {
  it('is polite unless it is danger, and carries its action and dismiss', () => {
    const onDismiss = jest.fn();
    const onAction = jest.fn();
    const { container, unmount } = mount(
      <>
        <InlineBanner tone="info" title="Heads up" action={{ label: 'Sign up', onClick: onAction }} onDismiss={onDismiss}>detail</InlineBanner>
        <InlineBanner tone="danger">bad</InlineBanner>
      </>,
    );
    const [info, danger] = Array.from(container.querySelectorAll('.tm-banner'));
    expect(info.getAttribute('role')).toBe('status');
    expect(danger.getAttribute('role')).toBe('alert');
    act(() => info.querySelector<HTMLButtonElement>('.tm-banner__action')!.click());
    expect(onAction).toHaveBeenCalled();
    act(() => info.querySelector<HTMLButtonElement>('.tm-banner__dismiss')!.click());
    expect(onDismiss).toHaveBeenCalled();
    unmount();
  });
});

describe('Skeleton and EmptyState', () => {
  it('skeletons are hidden from assistive technology; rows announce busy', () => {
    const { container, unmount } = mount(
      <>
        <Skeleton width={120} />
        <SkeletonRows rows={2} avatar label="Loading patients" />
      </>,
    );
    expect(container.querySelector('.tm-skeleton')?.getAttribute('aria-hidden')).toBe('true');
    const rows = container.querySelector('[role="status"]')!;
    expect(rows.getAttribute('aria-busy')).toBe('true');
    expect(rows.querySelectorAll('.tm-skeleton-row')).toHaveLength(2);
    expect(rows.querySelectorAll('.tm-skeleton--circle')).toHaveLength(2);
    unmount();
  });

  it('empty state offers the next step without inline colour', () => {
    const onClick = jest.fn();
    const { container, unmount } = mount(
      <EmptyState title="No orders yet" message="Orders you place appear here." action={{ label: 'New order', onClick }} size="sm" />,
    );
    expect(container.querySelector('.tm-empty')?.className).toContain('tm-empty--sm');
    expect(container.querySelector('[style]')).toBeNull();
    act(() => container.querySelector<HTMLButtonElement>('.btn-primary')!.click());
    expect(onClick).toHaveBeenCalled();
    unmount();
  });
});
