/**
 * DEPRECATED REDIRECT — remove after 2027-02-23.
 *
 * Billing & Subscriptions merged into /admin/organizations on 2026-08-23:
 * the page was the same tenant list wearing billing columns, so keeping both
 * meant two editors for one set of fields. The KPI strip moved onto the
 * registry; plan/status/seat-limit edits live in the registry's Edit
 * Organization form; each tenant's own subscription facts are on
 * /admin/organizations/[id]. This stub stays only so old links and
 * bookmarks keep working — same pattern as /org-admin/settings.
 */

import { redirect } from 'next/navigation';

export default function AdminBillingRedirect() {
  redirect('/admin/organizations');
}
