/**
 * API: /api/drug-interactions
 * GET  — Check interactions for a list of medications
 * POST — Check a new prescription against current medications
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';
const READ_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'nurse',
  'pharmacist', 'medical_superintendent',
];
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, READ_ROLES)) return forbidden();
    const {
      checkInteractions,
      getInteractionsForDrug,
    } = await import('@/lib/services/drug-interaction-service');
    const drug = request.nextUrl.searchParams.get('drug');
    const medications = request.nextUrl.searchParams.get('medications');
    if (drug) {
      const interactions = getInteractionsForDrug(drug);
      return NextResponse.json({ drug, interactions });
    }
    if (medications) {
      const meds = medications.split(',').map(m => m.trim()).filter(Boolean);
      const result = checkInteractions(meds);
      return NextResponse.json(result);
    }
    return NextResponse.json(
      { error: 'Provide ?drug=name or ?medications=med1,med2,...' },
      { status: 400 }
    );
  } catch (err) {
    logApiError('[API /drug-interactions GET]', err);
    return serverError();
  }
}
async function postHandler(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, READ_ROLES)) return forbidden();
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { sanitizePayload } = await import('@/lib/validation');
    body = sanitizePayload(body);
    const { checkNewPrescription } = await import('@/lib/services/drug-interaction-service');
    const newMedication = body.newMedication as string;
    const currentMedications = body.currentMedications as string[];
    if (!newMedication) {
      return NextResponse.json({ error: 'newMedication is required' }, { status: 400 });
    }
    const result = checkNewPrescription(
      newMedication,
      Array.isArray(currentMedications) ? currentMedications : []
    );
    return NextResponse.json(result);
  } catch (err) {
    logApiError('[API /drug-interactions POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'drug.interaction.check' });
