import { NextRequest, NextResponse } from 'next/server';
import { getAuthPayload, hasRole, forbidden, unauthorized, logApiError } from '@/modules/identity';
import { getUserById } from '@/modules/identity/services/user-service';
import { createRestrictedMentalHealthNote, getRestrictedMentalHealthNotes } from '@/modules/specialty-care/services/restricted-note-service.server';
import type { RestrictedMentalHealthNoteCategory } from '@/modules/specialty-care';
import { getSpecialtyEpisode } from '@/modules/specialty-care/services/specialty-care-service';

const BREAK_GLASS_ROLES = ['super_admin', 'doctor', 'clinical_officer', 'clinician', 'medical_superintendent'] as const;
const ORG_WIDE_ROLES = new Set(['super_admin', 'org_admin', 'medical_superintendent']);
const CATEGORIES = new Set<RestrictedMentalHealthNoteCategory>(['assessment', 'therapy', 'safeguarding', 'risk', 'follow_up']);

async function hasRoutineAccess(userId: string, role: string): Promise<boolean> {
  if (role === 'super_admin' || role === 'medical_superintendent') return true;
  const user = await getUserById(userId);
  return user?.specialtyCode === 'psychiatry';
}

export async function GET(request: NextRequest) {
  const auth = await getAuthPayload(request);
  if (!auth) return unauthorized();
  if (!auth.orgId) return forbidden('An organization context is required');
  const patientId = request.nextUrl.searchParams.get('patientId')?.trim();
  if (!patientId) return NextResponse.json({ error: 'patientId is required' }, { status: 400 });
  const breakGlassReason = request.nextUrl.searchParams.get('breakGlassReason')?.trim();
  let routine = false;
  try { routine = await hasRoutineAccess(auth.sub, auth.role); } catch { routine = false; }
  if (!routine) {
    if (!hasRole(auth, BREAK_GLASS_ROLES) || !breakGlassReason || breakGlassReason.length < 10) {
      return forbidden('Restricted notes require psychiatry authorization or a break-glass reason of at least 10 characters');
    }
  }
  try {
    const notes = await getRestrictedMentalHealthNotes({ patientId, orgId: auth.orgId, allowedFacilityIds: [auth.hospitalId, ...(auth.facilityIds ?? [])].filter((id): id is string => Boolean(id)), allFacilities: ORG_WIDE_ROLES.has(auth.role), actorId: auth.sub, actorName: auth.name, breakGlassReason: routine ? undefined : breakGlassReason });
    return NextResponse.json({ notes });
  } catch (error) {
    logApiError('[restricted-mh-notes:get]', error);
    const message = error instanceof Error ? error.message : 'Restricted notes could not be loaded';
    return NextResponse.json({ error: message }, { status: message.includes('PHI_ENCRYPTION_KEY') ? 503 : 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await getAuthPayload(request);
  if (!auth) return unauthorized();
  if (!auth.orgId || !auth.hospitalId) return forbidden('An organization and facility context is required');
  if (!(await hasRoutineAccess(auth.sub, auth.role))) return forbidden('Only psychiatry-authorized clinicians can author restricted notes');
  try {
    const body = await request.json() as Record<string, unknown>;
    const category = typeof body.category === 'string' ? body.category as RestrictedMentalHealthNoteCategory : undefined;
    if (!category || !CATEGORIES.has(category)) return NextResponse.json({ error: 'A valid note category is required' }, { status: 422 });
    const required = ['patientId', 'patientName', 'episodeId', 'narrative'] as const;
    for (const key of required) if (typeof body[key] !== 'string' || !(body[key] as string).trim()) return NextResponse.json({ error: `${key} is required` }, { status: 422 });
    const episode = await getSpecialtyEpisode((body.episodeId as string).trim(), { orgId: auth.orgId, hospitalId: auth.hospitalId, facilityIds: auth.facilityIds, role: auth.role, userId: auth.sub });
    if (!episode || episode.pathway !== 'mental_health' || episode.patientId !== (body.patientId as string).trim()) {
      return NextResponse.json({ error: 'The restricted note must reference an authorized mental-health episode for this patient' }, { status: 422 });
    }
    const note = await createRestrictedMentalHealthNote({ patientId: (body.patientId as string).trim(), patientName: (body.patientName as string).trim(), episodeId: (body.episodeId as string).trim(), narrative: body.narrative as string, category, hospitalId: auth.hospitalId, orgId: auth.orgId, actorId: auth.sub, actorName: auth.name });
    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    logApiError('[restricted-mh-notes:post]', error);
    const message = error instanceof Error ? error.message : 'Restricted note could not be created';
    return NextResponse.json({ error: message }, { status: message.includes('PHI_ENCRYPTION_KEY') ? 503 : 500 });
  }
}
