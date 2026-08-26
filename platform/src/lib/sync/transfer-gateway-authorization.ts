import type { AuthPayload } from '@/modules/identity';
import type { PatientDoc, PatientTransferDoc } from '../db-types';
import {
  canCancelTransfer,
  canContributeTransfer,
  canDecideTransfer,
  canForceTransfer,
  canRequestTransfer,
} from '../services/patient-transfer-permissions';

/**
 * Relationship-aware authorization for replicated transfer documents.
 * CouchDB's validate_doc_update can enforce roles and document types but cannot
 * load the related patient. The same-origin gateway can, so facility-edge mode
 * performs the missing care-team/destination check before forwarding a write.
 */
export function authorizeReplicatedTransfer(
  auth: AuthPayload,
  next: PatientTransferDoc,
  previous: PatientTransferDoc | null,
  patient: PatientDoc,
): string | null {
  if (next.patientId !== patient._id) return 'The transfer patient does not match the authorized patient record.';
  if (!auth.orgId || next.orgId !== auth.orgId) return 'The transfer is outside your organization.';

  if (!previous) {
    if (next.requestedById !== auth.sub) {
      return 'A transfer request cannot impersonate another requester.';
    }
    const crossOrg = Boolean(next.to.orgId && auth.orgId && next.to.orgId !== auth.orgId);
    const decision = next.status === 'completed'
      ? canForceTransfer(auth, patient, { crossOrg })
      : canRequestTransfer(auth, patient, { crossOrg });
    return decision.allowed ? null : decision.reason || 'The transfer is not authorized.';
  }

  if (next.patientId !== previous.patientId
      || next.requestedById !== previous.requestedById
      || JSON.stringify(next.from) !== JSON.stringify(previous.from)) {
    return 'Transfer ownership fields are immutable after creation.';
  }
  const previousEvents = previous.events ?? [];
  const nextEvents = next.events ?? [];
  if (nextEvents.length < previousEvents.length
      || previousEvents.some((event, index) => JSON.stringify(event) !== JSON.stringify(nextEvents[index]))) {
    return 'Transfer history is append-only.';
  }

  let decision;
  if (next.status !== previous.status && (next.status === 'accepted' || next.status === 'rejected')) {
    decision = canDecideTransfer(auth, previous);
  } else if (next.status !== previous.status && next.status === 'cancelled') {
    decision = canCancelTransfer(auth, previous);
  } else {
    decision = canContributeTransfer(auth, previous);
  }
  return decision.allowed ? null : decision.reason || 'The transfer update is not authorized.';
}
