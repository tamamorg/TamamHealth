'use client';

/**
 * Loading placeholders. A skeleton says "a value goes here and it is on its
 * way", which a spinner in an empty panel does not — and it keeps the layout
 * from jumping when the data lands. The shimmer is functional motion
 * (`tm-motion`); reduced-motion turns it into a still tint.
 */

import type { CSSProperties } from 'react';

export function Skeleton({ width, height = 14, variant = 'text', className = '', style }: {
  width?: number | string;
  height?: number | string;
  variant?: 'text' | 'circle' | 'block';
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={`tm-skeleton tm-skeleton--${variant} tm-motion${className ? ` ${className}` : ''}`}
      style={{ width: width ?? (variant === 'circle' ? height : '100%'), height, ...style }}
      aria-hidden="true"
    />
  );
}

/** A few lines of prose, the last one shorter so it reads as a paragraph. */
export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <span className="tm-skeleton-stack" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '62%' : '100%'} />
      ))}
    </span>
  );
}

/** List rows: an optional avatar, a title line and a shorter meta line. */
export function SkeletonRows({ rows = 4, avatar = false, label }: {
  rows?: number;
  avatar?: boolean;
  /** Announced to assistive technology while the rows are placeholders. */
  label?: string;
}) {
  return (
    <div role="status" aria-label={label} aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="tm-skeleton-row" aria-hidden="true">
          {avatar && <Skeleton variant="circle" height={36} />}
          <span className="tm-skeleton-stack" style={{ flex: 1 }}>
            <Skeleton width={`${58 + ((i * 17) % 30)}%`} />
            <Skeleton width={`${30 + ((i * 11) % 25)}%`} height={11} />
          </span>
        </div>
      ))}
    </div>
  );
}
