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
      paymentMod.getPaymentsByPatientUnscopedForPortal(auth.sub),
      paymentMod.getChargesByPatientUnscopedForPortal(auth.sub),
      paymentMod.getPaymentPlansByPatientUnscopedForPortal(auth.sub),
      paymentMod.getClaimsByPatientUnscopedForPortal(auth.sub),
      paymentMod.getPatientInsurancePoliciesUnscopedForPortal(auth.sub),
      paymentMod.getPatientFinancialSummaryUnscopedForPortal(auth.sub),
      ledgerMod.getPatientBalanceUnscopedForPortal(auth.sub),
      ledgerMod.getPatientLedgerUnscopedForPortal(auth.sub, 30),
      // Every read above is an explicit UnscopedForPortal entrypoint. Deliberately: this is the patient viewing their OWN bills
      // (auth.sub is the patient id from their own portal token, which
      // carries no org/role — a patient isn't tied to one org and can
      // legitimately have bills from every facility they've been treated
      // at). Scoping by org would hide a patient's own bill from themselves.
      billingMod.getBillsByPatientUnscopedForPortal(auth.sub),
    ]);

    return NextResponse.json({ payments, charges, plans, claims, policies, summary, balance, ledger, bills });
  } catch (err) {
    if (demoFallbackEnabled()) {
      logDemoFallback('billing', err);
      return NextResponse.json(await getDemoBillingByPatient(auth.sub));
    }
    logApiError('[patient-portal/billing]', err);
    return NextResponse.json({ error: 'Your bills could not be loaded. Try again.' }, { status: 500 });
  }
}
