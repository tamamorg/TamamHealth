'use client';

/**
 * The page half of a create popup.
 *
 * Every "add"/"create" popup in the app can be promoted to a full page, and
 * that page is always the same anatomy — the one `/patients/new` established
 * and `/admin/{organizations,facilities,users}/new` already reuse: a back
 * toolbar, a sticky rail carrying the title and a line of orientation, and the
 * SAME form component in a card beside it.
 *
 * The form is never forked for this. A popup that renders its body under
 * `presentation="page"` is the identical component with its dialog chrome
 * left off, so validation and persistence cannot drift between the two
 * surfaces — which is the whole reason expanding is safe mid-entry.
 */

import type { ReactNode } from 'react';
import { useConsoleTrail } from '@/components/navigation/ConsoleTrail';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { routeLabelKeyFor } from '@/lib/navigation/route-context';

export default function CreateRecordPage({
  title,
  note,
  returnTo,
  layout = 'rail',
  children,
}: {
  title: string;
  /** One line of orientation under the title. */
  note?: string;
  /** No longer drawn: Back and the title are in the bar at the top. */
  backLabel?: string;
  /** Already validated as an internal path by `useReturnTo`/`safeReturnTo`. */
  returnTo: string;
  /**
   * 'full' drops the side rail and puts the title above a full-width card.
   *
   * For the handful of forms that carry a rail of their own — the lab
   * requisition wizard's step list, say. Two rails either side of one form is
   * a worse page than no rail at all.
   */
  layout?: 'rail' | 'full';
  children: ReactNode;
}) {
  const { t } = useTranslation();
  // The title and Back live in the bar at the top (RouteContextBar), not in a
  // toolbar and heading of the page's own: Back goes to the screen the form
  // was opened from, `returnTo` when there is none.
  const parentKey = routeLabelKeyFor(returnTo);
  useConsoleTrail('create-record-page', [
    ...(parentKey ? [{ label: t(parentKey), href: returnTo }] : []),
    { label: title },
  ]);

  return (
    <main className="page-container page-enter sadb-scope">
      <div className="sadb-page">
        <div className="sadb-regpage-shell">
          {layout === 'full' ? (
            <>
              {note && (
                <div className="sadb-regpage-rail" style={{ position: 'static' }}>
                  <p className="sadb-regpage-note">{note}</p>
                </div>
              )}
              <div className="sadb-card sadb-regpage-form">{children}</div>
            </>
          ) : (
            <div className="sadb-regpage">
              <aside className="sadb-regpage-rail" aria-label={title}>
                {note && <p className="sadb-regpage-note">{note}</p>}
              </aside>

              <div className="sadb-card sadb-regpage-form">{children}</div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
