'use client';

/**
 * A number field with − and + beside it — every number a user types has a
 * way to nudge it without the keyboard (2026-11-04, user request).
 *
 * A drop-in for `<input type="number">`: every prop goes to the input, which
 * stays the real control (its value, events and form submission are
 * unchanged). The buttons step by the input's own `step` (1 when it is unset
 * or "any"), stay inside `min`/`max`, and change the value the way typing
 * does — the native value setter plus an `input` event — so a React
 * `onChange` sees an ordinary edit.
 */

import { forwardRef, useRef, type InputHTMLAttributes } from 'react';
import { Minus, Plus } from '@/components/icons/lucide';

type NumberInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

const decimalsOf = (n: number) => {
  const text = String(n);
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
};

/** The value one step up or down, inside min/max; null when it cannot move. */
export function steppedValue(current: string, direction: 1 | -1, step?: string | number, min?: string | number, max?: string | number): string | null {
  const stepNum = Number(step);
  const size = Number.isFinite(stepNum) && stepNum > 0 ? stepNum : 1;
  const lo = min === undefined || min === '' ? -Infinity : Number(min);
  const hi = max === undefined || max === '' ? Infinity : Number(max);
  const now = Number(current);
  const start = current === '' || !Number.isFinite(now)
    ? (direction === 1 ? (Number.isFinite(lo) ? lo : 0) : (Number.isFinite(hi) ? hi : 0))
    : now + direction * size;
  const clamped = Math.min(hi, Math.max(lo, start));
  const rounded = Number(clamped.toFixed(Math.max(decimalsOf(size), decimalsOf(now) || 0)));
  if (current !== '' && rounded === now) return null;
  return String(rounded);
}

const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(props, forwardedRef) {
  const innerRef = useRef<HTMLInputElement | null>(null);
  const setRef = (el: HTMLInputElement | null) => {
    innerRef.current = el;
    if (typeof forwardedRef === 'function') forwardedRef(el);
    else if (forwardedRef) forwardedRef.current = el;
  };

  const nudge = (direction: 1 | -1) => {
    const input = innerRef.current;
    if (!input || input.disabled || input.readOnly) return;
    const next = steppedValue(input.value, direction, props.step, props.min, props.max);
    if (next === null) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(input, next); else input.value = next;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const label = props['aria-label'] || '';
  const off = props.disabled || props.readOnly;
  return (
    <span className="tm-num" data-disabled={off || undefined}>
      <input ref={setRef} {...props} type="number" />
      {/* tabIndex -1: the arrow keys already step the focused field; the
          buttons are for pointer and touch, and would double every Tab. */}
      <button type="button" className="tm-num-btn" tabIndex={-1} disabled={off}
        aria-label={label ? `− ${label}` : 'Decrease'} onClick={() => nudge(-1)}>
        <Minus aria-hidden="true" />
      </button>
      <button type="button" className="tm-num-btn" tabIndex={-1} disabled={off}
        aria-label={label ? `+ ${label}` : 'Increase'} onClick={() => nudge(1)}>
        <Plus aria-hidden="true" />
      </button>
    </span>
  );
});

export default NumberInput;
