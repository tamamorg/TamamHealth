/**
 * DEPRECATED REDIRECT — remove after 2027-02-01.
 *
 * The org-scoped roster is a section of the organization's own page now
 * (`/manage` for a single-tenant role), reached by drilling rather than by a
 * roster route of its own.
 */

import { redirect } from 'next/navigation';

export default async function OrgUsersRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const user = typeof params.user === 'string' ? params.user : null;
  if (user) redirect(`/admin/users/${encodeURIComponent(user)}`);

  const next = new URLSearchParams();
  if (typeof params.q === 'string') next.set('q', params.q);
  if (typeof params.new === 'string') next.set('new', 'user');
  const query = next.toString();
  redirect(query ? `/manage?${query}` : '/manage');
}
