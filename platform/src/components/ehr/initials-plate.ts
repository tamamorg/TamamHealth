/**
 * Fallback identity plate for a worklist row whose patient doc is outside
 * this device's scope — `PatientAvatar` needs the doc, so rows keyed only by
 * a name string draw this instead (the same plate the transfers queue draws).
 *
 * Shared by the lab, referrals, and pharmacy card-grid lists; extracted once
 * the third copy appeared.
 */
import type { CSSProperties } from 'react';

export const INITIALS_PLATE_STYLE: CSSProperties = {
  width: 40, height: 40, borderRadius: 12, flexShrink: 0,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--overlay-subtle)', color: 'var(--text-secondary)',
  fontSize: 12, fontWeight: 700, letterSpacing: '0.02em',
};

export function nameInitials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}
