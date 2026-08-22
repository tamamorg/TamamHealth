import { logApiError } from '@/modules/identity';
import { NextRequest, NextResponse } from 'next/server';
import { verifyPatientToken } from '@/lib/patient-portal-auth';
import { demoFallbackEnabled, logDemoFallback, getDemoBillingByPatient } from '@/lib/patient-portal-demo';

export async function GET(req: NextRequest) {
  const auth = await verifyPatientToken(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const paymentMod = await import('@/lib/services/payment-service');
    const ledgerMod = await import('@/lib/services/ledger-service');
    const billingMod = await import('@/lib/services/billing-service');

    const [payments, charges, plans, claims, policies, summary, balance, ledger, bills] = await Promise.all([
      paymentMod.getPaymentsByPatient(auth.sub),
      paymentMod.getChargesByPatient(auth.sub),
      paymentMod.getPaymentPlansByPatient(auth.sub),
      paymentMod.getClaimsByPatient(auth.sub),
      paymentMod.getPatientInsurancePolicies(auth.sub),
      paymentMod.getPatientFinancialSummary(auth.sub),
      ledgerMod.getPatientBalance(auth.sub),
      ledgerMod.getPatientLedger(auth.sub, 30),
      // Deliberately unscoped: this is the patient viewing their OWN bills
      // (auth.sub is the patient id from their own portal token, which
      // carries no org/role — a patient isn't tied to one org and can
      // legitimately have bills from every facility they've been treated
      // at). Scoping by org would hide a patient's own bill from themselves.
      billingMod.getBillsByPatient(auth.sub),
    ]);

    return NextResponse.json({ payments, charges, plans, claims, policies, summary, balance, ledger, bills });
  } catch (err) {
    if (demoFallbackEnabled()) {
      logDemoFallback('billing', err);
      return NextResponse.json(await getDemoBillingByPatient(auth.sub));
    }
    logApiError('[patient-portal/billing]', err);
    return NextResponse.json({ error: 'Failed to fetch billing data' }, { status: 500 });
  }
}
