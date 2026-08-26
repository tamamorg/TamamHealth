'use client';

/**
 * One organization, drilled into from the registry at `/manage`.
 *
 * The page itself is thin: the level's whole anatomy — header, vitals, its
 * FACILITIES, then its people — lives in `OrganizationDetail`, because a role
 * that only ever sees one tenant gets exactly this content at `/manage`
 * instead, and two copies of a screen this consequential is how the org form
 * and the facility form each drifted into three versions before.
 */

import { useParams } from 'next/navigation';
import { SadbPage } from '@/components/admin/sadb-ui';
import { OrganizationDetail } from '@/modules/tenancy/client';
import { TENANCY_WORKSPACE_ROLES } from '@/modules/tenancy/client';

export default function AdminOrganizationDetailPage() {
  const params = useParams<{ id: string }>();
  const orgId = params?.id ?? '';

  return (
    <SadbPage roles={[...TENANCY_WORKSPACE_ROLES]}>
      <OrganizationDetail orgId={orgId} hostedAt={`/admin/organizations/${encodeURIComponent(orgId)}`} />
    </SadbPage>
  );
}
