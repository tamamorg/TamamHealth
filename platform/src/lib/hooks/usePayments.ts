'use client';

import { useState, useCallback } from 'react';
import { usePouchLiveReload } from './usePouchLiveReload';
import type { PaymentDoc, InsurancePolicyDoc, ClaimDoc, PaymentPlanDoc, LedgerEntryDoc, PatientFinancialSummary } from '../db-types-payments';
import { paymentsDB, insurancePoliciesDB, claimsDB, paymentPlansDB, ledgerDB } from '../db';
import { useDataScope } from './useDataScope';

export function usePayments() {
  const [payments, setPayments] = useState<PaymentDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope = useDataScope();

  const loadPayments = useCallback(async () => {
    if (!scope) {
      setPayments([]);
      setLoading(false);
      return;
    }
    try {
      const { getAllPayments } = await import('../services/payment-service');
      const data = await getAllPayments(scope);
      setPayments(data);
      setError(null);
    } catch (err) {
      setError('Payments not loaded. Reload the page to try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  // Live PouchDB subscription: re-load whenever a payment is created,
  // updated, or deleted anywhere in the app.
  usePouchLiveReload({ load: loadPayments, database: paymentsDB });

  return { payments, loading, error, reload: loadPayments };
}

// One shared feed pair so a payment or a policy change reloads the patient ledger once.
const patientPaymentDatabases = () => [paymentsDB(), insurancePoliciesDB()];

export function usePatientPayments(patientId?: string) {
  const [payments, setPayments] = useState<PaymentDoc[]>([]);
  const [policies, setPolicies] = useState<InsurancePolicyDoc[]>([]);
  const [balance, setBalance] = useState<number>(0);
  const [summary, setSummary] = useState<PatientFinancialSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope = useDataScope();

  const loadPatientPayments = useCallback(async () => {
    if (!patientId || !scope) {
      setPayments([]);
      setPolicies([]);
      setSummary(null);
      setLoading(false);
      return;
    }
    try {
      const { getPaymentsByPatient, getPatientInsurancePolicies, getPatientFinancialSummary } = await import('../services/payment-service');
      const { getPatientBalance } = await import('../services/ledger-service');

      const [paymentsData, policiesData, balanceData, summaryData] = await Promise.all([
        getPaymentsByPatient(patientId, scope),
        getPatientInsurancePolicies(patientId, scope),
        getPatientBalance(patientId, scope),
        getPatientFinancialSummary(patientId, scope)
      ]);

      setPayments(paymentsData);
      setPolicies(policiesData);
      setBalance(balanceData);
      setSummary(summaryData);
      setError(null);
    } catch (err) {
      setError('Patient payments not loaded. Reload the page to try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [patientId, scope]);

  // Live PouchDB subscriptions for payments and policies
  usePouchLiveReload({ load: loadPatientPayments, database: patientPaymentDatabases, enabled: Boolean(patientId) });

  return { payments, policies, balance, summary, loading, error, reload: loadPatientPayments };
}

export function useInsurancePolicies(patientId?: string) {
  const [policies, setPolicies] = useState<InsurancePolicyDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope = useDataScope();

  const loadInsurancePolicies = useCallback(async () => {
    if (!patientId || !scope) {
      setPolicies([]);
      setLoading(false);
      return;
    }
    try {
      const { getPatientInsurancePolicies } = await import('../services/payment-service');
      const data = await getPatientInsurancePolicies(patientId, scope);
      setPolicies(data);
      setError(null);
    } catch (err) {
      setError('Insurance policies not loaded. Reload the page to try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [patientId, scope]);

  // Live PouchDB subscription
  usePouchLiveReload({ load: loadInsurancePolicies, database: insurancePoliciesDB, enabled: Boolean(patientId) });

  return { policies, loading, error, reload: loadInsurancePolicies };
}

/** Patient ids holding at least one active insurance policy — powers the
 *  Insured / Not insured badge on appointment lists without per-row queries. */
export function useInsuredPatientIds(): Set<string> {
  const [insuredIds, setInsuredIds] = useState<Set<string>>(new Set());
  const scope = useDataScope();

  const load = useCallback(async () => {
    if (!scope) {
      setInsuredIds(new Set());
      return;
    }
    try {
      const { getInsuredPatientIds } = await import('../services/payment-service');
      setInsuredIds(await getInsuredPatientIds(scope));
    } catch { /* leave empty — rows fall back to Not insured */ }
  }, [scope]);

  // Live PouchDB subscription
  usePouchLiveReload({ load, database: insurancePoliciesDB });

  return insuredIds;
}

export function useClaims() {
  const [claims, setClaims] = useState<ClaimDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope = useDataScope();

  const loadClaims = useCallback(async () => {
    if (!scope) {
      setClaims([]);
      setLoading(false);
      return;
    }
    try {
      const { getAllClaims } = await import('../services/payment-service');
      const data = await getAllClaims(scope);
      setClaims(data);
      setError(null);
    } catch (err) {
      setError('Claims not loaded. Reload the page to try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  // Live PouchDB subscription
  usePouchLiveReload({ load: loadClaims, database: claimsDB });

  return { claims, loading, error, reload: loadClaims };
}

export function usePaymentPlans() {
  const [paymentPlans, setPaymentPlans] = useState<PaymentPlanDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope = useDataScope();

  const loadPaymentPlans = useCallback(async () => {
    if (!scope) {
      setPaymentPlans([]);
      setLoading(false);
      return;
    }
    try {
      const { getAllPaymentPlans } = await import('../services/payment-service');
      const data = await getAllPaymentPlans(scope);
      setPaymentPlans(data);
      setError(null);
    } catch (err) {
      setError('Payment plans not loaded. Reload the page to try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  // Live PouchDB subscription
  usePouchLiveReload({ load: loadPaymentPlans, database: paymentPlansDB });

  return { paymentPlans, loading, error, reload: loadPaymentPlans };
}

export function useLedger(patientId?: string) {
  const [ledger, setLedger] = useState<LedgerEntryDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope = useDataScope();

  const loadLedger = useCallback(async () => {
    if (!scope) {
      setLedger([]);
      setLoading(false);
      return;
    }
    try {
      const { getPatientLedger, getAllLedgerEntries } = await import('../services/ledger-service');
      const data = patientId ? await getPatientLedger(patientId, undefined, scope) : await getAllLedgerEntries(scope);
      setLedger(data);
      setError(null);
    } catch (err) {
      setError('Ledger not loaded. Reload the page to try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [patientId, scope]);

  // Live PouchDB subscription
  usePouchLiveReload({ load: loadLedger, database: ledgerDB });

  return { ledger, loading, error, reload: loadLedger };
}
