/**
 * GET /api/booking/provider/[slug]?practice=<practice-slug>
 *
 * One published clinician, for the public profile page. Reads only
 * `ProviderProfileDoc` — never `UserDoc`, which carries `passwordHash` and
 * `pinHash`. A draft profile is indistinguishable from a missing one.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getPublishedProfileBySlug } from '@/lib/services/provider-profile-service';
import { getVisitReasonsForFacility } from '@/lib/services/visit-reason-service';
import { getHospitalById } from '@/lib/services/hospital-service';
import {
  resolvePractice, publicProviderView, publicReasonView, publicPolicyView, guardPublicRate,
} from '@/lib/booking/public-context';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const limited = await guardPublicRate(request, 'provider', 60, 60_000);
  if (limited) return limited;

  const { slug } = await params;
  const practiceSlug = request.nextUrl.searchParams.get('practice') || '';
  const resolved = await resolvePractice(practiceSlug);
  if ('error' in resolved) return resolved.error;
  const { policy, facilityId, orgId } = resolved.practice;

  const profile = await getPublishedProfileBySlug(orgId, slug);
  if (!profile) {
    return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
  }

  const [reasons, facility, locations] = await Promise.all([
    getVisitReasonsForFacility(facilityId, orgId),
    getHospitalById(facilityId, { role: 'org_admin', orgId }).catch(() => null),
    // "+N more location" needs the names of everywhere this clinician works,
    // not just the practice being browsed.
    Promise.all(profile.facilityIds.map(id => getHospitalById(id, { role: 'org_admin', orgId }).catch(() => null))),
  ]);

  return NextResponse.json({
    practice: {
      slug: policy.publicSlug,
      name: facility?.name || 'Clinic',
      town: facility?.town,
      state: facility?.state,
      phone: policy.publicPhone,
    },
    policy: publicPolicyView(policy),
    provider: publicProviderView(profile),
    locations: locations
      .filter((f): f is NonNullable<typeof f> => Boolean(f))
      .map(f => ({ id: f._id, name: f.name, town: f.town, state: f.state })),
    reasons: reasons
      .filter(r => r.isActive && (r.availableToNewPatients || r.availableToReturningPatients))
      // A reason restricted to a provider subset only appears on the profiles
      // of the clinicians who actually offer it.
      .filter(r => r.providerIds.length === 0 || r.providerIds.includes(profile.userId))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(publicReasonView),
  }, {
    headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
  });
}
