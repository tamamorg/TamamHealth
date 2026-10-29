/**
 * The filled status marks the notifications wear — a solid disc (or triangle)
 * in the tone with the symbol knocked out, the Carbon / O3 shape.
 *
 * Drawn here rather than taken from the icon set because the set is stroked:
 * a stroked circle reads as an outline at 20px and the global icon rules
 * repaint `svg.lucide` strokes. These carry no `lucide` class and paint with
 * `fill`, so they keep the tone they are given through `color`; the symbol
 * is knocked out in `--tm-status-knockout`, which each panel sets.
 */

export type StatusTone = 'error' | 'success' | 'warning' | 'info';

export default function StatusGlyph({ tone, className = '' }: { tone: StatusTone; className?: string }) {
  const cls = `tm-status-glyph tm-status-glyph--${tone}${className ? ` ${className}` : ''}`;
  if (tone === 'warning') {
    return (
      <svg className={cls} viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
        <path d="M10 1.5 19 18H1z" fill="currentColor" />
        <path d="M9.1 7h1.8v5.2H9.1zM10 13.6a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2z" fill="var(--tm-status-knockout)" />
      </svg>
    );
  }
  return (
    <svg className={cls} viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
      <circle cx="10" cy="10" r="9" fill="currentColor" />
      {tone === 'error' && (
        <path d="m5.6 6.9 1.3-1.3 7.5 7.5-1.3 1.3z" fill="var(--tm-status-knockout)" />
      )}
      {tone === 'success' && (
        <path d="m8.6 13.6-3.4-3.4 1.2-1.2 2.2 2.2 4.8-4.8 1.2 1.2z" fill="var(--tm-status-knockout)" />
      )}
      {tone === 'info' && (
        <path d="M9.1 8.6h1.8v5.8H9.1zM10 5.2a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2z" fill="var(--tm-status-knockout)" />
      )}
    </svg>
  );
}
