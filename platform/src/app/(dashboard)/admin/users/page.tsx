/**
 * There is no flat platform roster any more.
 *
 * An account belongs to a facility and a facility to an organization, so the
 * people who work somewhere are listed on that somewhere: the tenant page
 * carries every account in the organization, and each facility page carries
 * its own staff. This stub keeps old links and bookmarks resolving.
 *
 * `?user=<id>` is still answered exactly — that record has its own page, and
 * the console root forwards straight to it.
 */

import { redirect } from 'next/navigation';

export default async function UsersRedirect({
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
