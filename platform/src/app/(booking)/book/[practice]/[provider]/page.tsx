import { notFound } from 'next/navigation';
import { publicBookingOrigin } from '@/lib/booking/public-base-url';
import ProviderProfile from '@/components/booking/ProviderProfile';
import type { ProviderPayload } from '@/lib/booking/public-client';
import T from '@/components/T';

export const dynamic = 'force-dynamic';

/**
 * S1/S2/S3 — a published clinician's public profile.
 *
 * `embed` is a sibling route under the same segment, so it must not be read as
 * a provider slug. Next resolves the static segment first, but this page is
 * also reachable directly and the guard keeps the 404 honest.
 */
async function loadProvider(practice: string, provider: string): Promise<ProviderPayload | null> {
  try {
    const url = `${publicBookingOrigin()}/api/booking/provider/${encodeURIComponent(provider)}`
      + `?practice=${encodeURIComponent(practice)}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json() as ProviderPayload;
  } catch {
    return null;
  }
}

export default async function ProviderProfilePage({
  params,
}: {
  params: Promise<{ practice: string; provider: string }>;
}) {
  const { practice, provider } = await params;
  const data = await loadProvider(practice, provider);
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
        <a className="booking-btn is-ghost" href={`/book/${encodeURIComponent(practice)}`}>
          <T k="ui.allClinicians" en="All clinicians" />
        </a>
      </header>
      <ProviderProfile data={data} />
    </>
  );
}
