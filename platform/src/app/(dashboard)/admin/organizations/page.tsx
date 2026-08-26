/**
 * The tenant registry lives at `/manage`. This stub stays for old links and
 * bookmarks, and for the two hand-offs the tenant page used to make.
 *
 * `?org=<id>` now resolves to that organization's OWN page rather than to a
 * list of every other one: `?edit=1` and `?deactivate=1` are handled there,
 * beside the record they act on, instead of bouncing an operator out of the
 * tenant they were reading and back again.
 */

import { redirect } from 'next/navigation';

export default async function OrganizationsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const org = typeof params.org === 'string' ? params.org : null;

  if (org) {
    const next = new URLSearchParams();
    for (const key of ['edit', 'deactivate', 'facility', 'q'] as const) {
      const value = params[key];
      if (typeof value === 'string') next.set(key, value);
    }
    const query = next.toString();
    redirect(`/admin/organizations/${encodeURIComponent(org)}${query ? `?${query}` : ''}`);
  }

  const next = new URLSearchParams();
  if (typeof params.q === 'string') next.set('q', params.q);
  /* `?new=1` meant "the thing this view creates", and the view it named is
     gone. At the console root that thing is an organization; `?view=facilities`
     still asks for a facility, which the root's dialog can also open. */
  if (typeof params.new === 'string') {
    next.set('new', params.view === 'facilities' ? 'facility' : 'organization');
  }
  const query = next.toString();
  redirect(query ? `/manage?${query}` : '/manage');
}
