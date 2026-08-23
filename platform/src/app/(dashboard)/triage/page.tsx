'use client';

/**
 * `/triage` has no board of its own — triage is per patient.
 *
 * The route is granted to the whole clinical family because its CHILD,
 * `/triage/[patientId]`, is the ETAT form a queue row opens. `isPathAllowed`
 * grants by prefix, so the proxy waved the bare parent through to a route that
 * had no page at all: a nurse who bookmarked the old station board, or who
 * trimmed the patient id off the URL, got a hard 404 in the middle of a shift.
 *
 * Client-side like `/notes`, not a server `redirect()`: this group's layout is
 * a client component that holds render until the local database is ready, and
 * a server redirect inside it does not move the browser.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function TriageIndexPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/dashboard');
  }, [router]);

  return <div className="cn-empty">Opening your worklist…</div>;
}
