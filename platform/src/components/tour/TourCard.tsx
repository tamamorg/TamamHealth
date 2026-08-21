'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp, Check, X } from '@/components/icons/lucide';
import type { TourStep } from '@/lib/tour/types';

const CARD_WIDTH = 300;
const GAP = 14;
const MARGIN = 12;

export type TourTail = 'top' | 'bottom' | 'left' | 'right' | null;

// Position the card next to its target, auto-flipping to the opposite side when
// the preferred side would push it off-screen, and always clamping it fully
// within the viewport using the card's measured height.
//
// The clamp is what makes a tour survive a target taller than the window — the
// national dashboard's map panel is `grid-row: 1 / -1`, so it runs past both
// edges of the viewport and NEITHER side fits. Placing the card at
// `rect.bottom + GAP` then puts it below the fold: the spotlight is drawn, the
// card is not reachable, and Next can never be clicked, which strands the whole
// journey on step one. So every branch commits its preferred coordinates and
// then clamps them onto the screen.
export function cardPosition(rect: DOMRect, placement: TourStep['placement'], cardH: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const style: React.CSSProperties = { position: 'fixed', width: CARD_WIDTH };
  const clampX = (x: number) => Math.min(Math.max(x, MARGIN), Math.max(MARGIN, vw - CARD_WIDTH - MARGIN));
  const clampY = (y: number) => Math.min(Math.max(y, MARGIN), Math.max(MARGIN, vh - cardH - MARGIN));

  // Commit a placement: clamp it onto the screen, and drop the tail if the
  // clamp had to move it. An arrow that no longer touches the edge it names
  // points at nothing, which reads as a rendering fault rather than a nudge.
  const place = (left: number, top: number, tail: Exclude<TourTail, null>) => {
    const x = clampX(left);
    const y = clampY(top);
    style.left = x;
    style.top = y;
    const moved = Math.abs(x - left) > 1 || Math.abs(y - top) > 1;
    return { style, tail: (moved ? null : tail) as TourTail };
  };

  const centerX = rect.left + rect.width / 2 - CARD_WIDTH / 2;
  const centerY = rect.top + rect.height / 2 - cardH / 2;

  const fitsBelow = rect.bottom + GAP + cardH <= vh - MARGIN;
  const fitsAbove = rect.top - GAP - cardH >= MARGIN;
  const fitsRight = rect.right + GAP + CARD_WIDTH <= vw - MARGIN;
  const fitsLeft = rect.left - GAP - CARD_WIDTH >= MARGIN;

  switch (placement) {
    case 'top':
      if (fitsAbove || !fitsBelow) return place(centerX, rect.top - GAP - cardH, 'bottom');
      return place(centerX, rect.bottom + GAP, 'top');
    case 'left':
      if (fitsLeft || !fitsRight) return place(rect.left - GAP - CARD_WIDTH, centerY, 'right');
      return place(rect.right + GAP, centerY, 'left');
    case 'right':
      if (fitsRight || !fitsLeft) return place(rect.right + GAP, centerY, 'left');
      return place(rect.left - GAP - CARD_WIDTH, centerY, 'right');
    case 'bottom':
    default:
      if (fitsBelow || !fitsAbove) return place(centerX, rect.bottom + GAP, 'top');
      return place(centerX, rect.top - GAP - cardH, 'bottom');
  }
}

export default function TourCard({
  step, rect, index, total, stepTitles, onJumpTo, onBack, onNext, onSkip, isLast,
}: {
  step: TourStep;
  rect: DOMRect | null;
  index: number;
  total: number;
  /** Titles of every step in the tour — powers the "All steps" overview. */
  stepTitles?: string[];
  /** Jump straight to a step from the overview list. */
  onJumpTo?: (index: number) => void;
  onBack?: () => void;
  onNext: () => void;
  onSkip: () => void;
  isLast: boolean;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(180);
  const [showAllSteps, setShowAllSteps] = useState(false);

  // Re-measure whenever the content or anchor changes so the on-screen clamp
  // uses the card's real height.
  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight;
    if (h && Math.abs(h - cardH) > 1) setCardH(h);
  }, [step.id, rect, cardH]);

  const { style, tail } = rect
    ? cardPosition(rect, step.placement, cardH)
    : { style: { position: 'fixed' as const, left: '50%', top: '50%', width: CARD_WIDTH, transform: 'translate(-50%, -50%)' }, tail: null };

  return (
    <>
      {/* Dim backdrop so the card stands out. With an anchor it's the spotlight
          cut-out; centred (narrative) steps get a plain dim wash. */}
      {rect ? (
        <div
          aria-hidden
          className="tour-spotlight"
          style={{
            position: 'fixed',
            left: rect.left - 6,
            top: rect.top - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            borderRadius: 10,
            pointerEvents: 'none',
            zIndex: 9998,
            transition: 'left .2s ease, top .2s ease, width .2s ease, height .2s ease',
          }}
        />
      ) : (
        <div aria-hidden style={{ position: 'fixed', inset: 0, background: 'rgba(0, 29, 63, 0.62)', pointerEvents: 'none', zIndex: 9998 }} />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-label={step.title}
        className="tour-card"
        style={{
          ...style,
          zIndex: 9999,
          background: 'var(--bg-card)',
          borderRadius: 'var(--card-radius)',
          // Strong accent ring so the card reads clearly against any page.
          // The drop shadow lives in .tour-card (globals.css) — the flat
          // baseline strips box-shadow with !important, so inline won't win.
          border: '2px solid var(--accent-primary)',
          padding: '16px 18px',
          maxHeight: 'calc(100vh - 24px)',
          overflowY: 'auto',
          transition: rect ? 'left .2s ease, top .2s ease' : undefined,
        }}
      >
        {tail && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              width: 12,
              height: 12,
              background: 'var(--bg-card)',
              border: '2px solid var(--accent-primary)',
              transform: 'rotate(45deg)',
              ...(tail === 'top' ? { top: -7, left: '50%', marginInlineStart: -6, borderInlineEnd: 'none', borderBottom: 'none' } : {}),
              ...(tail === 'bottom' ? { bottom: -7, left: '50%', marginInlineStart: -6, borderInlineStart: 'none', borderTop: 'none' } : {}),
              ...(tail === 'left' ? { left: -7, top: '50%', marginTop: -6, borderInlineEnd: 'none', borderTop: 'none' } : {}),
              ...(tail === 'right' ? { right: -7, top: '50%', marginTop: -6, borderInlineStart: 'none', borderBottom: 'none' } : {}),
            }}
          />
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          {/* "Step 3 of 10" rather than "3/10": the tour is read once, by
              someone learning the product, and a ratio makes them decode it. */}
          <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--accent-primary)', letterSpacing: '0.02em' }}>
            Step {index + 1} of {total}
          </span>
          <button
            type="button"
            onClick={onSkip}
            aria-label="Close tour"
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2, lineHeight: 0 }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Progress. Tells someone mid-tour how much is left — the difference
            between "I'll finish this" and "I'll skip it". */}
        <div
          aria-hidden
          style={{ height: 3, borderRadius: 2, background: 'var(--overlay-subtle)', overflow: 'hidden', marginBottom: 12 }}
        >
          <div
            style={{
              height: '100%',
              width: `${((index + 1) / Math.max(total, 1)) * 100}%`,
              background: 'var(--accent-primary)',
              borderRadius: 2,
              transition: 'width .25s ease',
            }}
          />
        </div>

        <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-strong)', margin: '0 0 6px' }}>{step.title}</h3>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 10px' }}>{step.body}</p>

        {/* "All steps" overview — the whole journey at a glance, with the
            current stop highlighted, finished stops ticked, and every row
            clickable to jump straight there. */}
        {stepTitles && stepTitles.length > 1 && (
          <div style={{ marginBottom: 12 }}>
            <button
              type="button"
              onClick={() => setShowAllSteps(v => !v)}
              aria-expanded={showAllSteps}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, background: 'transparent', border: 'none',
                color: 'var(--accent-primary)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0,
              }}
            >
              {showAllSteps ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {showAllSteps ? 'Hide steps' : `Show all ${stepTitles.length} steps`}
            </button>
            {showAllSteps && (
              <ol style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, maxHeight: 180, overflowY: 'auto' }}>
                {stepTitles.map((title, i) => {
                  const isCurrent = i === index;
                  const isDone = i < index;
                  return (
                    <li key={`${i}-${title}`}>
                      <button
                        type="button"
                        onClick={() => onJumpTo?.(i)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'start',
                          background: isCurrent ? 'var(--accent-light)' : 'transparent',
                          border: 'none', borderRadius: 6, padding: '4px 6px', cursor: onJumpTo ? 'pointer' : 'default',
                        }}
                      >
                        <span
                          aria-hidden
                          style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                            fontSize: 10, fontWeight: 700,
                            background: isDone || isCurrent ? 'var(--accent-primary)' : 'var(--overlay-subtle)',
                            color: isDone || isCurrent ? '#fff' : 'var(--text-muted)',
                          }}
                        >
                          {isDone ? <Check className="w-2.5 h-2.5" /> : i + 1}
                        </span>
                        <span style={{
                          fontSize: 12, lineHeight: 1.3,
                          fontWeight: isCurrent ? 700 : 500,
                          color: isCurrent ? 'var(--text-primary)' : 'var(--text-secondary)',
                        }}>
                          {title}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              aria-label="Previous step"
              style={{
                display: 'flex', alignItems: 'center', gap: 4, background: 'transparent', border: 'none',
                color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '6px 4px',
              }}
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </button>
          ) : <span />}

          <button
            type="button"
            onClick={onNext}
            style={{
              background: 'var(--accent-primary)', color: '#fff', border: 'none', borderRadius: 8,
              padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {isLast ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    </>
  );
}
