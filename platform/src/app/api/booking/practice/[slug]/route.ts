/**
 * GET /api/booking/practice/[slug]
 *
 * Everything the public booking page needs to draw itself before a patient has
 * chosen anything: the practice's name, its published clinicians, the visit
 * reasons on offer, and the consent/policy copy.
 *
 * Zero PHI. The heaviest thing here is a clinician's own published bio.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getPublishedProfiles } from '@/lib/services/provider-profile-service';
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
  const limited = await guardPublicRate(request, 'practice', 60, 60_000);
  if (limited) return limited;

  const { slug } = await params;
  const resolved = await resolvePractice(slug);
  if ('error' in resolved) return resolved.error;
  const { policy, facilityId, orgId } = resolved.practice;

  const [providers, reasons, facility] = await Promise.all([
    getPublishedProfiles(orgId, facilityId),
    getVisitReasonsForFacility(facilityId, orgId),
    getHospitalById(facilityId, { role: 'org_admin', orgId }).catch(() => null),
  ]);

  return NextResponse.json({
    practice: {
      slug: policy.publicSlug,
      name: facility?.name || 'Clinic',
      // `HospitalDoc` locates a facility by town + state, not a street address;
      // the public phone comes from the booking policy, which is the field an
      // admin actually curates for patients to ring.
      town: facility?.town,
      state: facility?.state,
      phone: policy.publicPhone,
    },
    policy: publicPolicyView(policy),
    providers: providers.map(publicProviderView),
    // Only reasons a patient may actually pick online. A staff-only reason
    // ("Theatre list review") has both patient-class flags off and never
    // reaches the public menu.
    reasons: reasons
      .filter(r => r.isActive && (r.availableToNewPatients || r.availableToReturningPatients))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(publicReasonView),
  }, {
    // Availability is fetched separately and live; this payload is the slow-
    // moving part, so a short cache takes the repeat load off a practice page
    // that gets shared around.
    headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
  });
}
