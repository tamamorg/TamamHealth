import { redirect } from 'next/navigation';

export default async function OrganizationsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = new URLSearchParams({ view: params.view === 'facilities' ? 'facilities' : 'organizations' });
  if (typeof params.new === 'string') next.set('new', params.new);
  redirect(`/manage?${next.toString()}`);
}
