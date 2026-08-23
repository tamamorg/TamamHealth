'use client';

/**
 * `/wards/mar` has no board of its own — a medication administration record
 * belongs to one admission, at `/wards/mar/[admissionId]`.
 *
 * The prefix grant let the bare parent through to a route with no page. The
 * ward board is where an admission is chosen, so that is where this lands.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function WardsMarIndexPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/wards');
  }, [router]);

  return <div className="cn-empty">Opening your worklist…</div>;
}
