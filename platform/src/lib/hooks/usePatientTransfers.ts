'use client';

/**
 * Client access to the internal patient-transfer workflow.
 *
 * Reads go straight to the local PouchDB replica so the transfer history and
 * the pending-request banner work offline like the rest of the chart. Writes go
 * through the same local service layer and are marked pending for replication;
 * local capability checks keep the UI honest, while CouchDB validation remains
 * the authoritative boundary when those revisions reach the server.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  PatientTransferDoc,
  PatientTransferChecklistItem,
  PatientTransferType,
  PatientTransferUrgency,
  PatientDoc,
} from '../db-types';
import { patientTransfersDB } from '../db';
import { makeCoalescer } from './live-reload';
import { useAuth } from '../context';
import { useDataScope } from './useDataScope';
import {
  canCancelTransfer,
  canContributeTransfer,
  canDecideTransfer,
  canRequestTransfer,
} from '../services/patient-transfer-permissions';
import { filterByScope } from '../services/data-scope';
import { useNow } from '@/lib/hooks/useNow';

type CurrentUser = NonNullable<ReturnType<typeof useAuth>['currentUser']>;

function transferAuth(user: CurrentUser) {
  return {
    sub: user._id,
    username: user.username,
    role: user.role,
    actualRole: user.actualRole,
    name: user.name || user.username,
    hospitalId: user.hospitalId,
    hospitalName: user.hospitalName,
    facilityIds: user.facilityIds,
    orgId: user.orgId,
  };
}

function permissionError(reason?: string): Error {
  return new Error(reason || 'This transfer action is not permitted.');
}

export interface TransferDraftInput {
  to: {
    providerId?: string;
    providerName?: string;
    department?: string;
    facilityId?: string;
    facilityName?: string;
    orgId?: string;
  };
  reason: string;
  transferType?: PatientTransferType;
  urgency?: PatientTransferUrgency;
  handoffNotes?: string;
  checklist?: PatientTransferChecklistItem[];
  effectiveAt?: string;
  expiresAt?: string;
  asDraft?: boolean;
  destination?: PatientTransferDoc['destination'];
  transport?: PatientTransferDoc['transport'];
  clinicalReadiness?: PatientTransferDoc['clinicalReadiness'];
  communication?: PatientTransferDoc['communication'];
}

export function usePatientTransfers(patientId?: string) {
  const { currentUser } = useAuth();
  const [transfers, setTransfers] = useState<PatientTransferDoc[]>([]);
  const [loading, setLoading] = useState(Boolean(patientId));
  const [error, setError] = useState<string | null>(null);

  const scope = useDataScope();

  // The viewer's id, read out of the user so this callback depends on the id
  // and not on the whole object (see the note in useTransferQueue below).
  const viewerId = currentUser?._id;
  const load = useCallback(async () => {
    if (!patientId || !scope) { setTransfers([]); setLoading(false); return; }
    setLoading(true);
    try {
      const { getTransfersByPatient } = await import('../services/patient-transfer-service');
      // viewer id hides other people's unsent drafts.
      setTransfers(await getTransfersByPatient(patientId, scope, viewerId));
    } catch {
      setTransfers([]);
    } finally {
      setLoading(false);
    }
  }, [patientId, scope, viewerId]);

  useEffect(() => { load(); }, [load]);

  // Live-refresh: an accept/reject landing on another device must update this
  // chart, otherwise two clinicians can each believe they own the patient.
  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) load(); });
    const changes = patientTransfersDB()
      .changes({ since: 'now', live: true, include_docs: true })
      .on('change', change => {
        const doc = change.doc as PatientTransferDoc | undefined;
        if (!doc || doc.patientId === patientId || change.deleted) reload.trigger();
      })
      .on('error', () => { /* offline-first: next local change retries */ });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [patientId, load]);

  /** The live transfer worth showing in a chart banner, if any. */
  const now = useNow();
  const activeTransfer = useMemo(() => {
    const pending = transfers.find(t => t.status === 'requested' || t.status === 'accepted');
    if (pending) return pending;
    return transfers.find(t =>
      t.status === 'completed'
      && t.transferType !== 'permanent'
      && t.expiresAt
      && new Date(t.expiresAt).getTime() > now) ?? null;
  }, [transfers, now]);

  /** Wrap a mutation so every caller gets the same error/refresh handling. */
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setError(null);
    try {
      const result = await fn();
      await load();
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transfer action failed');
      throw e;
    }
  }, [load]);

  const request = useCallback(async (patient: PatientDoc, input: TransferDraftInput) => {
    return run(async () => {
      if (!currentUser) throw new Error('Not signed in.');
      const auth = transferAuth(currentUser);
      const crossOrg = Boolean(input.to.orgId && auth.orgId && input.to.orgId !== auth.orgId);
      if (!crossOrg && input.to.facilityId && auth.hospitalId && input.to.facilityId !== auth.hospitalId) {
        throw new Error('Internal transfers must stay within the current facility.');
      }
      const permission = canRequestTransfer(auth, patient, { crossOrg });
      if (!permission.allowed) throw permissionError(permission.reason);
      const svc = await import('../services/patient-transfer-service');
      return svc.createTransferRequest({
        patientId: patient._id,
        patientName: [patient.firstName, patient.surname].filter(Boolean).join(' '),
        hospitalNumber: patient.hospitalNumber,
        transferType: input.transferType,
        urgency: input.urgency,
        from: {
          providerId: patient.assignedDoctor,
          providerName: patient.assignedDoctorName,
          department: patient.assignedDepartment,
          facilityId: patient.registrationHospital,
          orgId: patient.orgId,
        },
        to: input.to,
        reason: input.reason,
        handoffNotes: input.handoffNotes,
        checklist: input.checklist,
        effectiveAt: input.effectiveAt,
        expiresAt: input.expiresAt,
        destination: input.destination,
        transport: input.transport,
        clinicalReadiness: input.clinicalReadiness,
        communication: input.communication,
        asDraft: input.asDraft,
        hospitalId: auth.hospitalId,
        orgId: auth.orgId,
        actor: { id: auth.sub, name: auth.name, role: auth.role },
      });
    });
  }, [run, currentUser]);

  const loadActionTarget = useCallback(async (id: string) => {
    if (!currentUser || !scope) throw new Error('Not signed in.');
    const svc = await import('../services/patient-transfer-service');
    const transfer = await svc.getTransferById(id);
    if (!transfer || filterByScope([transfer], scope).length === 0) {
      throw new Error('Transfer not found.');
    }
    return { svc, transfer, auth: transferAuth(currentUser) };
  }, [currentUser, scope]);

  const accept = useCallback(async (id: string, notes?: string) => {
    return run(async () => {
      const { svc, transfer, auth } = await loadActionTarget(id);
      const permission = canDecideTransfer(auth, transfer);
      if (!permission.allowed) throw permissionError(permission.reason);
      return svc.acceptTransfer(id, { id: auth.sub, name: auth.name, role: auth.role }, notes);
    });
  }, [run, loadActionTarget]);

  const reject = useCallback(async (id: string, notes: string) => {
    return run(async () => {
      const { svc, transfer, auth } = await loadActionTarget(id);
      const permission = canDecideTransfer(auth, transfer);
      if (!permission.allowed) throw permissionError(permission.reason);
      return svc.rejectTransfer(id, { id: auth.sub, name: auth.name, role: auth.role }, notes);
    });
  }, [run, loadActionTarget]);

  const cancel = useCallback(async (id: string, reason?: string) => {
    return run(async () => {
      const { svc, transfer, auth } = await loadActionTarget(id);
      const permission = canCancelTransfer(auth, transfer);
      if (!permission.allowed) throw permissionError(permission.reason);
      return svc.cancelTransfer(id, { id: auth.sub, name: auth.name, role: auth.role }, reason);
    });
  }, [run, loadActionTarget]);

  const complete = useCallback(async (id: string) => {
    return run(async () => {
      const { svc, transfer, auth } = await loadActionTarget(id);
      const permission = canDecideTransfer(auth, { ...transfer, status: 'requested' });
      if (!permission.allowed) throw permissionError(permission.reason);
      return svc.completeTransfer(id, { id: auth.sub, name: auth.name, role: auth.role });
    });
  }, [run, loadActionTarget]);

  const addNote = useCallback(async (id: string, note: string) => {
    return run(async () => {
      const { svc, transfer, auth } = await loadActionTarget(id);
      const permission = canContributeTransfer(auth, transfer);
      if (!permission.allowed) throw permissionError(permission.reason);
      return svc.addTransferNote(id, note, { id: auth.sub, name: auth.name, role: auth.role });
    });
  }, [run, loadActionTarget]);

  const updateLogistics = useCallback(async (id: string, patch: Record<string, unknown>) =>
    run(async () => {
      const { svc, transfer, auth } = await loadActionTarget(id);
      const permission = canContributeTransfer(auth, transfer);
      if (!permission.allowed) throw permissionError(permission.reason);
      return svc.updateTransferLogistics(
        id,
        patch as Parameters<typeof svc.updateTransferLogistics>[1],
        { id: auth.sub, name: auth.name, role: auth.role },
      );
    }), [run, loadActionTarget]);
  const arrive = useCallback(async (id: string, assessment?: Record<string, unknown>) =>
    run(async () => {
      const { svc, transfer, auth } = await loadActionTarget(id);
      const permission = canContributeTransfer(auth, transfer);
      if (!permission.allowed) throw permissionError(permission.reason);
      return svc.markTransferArrived(
        id,
        { id: auth.sub, name: auth.name, role: auth.role },
        assessment as Parameters<typeof svc.markTransferArrived>[2],
      );
    }), [run, loadActionTarget]);
  const close = useCallback(async (id: string) =>
    run(async () => {
      const { svc, transfer, auth } = await loadActionTarget(id);
      const permission = canContributeTransfer(auth, transfer);
      if (!permission.allowed) throw permissionError(permission.reason);
      return svc.closeTransfer(id, { id: auth.sub, name: auth.name, role: auth.role });
    }), [run, loadActionTarget]);

  return {
    transfers,
    activeTransfer,
    loading,
    error,
    reload: load,
    request,
    accept,
    reject,
    cancel,
    complete,
    addNote,
    updateLogistics,
    arrive,
    close,
  };
}

/**
 * The signed-in user's transfer queue — requests awaiting their decision, and
 * the ones they sent that are still open.
 *
 * Separate from `usePatientTransfers` because it watches every transfer rather
 * than one chart's. This is what the dashboard's outstanding-work list reads:
 * a transfer request that only ever appears on the patient's own chart is
 * invisible to the person who has to answer it, since they have no reason to
 * open a chart that isn't theirs yet.
 */
export function useTransferQueue() {
  const { currentUser } = useAuth();
  const [incoming, setIncoming] = useState<PatientTransferDoc[]>([]);
  const [outgoing, setOutgoing] = useState<PatientTransferDoc[]>([]);
  const [loading, setLoading] = useState(true);

  // Read out of the user once so the memo below depends on the FIELD rather
  // than on the whole user object: a dependency list naming a property of an
  // object the body reads is narrower than the compiler can infer, and it
  // skips optimizing the component rather than guess.
  const userId = currentUser?._id;
  const userOrgId = currentUser?.orgId;
  const userHospitalId = currentUser?.hospitalId;
  const userRole = currentUser?.role;
  const userDepartment = currentUser?.department;
  const load = useCallback(async () => {
    // Both are always present on a signed-in user; naming them here is what
    // lets the scope below type as a DataScope without reaching back into the
    // whole user object.
    if (!userId || !userRole) { setIncoming([]); setOutgoing([]); setLoading(false); return; }
    setLoading(true);
    try {
      const svc = await import('../services/patient-transfer-service');
      const scope = {
        orgId: userOrgId,
        hospitalId: userHospitalId,
        role: userRole,
      };
      const [inRows, outRows] = await Promise.all([
        svc.getIncomingTransfers({
          id: userId,
          department: userDepartment,
          hospitalId: userHospitalId,
          role: userRole,
        }, scope),
        svc.getOutgoingTransfers(userId, scope),
      ]);
      setIncoming(inRows);
      setOutgoing(outRows);
    } catch {
      setIncoming([]);
      setOutgoing([]);
    } finally {
      setLoading(false);
    }
  }, [
    userId, userOrgId, userHospitalId,
    userRole, userDepartment,
  ]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) load(); });
    const changes = patientTransfersDB()
      .changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger())
      .on('error', () => { /* offline-first: next local change retries */ });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [load]);

  return { incoming, outgoing, loading, reload: load };
}
