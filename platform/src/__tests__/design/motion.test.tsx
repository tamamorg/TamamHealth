/**
 * Functional motion (lib/motion.ts, components/motion/RouteMotion): the exit
 * stand-in for a closing dialog, and the route progress line.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { playExitGhost, fadeIn, motionAllowed } from '@/lib/motion';

let mockPath = '/dashboard';
jest.mock('next/navigation', () => ({
  usePathname: () => mockPath,
  useSearchParams: () => new URLSearchParams(''),
}));
import RouteMotion from '@/components/motion/RouteMotion';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const flushMicrotasks = () => new Promise<void>(resolve => queueMicrotask(resolve));

describe('motion helpers', () => {
  const originalAnimate = Element.prototype.animate;
  let finish: () => void;
  beforeEach(() => {
    const finished = new Promise<void>(resolve => { finish = resolve; });
    Element.prototype.animate = jest.fn(() => ({ finished }) as unknown as Animation);
    window.matchMedia = jest.fn(() => ({ matches: false }) as unknown as MediaQueryList);
  });
  afterEach(() => {
    Element.prototype.animate = originalAnimate;
    document.body.innerHTML = '';
  });

  test('stay still when the browser cannot animate', () => {
    // @ts-expect-error simulate jsdom / an old browser
    Element.prototype.animate = undefined;
    expect(motionAllowed()).toBe(false);
    expect(() => fadeIn(document.body)).not.toThrow();
  });

  test('stay still when the user asks for reduced motion', () => {
    window.matchMedia = jest.fn(() => ({ matches: true }) as unknown as MediaQueryList);
    fadeIn(document.body);
    expect(Element.prototype.animate).not.toHaveBeenCalled();
  });

  test('a removed surface leaves through an inert, id-free clone that keeps what was typed', async () => {
    document.body.innerHTML = '<div id="dlg" class="tm-motion" role="dialog"><input id="f" value=""><p id="p">x</p></div>';
    const node = document.getElementById('dlg')!;
    (node.querySelector('input') as HTMLInputElement).value = 'typed';
    playExitGhost(node, ghost => [ghost.animate([{ opacity: 1 }, { opacity: 0 }], 100)], 1999);
    node.remove();
    await flushMicrotasks();
    const ghost = document.querySelector<HTMLElement>('[data-exit-ghost]')!;
    expect(ghost).not.toBeNull();
    expect(ghost.hasAttribute('inert')).toBe(true);
    expect(ghost.getAttribute('aria-hidden')).toBe('true');
    expect(ghost.getAttribute('role')).toBeNull();
    expect(ghost.classList.contains('tm-motion')).toBe(false);
    expect(ghost.style.zIndex).toBe('1999');
    expect(ghost.querySelectorAll('[id]')).toHaveLength(0);
    expect(document.getElementById('f')).toBeNull();
    expect(ghost.querySelector('input')!.value).toBe('typed');
    finish();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(document.querySelector('[data-exit-ghost]')).toBeNull();
  });

  test('no ghost when the node stayed (Strict Mode re-running the effect)', async () => {
    document.body.innerHTML = '<div id="dlg"></div>';
    playExitGhost(document.getElementById('dlg'), ghost => [ghost.animate([], 100)]);
    await flushMicrotasks();
    expect(document.querySelector('[data-exit-ghost]')).toBeNull();
  });
});

describe('route progress line', () => {
  let root: Root;
  let host: HTMLDivElement;
  beforeEach(() => {
    jest.useFakeTimers();
    mockPath = '/dashboard';
    window.history.replaceState(null, '', '/dashboard');
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<RouteMotion />));
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    jest.useRealTimers();
  });
  const state = () => host.querySelector<HTMLElement>('.tm-route-progress')!.dataset.state;
  const start = (url: string) => act(() => { window.dispatchEvent(new CustomEvent('tamam:navigation-start', { detail: { url } })); });

  test('shows only for a navigation slower than the instant threshold, then completes', () => {
    start('/patients');
    expect(state()).toBe('idle');
    act(() => { jest.advanceTimersByTime(130); });
    expect(state()).toBe('loading');
    mockPath = '/patients';
    act(() => root.render(<RouteMotion />));
    expect(state()).toBe('done');
    act(() => { jest.advanceTimersByTime(1000); });
    expect(state()).toBe('idle');
  });

  test('a fast navigation never shows the line', () => {
    start('/patients');
    mockPath = '/patients';
    act(() => root.render(<RouteMotion />));
    act(() => { jest.advanceTimersByTime(500); });
    expect(state()).toBe('idle');
  });

  test('ignores a navigation to the screen already open', () => {
    start('/dashboard');
    act(() => { jest.advanceTimersByTime(500); });
    expect(state()).toBe('idle');
  });
});
