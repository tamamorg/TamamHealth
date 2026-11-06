import { notFound } from 'next/navigation';
import { publicBookingOrigin } from '@/lib/booking/public-base-url';
import EmbedBooking from '@/components/booking/EmbedBooking';
import type { PracticePayload } from '@/lib/booking/public-client';

export const dynamic = 'force-dynamic';

/**
 * S5/S6/S7 — the chrome-less widget a practice iframes into its own website.
 *
 * This is the only route allowed in a frame; every other page keeps the global
 * deny. The `frame-ancestors` allow-list comes from the practice's own
 * `embedAllowedOrigins` and is applied in `proxy.ts`, which is the only place
 * that sees the request headers early enough to set it.
 */
async function loadPractice(slug: string): Promise<PracticePayload | null> {
  try {
    const res = await fetch(`${publicBookingOrigin()}/api/booking/practice/${encodeURIComponent(slug)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return await res.json() as PracticePayload;
  } catch {
    return null;
  }
}

export default async function EmbedPage({
  params,
}: {
  params: Promise<{ practice: string }>;
}) {
  const { practice } = await params;
  const data = await loadPractice(practice);
  if (!data) notFound();
  return <EmbedBooking data={data} />;
}
