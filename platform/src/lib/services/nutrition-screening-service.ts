/**
 * Nutrition screenings — MUAC-based malnutrition screening for children
 * (6–59 months) and ANC mothers, recorded by nutrition staff.
 *
 * Classification is WHO-aligned and lives here as the single source of truth:
 *   Children:   edema or MUAC <11.5cm ⇒ SAM; <12.5 ⇒ MAM; <13.5 ⇒ At Risk.
 *   ANC women:  MUAC <21.0cm ⇒ Underweight.
 *
 * Org-scoped synced store (tamamhealth_nutrition_screenings).
 */
import { v4 as uuidv4 } from 'uuid';
import { nutritionScreeningsDB } from '../db';
import type { NutritionFollowUpAction, NutritionScreeningDoc, NutritionStatus } from '../db-types';
import { findByType } from './db-query';
import { filterByScope, type DataScope } from './data-scope';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';

export const MUAC_THRESHOLDS = { severe: 11.5, moderate: 12.5, normal: 13.5 } as const;
export const ANC_MUAC_THRESHOLD = 21.0;

/** WHO-aligned classification from MUAC (cm) + bilateral pitting edema. */
export function classifyScreening(muac: number, edema: boolean, isAnc: boolean): NutritionStatus {
  if (isAnc) return muac < ANC_MUAC_THRESHOLD ? 'Underweight' : 'Normal';
  if (edema || muac < MUAC_THRESHOLDS.severe) return 'SAM';
  if (muac < MUAC_THRESHOLDS.moderate) return 'MAM';
  if (muac < MUAC_THRESHOLDS.normal) return 'At Risk';
  return 'Normal';
}

/** All screenings visible to the caller's scope, newest first. */
export async function getAllNutritionScreenings(scope?: DataScope): Promise<NutritionScreeningDoc[]> {
  let rows = await findByType<NutritionScreeningDoc>(nutritionScreeningsDB(), 'nutrition_screening');
  if (scope) rows = filterByScope(rows, scope);
  return rows.sort((a, b) =>
    (b.screeningDate || '').localeCompare(a.screeningDate || '') ||
    new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime()
  );
}

export interface AddNutritionScreeningInput {
  patientId?: string;
  patientName: string;
  age: string;
  sex: string;
  muac: number;
  weightKg?: number;
  heightCm?: number;
  edema: boolean;
  isAnc: boolean;
  notes?: string;
  screeningDate?: string;
  screenedById?: string;
  screenedByName?: string;
  hospitalId?: string;
  orgId?: string;
}

export async function addNutritionScreening(input: AddNutritionScreeningInput): Promise<NutritionScreeningDoc> {
  const name = (input.patientName || '').trim();
  if (!name) throw new Error('A patient name is required');
  if (!Number.isFinite(input.muac) || input.muac <= 0 || input.muac > 40) {
    throw new Error('A valid MUAC in cm is required');
  }
  const db = nutritionScreeningsDB();
  const now = new Date().toISOString();
  const status = classifyScreening(input.muac, input.edema, input.isAnc);
  const doc: NutritionScreeningDoc = {
    _id: `nscr-${uuidv4()}`,
    type: 'nutrition_screening',
    patientId: input.patientId,
    patientName: name,
    age: (input.age || '').trim(),
    sex: input.isAnc ? 'F' : input.sex,
    muac: input.muac,
    weightKg: input.weightKg,
    heightCm: input.heightCm,
    edema: input.edema,
    isAnc: input.isAnc,
    notes: input.notes?.trim() || undefined,
    status,
    followUpAction: status === 'Normal' ? undefined : 'needed',
    screeningDate: input.screeningDate || now.slice(0, 10),
    screenedById: input.screenedById,
    screenedByName: input.screenedByName,
    hospitalId: input.hospitalId,
    orgId: input.orgId,
    createdAt: now,
    updatedAt: now,
  };
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  await logAuditSafe(
    'ADD_NUTRITION_SCREENING',
    input.screenedById,
    input.screenedByName,
    `Nutrition screening for ${doc.patientName}: MUAC ${doc.muac}cm → ${doc.status}`,
  );
  emitSyncEvent({ resourceType: 'nutrition_screening', resourceId: doc._id, operation: 'create', resourceVersion: doc._rev, hospitalId: doc.hospitalId, orgId: doc.orgId });
  return doc;
}

export async function updateNutritionScreening(
  id: string,
  patch: Partial<Pick<NutritionScreeningDoc, 'notes' | 'followUpAction' | 'followUpAt'>>,
  actor?: { id?: string; name?: string },
): Promise<NutritionScreeningDoc | null> {
  const db = nutritionScreeningsDB();
  let existing: NutritionScreeningDoc;
  try {
    existing = (await db.get(id)) as NutritionScreeningDoc;
  } catch {
    return null;
  }
  const now = new Date().toISOString();
  const updated: NutritionScreeningDoc = {
    ...existing,
    ...patch,
    notes: patch.notes !== undefined ? (patch.notes.trim() || undefined) : existing.notes,
    updatedAt: now,
  };
  if (patch.followUpAction && patch.followUpAction !== 'needed' && !patch.followUpAt) {
    updated.followUpAt = now;
  }
  const resp = await db.put(updated);
  updated._rev = resp.rev;
  await logAuditSafe(
    'UPDATE_NUTRITION_SCREENING',
    actor?.id,
    actor?.name,
    `Nutrition screening ${id}: ${patch.followUpAction || 'notes updated'}`,
  );
  emitSyncEvent({ resourceType: 'nutrition_screening', resourceId: updated._id, operation: 'update', resourceVersion: updated._rev, hospitalId: updated.hospitalId, orgId: updated.orgId });
  return updated;
}

export type { NutritionFollowUpAction };
