/**
 * The slider resize grip: the arrow keys widen in exact steps (a 32px step
 * inside the 40px snap zone used to snap straight back, so the keyboard could
 * never widen), Home goes back to the standard width, and the panel never
 * goes narrower than standard.
 */
import { act } from 'react';
import { mount } from '../clinical-notes/test-utils';
import SliderResizeHandle from '@/components/overlay/SliderResizeHandle';

jest.mock('@/lib/i18n/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

afterEach(() => { document.body.innerHTML = ''; });

const key = (el: Element, k: string) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });

describe('SliderResizeHandle', () => {
  it('widens by keyboard, resets with Home, never below standard', () => {
    const { container, unmount } = mount(<div className="panel"><SliderResizeHandle /></div>);
    const panel = container.querySelector<HTMLElement>('.panel')!;
    const handle = container.querySelector('.tm-resize-handle')!;

    key(handle, 'ArrowLeft');
    expect(panel.style.getPropertyValue('--slider-std-w')).toBe('592px');
    key(handle, 'ArrowLeft');
    expect(panel.style.getPropertyValue('--slider-std-w')).toBe('624px');
    expect(panel.hasAttribute('data-resized')).toBe(true);

    key(handle, 'Home');
    expect(panel.style.getPropertyValue('--slider-std-w')).toBe('');
    expect(panel.hasAttribute('data-resized')).toBe(false);

    key(handle, 'ArrowRight');
    expect(panel.style.getPropertyValue('--slider-std-w')).toBe('');
    unmount();
  });
});
