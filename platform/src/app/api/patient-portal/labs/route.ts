import { logApiError } from '@/modules/identity';
import { NextRequest, NextResponse } from 'next/server';
import { verifyPatientToken } from '@/lib/patient-portal-auth';
import { demoFallbackEnabled, logDemoFallback, getDemoLabResultsByPatient } from '@/lib/patient-portal-demo';

export async function GET(req: NextRequest) {
  const auth = await verifyPatientToken(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { getLabResultsByPatient } = await import('@/lib/services/lab-service');
    const results = await getLabResultsByPatient(auth.sub);
    return NextResponse.json({ results });
  } catch (err) {
    if (demoFallbackEnabled()) {
      logDemoFallback('labs', err);
      return NextResponse.json({ results: await getDemoLabResultsByPatient(auth.sub) });
    }
    logApiError('[patient-portal/labs]', err);
    return NextResponse.json({ error: 'Failed to fetch lab results' }, { status: 500 });
  }
}
