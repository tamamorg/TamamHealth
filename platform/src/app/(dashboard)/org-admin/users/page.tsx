import { redirect } from 'next/navigation';

export default async function OrgUsersRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = new URLSearchParams({ view: 'people' });
  for (const key of ['new', 'q', 'user', 'tab']) {
    const value = params[key];
    if (typeof value === 'string') next.set(key, value);
  }
  redirect(`/manage?${next.toString()}`);
}
