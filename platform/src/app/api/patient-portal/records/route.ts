import { logApiError } from '@/modules/identity';
import { NextRequest, NextResponse } from 'next/server';
import { verifyPatientToken } from '@/lib/patient-portal-auth';
import { demoFallbackEnabled, logDemoFallback, getDemoRecordsByPatient } from '@/lib/patient-portal-demo';

export async function GET(req: NextRequest) {
  const auth = await verifyPatientToken(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { getRecordsByPatient } = await import('@/lib/services/medical-record-service');
    const records = await getRecordsByPatient(auth.sub);
    return NextResponse.json({ records });
  } catch (err) {
    if (demoFallbackEnabled()) {
      logDemoFallback('records', err);
      return NextResponse.json({ records: await getDemoRecordsByPatient(auth.sub) });
    }
    logApiError('[patient-portal/records]', err);
    return NextResponse.json({ error: 'Your records could not be loaded. Try again.' }, { status: 500 });
  }
}
