/**
 * API: /api/organizations
 * GET  — List organizations, get by ID or slug, get stats
 * POST — Create organization, update organization, or deactivate organization
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthPayload, unauthorized, forbidden, hasRole, serverError, logApiError,
} from '@/lib/api-auth';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole, OrganizationDoc } from '@/lib/db-types';
const READ_ROLES: UserRole[] = [
  'super_admin', 'org_admin',
];
const WRITE_ROLES: UserRole[] = [
  'super_admin',
];
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, READ_ROLES)) return forbidden();
    const {
      getAllOrganizations,
      getOrganizationById,
      getOrganizationBySlug,
      getOrganizationStats,
    } = await import('@/lib/services/organization-service');
    const id = request.nextUrl.searchParams.get('id');
    const slug = request.nextUrl.searchParams.get('slug');
    const orgId = request.nextUrl.searchParams.get('orgId');
    const withStats = request.nextUrl.searchParams.get('stats') === 'true';
    if (id) {
      const org = await getOrganizationById(id);
      if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
      if (withStats) {
        const stats = await getOrganizationStats(id);
        return NextResponse.json({ organization: org, stats });
      }
      return NextResponse.json({ organization: org });
    }
    if (slug) {
      const org = await getOrganizationBySlug(slug);
      if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
      if (withStats) {
        const stats = await getOrganizationStats(org._id);
        return NextResponse.json({ organization: org, stats });
      }
      return NextResponse.json({ organization: org });
    }
    if (orgId && withStats) {
      const stats = await getOrganizationStats(orgId);
      return NextResponse.json({ stats });
    }
    const organizations = await getAllOrganizations();
    return NextResponse.json({ organizations });
  } catch (err) {
    logApiError('[API /organizations GET]', err);
    return serverError();
  }
}
async function postHandler(request: NextRequest) {
  try {
    const { checkRateLimit } = await import('@/lib/api-security');
    const rateLimitResponse = await checkRateLimit(request, 'organizations:write', 10);
    if (rateLimitResponse) return rateLimitResponse;
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, WRITE_ROLES)) return forbidden();
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { sanitizePayload } = await import('@/lib/validation');
    body = sanitizePayload(body);
    const action = body.action as string;
    // Deactivate organization
    if (action === 'deactivate') {
      if (!body.orgId) {
        return NextResponse.json(
          { error: 'orgId is required' },
          { status: 400 }
        );
      }
      const { deactivateOrganization } = await import('@/lib/services/organization-service');
      await deactivateOrganization(body.orgId as string, auth.sub, auth.username);
      return NextResponse.json({ success: true });
    }
    // Update existing organization
    if (action === 'update' && body.orgId) {
      const { updateOrganization } = await import('@/lib/services/organization-service');
      const updated = await updateOrganization(
        body.orgId as string,
        {
          name: body.name as string | undefined,
          slug: body.slug as string | undefined,
        },
        auth.sub,
        auth.username
      );
      return NextResponse.json({ organization: updated });
    }
    if (process.env.SINGLE_ORG_MODE === 'true') {
      return NextResponse.json(
        { error: 'This deployment currently supports one organization. Add staff to the existing organization.' },
        { status: 409 },
      );
    }
    // Create new organization
    if (!body.name || !body.slug || !body.contactEmail || !body.country) {
      return NextResponse.json(
        { error: 'name, slug, contactEmail, and country are required' },
        { status: 400 }
      );
    }
    const { createOrganization } = await import('@/lib/services/organization-service');
    const org = await createOrganization(
      {
        name: body.name as string,
        slug: body.slug as string,
        contactEmail: body.contactEmail as string,
        country: body.country as string,
        primaryColor: (body.primaryColor as string) || '#2191D0',
        secondaryColor: (body.secondaryColor as string) || '#015697',
        accentColor: body.accentColor as string | undefined,
        subscriptionStatus: (body.subscriptionStatus as OrganizationDoc['subscriptionStatus']) || 'trial',
        subscriptionPlan: (body.subscriptionPlan as OrganizationDoc['subscriptionPlan']) || 'basic',
        maxUsers: (body.maxUsers !== undefined ? Number(body.maxUsers) : 50),
        maxHospitals: (body.maxHospitals !== undefined ? Number(body.maxHospitals) : 10),
        featureFlags: (body.featureFlags as OrganizationDoc['featureFlags']) || {
          epidemicIntelligence: false,
          mchAnalytics: false,
          dhis2Export: false,
          aiClinicalSupport: false,
          communityHealth: false,
          facilityAssessments: false,
        },
        orgType: (body.orgType as OrganizationDoc['orgType']) || 'public',
        isActive: true,
      },
      auth.sub,
      auth.username
    );
    return NextResponse.json({ organization: org }, { status: 201 });
  } catch (err) {
    logApiError('[API /organizations POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'organization.create' });
