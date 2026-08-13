'use client';

/**
 * Bills & Claims. Both live in one workspace now (`BillingWorkspace`) — this
 * route opens on the patient-accounts queue; /payments/claims opens the same
 * screen on the claims queue.
 */

import BillingWorkspace from '@/components/payments/BillingWorkspace';

export default function PaymentsPage() {
  return <BillingWorkspace initialTab="accounts" />;
}
