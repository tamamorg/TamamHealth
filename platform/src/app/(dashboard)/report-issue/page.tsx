'use client';

/**
 * Report a problem — every signed-in role (a universal route in role-routes).
 * Reached from the account menu, which passes the page the user was on.
 */

import { Suspense } from 'react';
import { ReportIssueScreen } from '@/modules/communication/client';

export default function ReportIssuePage() {
  // useSearchParams inside the screen needs a Suspense boundary under the App Router.
  return (
    <Suspense fallback={null}>
      <ReportIssueScreen />
    </Suspense>
  );
}
