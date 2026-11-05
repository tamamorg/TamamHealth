'use client';

/**
 * Reported issues — the management inbox for problems staff report from their
 * account menu (Report a problem). The patient-inquiry queue that used to
 * live here was removed for management at the user's request (2026-11-04);
 * the inbox is the whole page now.
 */

import { IssueReportsQueue } from '@/modules/communication/client';

export default function InquiriesPage() {
  return <IssueReportsQueue />;
}
