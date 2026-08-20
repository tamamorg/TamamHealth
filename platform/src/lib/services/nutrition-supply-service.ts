/**
 * Nutrition supply inventory — RUTF/therapeutic milk/ORS/micronutrient stock
 * tracked by nutrition staff at a facility.
 *
 * Mirrors the pharmacy inventory pattern (see pharmacy-inventory-service.ts):
 * one row per supply item per facility, persisted immediately on every
 * receipt/consumption adjustment (no useState-only mutation), with a
 * 409-conflict retry so two staff adjusting the same item concurrently don't
 * lose an update.
 *
 * The doc type is defined here rather than in db-types.ts (kept isolated from
 * unrelated in-flight work on that file) — org-scoped synced store
 * (tamamhealth_nutrition_supplies), registered in sync-config.ts alongside
 * tamamhealth_nutrition_screenings.
 */
import { v4 as uuidv4 } from 'uuid';
import { nutritionSuppliesDB } from '../db';
import type { BaseDoc } from '../db-types';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { findByType } from './db-query';

export interface NutritionSupplyDoc extends BaseDoc {
  type: 'nutrition_supply';
  name: string;
  /** sachets, tins, packets, capsules, tabs, tapes, units, ... */
  unit: string;
  currentLevel: number;
  reorderLevel: number;
  hospitalId?: string;
  orgId?: string;
  lastReceivedAt?: string;
  lastConsumedAt?: string;
  updatedBy?: string;
  updatedByName?: string;
}

export type NutritionSupplyStatus = 'ok' | 'low' | 'critical';

/** Low-stock derivation: below half the reorder level is critical, at/below it is low. */
export function classifySupplyStatus(
  item: Pick<NutritionSupplyDoc, 'currentLevel' | 'reorderLevel'>
): NutritionSupplyStatus {
  if (item.reorderLevel > 0 && item.currentLevel <= item.reorderLevel / 2) return 'critical';
  if (item.reorderLevel > 0 && item.currentLevel <= item.reorderLevel) return 'low';
  return 'ok';
}

export async function getAllSupplies(scope?: DataScope): Promise<NutritionSupplyDoc[]> {
  const db = nutritionSuppliesDB();
  const all = (await findByType<NutritionSupplyDoc>(db, 'nutrition_supply'))
    .sort((a, b) => a.name.localeCompare(b.name));
  return scope ? filterByScope(all, scope) : all;
}

export interface CreateSupplyInput {
  name: string;
  unit: string;
  currentLevel: number;
  reorderLevel: number;
  hospitalId?: string;
  orgId?: string;
  createdBy?: string;
}

export async function createSupplyItem(input: CreateSupplyInput): Promise<NutritionSupplyDoc> {
  const name = (input.name || '').trim();
  if (!name) throw new Error('A supply item name is required');
  const unit = (input.unit || '').trim() || 'units';
  const currentLevel = Number.isFinite(input.currentLevel) ? Math.max(0, input.currentLevel) : 0;
  const reorderLevel = Number.isFinite(input.reorderLevel) ? Math.max(0, input.reorderLevel) : 0;

  const db = nutritionSuppliesDB();
  const now = new Date().toISOString();
  const doc: NutritionSupplyDoc = {
    _id: `nsup-${uuidv4()}`,
    type: 'nutrition_supply',
    name,
    unit,
    currentLevel,
    reorderLevel,
    hospitalId: input.hospitalId,
    orgId: input.orgId,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  await logAuditSafe(
    'NUTRITION_SUPPLY_ADD',
    input.createdBy,
    undefined,
    `${name} added to nutrition supply inventory: ${currentLevel} ${unit} (reorder at ${reorderLevel})`,
  );
  emitSyncEvent({
    resourceType: 'nutrition_supply',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.hospitalId,
  });
  return doc;
}

/**
 * Adjust a supply item's stock level by `delta` (positive = receipt,
 * negative = consumption/dispense). Floors at 0. Retries up to 5 times on a
 * 409 revision conflict, re-reading the latest doc each round — the same
 * strategy pharmacy's decrementStock uses so a concurrent adjustment from
 * another tab/device doesn't silently evaporate.
 */
export async function adjustSupplyLevel(
  id: string,
  delta: number,
  actor?: { id?: string; name?: string },
): Promise<NutritionSupplyDoc | null> {
  const db = nutritionSuppliesDB();
  const MAX_RETRIES = 5;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let target: NutritionSupplyDoc;
    try {
      target = await db.get(id) as NutritionSupplyDoc;
    } catch {
      return null;
    }
    const now = new Date().toISOString();
    const nextLevel = Math.max(0, (target.currentLevel || 0) + delta);
    const updated: NutritionSupplyDoc = {
      ...target,
      currentLevel: nextLevel,
      updatedAt: now,
      updatedBy: actor?.id ?? target.updatedBy,
      updatedByName: actor?.name ?? target.updatedByName,
      ...(delta > 0 ? { lastReceivedAt: now } : {}),
      ...(delta < 0 ? { lastConsumedAt: now } : {}),
    };
    try {
      const resp = await db.put(updated);
      updated._rev = resp.rev;
      emitSyncEvent({
        resourceType: 'nutrition_supply',
        resourceId: updated._id,
        operation: 'update',
        resourceVersion: resp.rev,
        orgId: updated.orgId,
        hospitalId: updated.hospitalId,
      });
      return updated;
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 409 && attempt < MAX_RETRIES - 1) continue;
      throw err;
    }
  }
  return null;
}

export interface SeedSupplyItem {
  name: string;
  unit: string;
  currentLevel: number;
  reorderLevel: number;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');
}

/**
 * One-time demo seed: if the store is empty, persists the given starter
 * items as real docs so the supplies card has something to show and +/-
 * adjustments have somewhere to land, instead of a hardcoded useState-only
 * list that vanished on reload. No-op once any nutrition_supply doc exists
 * for this facility — never overwrites or duplicates existing data.
 *
 * Deterministic per-name ids (slugified) mean two tabs racing to seed at
 * once both attempt the same _id and only one write wins (PouchDB rejects
 * the loser's put as a 409), so we don't end up with duplicate demo rows.
 *
 * Callers should only pass items here in demo mode — production deploys
 * should populate real stock via createSupplyItem (the "Add supply item"
 * affordance).
 */
export async function seedSuppliesIfEmpty(
  items: SeedSupplyItem[],
  ctx: { hospitalId?: string; orgId?: string },
): Promise<void> {
  // Seed only when THIS facility's store is empty — an unscoped check would
  // see another facility's supplies (the store is org-scoped and syncs across
  // facilities in an org) and wrongly skip seeding, leaving a genuinely-empty
  // facility blank forever.
  const all = await getAllSupplies();
  const alreadySeeded = all.some(s =>
    (ctx.hospitalId ? s.hospitalId === ctx.hospitalId : true) &&
    (ctx.orgId ? s.orgId === ctx.orgId : true),
  );
  if (alreadySeeded) return;
  const db = nutritionSuppliesDB();
  const now = new Date().toISOString();
  // Scope the _id to the facility/org too — a bare `nsup-<name>` would collide
  // across facilities in the same synced org, so a second facility's seed of
  // the same item would be rejected and silently never appear.
  const scopeKey = ctx.hospitalId ?? ctx.orgId ?? 'global';
  const docs: NutritionSupplyDoc[] = items.map(item => ({
    _id: `nsup-${scopeKey}-${slugify(item.name)}`,
    type: 'nutrition_supply',
    name: item.name,
    unit: item.unit,
    currentLevel: item.currentLevel,
    reorderLevel: item.reorderLevel,
    hospitalId: ctx.hospitalId,
    orgId: ctx.orgId,
    createdAt: now,
    updatedAt: now,
  }));
  try {
    await db.bulkDocs(docs);
  } catch {
    // Best-effort — a concurrent seed from another tab is fine; PouchDB
    // rejects duplicate _ids individually rather than throwing here.
  }
}
