/**
 * Visit reasons — the patient-facing service menu a booking surface offers.
 *
 * This is the practice's vocabulary, not the chart's: "Annual Gynecology
 * Visit", "Well Baby/Child Visit". Each reason carries its own duration, which
 * is what lets a 40-minute new-patient visit refuse to land in a 15-minute gap,
 * and an `appointmentType` that maps it back onto the clinical union so every
 * existing report keeps working.
 */

import { visitReasonsDB } from '../db';
import type { VisitReasonDoc, PatientClass } from '../db-types-booking';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { findByType } from './db-query';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { v4 as uuidv4 } from 'uuid';

/** "Annual Gynecology Visit" → "annual-gynecology-visit". */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// ═══════════════════════════════════════════════════════════════════════════
// Defaults
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The service menu every facility starts with.
 *
 * A facility is bookable the moment it exists — nobody has to configure a list
 * of visit types before the desk can book an appointment. These are the visits
 * a general facility actually runs, with the durations they actually take, and
 * a site that wants different ones edits them in Settings → Visit types.
 *
 * They are NOT written to the database on read. A read path that quietly
 * creates documents races across tabs and devices and leaves rows nobody asked
 * for; these are materialised in memory and only persisted the first time
 * someone edits the list (see `ensureVisitReasonsPersisted`).
 */
export const DEFAULT_VISIT_REASONS: ReadonlyArray<
  Pick<VisitReasonDoc,
    | 'name' | 'slug' | 'description' | 'durationMinutes' | 'availableToNewPatients'
    | 'availableToReturningPatients' | 'modality' | 'department' | 'appointmentType'>
> = [
  {
    name: 'General Consultation', slug: 'general-consultation',
    description: 'A standard outpatient consultation.',
    durationMinutes: 30, availableToNewPatients: true, availableToReturningPatients: true,
    modality: 'in_person', department: 'Outpatient', appointmentType: 'general',
  },
  {
    name: 'New Patient Visit', slug: 'new-patient-visit',
    description: 'First visit at this facility — allow extra time for history.',
    durationMinutes: 40, availableToNewPatients: true, availableToReturningPatients: false,
    modality: 'in_person', department: 'Outpatient', appointmentType: 'general',
  },
  {
    name: 'Follow-up Review', slug: 'follow-up-review',
    description: 'Review of an ongoing problem or recent results.',
    durationMinutes: 20, availableToNewPatients: false, availableToReturningPatients: true,
    modality: 'in_person', department: 'Outpatient', appointmentType: 'follow_up',
  },
  {
    name: 'Antenatal Visit', slug: 'antenatal-visit',
    description: 'Scheduled antenatal check during pregnancy.',
    durationMinutes: 30, availableToNewPatients: true, availableToReturningPatients: true,
    modality: 'in_person', department: 'Obstetrics & Gynecology', appointmentType: 'anc',
  },
  {
    name: 'Child Immunization', slug: 'child-immunization',
    description: 'Routine vaccination for a child under five.',
    durationMinutes: 15, availableToNewPatients: true, availableToReturningPatients: true,
    modality: 'in_person', department: 'Pediatrics', appointmentType: 'immunization',
  },
];

/** Stable id so a default keeps its identity across reloads and devices. */
export function defaultVisitReasonId(facilityId: string, slug: string): string {
  return `visit-reason-default-${facilityId}-${slug}`;
}

/** The built-in menu as real documents, for a facility that has none of its own. */
export function materialiseDefaults(facilityId: string, orgId: string): VisitReasonDoc[] {
  // A fixed timestamp, not `new Date()`: these are the same documents on every
  // read, and a moving `updatedAt` would make React treat them as new objects
  // on every render.
  const at = '1970-01-01T00:00:00.000Z';
  return DEFAULT_VISIT_REASONS.map((template, index) => ({
    _id: defaultVisitReasonId(facilityId, template.slug),
    type: 'visit_reason' as const,
    orgId,
    facilityId,
    ...template,
    providerIds: [],
    requiresInsurance: false,
    sortOrder: index,
    isActive: true,
    createdAt: at,
    updatedAt: at,
  }));
}

/** Whether a reason is one of the built-ins rather than something authored. */
export function isDefaultVisitReason(reason: VisitReasonDoc): boolean {
  return reason._id.startsWith('visit-reason-default-');
}

export async function getAllVisitReasons(scope?: DataScope): Promise<VisitReasonDoc[]> {
  const db = visitReasonsDB();
  const all = await findByType<VisitReasonDoc>(db, 'visit_reason');
  all.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
  return scope ? filterByScope(all, scope) : all;
}

/**
 * Reasons offered at a facility.
 *
 * A reason with no `facilityId` belongs to the whole organisation, which is how
 * a small practice configures its menu once instead of per site.
 *
 * A facility that has authored nothing gets `DEFAULT_VISIT_REASONS`, so every
 * facility is bookable from the day it exists rather than after someone
 * remembers to fill in a list. Once anything has been authored, that is the
 * menu — the defaults do not reappear alongside it, or removing one would be
 * impossible.
 */
export async function getVisitReasonsForFacility(
  facilityId: string,
  orgId?: string,
): Promise<VisitReasonDoc[]> {
  const all = await getAllVisitReasons();
  const owned = all.filter(r =>
    (!orgId || r.orgId === orgId) &&
    (!r.facilityId || r.facilityId === facilityId));

  if (owned.length === 0) return materialiseDefaults(facilityId, orgId || '');
  return owned.filter(r => r.isActive);
}

/**
 * Write the built-in menu to the database, so it can be edited.
 *
 * Called by the settings screen the first time someone changes anything: until
 * then the defaults are computed, and a computed document has no `_rev` to
 * update. Returns the persisted rows. A no-op once the facility has authored
 * anything of its own.
 */
export async function ensureVisitReasonsPersisted(
  facilityId: string,
  orgId: string,
): Promise<VisitReasonDoc[]> {
  const all = await getAllVisitReasons();
  const owned = all.filter(r =>
    r.orgId === orgId && (!r.facilityId || r.facilityId === facilityId));
  if (owned.length > 0) return owned;

  const db = visitReasonsDB();
  const now = new Date().toISOString();
  const written: VisitReasonDoc[] = [];
  for (const doc of materialiseDefaults(facilityId, orgId)) {
    const row = { ...doc, createdAt: now, updatedAt: now };
    try {
      const resp = await db.put(row);
      written.push({ ...row, _rev: resp.rev });
    } catch {
      // Another tab got there first — its copy is equally valid.
      try { written.push(await db.get(row._id) as VisitReasonDoc); } catch { /* skip */ }
    }
  }
  return written;
}

/** The subset a given kind of booker may actually pick online. */
export function bookableBy(reasons: VisitReasonDoc[], patientClass: PatientClass): VisitReasonDoc[] {
  return reasons.filter(r => (
    patientClass === 'new' ? r.availableToNewPatients : r.availableToReturningPatients
  ));
}

export async function getVisitReasonById(id: string): Promise<VisitReasonDoc | null> {
  try {
    return await visitReasonsDB().get(id) as VisitReasonDoc;
  } catch {
    return null;
  }
}

export async function getVisitReasonBySlug(slug: string, orgId?: string): Promise<VisitReasonDoc | null> {
  const all = await getAllVisitReasons();
  return all.find(r => r.slug === slug && (!orgId || r.orgId === orgId)) ?? null;
}

export type VisitReasonInput =
  Omit<VisitReasonDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt' | 'slug' | 'isActive' | 'sortOrder'>
  & Partial<Pick<VisitReasonDoc, 'slug' | 'isActive' | 'sortOrder'>>;

export async function createVisitReason(
  input: VisitReasonInput,
  actorId?: string,
  actorName?: string,
): Promise<VisitReasonDoc> {
  if (!input.name?.trim()) throw new Error('A visit reason needs a name');
  if (!input.orgId) throw new Error('A visit reason needs an organization');
  if (!(input.durationMinutes > 0)) throw new Error('A visit reason needs a duration in minutes');
  // A reason offered to neither new nor returning patients is legitimate — it
  // is a staff-booking-only service — so it is allowed, not rejected. The
  // settings screen labels it rather than the service refusing it.

  const db = visitReasonsDB();
  const now = new Date().toISOString();
  const slug = input.slug || slugify(input.name);

  const existing = await getAllVisitReasons();
  if (existing.some(r => r.slug === slug && r.orgId === input.orgId)) {
    throw new Error(`"${input.name}" already exists in this organization`);
  }

  const doc: VisitReasonDoc = {
    _id: `visit-reason-${uuidv4().slice(0, 8)}`,
    type: 'visit_reason',
    isActive: true,
    sortOrder: existing.length,
    ...input,
    slug,
    name: input.name.trim(),
    createdAt: now,
    updatedAt: now,
  };

  const resp = await db.put(doc);
  doc._rev = resp.rev;
  await logAuditSafe('CREATE_VISIT_REASON', actorId, actorName,
    `Visit reason "${doc.name}" (${doc.durationMinutes} min)`);
  emitSyncEvent({
    resourceType: 'visit_reason',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });
  return doc;
}

export async function updateVisitReason(
  id: string,
  updates: Partial<VisitReasonInput>,
  actorId?: string,
  actorName?: string,
): Promise<VisitReasonDoc> {
  const db = visitReasonsDB();
  const existing = await db.get(id) as VisitReasonDoc;
  if (updates.durationMinutes !== undefined && !(updates.durationMinutes > 0)) {
    throw new Error('A visit reason needs a duration in minutes');
  }
  const doc: VisitReasonDoc = {
    ...existing,
    ...updates,
    _id: existing._id,
    _rev: existing._rev,
    type: 'visit_reason',
    updatedAt: new Date().toISOString(),
  };
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  await logAuditSafe('UPDATE_VISIT_REASON', actorId, actorName, `Visit reason "${doc.name}" updated`);
  emitSyncEvent({
    resourceType: 'visit_reason',
    resourceId: doc._id,
    operation: 'update',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });
  return doc;
}

/**
 * Retire a reason rather than deleting it.
 *
 * Appointments booked under it keep a denormalised `visitReasonName`, but the
 * document itself is still what a report or a reschedule looks up. Deleting it
 * would leave those bookings pointing at nothing.
 */
export async function retireVisitReason(id: string, actorId?: string, actorName?: string): Promise<void> {
  await updateVisitReason(id, { isActive: false }, actorId, actorName);
}
