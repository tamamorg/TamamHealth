import { redirect } from 'next/navigation';

export default async function OrganizationsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = new URLSearchParams({ view: params.view === 'facilities' ? 'facilities' : 'organizations' });
  /* Carry the deep-link through. This used to forward `view` and `new` only,
     so the tenant page's "Edit organization" and "Deactivate" — both of which
     hand off as ?org=<id>&edit=1 / &deactivate=1 — landed on an unscoped
     /manage with no dialog open, and the operator's action just vanished. */
  for (const key of ['new', 'org', 'facility', 'edit', 'deactivate', 'q'] as const) {
    const value = params[key];
    if (typeof value === 'string') next.set(key, value);
  }
  redirect(`/manage?${next.toString()}`);
}
