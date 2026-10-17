import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react';

/** Inline highlight for a deep-linked row (same look ResultsSection uses). */
export const FOCUSED_ROW_STYLE: CSSProperties = {
  background: 'var(--accent-light)',
  boxShadow: 'inset 3px 0 0 var(--accent-primary)',
};

/**
 * Keyboard + pointer activation for a table row that also contains its own
 * buttons/links. Unlike the bare `clickable()` helper it ignores events that
 * originate in a nested interactive control, so "Correct" / "Mark error"
 * buttons keep working and Enter on them is not swallowed by the row.
 */
export function rowActivation(onActivate: () => void, label: string) {
  const fromInner = (target: EventTarget | null, current: HTMLElement) => {
    const el = target as HTMLElement | null;
    const inner = el?.closest?.('button, a, input, select, textarea, label');
    return !!inner && inner !== current && current.contains(inner);
  };
  return {
    role: 'button' as const,
    tabIndex: 0,
    'aria-label': label,
    onClick: (e: MouseEvent<HTMLElement>) => {
      if (fromInner(e.target, e.currentTarget)) return;
      onActivate();
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (e.target !== e.currentTarget) return;
      e.preventDefault();
      onActivate();
    },
  };
}
