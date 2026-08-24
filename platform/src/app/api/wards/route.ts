/**
 * API: /api/wards
 * GET  — List wards + beds + occupancy (supports ?facilityId=xxx)
 * POST — Create a new ward, manage beds, admit/discharge patients
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';
import {
  WARD_ADMIT_ROLES,
  WARD_BED_ROLES,
  WARD_CONFIG_ROLES,
  WARD_DISCHARGE_ROLES,
} from '@/lib/clinical-flow/ward-permissions';
const READ_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'nurse',
  'midwife', 'medical_superintendent', 'clinician', 'triage_nurse',
  'rooming_nurse', 'hospital_manager',
];
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, READ_ROLES)) return forbidden();
    const {
      getAllWards, getBedsByWard, getOccupancyStats,
      getActiveAdmissions,
    } = await import('@/lib/services/ward-service');
    const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
    const scope = buildScopeFromAuth(auth);
    const url = new URL(request.url);
    const facilityId = url.searchParams.get('facilityId') || auth.hospitalId || '';
    const view = url.searchParams.get('view'); // 'beds', 'occupancy', 'admissions'
    if (view === 'occupancy') {
      const stats = await getOccupancyStats(facilityId, scope);
      return NextResponse.json(stats);
    }
    // Census view: system-wide bed occupancy across all facilities
    if (view === 'census') {
      const { getAllBeds } = await import('@/lib/services/ward-service');
      const [allWards, admissions, allBeds] = await Promise.all([
        getAllWards(scope), getActiveAdmissions(scope), getAllBeds(scope),
      ]);
      // Group by facility
      const facilityMap = new Map<string, {
        facilityId: string;
        totalBeds: number;
        occupiedBeds: number;
        availableBeds: number;
        occupancyRate: number;
        wards: { wardId: string; wardName: string; totalBeds: number; occupiedBeds: number }[];
      }>();
      for (const ward of allWards) {
        const fid = ward.facilityId || 'unknown';
        if (!facilityMap.has(fid)) {
          facilityMap.set(fid, {
            facilityId: fid,
            totalBeds: 0,
            occupiedBeds: 0,
            availableBeds: 0,
            occupancyRate: 0,
            wards: [],
          });
        }
        const f = facilityMap.get(fid)!;
        const wardBeds = allBeds.filter(bed => bed.wardId === ward._id);
        const total = wardBeds.length || ward.totalBeds || 0;
        const occupied = wardBeds.filter(bed => bed.status === 'occupied').length;
        f.totalBeds += total;
        f.occupiedBeds += occupied;
        f.wards.push({
          wardId: ward._id,
          wardName: ward.name,
          totalBeds: total,
          occupiedBeds: occupied,
        });
      }
      for (const f of facilityMap.values()) {
        f.availableBeds = f.totalBeds - f.occupiedBeds;
        f.occupancyRate = f.totalBeds > 0
          ? Math.round((f.occupiedBeds / f.totalBeds) * 100)
          : 0;
      }
      const facilities = Array.from(facilityMap.values())
        .sort((a, b) => b.occupancyRate - a.occupancyRate);
      const systemTotal = facilities.reduce((acc, f) => acc + f.totalBeds, 0);
      const systemOccupied = facilities.reduce((acc, f) => acc + f.occupiedBeds, 0);
      return NextResponse.json({
        census: {
          systemTotalBeds: systemTotal,
          systemOccupiedBeds: systemOccupied,
          systemAvailableBeds: systemTotal - systemOccupied,
          systemOccupancyRate: systemTotal > 0
            ? Math.round((systemOccupied / systemTotal) * 100)
            : 0,
          totalActiveAdmissions: admissions.length,
          facilities,
        },
      });
    }
    if (view === 'admissions') {
      const admissions = await getActiveAdmissions(scope);
      return NextResponse.json({ admissions, total: admissions.length });
    }
    if (view === 'beds') {
      const wardId = url.searchParams.get('wardId');
      if (!wardId) {
        return NextResponse.json({ error: 'wardId required for beds view' }, { status: 400 });
      }
      const beds = await getBedsByWard(wardId, scope);
      return NextResponse.json({ beds, total: beds.length });
    }
    // Default: list wards
    const wards = await getAllWards(scope);
    return NextResponse.json({ wards, total: wards.length });
  } catch (err) {
    logApiError('[API /wards GET]', err);
    return serverError();
  }
}
async function postHandler(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { sanitizePayload } = await import('@/lib/validation');
    body = sanitizePayload(body);
    const action = body.action as string;
    const { buildScopeFromAuth, filterByScope } = await import('@/lib/services/data-scope');
    const scope = buildScopeFromAuth(auth);
    // Admit patient
    if (action === 'admit') {
      if (!hasRole(auth, [...WARD_ADMIT_ROLES])) return forbidden();
      if (!body.patientId || !body.wardId || !body.admittingDiagnosis) {
        return NextResponse.json(
          { error: 'patientId, wardId, and admittingDiagnosis are required' },
          { status: 400 }
        );
      }
      const { admitPatient, getBedById, getWardById } = await import('@/lib/services/ward-service');
      const { getPatientById } = await import('@/lib/services/patient-service');
      const [ward, patient, bed] = await Promise.all([
        getWardById(body.wardId as string, scope),
        getPatientById(body.patientId as string),
        body.bedId ? getBedById(body.bedId as string, scope) : Promise.resolve(null),
      ]);
      if (!ward) return forbidden('Ward is outside your assigned facilities');
      if (!patient || filterByScope([patient], scope).length === 0) return forbidden('Patient is outside your assigned facilities');
      if (body.bedId && (!bed || bed.wardId !== ward._id)) {
        return NextResponse.json({ error: 'The selected bed does not belong to this ward' }, { status: 400 });
      }
      const admission = await admitPatient({
        patientId: patient._id,
        patientName: `${patient.firstName} ${patient.surname}`.trim(),
        hospitalNumber: patient.hospitalNumber,
        wardId: ward._id,
        wardName: ward.name,
        bedId: bed?._id,
        bedNumber: bed?.bedNumber,
        facilityId: ward.facilityId,
        facilityName: ward.facilityName,
        facilityLevel: ward.facilityLevel,
        admittedBy: auth.sub,
        admittedByName: auth.name,
        attendingPhysician: (body.attendingPhysician as string) || auth.sub,
        attendingPhysicianName: (body.attendingPhysicianName as string) || auth.name,
        admittingDiagnosis: body.admittingDiagnosis as string,
        icd11Code: body.icd11Code as string | undefined,
        severity: (body.severity as Parameters<typeof admitPatient>[0]['severity']) || 'moderate',
        isolationRequired: body.isolationRequired as boolean | undefined,
        isolationReason: body.isolationReason as string | undefined,
        state: (body.state as string) || '',
        county: body.county as string | undefined,
        orgId: auth.orgId,
      });
      return NextResponse.json({ admission }, { status: 201 });
    }
    // Discharge patient
    if (action === 'discharge') {
      if (!hasRole(auth, [...WARD_DISCHARGE_ROLES])) return forbidden();
      if (!body.admissionId) {
        return NextResponse.json(
          { error: 'admissionId is required' },
          { status: 400 }
        );
      }
      const { dischargePatient, getAdmissionById } = await import('@/lib/services/ward-service');
      const admission = await getAdmissionById(body.admissionId as string, scope);
      if (!admission) return forbidden('Admission is outside your assigned facilities');
      const result = await dischargePatient(
        body.admissionId as string,
        {
          dischargeType: (body.dischargeType as Parameters<typeof dischargePatient>[1]['dischargeType']) || 'normal',
          dischargeDiagnosis: body.dischargeDiagnosis as string | undefined,
          dischargeIcd11: body.dischargeIcd11 as string | undefined,
          dischargeSummary: body.dischargeSummary as string | undefined,
          dischargedBy: auth.sub,
          dischargedByName: auth.name,
          followUpRequired: body.followUpRequired as boolean | undefined,
          followUpDate: body.followUpDate as string | undefined,
          followUpInstructions: body.followUpInstructions as string | undefined,
          medicationReconciled: body.medicationReconciled as boolean | undefined,
        },
      );
      if (!result) return NextResponse.json({ error: 'Admission not found' }, { status: 404 });
      return NextResponse.json({ admission: result });
    }
    // Update bed status
    if (action === 'update_bed') {
      if (!hasRole(auth, [...WARD_BED_ROLES])) return forbidden();
      if (!body.bedId || !body.status) {
        return NextResponse.json(
          { error: 'bedId and status are required' },
          { status: 400 }
        );
      }
      const validStatuses = ['available', 'occupied', 'reserved', 'maintenance', 'cleaning'];
      if (!validStatuses.includes(body.status as string)) {
        return NextResponse.json({ error: 'Invalid bed status' }, { status: 400 });
      }
      const { getBedById, updateBedStatus } = await import('@/lib/services/ward-service');
      if (!await getBedById(body.bedId as string, scope)) return forbidden('Bed is outside your assigned facilities');
      const bed = await updateBedStatus(
        body.bedId as string,
        body.status as Parameters<typeof updateBedStatus>[1],
      );
      if (!bed) return NextResponse.json({ error: 'Bed not found' }, { status: 404 });
      return NextResponse.json({ bed });
    }
    // Create ward
    if (action && action !== 'create_ward') {
      return NextResponse.json({ error: 'Unknown ward action' }, { status: 400 });
    }
    if (!hasRole(auth, [...WARD_CONFIG_ROLES])) return forbidden();
    if (!body.name || !body.facilityId) {
      return NextResponse.json(
        { error: 'name and facilityId are required' },
        { status: 400 }
      );
    }
    if (auth.role !== 'super_admin' && auth.role !== 'org_admin') {
      if (body.facilityId && auth.hospitalId && body.facilityId !== auth.hospitalId) {
        return forbidden('Cannot create wards at a facility you are not assigned to');
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
      if (!target) return forbidden('Facility is outside your organization');
      if (target.orgId && auth.orgId && target.orgId !== auth.orgId) {
        return forbidden('Cannot create wards in another organization');
      }
    }
    // A ward's capacity is a claim about physical beds — never invent one.
    // The old `|| 10` default silently asserted a 10-bed ward for any POST
    // that omitted totalBeds (and swallowed an explicit 0), feeding the
    // national bed census a number nobody stated.
    const totalBeds = Number(body.totalBeds);
    if (!Number.isFinite(totalBeds) || totalBeds < 0) {
      return NextResponse.json({ error: 'totalBeds is required and must be a non-negative number' }, { status: 400 });
    }
    const { createWard } = await import('@/lib/services/ward-service');
    const ward = await createWard({
      name: body.name as string,
      wardType: (body.wardType as Parameters<typeof createWard>[0]['wardType']) || 'general_male',
      facilityId: body.facilityId as string,
      facilityName: (body.facilityName as string) || '',
      facilityLevel: (body.facilityLevel as Parameters<typeof createWard>[0]['facilityLevel']) || 'county',
      totalBeds,
      isActive: true,
      orgId: auth.orgId,
    });
    return NextResponse.json({ ward }, { status: 201 });
  } catch (err) {
    const workflow = err as { name?: string; code?: string; message?: string } | undefined;
    if (workflow?.name === 'WardWorkflowError') {
      const status = workflow.code === 'ADMISSION_NOT_FOUND'
        ? 404
        : workflow.code === 'DISCHARGE_INCOMPLETE'
          ? 400
          : 409;
      return NextResponse.json({ error: workflow.message || 'Ward workflow could not be completed', code: workflow.code }, { status });
    }
    logApiError('[API /wards POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'ward.workflow' });
