/**
 * API: /api/blood-bank
 * GET   — List blood units (supports ?available=true, ?bloodGroup=, ?facilityId=, ?summary=true, ?expiring=true)
 * POST  — Add a new blood unit
 * PATCH — Update a unit (supports actions: reserve, crossmatch, transfuse, discard via ?action=)
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';
const READ_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'nurse',
  'pharmacist', 'medical_superintendent', 'lab_tech',
];
const WRITE_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'nurse', 'lab_tech',
  'medical_superintendent',
];
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, READ_ROLES)) return forbidden();
    const {
      getAllUnits, getAvailableUnits, getBloodInventorySummary, getExpiringUnits, getCompatibleGroups,
    } = await import('@/lib/services/blood-bank-service');
    const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
    const scope = buildScopeFromAuth(auth);
    const url = new URL(request.url);
    const summary = url.searchParams.get('summary');
    const expiring = url.searchParams.get('expiring');
    const available = url.searchParams.get('available');
    const bloodGroup = url.searchParams.get('bloodGroup') || undefined;
    const facilityId = url.searchParams.get('facilityId') || undefined;
    const compatible = url.searchParams.get('compatible');
    if (compatible) {
      const groups = await getCompatibleGroups(compatible);
      return NextResponse.json({ patientBloodGroup: compatible, compatibleDonorGroups: groups });
    }
    if (summary) {
      const data = await getBloodInventorySummary(facilityId, scope);
      return NextResponse.json(data);
    }
    if (expiring) {
      const days = parseInt(url.searchParams.get('days') || '7', 10);
      const units = await getExpiringUnits(days, facilityId, scope);
      return NextResponse.json({ units, total: units.length });
    }
    if (available) {
      const units = await getAvailableUnits(bloodGroup, facilityId, scope);
      return NextResponse.json({ units, total: units.length });
    }
    const units = await getAllUnits(scope);
    return NextResponse.json({ units, total: units.length });
  } catch (err) {
    logApiError('[API /blood-bank GET]', err);
    return serverError();
  }
}
async function postHandler(request: NextRequest) {
  try {
    const { checkRateLimit } = await import('@/lib/api-security');
    const rateLimitResponse = await checkRateLimit(request, 'blood-bank:write', 30);
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
    // Tenancy is stamped from the verified auth claim, never trusted from the
    // client -- a non-admin must not inject records into another org's tenant DB.
    // Platform/national admins may still target a specific org explicitly.
    if (auth.role !== 'super_admin' && auth.role !== 'government') {
      if (auth.orgId) body.orgId = auth.orgId;
      else delete body.orgId;
    }
    if (auth.role !== 'super_admin' && auth.role !== 'org_admin') {
      if (body.facilityId && auth.hospitalId && body.facilityId !== auth.hospitalId) {
        return forbidden('Cannot add blood units at a facility you are not assigned to');
      }
      body.facilityId = auth.hospitalId;
    }
    if (auth.role === 'org_admin') {
      const { getHospitalById } = await import('@/lib/services/hospital-service');
      // Scoped: after the tenant cutover the shared aggregate never receives a
      // facility a clinic registers, so an unscoped read returns null and this
      // cross-org guard silently passes on a facility it cannot see.
      const target = body.facilityId
        ? await getHospitalById(body.facilityId as string, { role: auth.role, orgId: auth.orgId })
        : null;
      if (target && target.orgId && auth.orgId && target.orgId !== auth.orgId) {
        return forbidden('Cannot add blood units in another organization');
      }
    }
    const { addUnit } = await import('@/lib/services/blood-bank-service');
    const unit = await addUnit(body as Parameters<typeof addUnit>[0]);
    return NextResponse.json({ unit }, { status: 201 });
  } catch (err) {
    logApiError('[API /blood-bank POST]', err);
    return serverError();
  }
}
async function patchHandler(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, WRITE_ROLES)) return forbidden();
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const action = url.searchParams.get('action');
    if (!id) return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 });
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const { sanitizePayload } = await import('@/lib/validation');
    body = sanitizePayload(body);
    const {
      updateUnit, reserveUnit, crossmatchUnit, recordTransfusion, discardUnit,
    } = await import('@/lib/services/blood-bank-service');
    const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
    const scope = buildScopeFromAuth(auth);
    let result;
    switch (action) {
      case 'reserve':
        if (!body.patientId) return NextResponse.json({ error: 'Missing patientId' }, { status: 400 });
        result = await reserveUnit(id, body.patientId as string, scope);
        break;
      case 'crossmatch':
        if (!body.result) return NextResponse.json({ error: 'Missing crossmatch result' }, { status: 400 });
        result = await crossmatchUnit(id, body.result as 'compatible' | 'incompatible' | 'pending', scope);
        break;
      case 'transfuse':
        if (!body.patientId) return NextResponse.json({ error: 'Missing patientId' }, { status: 400 });
        result = await recordTransfusion(id, body.patientId as string, auth.name || auth.sub, scope);
        break;
      case 'discard':
        if (!body.reason) return NextResponse.json({ error: 'Missing discard reason' }, { status: 400 });
        result = await discardUnit(id, body.reason as string, scope);
        break;
      default:
        result = await updateUnit(id, body, scope);
    }
    if (!result) return NextResponse.json({ error: 'Unit not found or action failed' }, { status: 404 });
    return NextResponse.json({ unit: result });
  } catch (err) {
    logApiError('[API /blood-bank PATCH]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'bloodbank.create' });
export const PATCH = withAuditLog(patchHandler, { action: 'bloodbank.update' });
