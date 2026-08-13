'use client';

/**
 * Claims — the same Bills & Claims workspace as /payments, opened on the
 * claims queue.
 *
 * The route is kept (rather than redirected away) because it is an
 * explicit-grant route in role-routes: a cashier reaches /payments but must
 * not reach claims, and RoleGuard enforces that on this path. Existing deep
 * links, dashboard shortcuts and the biller tour also still point here.
 */

import BillingWorkspace from '@/components/payments/BillingWorkspace';

export default function ClaimsPage() {
  return <BillingWorkspace initialTab="claims" />;
}
