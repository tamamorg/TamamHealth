/**
 * API: /api/prescriptions/:id
 * PATCH — Update (e.g., dispense) a prescription
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';
const WRITE_ROLES: UserRole[] = [
  'super_admin', 'doctor', 'clinical_officer', 'pharmacist', 'medical_superintendent',
];
const PRESCRIBER_ROLES: UserRole[] = ['super_admin', 'doctor', 'clinical_officer', 'medical_superintendent'];
/** Drug-defining fields: prescriber-only, and only while nothing has been dispensed. */
const DRUG_FIELDS = ['medication', 'dose', 'quantityToDispense'] as const;
/** Part of the record of what was supplied: frozen once anything is dispensed, like DRUG_FIELDS. */
const SUPPLY_RECORD_FIELDS = ['route', 'frequency', 'duration', 'refills'] as const;
const PRESCRIBER_EDITABLE = [
  'route', 'frequency', 'duration', 'indication', 'allowSubstitution', 'refills',
  'effectiveOn', 'pharmacyInstructions', 'urgency',
] as const;
/** What the pharmacy may annotate without dispensing. */
const PHARMACY_EDITABLE = ['pharmacyInstructions'] as const;
async function patchHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, WRITE_ROLES)) return forbidden();
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    // A standalone demo deployment (NEXT_PUBLIC_DEMO_MODE='true', no CouchDB
    // admin credentials — see `isStandaloneDemo`) has no server-side
    // prescriptions database at all: every prescription lives only in the
    // browser's own PouchDB (see `db-seed.ts`) and never replicates anywhere
    // this route can read. `getPrescriptionById` below would answer "not
    // found" for every single id, which used to surface here as a
    // misleading 404 "Prescription not found" — indistinguishable from a
    // caller passing a bad id — every time this route was hit at all. The
    // client (`usePrescriptions.dispense`) now routes straight to the local
    // transaction on this deployment and should never reach this PATCH, but
    // answer honestly rather than 404 for any caller that still does (a
    // stale tab, a direct API consumer).
    const { isStandaloneDemo } = await import('@/modules/identity/core/server-users');
    if (isStandaloneDemo()) {
      return NextResponse.json(
        { error: 'This deployment keeps prescriptions on the device; dispense from the pharmacy screen.' },
        { status: 409 },
      );
    }
    // Tenant guard: only dispense/update a prescription the caller's
    // org/facility owns. Without this, a pharmacist could mark another tenant's
    // prescription dispensed (diversion) or rewrite dose/medication by id.
    const { getPrescriptionById } = await import('@/lib/services/prescription-service');
    const { buildScopeFromAuth, filterByScope } = await import('@/lib/services/data-scope');
    const existingRx = await getPrescriptionById(id);
    if (!existingRx) {
      return NextResponse.json({ error: 'Prescription not found' }, { status: 404 });
    }
    if (filterByScope([existingRx], buildScopeFromAuth(auth)).length === 0) {
      return forbidden('Access denied to this prescription.');
    }
    // ── Dispense: one server-side transaction ──
    // Stock gate, FEFO decrement, controlled-substance register and the
    // prescription update all happen inside dispenseMedication(), which rolls
    // back anything already applied if a later step fails. The client can no
    // longer perform these as separate writes, so a half-finished dispense is
    // not reachable from the UI.
    if (body.status === 'dispensed' || body.action === 'dispense') {
      const { dispenseMedication, DispenseError } = await import('@/lib/services/dispensing-service');
      try {
        const result = await dispenseMedication({
          prescription: existingRx,
          quantity: Number(body.quantity) || existingRx.quantityToDispense || 1,
          dispenserId: auth.sub,
          dispenserName: auth.name,
          // From the verified JWT, not the directory — dispenseMedication()
          // resolves the directory role first and only falls back to this
          // when no user record exists at all, but the API path should not
          // depend on that directory read succeeding. WRITE_ROLES above is
          // intentionally broader than dispensing (it also covers stock_out,
          // request_clarification and the generic update below); the actual
          // dispense-role restriction to 'pharmacist' lives in
          // dispenseMedication() itself, which is what makes this PATCH now
          // correctly refuse a dispense from a doctor/clinical_officer/
          // medical_superintendent/super_admin caller.
          dispenserRole: auth.role,
          facilityId: existingRx.hospitalId || auth.hospitalId || '',
          facilityName: existingRx.hospitalName,
          orgId: existingRx.orgId ?? auth.orgId,
          witnessId: typeof body.witnessId === 'string' ? body.witnessId : undefined,
          witnessName: typeof body.witnessName === 'string' ? body.witnessName : undefined,
          // A short fill has to be asked for explicitly — see PARTIAL_NOT_ALLOWED.
          allowPartial: body.allowPartial === true,
          note: typeof body.note === 'string' ? body.note : undefined,
          counsellingConfirmed: body.counsellingConfirmed === true,
          allergyReview: typeof body.allergyReview === 'string' ? body.allergyReview : undefined,
        });
        return NextResponse.json({
          prescription: result.prescription,
          allocations: result.allocations,
          quantityDispensed: result.quantityDispensed,
          outcome: result.outcome,
          controlledLogId: result.controlledLogId,
          controlledLogIds: result.controlledLogIds,
        });
      } catch (err) {
        if (err instanceof DispenseError) {
          // 409 for "the shelf says no" (stock/clearance/ambiguity — state the
          // caller must resolve before retrying), 403 for "you may not do
          // this at all" (actor authorization — WRITE_ROLES above only gates
          // the PATCH generally; NOT_AUTHORISED is dispenseMedication()'s own
          // pharmacist-only check), 400 for everything else (missing or
          // unverifiable witness, nonsense quantity, unconfirmed partial).
          // The client shows the message either way, but the codes stay
          // meaningful.
          const status = err.code === 'STOCK_OUT' || err.code === 'INSUFFICIENT_STOCK'
            || err.code === 'NOT_CLEARED' || err.code === 'AMBIGUOUS_MEDICATION'
            || err.code === 'ALLERGY_REVIEW_REQUIRED' ? 409
            : err.code === 'NOT_AUTHORISED' ? 403
            : 400;
          return NextResponse.json(
            { error: err.message, code: err.code, available: err.available },
            { status },
          );
        }
        throw err;
      }
    }

    // ── Unfilled outcomes: stock-out referral, or held for prescriber
    // clarification. Both keep the order active. ──
    if (body.action === 'stock_out' || body.action === 'request_clarification') {
      const { recordUnfilled } = await import('@/lib/services/dispensing-service');
      const updated = await recordUnfilled(
        existingRx,
        body.action === 'stock_out' ? 'stock_out' : 'clarification_requested',
        typeof body.note === 'string' ? body.note : '',
        { id: auth.sub, name: auth.name },
      );
      if (!updated) {
        return NextResponse.json({ error: 'Prescription not found' }, { status: 404 });
      }
      return NextResponse.json({ prescription: updated });
    }
    // Generic update -- an explicit allow-list, never a body merge.
    // Dispensing lifecycle (status, orderStatus, dispense*, stock, counselling,
    // controlled-substance log) moves ONLY through the dispense / stock_out /
    // request_clarification actions above. Identity, tenancy and authorship
    // (patientId, orgId, hospitalId, prescribedBy, _id, _rev, type, createdAt)
    // are never accepted from the body.
    if ('status' in body || 'orderStatus' in body) {
      return forbidden('Prescription status changes go through the dispense, stock-out or clarification actions.');
    }
    const isPrescriber = hasRole(auth, PRESCRIBER_ROLES);
    const touchesDrug = [...DRUG_FIELDS, ...SUPPLY_RECORD_FIELDS].some(f => f in body);
    if (touchesDrug) {
      if (!isPrescriber) {
        return forbidden('Only a prescriber can change the medication, dose, quantity, route, frequency, duration or refills of a prescription.');
      }
      if (existingRx.status !== 'pending' || existingRx.dispensedAt || (existingRx.quantityDispensed ?? 0) > 0) {
        return NextResponse.json(
          { error: 'A prescription that has been dispensed or stopped cannot be amended.' },
          { status: 409 },
        );
      }
    }
    const allowed = isPrescriber ? [...PRESCRIBER_EDITABLE, ...DRUG_FIELDS] : PHARMACY_EDITABLE;
    const patch: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body && body[key] !== undefined) patch[key] = body[key];
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No editable fields supplied' }, { status: 400 });
    }
    const { sanitizePayload } = await import('@/lib/validation');
    const clean = sanitizePayload(patch);
    const { updatePrescription } = await import('@/lib/services/prescription-service');
    const updated = await updatePrescription(id, clean);
    if (!updated) {
      return NextResponse.json({ error: 'Prescription not found' }, { status: 404 });
    }
    return NextResponse.json({ prescription: updated });
  } catch (err) {
    logApiError('[API /prescriptions/:id PATCH]', err);
    return serverError();
  }
}
export const PATCH = withAuditLog(patchHandler, { action: 'prescription.update' });
