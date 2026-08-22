/**
 * API: /api/supply-chain
 * GET  — Stock alerts, supply chain summary, consumption trends
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import type { UserRole } from '@/lib/db-types';
const READ_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'pharmacist', 'medical_superintendent',
  'doctor', 'clinical_officer', 'nurse', 'government',
];
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, READ_ROLES)) return forbidden();
    const {
      getStockAlerts,
      getSupplyChainSummary,
      getConsumptionTrend,
    } = await import('@/lib/services/supply-chain-service');
    const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
    const scope = buildScopeFromAuth(auth);
    const facilityId = request.nextUrl.searchParams.get('facilityId') || undefined;
    const view = request.nextUrl.searchParams.get('view');
    const medication = request.nextUrl.searchParams.get('medication');
    if (view === 'alerts') {
      const alerts = await getStockAlerts(facilityId, scope);
      return NextResponse.json({ alerts });
    }
    if (view === 'trend' && medication) {
      const trend = await getConsumptionTrend(medication, facilityId, scope);
      return NextResponse.json({ trend });
    }
    // Default: full supply chain summary
    const summary = await getSupplyChainSummary(facilityId, scope);
    return NextResponse.json({ summary });
  } catch (err) {
    logApiError('[API /supply-chain GET]', err);
    return serverError();
  }
}
