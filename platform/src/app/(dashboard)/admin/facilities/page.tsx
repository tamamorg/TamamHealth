/**
 * `/admin/facilities` has never had a page — only `[id]` and `new` beneath it
 * — while sitting in seven roles' allow-lists in `role-routes.ts`. Typing it,
 * or following any link that trimmed the id off, produced a 404 from a route
 * the proxy had just waved through.
 *
 * There is no flat national facility registry to send it to any more: a
 * facility belongs to an organization, so the list of them lives on that
 * organization's page. This forwards to the console root, which is that page
 * for a single-tenant role and the tenant list for everyone else.
 */

import { redirect } from 'next/navigation';

export default async function AdminFacilitiesRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = new URLSearchParams();
  // `?new=1` is what the Add menu used to emit at this address.
  if (typeof params.new === 'string') next.set('new', 'facility');
  if (typeof params.org === 'string') redirect(`/admin/organizations/${encodeURIComponent(params.org)}?${next.toString()}`);
  const query = next.toString();
  redirect(query ? `/manage?${query}` : '/manage');
}
