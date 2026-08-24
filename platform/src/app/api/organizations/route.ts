/**
 * API: /api/organizations
 * GET  — List organizations, get by ID or slug, get stats
 * POST — Create organization, update organization, or deactivate organization
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole, OrganizationDoc } from '@/lib/db-types';
import { ROLE_ROUTE_TABLE } from '@/lib/role-routes';
import { TENANCY_WORKSPACE_ROLES } from '@/modules/tenancy';
const READ_ROLES = TENANCY_WORKSPACE_ROLES;
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
    const seesEveryOrganization = auth.role === 'super_admin' || auth.role === 'government';
    const ownOrgId = seesEveryOrganization ? undefined : auth.orgId;
    if (!seesEveryOrganization && !ownOrgId) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }
    if (id) {
      if (ownOrgId && id !== ownOrgId) {
        return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
      }
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
      if (!org || (ownOrgId && org._id !== ownOrgId)) {
        return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
      }
      if (withStats) {
        const stats = await getOrganizationStats(org._id);
        return NextResponse.json({ organization: org, stats });
      }
      return NextResponse.json({ organization: org });
    }
    if (orgId && withStats) {
      if (ownOrgId && orgId !== ownOrgId) {
        return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
      }
      const stats = await getOrganizationStats(orgId);
      return NextResponse.json({ stats });
    }
    if (ownOrgId) {
      const org = await getOrganizationById(ownOrgId);
      return NextResponse.json({ organizations: org ? [org] : [] });
    }
    const organizations = await getAllOrganizations();
    return NextResponse.json({ organizations });
  } catch (err) {
    logApiError('[API /organizations GET]', err);
    return serverError();
  }
}
/**
 * The organization's staff-role roster, validated against the real role table.
 *
 * Returns undefined for anything that is not a non-empty array of known roles,
 * which is the documented "not configured" value — the org admin is then
 * offered every role their organization type allows, exactly as before the
 * field existed. Unknown strings are dropped rather than stored, so a typo or
 * a renamed role cannot quietly shrink a tenant's picker later.
 */
function sanitizeEnabledRoles(value: unknown): UserRole[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const known = new Set<string>(Object.keys(ROLE_ROUTE_TABLE));
  const roles = value.filter((r): r is UserRole => typeof r === 'string' && known.has(r));
  return roles.length > 0 ? roles : undefined;
}

/** The organization fields the super-admin form may change, read off a request body. */
function editableOrganizationFields(body: Record<string, unknown>): Partial<OrganizationDoc> {
  const fields: Partial<OrganizationDoc> = {};
  const str = (key: keyof OrganizationDoc) => {
    const v = body[key as string];
    if (typeof v === 'string') (fields as Record<string, unknown>)[key as string] = v;
  };
  const num = (key: keyof OrganizationDoc) => {
    const v = body[key as string];
    if (v !== undefined && v !== null && Number.isFinite(Number(v))) {
      (fields as Record<string, unknown>)[key as string] = Number(v);
    }
  };
  (['name', 'slug', 'contactEmail', 'country', 'primaryColor', 'secondaryColor',
    'accentColor', 'orgType', 'subscriptionPlan', 'subscriptionStatus', 'locale',
    'bankDetails', 'logoUrl'] as (keyof OrganizationDoc)[]).forEach(str);
  (['maxUsers', 'maxHospitals', 'lockTimeoutMinutes'] as (keyof OrganizationDoc)[]).forEach(num);
  if (body.featureFlags && typeof body.featureFlags === 'object') {
    fields.featureFlags = body.featureFlags as OrganizationDoc['featureFlags'];
  }
  // Present-but-empty is a real choice here ("clear the roster"), so the key is
  // written whenever the caller sent an array at all.
  if (Array.isArray(body.enabledRoles)) fields.enabledRoles = sanitizeEnabledRoles(body.enabledRoles);
  return fields;
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
    // Put a deactivated tenant back into service — the Trash's undo.
    if (action === 'restore') {
      if (!body.orgId) {
        return NextResponse.json({ error: 'orgId is required' }, { status: 400 });
      }
      const { restoreOrganization } = await import('@/lib/services/organization-service');
      await restoreOrganization(body.orgId as string, auth.sub, auth.username);
      return NextResponse.json({ success: true });
    }
    // Delete a tenant for good. Deleting the parent does not delete what it
    // owns — those documents carry the `orgId` as a plain string and would be
    // stranded behind a scope match that can never succeed again. So the
    // service either refuses, or (with `cascade`) removes the facilities and
    // staff accounts along with the tenant. Only `super_admin` reaches here at
    // all: WRITE_ROLES above is that role and nothing else.
    if (action === 'purge') {
      if (!body.orgId) {
        return NextResponse.json({ error: 'orgId is required' }, { status: 400 });
      }
      const { purgeOrganization, OrganizationNotEmptyError } = await import('@/lib/services/organization-service');
      try {
        await purgeOrganization(body.orgId as string, auth.sub, auth.username, {
          cascade: body.cascade === true,
        });
      } catch (err) {
        if (err instanceof OrganizationNotEmptyError) {
          const { hospitalCount, userCount, patientCount } = err.counts;
          // Two different refusals, and the operator can act on only one of
          // them. Telling someone to "move or remove them first" when the way
          // through is the dialog they are already looking at is the kind of
          // dead end that makes an admin console feel broken.
          //
          // The cascadable branch is reachable only when the tenant gained a
          // facility or staff account after Trash counted it — the panel sends
          // `cascade` whenever it knows of any — so it asks for a fresh count
          // rather than describing a control that is not on screen.
          const held = `Facilities: ${hospitalCount}, staff accounts: ${userCount}, patients: ${patientCount}.`;
          return NextResponse.json({
            error: err.cascadable
              ? `This organization gained records since Trash last counted it. ${held} `
                + 'Reload Trash and delete it again — the dialog will confirm removing them with it.'
              : `This organization still holds ${patientCount} patient record(s), so it cannot be deleted. ${held} `
                + 'Transfer or export the patients first — deleting the organization would strand their charts, '
                + 'not remove them.',
            counts: { hospitalCount, userCount, patientCount },
            cascadable: err.cascadable,
          }, { status: 409 });
        }
        throw err;
      }
      return NextResponse.json({ success: true });
    }
    // Update existing organization.
    //
    // This used to accept only name and slug, so every other field the
    // super-admin can edit — plan, limits, branding, feature flags, staff roles
    // — was silently dropped on save. The organization form writes through this
    // route (organization-service routes browser writes here, because the
    // organizations database refuses client writes outright), so anything not
    // listed below is a field the UI cannot actually change.
    if (action === 'update' && body.orgId) {
      const { updateOrganization } = await import('@/lib/services/organization-service');
      const updated = await updateOrganization(
        body.orgId as string,
        editableOrganizationFields(body),
        auth.sub,
        auth.username
      );
      return NextResponse.json({ organization: updated });
    }
    if (process.env.SINGLE_ORG_MODE === 'true') {
      const { getAllOrganizations } = await import('@/lib/services/organization-service');
      const existingOrganizations = await getAllOrganizations();
      // Single-org mode limits the deployment to one tenant; it must not make
      // an empty installation impossible to bootstrap. The first organization
      // is allowed, and every later create is rejected.
      if (existingOrganizations.length > 0) {
        return NextResponse.json(
          { error: 'This deployment currently supports one organization. Add staff to the existing organization.' },
          { status: 409 },
        );
      }
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
        primaryColor: (body.primaryColor as string) || 'var(--accent-primary)',
        secondaryColor: (body.secondaryColor as string) || 'var(--accent-hover)',
        accentColor: body.accentColor as string | undefined,
        subscriptionStatus: (body.subscriptionStatus as OrganizationDoc['subscriptionStatus']) || 'trial',
        subscriptionPlan: (body.subscriptionPlan as OrganizationDoc['subscriptionPlan']) || 'basic',
        maxUsers: (body.maxUsers !== undefined ? Number(body.maxUsers) : 50),
        maxHospitals: (body.maxHospitals !== undefined ? Number(body.maxHospitals) : 10),
        featureFlags: (body.featureFlags as OrganizationDoc['featureFlags']) || {
          epidemicIntelligence: false,
          mchAnalytics: false,
          dhis2Export: false,
          communityHealth: false,
          facilityAssessments: false,
        },
        orgType: (body.orgType as OrganizationDoc['orgType']) || 'public',
        enabledRoles: sanitizeEnabledRoles(body.enabledRoles),
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
