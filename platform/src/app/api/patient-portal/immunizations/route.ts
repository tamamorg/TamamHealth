import { logApiError } from '@/modules/identity';
import { NextRequest, NextResponse } from 'next/server';
import { verifyPatientToken } from '@/lib/patient-portal-auth';
import { demoFallbackEnabled, logDemoFallback, getDemoImmunizationsByPatient } from '@/lib/patient-portal-demo';

export async function GET(req: NextRequest) {
  const auth = await verifyPatientToken(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { getByPatient } = await import('@/lib/services/immunization-service');
    const immunizations = await getByPatient(auth.sub);
    return NextResponse.json({ immunizations });
  } catch (err) {
    if (demoFallbackEnabled()) {
      logDemoFallback('immunizations', err);
      return NextResponse.json({ immunizations: await getDemoImmunizationsByPatient(auth.sub) });
    }
    logApiError('[patient-portal/immunizations]', err);
    return NextResponse.json({ error: 'Failed to fetch immunizations' }, { status: 500 });
  }
}
