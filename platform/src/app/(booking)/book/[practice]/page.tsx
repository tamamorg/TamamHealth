import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import PracticeBooking from '@/components/booking/PracticeBooking';
import type { PracticePayload } from '@/lib/booking/public-client';
import T from '@/components/T';

export const dynamic = 'force-dynamic';

/**
 * S4 — the practice-wide booking page.
 *
 * Fetched server-side through the same public endpoint the browser uses, so
 * there is exactly one definition of what a practice may publish. Rendering it
 * from the service layer directly would create a second, quieter path that
 * could drift out of step with the allow-lists in `public-context`.
 */
async function loadPractice(slug: string): Promise<PracticePayload | null> {
  const h = await headers();
  const host = h.get('host');
  const proto = h.get('x-forwarded-proto') || 'http';
  try {
    const res = await fetch(`${proto}://${host}/api/booking/practice/${encodeURIComponent(slug)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return await res.json() as PracticePayload;
  } catch {
    return null;
  }
}

export default async function PracticeBookingPage({
  params,
}: {
  params: Promise<{ practice: string }>;
}) {
  const { practice } = await params;
  const data = await loadPractice(practice);
  // A practice that has not switched online booking on is indistinguishable
  // from one that does not exist — the endpoint behind this makes the same
  // choice, so the two cannot be told apart by probing either.
  if (!data) notFound();

  return (
    <>
      <header className="booking-topbar">
        <div className="booking-topbar-practice">
          <b>{data.practice.name}</b>
          {(data.practice.town || data.practice.state) && (
            <span>{[data.practice.town, data.practice.state].filter(Boolean).join(', ')}</span>
          )}
        </div>
        {data.practice.phone && (
          <a className="booking-btn is-ghost" href={`tel:${data.practice.phone.replace(/\s+/g, '')}`}>
            <T k="ui.callPhone" vars={{ phone: data.practice.phone }} en="Call {{phone}}" />
          </a>
        )}
      </header>
      <PracticeBooking data={data} />
    </>
  );
}
