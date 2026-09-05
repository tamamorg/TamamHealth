'use client';

import type { ComponentType } from 'react';
import { Stethoscope } from '@/components/icons/lucide';

/**
 * The mission card — the day's one instruction for the role, in the words of
 * the design's "Close the loop" / "Keep the desk moving" cards.
 *
 * Every role's landing screen carries one, so a user signing in knows in a
 * sentence what this screen is for. The two dashboard shells render it at the
 * foot of the right rail; dashboards on their own layouts place it where their
 * grid has room. One component so the look (brand-blue surface, icon, the
 * small-caps title, the rule under it) is defined once — the copy is the only
 * thing that differs per role, and it lives in the `mission.*` locale keys.
 */
export default function EhrMissionCard({
  title,
  description,
  icon: Icon = Stethoscope,
  className,
}: {
  title: string;
  description: string;
  /** Lucide icon for the head. Defaults to the clinician's stethoscope. */
  icon?: ComponentType<{ className?: string }>;
  className?: string;
}) {
  return (
    <div className={`ehr-side-card ehr-mission-card${className ? ` ${className}` : ''}`} data-tour="mission-card">
      <div className="ehr-side-card-head ehr-mission-head">
        <Icon className="w-5 h-5" />
        <h2>{title}</h2>
      </div>
      <p>{description}</p>
    </div>
  );
}
