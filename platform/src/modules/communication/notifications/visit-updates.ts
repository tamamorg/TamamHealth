/**
 * The `visit` notification source: every status update on a visit, addressed
 * to the people the visit names.
 *
 * The other bell sources tell a clinician a patient is WAITING (the triage
 * pool) or that RESULTS are back — but nothing fired when their own patient
 * moved along the visit ladder: triage completed, ready to be called in, off
 * at pharmacy, dispensed. This source derives one item per active visit from
 * the encounter's own status, using the ladder's own vocabulary
 * (visit-state.ts) so the bell, the worklist chip and the lane all speak the
 * same words.
 *
 * Two properties do the work:
 *
 *   - The item id embeds the STATUS (`visit-<encounterId>-<status>`), so every
 *     transition mints a fresh unread item — the badge and chime fire on each
 *     rung, while the feed itself only ever shows the CURRENT rung per visit
 *     (it is derived, so the previous rung's item simply stops existing).
 *   - Ownership comes from the encounter document itself
 *     (assignedClinicianId / assignedNurseId / clinicianId) — the same fields
 *     the assignment service stamps — so "my patient" means exactly what the
 *     worklists mean by it. Unclaimed patients stay with the shared triage
 *     pool source; this one is personal by construction.
 *
 * Pure module (no React, no DB): `useNotifications` reads the documents and
 * hands them here, and the tests exercise the derivation directly.
 */
import type { EncounterDoc, PrescriptionDoc } from '@/lib/db-types';
import { shortenPersonName } from '@/lib/patient-utils';
import { encounterVisitState } from '@/lib/clinical-flow/visit-state';
import { isOwnedByViewer, type FeedViewer } from './notification-scope';
import type { NotificationItem, NotificationSeverity } from './types';

/** How long a finished visit's closing status (Discharged, Dispensed, …)
 *  stays in the feed. Long enough to survive a weekend off. */
const CLOSURE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/** Is this viewer on the visit's named care team? */
function onCareTeam(encounter: EncounterDoc, viewerId: string): boolean {
  return encounter.assignedClinicianId === viewerId
    || encounter.assignedNurseId === viewerId
    || encounter.clinicianId === viewerId;
}

function severityFor(status: EncounterDoc['status']): NotificationSeverity {
  // A patient escalated or lost is never "for information".
  if (status === 'escalated_to_emergency' || status === 'deceased') return 'critical';
  // The rung that asks the clinician to act right now: call the patient in.
  if (status === 'ready_for_clinician') return 'warning';
  return 'info';
}

// The title already leads with the patient's name, so the subtitle carries
// only the description.
function subtitleFor(encounter: EncounterDoc): string {
  switch (encounter.status) {
    case 'ready_for_clinician': return 'ready — call them in';
    case 'triaged_awaiting_destination': return 'triage completed';
    case 'awaiting_pharmacy': return 'prescription at pharmacy';
    case 'awaiting_labs': return 'sample with the lab';
    case 'awaiting_imaging': return 'with imaging';
    default: return 'visit status update';
  }
}

/** When the visit last moved — the transition trail's last entry when it
 *  exists, else the document's own timestamps. */
function movedAt(encounter: EncounterDoc): string {
  const trail = encounter.statusHistory;
  if (trail && trail.length > 0) return trail[trail.length - 1].at;
  return encounter.updatedAt || encounter.createdAt || '';
}

/**
 * One item per visit this viewer is on the care team of: the visit's current
 * rung, in the ladder's words. In-facility rungs always show; closing rungs
 * (Discharged, …) show inside the closure window; upcoming rungs (Scheduled,
 * Registered) never — nothing has happened in the building yet.
 */
export function visitUpdateItems(
  encounters: EncounterDoc[],
  viewer: FeedViewer | null | undefined,
  nowMs: number,
  limit: number,
): NotificationItem[] {
  const viewerId = viewer?._id;
  if (!viewerId) return [];
  const items: NotificationItem[] = [];
  for (const encounter of encounters) {
    if (!onCareTeam(encounter, viewerId)) continue;
    const state = encounterVisitState(encounter.status);
    if (!state.label) continue; // unknown status from a newer app version
    if (state.lane === 'upcoming') continue;
    const at = movedAt(encounter);
    if (state.lane === 'finished') {
      const ms = Date.parse(at);
      if (!Number.isNaN(ms) && nowMs - ms > CLOSURE_WINDOW_MS) continue;
    }
    items.push({
      id: `visit-${encounter._id}-${encounter.status}`,
      type: 'visit',
      severity: severityFor(encounter.status),
      // WHO first, then the rung — "Nyandeng Deng · Awaiting consultation" —
      // with the name on the two-name display rule like every list row.
      title: `${shortenPersonName(encounter.patientName) || 'Patient'} · ${state.label}`,
      subtitle: subtitleFor(encounter),
      time: at,
      href: `/patients/${encodeURIComponent(encounter.patientId)}`,
    });
  }
  return items
    .sort((a, b) => (b.time || '').localeCompare(a.time || ''))
    .slice(0, limit);
}

/** The roles that staff the desk a returned visit lands on. */
const RECEPTION_ROLES = new Set<string>([
  'front_desk', 'central_registration_clerk', 'clinic_clerk', 'super_admin',
]);

/** The stages a clinician can send a visit back to the desk FROM — used to
 *  tell a RETURNED visit apart from a fresh arrival parked at the same
 *  crossroads status by registration. */
const RETURNABLE_STAGES = new Set<EncounterDoc['status']>([
  'triaged_awaiting_destination', 'routed_to_clinic',
  'arrived_at_clinic_awaiting_rooming', 'in_rooming', 'ready_for_clinician',
]);

/**
 * Reception's side of "return to front desk": one item per open visit a
 * clinician sent back (`awaiting_next_station` reached FROM a triage/clinic
 * stage — a fresh arrival reaches the same status from registration and is
 * not news to the desk that put it there). Addressed by ROLE, not care team:
 * the whole desk needs to see it, whoever is on shift.
 */
export function returnedToDeskItems(
  encounters: EncounterDoc[],
  viewer: FeedViewer | null | undefined,
  nowMs: number,
  limit: number,
): NotificationItem[] {
  if (!viewer?.role || !RECEPTION_ROLES.has(String(viewer.role))) return [];
  const items: NotificationItem[] = [];
  for (const encounter of encounters) {
    if (encounter.status !== 'awaiting_next_station') continue;
    const trail = encounter.statusHistory;
    const last = trail && trail.length > 0 ? trail[trail.length - 1] : undefined;
    if (!last?.from || !RETURNABLE_STAGES.has(last.from)) continue;
    const at = last.at || encounter.updatedAt || '';
    const ms = Date.parse(at);
    if (!Number.isNaN(ms) && nowMs - ms > CLOSURE_WINDOW_MS) continue;
    items.push({
      id: `visit-returned-${encounter._id}-${at}`,
      type: 'visit',
      severity: 'warning',
      title: `${shortenPersonName(encounter.patientName) || 'Patient'} · Returned to front desk`,
      subtitle: last.reason || 'sent back by the clinical team — rebook or close the visit',
      time: at,
      href: `/patients/${encodeURIComponent(encounter.patientId)}`,
    });
  }
  return items
    .sort((a, b) => (b.time || '').localeCompare(a.time || ''))
    .slice(0, limit);
}

/**
 * The loop-closer at the end of the journey: this viewer's own prescriptions
 * that pharmacy has dispensed, inside the closure window. `prescribedBy` is a
 * free-text name, matched the same way the lab feed matches `orderedBy`.
 */
export function dispensedItems(
  prescriptions: PrescriptionDoc[],
  viewer: FeedViewer | null | undefined,
  nowMs: number,
  limit: number,
): NotificationItem[] {
  const items: NotificationItem[] = [];
  for (const rx of prescriptions) {
    if (rx.status !== 'dispensed') continue;
    if (!isOwnedByViewer({ ownerName: rx.prescribedBy }, viewer)) continue;
    const at = rx.dispensedAt || rx.updatedAt || rx.createdAt || '';
    const ms = Date.parse(at);
    if (!Number.isNaN(ms) && nowMs - ms > CLOSURE_WINDOW_MS) continue;
    items.push({
      id: `visit-rx-${rx._id}`,
      type: 'visit',
      severity: 'info',
      title: `${shortenPersonName(rx.patientName) || 'Patient'} · Dispensed`,
      subtitle: `${rx.medication} · collected from pharmacy`,
      time: at,
      href: `/patients/${encodeURIComponent(rx.patientId)}?tab=medications`,
    });
  }
  return items
    .sort((a, b) => (b.time || '').localeCompare(a.time || ''))
    .slice(0, limit);
}
