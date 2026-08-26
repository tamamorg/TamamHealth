/**
 * DEPRECATED REDIRECT — remove after 2027-02-01.
 *
 * An organization's facilities are a section of its own page now, which is
 * what `/manage` renders for a role that lives inside one tenant.
 */

import { redirect } from 'next/navigation';

export default async function OrgFacilitiesRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = new URLSearchParams();
  if (typeof params.new === 'string') next.set('new', 'facility');
  const query = next.toString();
  redirect(query ? `/manage?${query}` : '/manage');
}
