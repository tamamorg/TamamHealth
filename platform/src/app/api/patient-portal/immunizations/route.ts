import { logApiError } from '@/modules/identity';
import { NextRequest, NextResponse } from 'next/server';
import { verifyPatientToken } from '@/lib/patient-portal-auth';
import { demoFallbackEnabled, logDemoFallback, getDemoImmunizationsByPatient } from '@/lib/patient-portal-demo';

export async function GET(req: NextRequest) {
  const auth = await verifyPatientToken(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { getByPatientUnscopedForPortal } = await import('@/lib/services/immunization-service');
    const immunizations = await getByPatientUnscopedForPortal(auth.sub);
    return NextResponse.json({ immunizations });
  } catch (err) {
    if (demoFallbackEnabled()) {
      logDemoFallback('immunizations', err);
      return NextResponse.json({ immunizations: await getDemoImmunizationsByPatient(auth.sub) });
    }
    logApiError('[patient-portal/immunizations]', err);
    return NextResponse.json({ error: 'Your immunizations could not be loaded. Try again.' }, { status: 500 });
  }
}
