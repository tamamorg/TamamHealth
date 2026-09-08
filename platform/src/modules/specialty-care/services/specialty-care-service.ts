import { v4 as uuidv4 } from 'uuid';
import { hospitalsDB, specialtyCareDB, appointmentsDB, encountersDB } from '@/lib/db';
import { getPatientById } from '@/lib/services/patient-service';
import { patientDisplayName } from '@/lib/patient-utils';
import type { DataScope } from '@/lib/services/data-scope';
import { filterByScope } from '@/lib/services/data-scope';
import { findByType } from '@/lib/services/db-query';
import { logAuditSafe } from '@/lib/services/audit-service';
import { emitSyncEvent } from '@/lib/services/sync-event-service';
import { validateSpecialtyEpisode } from '../core/validation';
import type {
  SpecialtyCareEpisodeDoc,
  SpecialtyEpisodeEvent,
  SpecialtyEpisodeStatus,
  SpecialtyFieldValue,
  SpecialtyPathwayCode,
  SpecialtyPathwayConfigDoc,
} from '../core/types';

const CONFIG_ROLES = new Set<DataScope['role']>(['super_admin', 'org_admin', 'medical_superintendent', 'hospital_manager']);

const TRANSITIONS: Readonly<Record<SpecialtyEpisodeStatus, readonly SpecialtyEpisodeStatus[]>> = {
  planned: ['in_progress', 'cancelled'],
  in_progress: ['awaiting_review', 'completed', 'cancelled'],
  awaiting_review: ['in_progress', 'completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export interface SpecialtyCareActor {
  id?: string;
  name?: string;
}

function event(action: SpecialtyEpisodeEvent['action'], actor: SpecialtyCareActor, extras: Partial<SpecialtyEpisodeEvent> = {}): SpecialtyEpisodeEvent {
  return { at: new Date().toISOString(), actorId: actor.id, actorName: actor.name, action, ...extras };
}

function ensureWritableScope(scope: DataScope, orgId: string, hospitalId: string): void {
  const visible = filterByScope([{ type: 'specialty_care_episode', orgId, hospitalId }], scope);
  if (!scope.orgId || visible.length !== 1) throw new Error('The specialty episode is outside your authorized scope');
}

export function specialtyPathwayConfigId(hospitalId: string, pathway: SpecialtyPathwayCode): string {
  return `specialty-pathway:${hospitalId}:${pathway}`;
}

export async function getSpecialtyPathwayConfigs(scope: DataScope): Promise<SpecialtyPathwayConfigDoc[]> {
  if (!scope.orgId) return [];
  return filterByScope(await findByType<SpecialtyPathwayConfigDoc>(hospitalsDB(), 'specialty_pathway_config'), scope)
    .sort((a, b) => a.pathway.localeCompare(b.pathway));
}

export async function getSpecialtyPathwayConfig(pathway: SpecialtyPathwayCode, hospitalId: string, scope: DataScope): Promise<SpecialtyPathwayConfigDoc | null> {
  try {
    const doc = await hospitalsDB().get(specialtyPathwayConfigId(hospitalId, pathway)) as SpecialtyPathwayConfigDoc;
    return filterByScope([doc], scope)[0] ?? null;
  } catch { return null; }
}

export async function configureSpecialtyPathway(input: {
  pathway: SpecialtyPathwayCode;
  hospitalId: string;
  facilityName?: string;
  orgId: string;
  status: SpecialtyPathwayConfigDoc['status'];
  clinicalOwnerId?: string;
  clinicalOwnerName?: string;
  sopReference?: string;
  reviewDueAt?: string;
  notes?: string;
  scope: DataScope;
  actor: Required<SpecialtyCareActor>;
}): Promise<SpecialtyPathwayConfigDoc> {
  if (!CONFIG_ROLES.has(input.scope.role)) throw new Error('Your role cannot configure specialty pathways');
  ensureWritableScope(input.scope, input.orgId, input.hospitalId);
  if ((input.status === 'pilot' || input.status === 'active') && (!input.clinicalOwnerName?.trim() || !input.sopReference?.trim())) {
    throw new Error('Pilot or active pathways require a clinical owner and approved SOP reference');
  }
  const db = hospitalsDB();
  const id = specialtyPathwayConfigId(input.hospitalId, input.pathway);
  let existing: SpecialtyPathwayConfigDoc | null = null;
  try { existing = await db.get(id) as SpecialtyPathwayConfigDoc; } catch { /* first version */ }
  const now = new Date().toISOString();
  const activating = input.status === 'pilot' || input.status === 'active';
  const doc: SpecialtyPathwayConfigDoc = {
    _id: id, _rev: existing?._rev, type: 'specialty_pathway_config', pathway: input.pathway,
    hospitalId: input.hospitalId, facilityName: input.facilityName, orgId: input.orgId,
    status: input.status, version: (existing?.version ?? 0) + 1,
    clinicalOwnerId: input.clinicalOwnerId, clinicalOwnerName: input.clinicalOwnerName?.trim() || undefined,
    sopReference: input.sopReference?.trim() || undefined, reviewDueAt: input.reviewDueAt,
    notes: input.notes?.trim() || undefined,
    approvedBy: activating ? input.actor.id : existing?.approvedBy,
    approvedByName: activating ? input.actor.name : existing?.approvedByName,
    approvedAt: activating ? now : existing?.approvedAt,
    createdBy: existing?.createdBy ?? input.actor.id, createdAt: existing?.createdAt ?? now, updatedAt: now,
  };
  const response = await db.put(doc); doc._rev = response.rev;
  await logAuditSafe('SPECIALTY_PATHWAY_CONFIGURED', input.actor.id, input.actor.name, `${input.pathway} ${input.status} at ${input.hospitalId}, configuration v${doc.version}`);
  return doc;
}

async function assertPathwayEnabled(pathway: SpecialtyPathwayCode, hospitalId: string, scope: DataScope): Promise<void> {
  const config = await getSpecialtyPathwayConfig(pathway, hospitalId, scope);
  if (!config || (config.status !== 'pilot' && config.status !== 'active')) {
    throw new Error('This specialty pathway is not activated for the facility');
  }
}

export async function getSpecialtyEpisodes(scope: DataScope, filters: {
  patientId?: string;
  pathway?: SpecialtyPathwayCode;
  departmentId?: string;
  status?: SpecialtyEpisodeStatus;
} = {}): Promise<SpecialtyCareEpisodeDoc[]> {
  if (!scope.orgId) return [];
  const rows = filterByScope(
    await findByType<SpecialtyCareEpisodeDoc>(specialtyCareDB(), 'specialty_care_episode'),
    scope,
  );
  return rows.filter((row) =>
    (!filters.patientId || row.patientId === filters.patientId)
    && (!filters.pathway || row.pathway === filters.pathway)
    && (!filters.departmentId || row.departmentId === filters.departmentId)
    && (!filters.status || row.status === filters.status)
  ).sort((a, b) => (b.scheduledAt || b.createdAt).localeCompare(a.scheduledAt || a.createdAt));
}

export async function getSpecialtyEpisode(id: string, scope: DataScope): Promise<SpecialtyCareEpisodeDoc | null> {
  try {
    const doc = await specialtyCareDB().get(id) as SpecialtyCareEpisodeDoc;
    return filterByScope([doc], scope)[0] ?? null;
  } catch {
    return null;
  }
}

export async function createSpecialtyEpisode(input: {
  pathway: SpecialtyPathwayCode;
  patientId: string;
  patientName: string;
  hospitalId: string;
  facilityName?: string;
  orgId: string;
  departmentId?: string;
  appointmentId?: string;
  encounterId?: string;
  serviceRequestId?: string;
  responsibleClinicianId?: string;
  responsibleClinicianName?: string;
  scheduledAt?: string;
  values?: Record<string, SpecialtyFieldValue>;
  scope: DataScope;
  actor?: SpecialtyCareActor;
}): Promise<SpecialtyCareEpisodeDoc> {
  ensureWritableScope(input.scope, input.orgId, input.hospitalId);
  await assertPathwayEnabled(input.pathway, input.hospitalId, input.scope);
  const patient = await getPatientById(input.patientId.trim(), input.scope);
  if (!patient) throw new Error('Select a registered patient in your authorized scope');
  let encounterId = input.encounterId;
  if (!encounterId && input.appointmentId) {
    const visits = await findByType<{ _id: string; type: string; patientId: string; orgId: string; hospitalId?: string; facilityId?: string }>(encountersDB(), 'clinical_encounter', { appointmentId: input.appointmentId });
    encounterId = filterByScope(visits, input.scope).find(item => item.patientId === patient._id)?._id;
  }
  if (input.departmentId) {
    const department = await hospitalsDB().get(input.departmentId) as { type?: string; orgId?: string; facilityId?: string };
    if (department.type !== 'department' || department.orgId !== input.orgId || department.facilityId !== input.hospitalId) throw new Error('Department does not belong to this facility');
  }
  for (const [id, db] of [[input.appointmentId, appointmentsDB], [input.encounterId, encountersDB]] as const) {
    if (!id) continue;
    const linked = await db().get(id) as { patientId?: string; orgId?: string; hospitalId?: string; facilityId?: string };
    if (linked.patientId !== patient._id || linked.orgId !== input.orgId || !filterByScope([linked], input.scope).length) throw new Error('Linked visit does not belong to this patient in your authorized scope');
  }
  const now = new Date().toISOString();
  const doc: SpecialtyCareEpisodeDoc = {
    _id: `specialty-${uuidv4()}`,
    type: 'specialty_care_episode',
    pathway: input.pathway,
    status: 'planned',
    patientId: input.patientId.trim(),
    patientName: patientDisplayName(patient),
    hospitalId: input.hospitalId,
    facilityName: input.facilityName,
    orgId: input.orgId,
    departmentId: input.departmentId,
    appointmentId: input.appointmentId,
    encounterId,
    serviceRequestId: input.serviceRequestId,
    responsibleClinicianId: input.responsibleClinicianId,
    responsibleClinicianName: input.responsibleClinicianName,
    scheduledAt: input.scheduledAt,
    values: input.values ?? {},
    events: [event('created', input.actor ?? {})],
    createdAt: now,
    updatedAt: now,
    createdBy: input.actor?.id,
  };
  const validation = validateSpecialtyEpisode(doc);
  if (!validation.valid) throw new Error(validation.errors.join('. '));
  const result = await specialtyCareDB().put(doc);
  doc._rev = result.rev;
  await logAuditSafe('SPECIALTY_EPISODE_CREATED', input.actor?.id, input.actor?.name, `${doc.pathway} episode ${doc._id} created for patient ${doc.patientId}`);
  emitSyncEvent({ resourceType: doc.type, resourceId: doc._id, operation: 'create', resourceVersion: doc._rev, userId: input.actor?.id, orgId: doc.orgId, hospitalId: doc.hospitalId });
  return doc;
}

export async function updateSpecialtyEpisode(input: {
  id: string;
  scope: DataScope;
  actor?: SpecialtyCareActor;
  values?: Record<string, SpecialtyFieldValue>;
  responsibleClinicianId?: string;
  responsibleClinicianName?: string;
  scheduledAt?: string;
  status?: SpecialtyEpisodeStatus;
  cancellationReason?: string;
}): Promise<SpecialtyCareEpisodeDoc> {
  const existing = await getSpecialtyEpisode(input.id, input.scope);
  if (!existing) throw new Error('Specialty episode not found in your authorized scope');
  if (existing.status === 'completed' || existing.status === 'cancelled') throw new Error('Finalized specialty episodes cannot be edited');

  const nextStatus = input.status ?? existing.status;
  if (nextStatus !== existing.status && !TRANSITIONS[existing.status].includes(nextStatus)) {
    throw new Error(`A specialty episode cannot move from ${existing.status} to ${nextStatus}`);
  }
  if (nextStatus === 'cancelled' && !input.cancellationReason?.trim()) throw new Error('Cancelling an episode requires a reason');
  const now = new Date().toISOString();
  const updated: SpecialtyCareEpisodeDoc = {
    ...existing,
    values: input.values ? { ...existing.values, ...input.values } : existing.values,
    responsibleClinicianId: input.responsibleClinicianId ?? existing.responsibleClinicianId,
    responsibleClinicianName: input.responsibleClinicianName ?? existing.responsibleClinicianName,
    scheduledAt: input.scheduledAt ?? existing.scheduledAt,
    status: nextStatus,
    startedAt: nextStatus === 'in_progress' && !existing.startedAt ? now : existing.startedAt,
    completedAt: nextStatus === 'completed' ? now : existing.completedAt,
    cancellationReason: nextStatus === 'cancelled' ? input.cancellationReason?.trim() : existing.cancellationReason,
    events: [...existing.events, event(nextStatus === existing.status ? 'updated' : 'status_changed', input.actor ?? {}, {
      fromStatus: nextStatus === existing.status ? undefined : existing.status,
      toStatus: nextStatus === existing.status ? undefined : nextStatus,
      note: nextStatus === 'cancelled' ? input.cancellationReason?.trim() : undefined,
    })],
    updatedAt: now,
  };
  const validation = validateSpecialtyEpisode(updated);
  if (!validation.valid) throw new Error(validation.errors.join('. '));
  const response = await specialtyCareDB().put(updated);
  updated._rev = response.rev;
  await logAuditSafe('SPECIALTY_EPISODE_UPDATED', input.actor?.id, input.actor?.name, `${updated.pathway} episode ${updated._id}: ${existing.status} → ${updated.status}`);
  emitSyncEvent({ resourceType: updated.type, resourceId: updated._id, operation: 'update', resourceVersion: updated._rev, userId: input.actor?.id, orgId: updated.orgId, hospitalId: updated.hospitalId });
  return updated;
}
