'use client';

import { useState, useEffect, useCallback } from 'react';
import { makeCoalescer } from './live-reload';
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
      setError('Failed to load payments');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    loadPayments();
  }, [loadPayments]);

  // Live PouchDB subscription: re-load whenever a payment is created,
  // updated, or deleted anywhere in the app.
  useEffect(() => {
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) loadPayments(); });
    const changes = paymentsDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger())
      .on('error', () => { /* swallow */ });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [loadPayments]);

  return { payments, loading, error, reload: loadPayments };
}

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
      setError('Failed to load patient payments');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [patientId, scope]);

  useEffect(() => {
    loadPatientPayments();
  }, [loadPatientPayments]);

  // Live PouchDB subscriptions for payments and policies
  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) loadPatientPayments(); });
    const changesPayments = paymentsDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger())
      .on('error', () => { /* swallow */ });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changesPayments.cancel(); } catch { /* noop */ }
    };
  }, [loadPatientPayments, patientId]);

  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) loadPatientPayments(); });
    const changesPolicies = insurancePoliciesDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger())
      .on('error', () => { /* swallow */ });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changesPolicies.cancel(); } catch { /* noop */ }
    };
  }, [loadPatientPayments, patientId]);

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
      setError('Failed to load insurance policies');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [patientId, scope]);

  useEffect(() => {
    loadInsurancePolicies();
  }, [loadInsurancePolicies]);

  // Live PouchDB subscription
  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) loadInsurancePolicies(); });
    const changes = insurancePoliciesDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger())
      .on('error', () => { /* swallow */ });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [loadInsurancePolicies, patientId]);

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

  useEffect(() => {
    load();
  }, [load]);

  // Live PouchDB subscription
  useEffect(() => {
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) load(); });
    const changes = insurancePoliciesDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger())
      .on('error', () => { /* swallow */ });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [load]);

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
      setError('Failed to load claims');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    loadClaims();
  }, [loadClaims]);

  // Live PouchDB subscription
  useEffect(() => {
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) loadClaims(); });
    const changes = claimsDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger())
      .on('error', () => { /* swallow */ });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [loadClaims]);

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
      setError('Failed to load payment plans');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    loadPaymentPlans();
  }, [loadPaymentPlans]);

  // Live PouchDB subscription
  useEffect(() => {
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) loadPaymentPlans(); });
    const changes = paymentPlansDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger())
      .on('error', () => { /* swallow */ });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [loadPaymentPlans]);

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
      setError('Failed to load ledger');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [patientId, scope]);

  useEffect(() => {
    loadLedger();
  }, [loadLedger]);

  // Live PouchDB subscription
  useEffect(() => {
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) loadLedger(); });
    const changes = ledgerDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger())
      .on('error', () => { /* swallow */ });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [loadLedger]);

  return { ledger, loading, error, reload: loadLedger };
}
