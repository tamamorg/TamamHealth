import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';

// Eligibility checks are billing-flow operations; restricted to staff who
// handle payments / claims as well as clinicians who may need to confirm
// coverage before ordering a procedure.
const ELIGIBILITY_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'medical_superintendent',
  'doctor', 'clinical_officer', 'nurse', 'front_desk', 'medical_biller',
];

interface EligibilityRequest {
  policyId: string;
  patientId: string;
  serviceDate?: string;
}

interface EligibilityResult {
  status: 'verified' | 'denied' | 'pending';
  source: 'api' | 'cache';
  checkedAt: string;
  patientId: string;
  policyId: string;
  serviceDate: string;
  copayAmount: number;
  coinsurancePct: number;
  deductibleRemaining: number;
  notes: string;
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

async function postHandler(req: NextRequest) {
  try {
    const auth = await getAuthPayload(req);
    if (!auth) return unauthorized();
    if (!hasRole(auth, ELIGIBILITY_ROLES)) return forbidden();

    let body: EligibilityRequest;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { policyId, patientId, serviceDate } = body;

    // Validate required fields
    if (!policyId || !patientId) {
      return NextResponse.json(
        { error: 'policyId and patientId are required' },
        { status: 400 }
      );
    }

    // Use provided service date or today
    const checkDate = serviceDate || formatDate(new Date());

    // No real payer EDI (270/271) integration is wired up yet. We must NOT
    // fabricate a "verified" result with invented copay/coinsurance figures —
    // a clinician or biller would treat that as confirmed coverage before a
    // procedure. Return an honest "pending / manual verification required"
    // with no fabricated financials until a real payer connector exists.
    // When integrated, replace this with:
    //   const eligibilityData = await PayerEDIService.check270(patientId, policyId, checkDate)
    const eligibilityResult: EligibilityResult = {
      status: 'pending',
      source: 'api',
      checkedAt: new Date().toISOString(),
      patientId,
      policyId,
      serviceDate: checkDate,
      copayAmount: 0,
      coinsurancePct: 0,
      deductibleRemaining: 0,
      notes: 'Automated payer verification is not configured — confirm coverage manually with the payer before relying on it.',
    };

    console.log('[Eligibility API] Eligibility check completed:', {
      status: eligibilityResult.status,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json(eligibilityResult);
  } catch (error) {
    logApiError('[API /eligibility POST]', error);
    return serverError();
  }
}

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthPayload(req);
    if (!auth) return unauthorized();
    if (!hasRole(auth, ELIGIBILITY_ROLES)) return forbidden();

    const { searchParams } = new URL(req.url);
    const patientId = searchParams.get('patientId');

    if (!patientId) {
      return NextResponse.json(
        { error: 'patientId query parameter is required' },
        { status: 400 }
      );
    }

    // No stored eligibility history yet (no payer connector). Report an honest
    // "pending" rather than a fabricated "verified" status.
    const response = {
      patientId,
      status: 'pending',
      lastChecked: null,
      message:
        'Automated payer verification is not configured. Use POST with policyId and serviceDate once a payer connector is available; until then confirm coverage manually.',
    };

    return NextResponse.json(response);
  } catch (error) {
    logApiError('[API /eligibility GET]', error);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'eligibility.check' });
