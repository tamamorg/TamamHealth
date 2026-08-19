'use client';

/**
 * One way to draw a member of staff.
 *
 * Every worklist, booking grid and directory row that shows a person should
 * come through here, so a clinician who uploads a photo starts being
 * recognisable everywhere at once rather than in whichever screens remembered
 * to check for one. Accounts without a photo — which is all of them until
 * someone uploads — fall back to initials on a tinted disc.
 */

import { useState } from 'react';
import { initials } from '@/lib/patient-utils';

export interface StaffAvatarProps {
  name: string;
  photoUrl?: string;
  /** Pixel diameter. */
  size?: number;
  /** Squared-off variant for profile headers. */
  rounded?: 'circle' | 'card';
  className?: string;
}

/**
 * Deterministic tint per person.
 *
 * The same face keeps the same colour between screens and between sessions,
 * which is what makes a monogram scannable in a long list. Hashed from the
 * name rather than the id so it survives a record being re-created.
 */
function tintIndex(name: string, buckets: number): number {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % buckets;
}

const TINTS = [
  { bg: '#E3F0FA', fg: 'var(--accent-hover)' },
  { bg: '#E7F4EC', fg: '#1F6B43' },
  { bg: '#FBEBE6', fg: '#9C4221' },
  { bg: '#EEEBFA', fg: '#4C36A8' },
  { bg: '#FDF1DC', fg: '#8A5A08' },
  { bg: '#FCE8EF', fg: '#9B2C4E' },
];

export default function StaffAvatar({
  name, photoUrl, size = 40, rounded = 'circle', className,
}: StaffAvatarProps) {
  // A stored data URL can still fail to decode (truncated by a bad sync, or a
  // format the browser refuses). Falling back to the monogram keeps the row
  // readable instead of leaving a broken-image glyph next to someone's name.
  const [broken, setBroken] = useState(false);
  const tint = TINTS[tintIndex(name || '', TINTS.length)];
  const radius = rounded === 'circle' ? '999px' : `${Math.round(size * 0.16)}px`;

  const style: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: radius,
    flex: '0 0 auto',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    background: tint.bg,
    color: tint.fg,
    fontWeight: 800,
    fontSize: Math.max(11, Math.round(size * 0.36)),
    lineHeight: 1,
    letterSpacing: '0.01em',
    userSelect: 'none',
  };

  return (
    <span className={className} style={style} aria-hidden title={name || undefined}>
      {photoUrl && !broken
        ? (
          <img
            src={photoUrl}
            alt=""
            loading="lazy"
            onError={() => setBroken(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        )
        : initials(name)}
    </span>
  );
}
