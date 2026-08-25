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
import { useRouter } from 'next/navigation';
import { ArrowLeft } from '@/components/icons/lucide';

export default function CreateRecordPage({
  title,
  note,
  backLabel,
  returnTo,
  layout = 'rail',
  children,
}: {
  title: string;
  /** One line of orientation under the title. */
  note?: string;
  backLabel: string;
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
  const router = useRouter();

  return (
    <main className="page-container page-enter sadb-scope">
      <div className="sadb-page">
        <div className="sadb-regpage-shell">
          <div className="patient-registration-toolbar">
            <button type="button" onClick={() => router.push(returnTo)} className="patient-registration-back">
              <ArrowLeft className="w-4 h-4" /> {backLabel}
            </button>
          </div>

          {layout === 'full' ? (
            <>
              <div className="sadb-regpage-rail" style={{ position: 'static' }}>
                <h1 className="sadb-regpage-title">{title}</h1>
                {note && <p className="sadb-regpage-note">{note}</p>}
              </div>
              <div className="sadb-card sadb-regpage-form">{children}</div>
            </>
          ) : (
            <div className="sadb-regpage">
              <aside className="sadb-regpage-rail">
                <h1 className="sadb-regpage-title">{title}</h1>
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
