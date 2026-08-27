/**
 * API: /api/triage
 * GET  — List triage encounters (supports ?status=pending&patientId=xxx)
 * POST — Create a new triage assessment (ETAT model)
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole, TriageDoc, TriagePriority } from '@/lib/db-types';
import { calculateBmi, isLowerTriagePriority, parseStrictVitalNumber, validateTriageVitals } from '@/lib/clinical/vitals';
import {
  filterKnownIittCodes,
  highestTriagePriority,
  IITT_RED_CRITERIA,
  IITT_YELLOW_CRITERIA,
  INFECTION_RISK_SIGNS,
  priorityFromIittCriteria,
} from '@/lib/clinical/iitt';
const READ_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'clinician', 'nurse',
  'midwife', 'triage_nurse', 'front_desk', 'medical_superintendent',
];
const CREATE_ROLES: UserRole[] = [
  'super_admin', 'doctor', 'clinical_officer', 'clinician', 'nurse', 'front_desk',
  'midwife', 'triage_nurse', 'medical_superintendent',
];
/**
 * Auto-calculate ETAT priority from ABCC assessment.
 * RED = any emergency sign; YELLOW = priority sign; GREEN = non-urgent.
 */
function calculatePriority(data: Record<string, unknown>): TriagePriority {
  if (
    data.airway === 'obstructed' ||
    data.breathing === 'absent' ||
    data.circulation === 'absent' ||
    data.consciousness === 'unresponsive'
  ) {
    return 'RED';
  }
  if (
    data.breathing === 'distressed' ||
    data.circulation === 'impaired' ||
    data.consciousness === 'pain' ||
    data.consciousness === 'verbal'
  ) {
    return 'YELLOW';
  }
  return 'GREEN';
}
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, READ_ROLES)) return forbidden();
    const { getDB } = await import('@/lib/db');
    const { buildScopeFromAuth, filterByScope } = await import('@/lib/services/data-scope');
    const db = getDB('tamamhealth_triage');
    const result = await db.allDocs({ include_docs: true });
    // Scope to the caller's org/facility before returning. Without this the
    // route returned every tenant's triage records (clinical PHI) to any
    // read-eligible role — a cross-tenant leak. filterByScope exempts
    // super_admin / national government, matching the other list routes.
    let docs = filterByScope(
      result.rows
        .map(r => r.doc as TriageDoc)
        .filter(d => d && d.type === 'triage'),
      buildScopeFromAuth(auth),
    ).sort((a, b) => (b.triagedAt || '').localeCompare(a.triagedAt || ''));
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const patientId = url.searchParams.get('patientId');
    if (status) docs = docs.filter(d => d.status === status);
    if (patientId) docs = docs.filter(d => d.patientId === patientId);
    // PHI read audit (KAN-97). Fire-and-forget: a failed audit write
    // must never turn a clinician's list view into an error.
    import('@/lib/services/audit-service').then(({ logPhiSearch }) =>
      logPhiSearch(
        { userId: auth.sub, username: auth.name, role: auth.role, orgId: auth.orgId, hospitalId: auth.hospitalId, route: '/api/triage' },
        'triage',
        { query: new URL(request.url).searchParams.get('q') || undefined, resultCount: Array.isArray(docs) ? docs.length : 0 },
      ),
    ).catch(() => {});
    return NextResponse.json({ triageRecords: docs, total: docs.length });
  } catch (err) {
    logApiError('[API /triage GET]', err);
    return serverError();
  }
}
async function postHandler(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, CREATE_ROLES)) return forbidden();
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { sanitizePayload } = await import('@/lib/validation');
    body = sanitizePayload(body);
    if (!body.patientId || !body.patientName) {
      return NextResponse.json(
        { error: 'patientId and patientName are required' },
        { status: 400 }
      );
    }
    const vitalErrors = validateTriageVitals({
      temperature: body.temperature as string | undefined,
      pulse: body.pulse as string | undefined,
      respiratoryRate: body.respiratoryRate as string | undefined,
      oxygenSaturation: body.oxygenSaturation as string | undefined,
      systolic: body.systolic as string | undefined,
      diastolic: body.diastolic as string | undefined,
      weight: body.weight as string | undefined,
      height: body.height as string | undefined,
      painScore: body.painScore as string | undefined,
      bloodGlucose: body.bloodGlucose as string | undefined,
      gcs: body.gcs as string | undefined,
      muac: body.muac as string | undefined,
    });
    if (Object.keys(vitalErrors).length > 0) {
      return NextResponse.json({ error: 'Invalid vital signs', fields: vitalErrors }, { status: 400 });
    }
    const capillaryRefill = parseStrictVitalNumber(body.capillaryRefillSeconds as string | undefined);
    if (body.capillaryRefillSeconds && (capillaryRefill === null || capillaryRefill < 0 || capillaryRefill > 10)) {
      return NextResponse.json({ error: 'Capillary refill must be between 0 and 10 seconds.' }, { status: 400 });
    }
    const gestationalAge = parseStrictVitalNumber(body.gestationalAgeWeeks as string | undefined);
    if (body.gestationalAgeWeeks && (gestationalAge === null || !Number.isInteger(gestationalAge) || gestationalAge < 0 || gestationalAge > 45)) {
      return NextResponse.json({ error: 'Gestational age must be a whole number from 0 to 45 weeks.' }, { status: 400 });
    }
    const requestedPriority = ['RED', 'YELLOW', 'GREEN'].includes(String(body.priority))
      ? body.priority as TriagePriority
      : undefined;
    body.priority = requestedPriority || calculatePriority(body);
    const redCriteria = filterKnownIittCodes(body.redCriteria, IITT_RED_CRITERIA);
    const yellowCriteria = filterKnownIittCodes(body.yellowCriteria, IITT_YELLOW_CRITERIA);
    const suppliedRecommendation = ['RED', 'YELLOW', 'GREEN'].includes(String(body.vitalUrgencyRecommendation))
      ? body.vitalUrgencyRecommendation as TriagePriority
      : undefined;
    const recommendation = highestTriagePriority(
      priorityFromIittCriteria(redCriteria, yellowCriteria, capillaryRefill),
      suppliedRecommendation,
    );
    const overrideReason = typeof body.vitalUrgencyOverrideReason === 'string'
      ? body.vitalUrgencyOverrideReason.trim()
      : '';
    if (
      recommendation &&
      isLowerTriagePriority(body.priority as TriagePriority, recommendation) &&
      (body.vitalUrgencyOverridden !== true || !overrideReason)
    ) {
      return NextResponse.json(
        { error: 'Saving below the recommended triage urgency requires a recorded override reason.' },
        { status: 400 },
      );
    }
    const vitalString = (value: unknown): string | undefined =>
      value === undefined || value === null || value === '' ? undefined : String(value).trim();
    const { v4: uuidv4 } = await import('uuid');
    const { getDB } = await import('@/lib/db');
    const db = getDB('tamamhealth_triage');
    const now = new Date().toISOString();
    const doc: TriageDoc = {
      _id: `triage-${uuidv4()}`,
      type: 'triage',
      patientId: body.patientId as string,
      patientName: body.patientName as string,
      hospitalNumber: body.hospitalNumber as string | undefined,
      // A missing ABCC dimension is recorded as exactly that — defaulting to a
      // normal-looking value would fabricate a finding no clinician made
      // (KAN-100).
      airway: (body.airway as TriageDoc['airway']) || 'not_assessed',
      breathing: (body.breathing as TriageDoc['breathing']) || 'not_assessed',
      circulation: (body.circulation as TriageDoc['circulation']) || 'not_assessed',
      consciousness: (body.consciousness as TriageDoc['consciousness']) || 'not_assessed',
      assessmentSource: body.assessmentSource === 'clerical_checkin' ? 'clerical_checkin' : 'clinician',
      priority: body.priority as TriagePriority,
      temperature: vitalString(body.temperature),
      pulse: vitalString(body.pulse),
      respiratoryRate: vitalString(body.respiratoryRate),
      systolic: vitalString(body.systolic),
      diastolic: vitalString(body.diastolic),
      oxygenSaturation: vitalString(body.oxygenSaturation),
      weight: vitalString(body.weight),
      height: vitalString(body.height),
      bmi: calculateBmi(body.weight as string | undefined, body.height as string | undefined) || undefined,
      painScore: vitalString(body.painScore),
      bloodGlucose: vitalString(body.bloodGlucose),
      gcs: vitalString(body.gcs),
      muac: vitalString(body.muac),
      vitalUrgencyRecommendation: recommendation,
      vitalUrgencyWarnings: Array.isArray(body.vitalUrgencyWarnings)
        ? body.vitalUrgencyWarnings as TriageDoc['vitalUrgencyWarnings']
        : undefined,
      vitalUrgencyOverridden: body.vitalUrgencyOverridden === true,
      vitalUrgencyOverrideReason: overrideReason || undefined,
      presentationCategory: body.presentationCategory as TriageDoc['presentationCategory'],
      triagePathway: body.triagePathway === 'pediatric_under_12' ? 'pediatric_under_12' : 'adult_12_plus',
      redCriteria,
      yellowCriteria,
      capillaryRefillSeconds: vitalString(body.capillaryRefillSeconds),
      pregnancyStatus: body.pregnancyStatus as TriageDoc['pregnancyStatus'],
      gestationalAgeWeeks: body.pregnancyStatus === 'pregnant' ? vitalString(body.gestationalAgeWeeks) : undefined,
      injuryMechanism: body.presentationCategory === 'trauma' ? body.injuryMechanism as string | undefined : undefined,
      infectionRiskSigns: filterKnownIittCodes(body.infectionRiskSigns, INFECTION_RISK_SIGNS),
      isolationRequired: body.isolationRequired === true,
      preArrivalCare: body.preArrivalCare as string | undefined,
      immediateInterventions: body.immediateInterventions as string | undefined,
      chiefComplaint: body.chiefComplaint as string | undefined,
      notes: body.notes as string | undefined,
      triagedBy: auth.sub,
      triagedByName: auth.name,
      triagedAt: now,
      facilityId: auth.hospitalId,
      facilityName: body.facilityName as string | undefined,
      orgId: auth.orgId,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    const resp = await db.put(doc);
    doc._rev = resp.rev;
    return NextResponse.json({ triage: doc }, { status: 201 });
  } catch (err) {
    logApiError('[API /triage POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'triage.create' });
