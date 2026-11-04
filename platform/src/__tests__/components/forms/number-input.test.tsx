import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import NumberInput, { steppedValue } from '@/components/forms/NumberInput';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('steppedValue', () => {
  it('steps by the field\'s own step, 1 when it is unset or "any"', () => {
    expect(steppedValue('5', 1)).toBe('6');
    expect(steppedValue('5', 1, 'any')).toBe('6');
    expect(steppedValue('36.5', 1, 0.1)).toBe('36.6');
    expect(steppedValue('2', -1, 0.5)).toBe('1.5');
  });
  it('stays inside min and max, and reports when it cannot move', () => {
    expect(steppedValue('0', -1, 1, 0)).toBeNull();
    expect(steppedValue('150', 1, 1, 0, 150)).toBeNull();
    expect(steppedValue('149.5', 1, 1, 0, 150)).toBe('150');
  });
  it('an empty field starts from min going up, max going down, else 0', () => {
    expect(steppedValue('', 1, 1, 4, 44)).toBe('4');
    expect(steppedValue('', -1, 1, 4, 44)).toBe('44');
    expect(steppedValue('', 1)).toBe('0');
  });
});

describe('NumberInput', () => {
  let container: HTMLDivElement; let root: Root; let seen: string[];
  function Harness({ disabled }: { disabled?: boolean }) {
    const [v, setV] = useState('3');
    return <NumberInput aria-label="Gravida" min={0} max={4} value={v} disabled={disabled} onChange={e => { seen.push(e.target.value); setV(e.target.value); }} />;
  }
  beforeEach(() => { seen = []; container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  it('− and + change the value through the field\'s own onChange, inside max', () => {
    act(() => root.render(<Harness />));
    const [minus, plus] = Array.from(container.querySelectorAll('button'));
    act(() => plus.click());
    act(() => plus.click());
    act(() => minus.click());
    expect(seen).toEqual(['4', '3']);
    expect(container.querySelector('input')!.value).toBe('3');
    expect(plus.getAttribute('aria-label')).toBe('+ Gravida');
  });

  it('a disabled field disables its buttons', () => {
    act(() => root.render(<Harness disabled />));
    expect(Array.from(container.querySelectorAll('button')).every(b => b.disabled)).toBe(true);
  });
});
