/**
 * API: /api/patient-transfers — internal transfer of care ownership.
 *
 * GET  ?patientId=…            full transfer history for one chart
 *      ?view=inbox             requests awaiting THIS user's decision
 *      ?view=outbox            requests this user sent and is waiting on
 *      ?view=overdue           requests past their acknowledgement SLA
 *      ?view=active&patientId= the live transfer for the chart banner
 *      (no params)             every transfer in scope
 *
 * POST { action, … } — request | send | accept | reject | cancel | complete
 *                    | force | note | checklist
 *
 * Two guards run on every write, and both are load-bearing:
 *   1. **Scope.** The patient must be visible to the caller under
 *      `filterByScope`. Transfers name a patient by id, so without this a
 *      clinician could move a patient from another tenant by guessing an id.
 *   2. **Capability + relationship.** See patient-transfer-permissions.ts —
 *      role capability alone never authorises acting on a specific transfer.
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import type { AuthPayload } from '@/modules/identity';

import { withAuditLog } from '@/lib/audit/with-audit';
import type { PatientDoc, PatientTransferDoc } from '@/lib/db-types';
import {
  TRANSFER_READ_ROLES, TRANSFER_WRITE_ROLES,
} from '@/lib/services/patient-transfer-permissions';

/**
 * Load a patient and confirm the caller may see them. Returns either the
 * patient or the response to send back — collapsing "not found" and "not
 * yours" into distinct, correct statuses in one place so no handler forgets.
 */
async function loadScopedPatient(
  auth: AuthPayload,
  patientId: string,
): Promise<{ patient: PatientDoc } | { error: NextResponse }> {
  const { getPatientById } = await import('@/lib/services/patient-service');
  const { buildScopeFromAuth, filterByScope } = await import('@/lib/services/data-scope');
  const patient = await getPatientById(patientId);
  if (!patient) {
    return { error: NextResponse.json({ error: 'Patient not found' }, { status: 404 }) };
  }
  if (filterByScope([patient], buildScopeFromAuth(auth)).length === 0) {
    return { error: forbidden('This patient is outside your facility or organisation.') };
  }
  return { patient };
}

/** Load a transfer and confirm it is within the caller's scope. */
async function loadScopedTransfer(
  auth: AuthPayload,
  transferId: string,
): Promise<{ transfer: PatientTransferDoc } | { error: NextResponse }> {
  const { getTransferById } = await import('@/lib/services/patient-transfer-service');
  const { buildScopeFromAuth, filterByScope } = await import('@/lib/services/data-scope');
  const transfer = await getTransferById(transferId);
  if (!transfer) {
    return { error: NextResponse.json({ error: 'Transfer not found' }, { status: 404 }) };
  }
  if (filterByScope([transfer], buildScopeFromAuth(auth)).length === 0) {
    return { error: forbidden('This transfer is outside your facility or organisation.') };
  }
  return { transfer };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, TRANSFER_READ_ROLES)) return forbidden();

    const svc = await import('@/lib/services/patient-transfer-service');
    const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
    const scope = buildScopeFromAuth(auth);

    const url = new URL(request.url);
    const patientId = url.searchParams.get('patientId');
    const view = url.searchParams.get('view');

    if (view === 'inbox') {
      const { getUserById } = await import('@/modules/identity/services/user-service');
      const me = await getUserById(auth.sub).catch(() => null);
      const transfers = await svc.getIncomingTransfers({
        id: auth.sub,
        department: me?.department,
        hospitalId: auth.hospitalId,
        role: auth.role,
      }, scope);
      return NextResponse.json({ transfers, total: transfers.length });
    }

    if (view === 'outbox') {
      const transfers = await svc.getOutgoingTransfers(auth.sub, scope);
      return NextResponse.json({ transfers, total: transfers.length });
    }

    if (view === 'overdue') {
      const transfers = await svc.getOverdueTransfers(scope);
      return NextResponse.json({ transfers, total: transfers.length });
    }

    if (patientId) {
      const scoped = await loadScopedPatient(auth, patientId);
      if ('error' in scoped) return scoped.error;
      if (view === 'active') {
        const transfer = await svc.getActiveTransferForPatient(patientId, scope, auth.sub);
        return NextResponse.json({ transfer });
      }
      const transfers = await svc.getTransfersByPatient(patientId, scope, auth.sub);
      return NextResponse.json({ transfers, total: transfers.length });
    }

    const transfers = await svc.getAllTransfers(scope, auth.sub);
    return NextResponse.json({ transfers, total: transfers.length });
  } catch (err) {
    logApiError('[API /patient-transfers GET]', err);
    return serverError();
  }
}

async function postHandler(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, TRANSFER_WRITE_ROLES)) return forbidden();

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { sanitizePayload } = await import('@/lib/validation');
    body = sanitizePayload(body);

    const action = String(body.action || '').toLowerCase();
    if (!action) {
      return NextResponse.json({ error: 'action is required' }, { status: 400 });
    }

    const svc = await import('@/lib/services/patient-transfer-service');
    const perms = await import('@/lib/services/patient-transfer-permissions');
    const actor = { id: auth.sub, name: auth.name, role: auth.role };
    const str = (k: string): string | undefined =>
      typeof body[k] === 'string' && body[k] ? (body[k] as string) : undefined;

    // ── Creating a transfer ──────────────────────────────────────────────
    if (action === 'request' || action === 'force') {
      const patientId = str('patientId');
      if (!patientId) {
        return NextResponse.json({ error: 'patientId is required' }, { status: 400 });
      }
      const scoped = await loadScopedPatient(auth, patientId);
      if ('error' in scoped) return scoped.error;
      const patient = scoped.patient;

      // `sanitizePayload` only walks TOP-LEVEL keys despite its name, so the
      // destination object's strings arrive unsanitised. Clean them here rather
      // than changing the shared helper's behaviour underneath every other
      // route that already depends on its current shape.
      const { sanitizeString } = await import('@/lib/validation');
      const rawTo = (body.to ?? {}) as Record<string, unknown>;
      const to: Record<string, string | undefined> = {};
      for (const key of ['providerId', 'providerName', 'department', 'facilityId', 'facilityName', 'orgId']) {
        const value = rawTo[key];
        if (typeof value === 'string' && value.trim()) to[key] = sanitizeString(value);
      }
      const crossOrg = Boolean(to.orgId && auth.orgId && to.orgId !== auth.orgId);

      // Internal destinations must resolve to staff/facilities in the same
      // facility. The client list is only a convenience; this is the
      // authoritative boundary check.
      if (!crossOrg && to.facilityId && auth.hospitalId && to.facilityId !== auth.hospitalId) {
        return forbidden('Internal transfers must stay within the current facility.');
      }
      if (to.providerId) {
        const { getUserById } = await import('@/modules/identity/services/user-service');
        const destinationUser = await getUserById(to.providerId);
        if (!destinationUser) return NextResponse.json({ error: 'Destination provider not found' }, { status: 400 });
        if (!crossOrg && auth.hospitalId && destinationUser.hospitalId !== auth.hospitalId) {
          return forbidden('The destination provider does not work at this facility.');
        }
        if (!to.facilityId) to.facilityId = destinationUser.hospitalId;
        if (!to.orgId) to.orgId = destinationUser.orgId;
      }

      const check = action === 'force'
        ? perms.canForceTransfer(auth, patient, { crossOrg })
        : perms.canRequestTransfer(auth, patient, { crossOrg });
      if (!check.allowed) return forbidden(check.reason);

      // The `from` side is derived from the chart, never taken from the client:
      // a caller-supplied origin would let the history be written to say the
      // patient came from someone they never belonged to.
      const from = {
        providerId: patient.assignedDoctor,
        providerName: patient.assignedDoctorName,
        department: patient.assignedDepartment,
        facilityId: patient.registrationHospital,
        orgId: patient.orgId,
      };

      const input = {
        patientId,
        patientName: [patient.firstName, patient.surname].filter(Boolean).join(' '),
        hospitalNumber: patient.hospitalNumber,
        transferType: body.transferType as Parameters<typeof svc.createTransferRequest>[0]['transferType'],
        urgency: body.urgency as Parameters<typeof svc.createTransferRequest>[0]['urgency'],
        from,
        to: {
          providerId: to.providerId,
          providerName: to.providerName,
          department: to.department,
          facilityId: to.facilityId,
          facilityName: to.facilityName,
          orgId: to.orgId,
        },
        reason: str('reason') ?? '',
        handoffNotes: str('handoffNotes'),
        checklist: body.checklist as Parameters<typeof svc.createTransferRequest>[0]['checklist'],
        effectiveAt: str('effectiveAt'),
        expiresAt: str('expiresAt'),
          autoCompleteOnEffectiveDate: body.autoCompleteOnEffectiveDate as boolean | undefined,
          destination: body.destination as Parameters<typeof svc.createTransferRequest>[0]['destination'],
          transport: body.transport as Parameters<typeof svc.createTransferRequest>[0]['transport'],
          clinicalReadiness: body.clinicalReadiness as Parameters<typeof svc.createTransferRequest>[0]['clinicalReadiness'],
          communication: body.communication as Parameters<typeof svc.createTransferRequest>[0]['communication'],
        asDraft: body.asDraft === true,
        hospitalId: auth.hospitalId,
        orgId: auth.orgId,
        actor,
      };

      try {
        const transfer = action === 'force'
          ? await svc.forceTransfer(input)
          : await svc.createTransferRequest(input);
        return NextResponse.json({ transfer }, { status: 201 });
      } catch (err) {
        if (err instanceof svc.TransferValidationError) {
          return NextResponse.json({ error: err.message }, { status: 400 });
        }
        throw err;
      }
    }

    // ── Acting on an existing transfer ───────────────────────────────────
    // NOTE: the scheduled/expiry sweep lives at POST /api/patient-transfers/sweep,
    // not here — it needs the shared-secret machine-caller path that a cron job
    // uses, and one implementation is the only way the cron and a manual admin
    // trigger stay in agreement.
    const transferId = str('transferId');
    if (!transferId) {
      return NextResponse.json({ error: 'transferId is required' }, { status: 400 });
    }
    const scopedT = await loadScopedTransfer(auth, transferId);
    if ('error' in scopedT) return scopedT.error;
    const transfer = scopedT.transfer;

    try {
      switch (action) {
        case 'accept': {
          const check = perms.canDecideTransfer(auth, transfer);
          if (!check.allowed) return forbidden(check.reason);
          const updated = await svc.acceptTransfer(transferId, actor, str('notes'));
          return NextResponse.json({ ok: true, transfer: updated });
        }
        case 'reject': {
          const check = perms.canDecideTransfer(auth, transfer);
          if (!check.allowed) return forbidden(check.reason);
          const updated = await svc.rejectTransfer(transferId, actor, str('notes'));
          return NextResponse.json({ ok: true, transfer: updated });
        }
        case 'cancel': {
          const check = perms.canCancelTransfer(auth, transfer);
          if (!check.allowed) return forbidden(check.reason);
          const updated = await svc.cancelTransfer(transferId, actor, str('reason'));
          return NextResponse.json({ ok: true, transfer: updated });
        }
        case 'send': {
          // Sending a draft is the sender's own act, so it reuses the cancel
          // relationship test (author or admin) rather than the accept one.
          const check = perms.canCancelTransfer(auth, transfer);
          if (!check.allowed) return forbidden(check.reason);
          const updated = await svc.sendDraftTransfer(transferId, actor);
          return NextResponse.json({ ok: true, transfer: updated });
        }
        case 'complete': {
          // Confirming an accepted future-dated transfer has actually happened.
          const check = perms.canDecideTransfer(auth, { ...transfer, status: 'requested' });
          if (!check.allowed) return forbidden(check.reason);
          const updated = await svc.completeTransfer(transferId, actor);
          return NextResponse.json({ ok: true, transfer: updated });
        }
        case 'note': {
          const check = perms.canContributeTransfer(auth, transfer);
          if (!check.allowed) return forbidden(check.reason);
          const note = str('notes');
          if (!note) return NextResponse.json({ error: 'notes is required' }, { status: 400 });
          const updated = await svc.addTransferNote(transferId, note, actor);
          return NextResponse.json({ ok: true, transfer: updated });
        }
        case 'checklist': {
          const check = perms.canContributeTransfer(auth, transfer);
          if (!check.allowed) return forbidden(check.reason);
          const updates = Array.isArray(body.updates)
            ? (body.updates as Array<{ key: string; done: boolean }>)
            : [];
          if (updates.length === 0) {
            return NextResponse.json({ error: 'updates array is required' }, { status: 400 });
          }
          const updated = await svc.updateTransferChecklist(transferId, updates, actor);
          return NextResponse.json({ ok: true, transfer: updated });
        }
        case 'logistics':
        case 'arrive':
        case 'close': {
          const check = perms.canContributeTransfer(auth, transfer);
          if (!check.allowed) return forbidden(check.reason);
          if (action === 'logistics') {
            const updated = await svc.updateTransferLogistics(transferId, {
              physicalStatus: body.physicalStatus as Parameters<typeof svc.updateTransferLogistics>[1]['physicalStatus'],
              destination: body.destination as Parameters<typeof svc.updateTransferLogistics>[1]['destination'],
              transport: body.transport as Parameters<typeof svc.updateTransferLogistics>[1]['transport'],
              clinicalReadiness: body.clinicalReadiness as Parameters<typeof svc.updateTransferLogistics>[1]['clinicalReadiness'],
              communication: body.communication as Parameters<typeof svc.updateTransferLogistics>[1]['communication'],
            }, actor);
            return NextResponse.json({ ok: true, transfer: updated });
          }
          if (action === 'arrive') {
            const updated = await svc.markTransferArrived(transferId, actor, body.assessment as Parameters<typeof svc.markTransferArrived>[2]);
            return NextResponse.json({ ok: true, transfer: updated });
          }
          const updated = await svc.closeTransfer(transferId, actor);
          return NextResponse.json({ ok: true, transfer: updated });
        }
        default:
          return NextResponse.json(
            {
              error: `Unsupported action "${action}". Supported: request, send, accept, `
                + 'reject, cancel, complete, force, note, checklist.',
            },
            { status: 400 },
          );
      }
    } catch (err) {
      if (err instanceof svc.TransferValidationError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
  } catch (err) {
    logApiError('[API /patient-transfers POST]', err);
    return serverError();
  }
}

export const POST = withAuditLog(postHandler, { action: 'patient_transfer.write' });
