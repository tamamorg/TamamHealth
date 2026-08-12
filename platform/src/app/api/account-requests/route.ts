import { NextRequest, NextResponse } from 'next/server';
import { getAuthPayload, forbidden, unauthorized, serverError, logApiError } from '@/lib/api-auth';
import { sanitizeString } from '@/lib/validation';
import type { UserRole } from '@/lib/db-types';

const STAFF_ROLES: UserRole[] = [
  'doctor', 'clinical_officer', 'nurse', 'midwife', 'lab_tech', 'pharmacist',
  'front_desk', 'cashier', 'data_entry_clerk', 'medical_superintendent', 'hrio',
  'nutritionist', 'radiologist', 'hospital_manager', 'medical_biller',
  'central_registration_clerk', 'clinic_clerk', 'triage_nurse', 'rooming_nurse',
  'clinician', 'records_hmis_officer',
];
const REQUEST_ROLES: UserRole[] = [...STAFF_ROLES, 'org_admin'];

function cleanEmail(value: unknown): string {
  const email = sanitizeString(value).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) throw new Error('A valid email is required');
  return email;
}

function cleanRole(value: unknown): UserRole {
  const role = sanitizeString(value) as UserRole;
  if (!REQUEST_ROLES.includes(role)) throw new Error('Invalid requested role');
  return role;
}

export async function GET(request: NextRequest) {
  try {
    if (request.nextUrl.searchParams.get('public') === 'organizations') {
      const [{ getAllOrganizations }, { getAllHospitals }] = await Promise.all([
        import('@/lib/services/organization-service'), import('@/lib/services/hospital-service'),
      ]);
      const [organizations, hospitals] = await Promise.all([getAllOrganizations(), getAllHospitals()]);
      return NextResponse.json({
        organizations: organizations.filter(o => o.isActive).map(o => ({ _id: o._id, name: o.name, slug: o.slug, country: o.country })),
        facilities: hospitals.filter(h => h.orgId && organizations.some(o => o._id === h.orgId && o.isActive)).map(h => ({ _id: h._id, name: h.name, orgId: h.orgId })),
      });
    }
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (auth.role !== 'super_admin' && auth.role !== 'org_admin') return forbidden();
    const { getAccountRequests } = await import('@/lib/services/account-request-service');
    const all = await getAccountRequests();
    const requests = auth.role === 'super_admin'
      ? all
      : all.filter(r => r.organizationId === auth.orgId && r.reviewerRole === 'org_admin');
    return NextResponse.json({ requests: requests.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
  } catch (error) {
    logApiError('[API /account-requests GET]', error);
    return serverError();
  }
}

export async function POST(request: NextRequest) {
  try {
    const { checkRateLimit, checkContentLength } = await import('@/lib/api-security');
    const limited = await checkRateLimit(request, 'account-requests:write', 8);
    if (limited) return limited;
    const tooLarge = checkContentLength(request, 32 * 1024);
    if (tooLarge) return tooLarge;
    let body: Record<string, unknown>;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }); }
    const action = sanitizeString(body.action);

    if (!action || action === 'submit') {
      const requestedRole = cleanRole(body.requestedRole);
      const email = cleanEmail(body.email);
      const applicantName = sanitizeString(body.applicantName);
      if (applicantName.length < 2 || applicantName.length > 120) throw new Error('Full name is required');
      const organizationId = sanitizeString(body.organizationId) || undefined;
      const isOrgAdmin = requestedRole === 'org_admin';
      if (isOrgAdmin && !organizationId && process.env.SINGLE_ORG_MODE === 'true') {
        return NextResponse.json(
          { error: 'Select the existing organization. New organizations are disabled in this deployment.' },
          { status: 409 },
        );
      }
      if (!isOrgAdmin && !organizationId) throw new Error('Select an organization');
      const facilityId = sanitizeString(body.facilityId) || undefined;
      let facilityName = sanitizeString(body.facilityName).slice(0, 160) || undefined;
      if (!isOrgAdmin) {
        if (!facilityId) throw new Error('Select a facility');
        const { getHospitalById } = await import('@/lib/services/hospital-service');
        const facility = await getHospitalById(facilityId);
        if (!facility || facility.orgId !== organizationId) throw new Error('Select a facility belonging to the organization');
        facilityName = facility.name;
      }
      if (isOrgAdmin && !organizationId && (!sanitizeString(body.organizationName) || !sanitizeString(body.organizationSlug))) {
        throw new Error('Organization name and slug are required for an organization administrator request');
      }
      if (organizationId) {
        const { getOrganizationById } = await import('@/lib/services/organization-service');
        const org = await getOrganizationById(organizationId);
        if (!org || !org.isActive) throw new Error('Organization is not available');
      }
      const { createAccountRequest } = await import('@/lib/services/account-request-service');
      const doc = await createAccountRequest({
        applicantName, email, requestedRole,
        phone: sanitizeString(body.phone).slice(0, 40) || undefined,
        organizationId,
        organizationName: sanitizeString(body.organizationName).slice(0, 160) || undefined,
        organizationSlug: sanitizeString(body.organizationSlug).slice(0, 80) || undefined,
        organizationCountry: sanitizeString(body.organizationCountry).slice(0, 80) || undefined,
        facilityId, facilityName,
        message: sanitizeString(body.message).slice(0, 1000) || undefined,
      });
      return NextResponse.json({ requestId: doc._id, message: 'Your request was submitted for approval.' }, { status: 201 });
    }

    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (auth.role !== 'super_admin' && auth.role !== 'org_admin') return forbidden();
    const requestId = sanitizeString(body.requestId);
    if (!requestId) return NextResponse.json({ error: 'requestId is required' }, { status: 400 });
    const { getAccountRequests, updateAccountRequest } = await import('@/lib/services/account-request-service');
    const target = (await getAccountRequests()).find(r => r._id === requestId);
    if (!target) return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    if (auth.role === 'org_admin' && (target.organizationId !== auth.orgId || target.reviewerRole !== 'org_admin')) return forbidden();
    if (target.status !== 'pending') return NextResponse.json({ error: 'Request has already been decided' }, { status: 409 });

    if (action === 'reject') {
      const updated = await updateAccountRequest(target._id, { status: 'rejected', reviewedAt: new Date().toISOString(), reviewedBy: auth.sub, rejectionReason: sanitizeString(body.reason).slice(0, 500) || 'Not approved' });
      return NextResponse.json({ request: updated });
    }
    if (action !== 'approve') return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    if (target.requestedRole === 'org_admin' && auth.role !== 'super_admin') return forbidden();
    const role = cleanRole(body.role || target.requestedRole);
    if (auth.role === 'org_admin' && role === 'org_admin') return forbidden();
    const orgId = target.organizationId;
    let finalOrgId = orgId;
    let finalOrgName = target.organizationName;
    if (!finalOrgId) {
      if (process.env.SINGLE_ORG_MODE === 'true') {
        return NextResponse.json(
          { error: 'New organizations are disabled in this deployment.' },
          { status: 409 },
        );
      }
      if (role !== 'org_admin' || auth.role !== 'super_admin') return NextResponse.json({ error: 'Organization details are incomplete' }, { status: 400 });
      const { createOrganization, getOrganizationBySlug } = await import('@/lib/services/organization-service');
      const requestedSlug = target.organizationSlug!;
      const existingOrg = await getOrganizationBySlug(requestedSlug);
      if (existingOrg && (existingOrg.contactEmail !== target.email || existingOrg.createdBy !== auth.sub)) {
        return NextResponse.json(
          { error: 'That organization slug is already in use. Choose a different slug.' },
          { status: 409 },
        );
      }
      const org = existingOrg || await createOrganization({ name: target.organizationName!, slug: requestedSlug, contactEmail: target.email, country: target.organizationCountry || 'South Sudan', primaryColor: '#2191D0', secondaryColor: '#015697', subscriptionStatus: 'trial', subscriptionPlan: 'basic', maxUsers: 50, maxHospitals: 10, featureFlags: { epidemicIntelligence: false, mchAnalytics: false, dhis2Export: false, aiClinicalSupport: false, communityHealth: false, facilityAssessments: false }, orgType: 'private', isActive: true }, auth.sub, auth.username);
      finalOrgId = org._id; finalOrgName = org.name;
      // Persist this checkpoint before user provisioning. If the following
      // write fails, an approval retry resumes in the same tenant instead of
      // creating a duplicate organization.
      await updateAccountRequest(target._id, {
        organizationId: finalOrgId,
        organizationName: finalOrgName,
      });
    }
    if (auth.role === 'org_admin' && finalOrgId !== auth.orgId) return forbidden();
    const facilityId = sanitizeString(body.facilityId) || target.facilityId;
    let facilityName = sanitizeString(body.facilityName) || target.facilityName;
    if (facilityId) {
      const { getHospitalById } = await import('@/lib/services/hospital-service');
      const facility = await getHospitalById(facilityId);
      if (!facility || facility.orgId !== finalOrgId) return NextResponse.json({ error: 'Facility is not part of this organization' }, { status: 400 });
      facilityName = facility.name;
    }
    if (role !== 'org_admin' && (!facilityId || !facilityName)) {
      return NextResponse.json({ error: 'A facility is required for this account role' }, { status: 400 });
    }
    const { createUser, getUserById, resetPassword } = await import('@/lib/services/user-service');
    const usernameBase = (sanitizeString(body.username) || target.email.split('@')[0]).toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 40) || `staff${Date.now()}`;
    const requestSuffix = target._id.replace(/[^a-z0-9]/gi, '').slice(-8).toLowerCase();
    const username = `${usernameBase}.${requestSuffix}`;
    const tempPassword = `${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}Aa1!`;
    let user = await getUserById(`user-${username}`);
    if (user) {
      if (user.orgId !== finalOrgId) return forbidden('Provisioned account belongs to another organization.');
      // Recovery path for an interrupted approval: rotate the unclaimed
      // temporary credential and return only the newly generated value.
      await resetPassword(user._id, tempPassword, auth.sub, auth.username);
    } else {
      user = await createUser({ username, email: target.email, password: tempPassword, name: target.applicantName, role, orgId: finalOrgId, hospitalId: facilityId, hospitalName: facilityName, phone: target.phone }, auth.sub, auth.username);
    }
    const updated = await updateAccountRequest(target._id, { status: 'approved', reviewedAt: new Date().toISOString(), reviewedBy: auth.sub, provisionedUserId: user._id, organizationId: finalOrgId, organizationName: finalOrgName });
    return NextResponse.json({ request: updated, credentials: { username, temporaryPassword: tempPassword } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to process request';
    if (/required|invalid|available|incomplete/i.test(message)) return NextResponse.json({ error: message }, { status: 400 });
    logApiError('[API /account-requests POST]', error);
    return serverError();
  }
}
