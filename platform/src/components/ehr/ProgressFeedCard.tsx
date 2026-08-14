'use client';

/**
 * ProgressFeedCard — "who moved where, just now", for a station rail.
 *
 * The clinician dashboard has "Awaiting review". Every other station has the
 * same need with a different question, so this is the same card shape with a
 * role-specific title and slice: the nurse sees who was triaged and whose
 * results landed, the pharmacy sees scripts moving, the front desk sees who
 * has finished and can be checked out.
 *
 * It loads its own data rather than taking it as a prop. Seven dashboards would
 * otherwise each have to wire three hooks and a memo, and they would drift —
 * the card is the same thing everywhere, so it owns its own feed.
 *
 * Renders nothing only when the role has no configured feed. A quiet window
 * shows the card with an explicit empty line instead of vanishing — a card
 * that appears and disappears reads as broken, and "no movement" is itself
 * information a station wants.
 */

import { shortenPersonName } from '@/lib/patient-utils';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Activity } from '@/components/icons/lucide';
import { useAuth } from '@/lib/context';
import { useTriage } from '@/lib/hooks/useTriage';
import { useLabResults } from '@/lib/hooks/useLabResults';
import { usePrescriptions } from '@/lib/hooks/usePrescriptions';
import {
  buildProgressFeed,
  progressFeedFor,
  relativeTime,
  type ProgressEvent,
} from '@/lib/clinical-flow/progress-feed';

/** How many rows before the card scrolls. Matches the overdue-labs card. */
const VISIBLE_CAP = 25;

export default function ProgressFeedCard() {
  const router = useRouter();
  const { currentUser } = useAuth();
  const config = progressFeedFor(currentUser?.role);

  const { triages } = useTriage();
  const { results } = useLabResults();
  const { prescriptions } = usePrescriptions();

  // Wall clock sampled in an effect so render stays pure, refreshed each
  // minute so "12m ago" keeps counting without a reload.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const events = useMemo<ProgressEvent[]>(() => {
    if (!config || nowMs === null) return [];
    const allowed = new Set(config.kinds);
    return buildProgressFeed(
      { triages, labs: results, prescriptions },
      { nowMs },
    ).filter(e => allowed.has(e.kind));
  }, [config, nowMs, triages, results, prescriptions]);

  if (!config) return null;

  return (
    <section className="ehr-side-card ehr-progress-card">
      <div className="ehr-side-card-head">
        <Activity className="w-5 h-5" />
        <h2>{config.title}</h2>
      </div>
      {events.length === 0 && (
        // The feed's window is 12h (buildProgressFeed default) — say so, so a
        // quiet card reads as "nothing happened", not "nothing loaded".
        <p className="ehr-progress-empty">No patient movement in the last 12 hours.</p>
      )}
      {events.length > 0 && (
      <ul className="ehr-progress-list is-scrollable">
        {events.slice(0, VISIBLE_CAP).map(ev => (
          <li key={ev.id}>
            <button type="button" onClick={() => router.push(ev.href)}>
              <span className="ehr-progress-headline">
                <b>{shortenPersonName(ev.patientName)}</b>
                {' — '}
                {ev.label}
              </span>
              <span className="ehr-progress-meta">
                {ev.detail ? `${ev.detail} · ` : ''}
                {/* An approximate time is the document's last-modified stamp,
                    not a stamp for this stage. Saying "updated 4m ago" keeps
                    that distinction visible instead of inventing a precision
                    the record does not have. */}
                {ev.approximate ? 'updated ' : ''}
                {relativeTime(ev.at, nowMs ?? Date.parse(ev.at))}
              </span>
            </button>
          </li>
        ))}
      </ul>
      )}
    </section>
  );
}
