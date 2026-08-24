'use client';

import { useState, useEffect, useCallback } from 'react';
import type { PrescriptionDoc } from '../db-types';
import { prescriptionsDB } from '../db';
import { makeCoalescer } from './live-reload';
import { useDataScope } from './useDataScope';
import { useAuth } from '../context';

export function usePrescriptions(patientId?: string) {
  const [prescriptions, setPrescriptions] = useState<PrescriptionDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope = useDataScope();
  // Identity only (useAuth, not useApp) — only used to supply advance()'s
  // actor id automatically below, so this must not re-render on every sync
  // tick or global-search keystroke the way useApp()'s broader slice would.
  const { currentUser } = useAuth();

  const loadPrescriptions = useCallback(async () => {
    try {
      setError(null);
      const { getAllPrescriptions, getPrescriptionsByPatient } = await import('../services/prescription-service');
      const data = patientId ? await getPrescriptionsByPatient(patientId, scope) : await getAllPrescriptions(scope);
      setPrescriptions(data);
    } catch (err) {
      console.error(err);
      setError('Failed to load prescriptions');
    } finally {
      setLoading(false);
    }
  }, [scope, patientId]);

  useEffect(() => {
    loadPrescriptions();
  }, [loadPrescriptions]);

  // Live subscription: re-load whenever a prescription is created or
  // dispensed anywhere in the app (consultation page, pharmacy queue, etc.).
  useEffect(() => {
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) loadPrescriptions(); });
    const changes = prescriptionsDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger())
      .on('error', (err) => { console.warn('Prescriptions subscription error:', err); });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [loadPrescriptions]);

  const create = useCallback(async (data: Omit<PrescriptionDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>) => {
    const { createPrescription } = await import('../services/prescription-service');
    const result = await createPrescription(data);
    await loadPrescriptions();
    return result;
  }, [loadPrescriptions]);

  /**
   * Dispense through the single guarded transaction (stock gate → FEFO
   * decrement → controlled-substance register → prescription update, with
   * rollback). Callers pass the whole prescription and quantity rather than
   * an id, because the transaction needs the order's clearance state and
   * facility to decide whether the dispense is legal at all.
   *
   * Online dispensing is committed against the central CouchDB through the
   * API, so the prescription compare-and-swap claim serializes different
   * workstations. A confirmed-offline device uses the same compensating
   * transaction locally and syncs later; an ambiguous network failure never
   * falls back locally because the server may already have committed it.
   */
  const dispense = useCallback(async (
    input: import('../services/dispensing-service').DispenseInput,
  ) => {
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      const { apiFetch } = await import('../api-fetch');
      let response: Response;
      try {
        response = await apiFetch(`/api/prescriptions/${encodeURIComponent(input.prescription._id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'dispense',
            quantity: input.quantity,
            witnessId: input.witnessId,
            witnessName: input.witnessName,
            allowPartial: input.allowPartial === true,
            note: input.note,
          }),
        });
      } catch {
        throw new Error(
          'The dispense result could not be confirmed. Do not retry until you refresh the order and stock position.',
        );
      }
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error((body.error as string) || `Dispense failed (${response.status})`);
      }
      await loadPrescriptions();
      return body as unknown as import('../services/dispensing-service').DispenseResult;
    }
    const { dispenseMedication } = await import('../services/dispensing-service');
    const result = await dispenseMedication(input);
    await loadPrescriptions();
    return result;
  }, [loadPrescriptions]);

  /** Record a prescription that could not be filled (stock-out or held for
   *  prescriber clarification). Both keep the order active. */
  const markUnfilled = useCallback(async (
    rx: import('../db-types').PrescriptionDoc,
    reason: 'stock_out' | 'clarification_requested',
    note: string,
    actor: { id: string; name: string },
  ) => {
    const { recordUnfilled } = await import('../services/dispensing-service');
    const result = await recordUnfilled(rx, reason, note, actor);
    await loadPrescriptions();
    return result;
  }, [loadPrescriptions]);

  const administer = useCallback(async (
    input: import('../services/prescription-service').AdministrationInput,
  ) => {
    const { recordAdministration } = await import('../services/prescription-service');
    const result = await recordAdministration(input);
    await loadPrescriptions();
    return result;
  }, [loadPrescriptions]);

  // MAR: void a mis-recorded administration (append-only — marks the entry
  // voided so its scheduled dose returns to due/overdue; nothing is deleted).
  const voidAdministration = useCallback(async (
    prescriptionId: string,
    administrationId: string,
    voidedBy: string,
    voidedByName: string,
    reason: string,
  ) => {
    const { voidAdministration } = await import('../services/prescription-service');
    const result = await voidAdministration(prescriptionId, administrationId, voidedBy, voidedByName, reason);
    await loadPrescriptions();
    return result;
  }, [loadPrescriptions]);

  const advance = useCallback(async (
    id: string,
    to: import('../clinical-flow/order-lifecycles').PrescriptionStatus,
    extra?: Partial<import('../db-types').PrescriptionDoc>,
  ) => {
    const { advancePrescription } = await import('../services/prescription-service');
    // The signed-in user, not a caller-supplied value — advancePrescription
    // resolves this directory-first and only enforces it for the
    // 'cleared_for_dispensing' transition, so this is a no-op for every
    // other call site and every other `to` value.
    const result = await advancePrescription(id, to, extra, currentUser?._id);
    await loadPrescriptions();
    return result;
  }, [loadPrescriptions, currentUser?._id]);

  const discontinue = useCallback(async (
    id: string,
    reason: string,
    source: 'clinician' | 'patient_reported',
    stoppedByName: string,
  ) => {
    const { updatePrescription } = await import('../services/prescription-service');
    const result = await updatePrescription(id, {
      status: 'discontinued',
      // Clear any stale lifecycle stage (e.g. 'cleared_for_dispensing') so it
      // can't disagree with `status` — effectivePrescriptionStatus/pharmacyStage
      // fall back to `status` when this is unset, but a leftover value must not
      // be left around to be trusted by some other reader.
      orderStatus: undefined,
      stoppedAt: new Date().toISOString(),
      stoppedReason: reason,
      stoppedSource: source,
      stoppedByName,
    });
    await loadPrescriptions();
    return result;
  }, [loadPrescriptions]);

  return { prescriptions, loading, error, create, dispense, markUnfilled, administer, voidAdministration, advance, discontinue, reload: loadPrescriptions };
}
