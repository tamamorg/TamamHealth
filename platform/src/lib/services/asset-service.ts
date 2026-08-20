/**
 * Asset Management service — CRUD + maintenance log helpers for facility
 * equipment, vehicles, IT, cold-chain, etc. Scope-aware so org admins,
 * superintendents, and Ministry of Health users see the right slice.
 */
import { assetsDB } from '../db';
import type { AssetDoc, AssetMaintenanceLog, AssetStatus } from '../db-types-asset';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { findByType } from './db-query';
import { toIsoDate } from '@/lib/date-utils';

export async function getAllAssets(scope?: DataScope): Promise<AssetDoc[]> {
  const db = assetsDB();
  const all = (await findByType<AssetDoc>(db, 'asset'))
    .sort((a, b) => a.name.localeCompare(b.name));
  return scope ? filterByScope(all, scope) : all;
}

export async function getAssetById(id: string): Promise<AssetDoc | null> {
  try {
    const doc = await assetsDB().get(id) as AssetDoc;
    return doc.type === 'asset' ? doc : null;
  } catch {
    return null;
  }
}

export interface CreateAssetInput {
  name: string;
  serialNumber?: string;
  assetTag: string;
  category: AssetDoc['category'];
  manufacturer?: string;
  model?: string;
  facilityId: string;
  facilityName: string;
  facilityLevel: AssetDoc['facilityLevel'];
  department?: string;
  location?: string;
  status?: AssetStatus;
  condition?: AssetDoc['condition'];
  acquiredDate?: string;
  cost?: number;
  costCurrency?: string;
  donor?: string;
  warrantyExpiresAt?: string;
  serviceIntervalMonths?: number;
  notes?: string;
  state?: string;
  county?: string;
  orgId?: string;
  createdBy?: string;
  createdByName?: string;
}

export async function createAsset(input: CreateAssetInput): Promise<AssetDoc> {
  const db = assetsDB();
  const now = new Date().toISOString();
  const nextServiceDueAt = input.serviceIntervalMonths
    ? toIsoDate(new Date(Date.now() + input.serviceIntervalMonths * 30 * 86400000))
    : undefined;

  const doc: AssetDoc = {
    _id: `asset-${uuidv4()}`,
    type: 'asset',
    name: input.name,
    serialNumber: input.serialNumber,
    assetTag: input.assetTag,
    category: input.category,
    manufacturer: input.manufacturer,
    model: input.model,
    facilityId: input.facilityId,
    facilityName: input.facilityName,
    facilityLevel: input.facilityLevel,
    department: input.department,
    location: input.location,
    status: input.status || 'operational',
    condition: input.condition || 'good',
    acquiredDate: input.acquiredDate,
    cost: input.cost,
    costCurrency: input.costCurrency || 'SSP',
    donor: input.donor,
    warrantyExpiresAt: input.warrantyExpiresAt,
    serviceIntervalMonths: input.serviceIntervalMonths,
    nextServiceDueAt,
    maintenanceLog: [],
    notes: input.notes,
    state: input.state,
    county: input.county,
    orgId: input.orgId,
    createdAt: now,
    updatedAt: now,
  };

  const resp = await db.put(doc);
  doc._rev = resp.rev;

  if (input.createdBy) {
    await logAuditSafe('ASSET_REGISTERED', input.createdBy, input.createdByName || input.createdBy,
      `Registered asset "${doc.name}" (tag ${doc.assetTag}) at ${doc.facilityName}`);
  }

  emitSyncEvent({
    resourceType: 'asset',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });

  return doc;
}

export async function updateAsset(id: string, updates: Partial<AssetDoc>): Promise<AssetDoc | null> {
  const db = assetsDB();
  try {
    const existing = await db.get(id) as AssetDoc;
    const next: AssetDoc = {
      ...existing,
      ...updates,
      _id: existing._id,
      _rev: existing._rev,
      type: 'asset',
      updatedAt: new Date().toISOString(),
    };
    const resp = await db.put(next);
    next._rev = resp.rev;
    emitSyncEvent({
      resourceType: 'asset',
      resourceId: next._id,
      operation: 'update',
      resourceVersion: next._rev,
      orgId: next.orgId,
      hospitalId: next.facilityId,
    });
    return next;
  } catch {
    return null;
  }
}

export async function setAssetStatus(
  id: string,
  status: AssetStatus,
  actor: { id: string; name: string },
): Promise<AssetDoc | null> {
  const updated = await updateAsset(id, { status });
  if (updated) {
    await logAuditSafe('ASSET_STATUS_CHANGED', actor.id, actor.name,
      `Set "${updated.name}" → ${status}`);
  }
  return updated;
}

export async function logMaintenance(
  id: string,
  entry: Omit<AssetMaintenanceLog, 'date'> & { date?: string },
): Promise<AssetDoc | null> {
  const db = assetsDB();
  try {
    const existing = await db.get(id) as AssetDoc;
    const now = new Date().toISOString();
    const log = [...(existing.maintenanceLog || []), { ...entry, date: entry.date || now }];
    const nextServiceDueAt = existing.serviceIntervalMonths
      ? toIsoDate(new Date(Date.now() + existing.serviceIntervalMonths * 30 * 86400000))
      : existing.nextServiceDueAt;
    const next: AssetDoc = {
      ...existing,
      maintenanceLog: log,
      lastServicedAt: now,
      nextServiceDueAt,
      // A repair implies the asset is back operational unless caller overrode.
      status: entry.type === 'repair' ? 'operational' : existing.status,
      updatedAt: now,
    };
    const resp = await db.put(next);
    next._rev = resp.rev;
    await logAuditSafe('ASSET_MAINTENANCE', entry.performedBy, entry.performedByName,
      `${entry.type} on "${existing.name}": ${entry.notes}`);
    emitSyncEvent({
      resourceType: 'asset',
      resourceId: next._id,
      operation: 'update',
      resourceVersion: next._rev,
      orgId: next.orgId,
      hospitalId: next.facilityId,
    });
    return next;
  } catch {
    return null;
  }
}

export async function deleteAsset(id: string): Promise<boolean> {
  const db = assetsDB();
  try {
    const existing = await db.get(id);
    const typed = existing as unknown as AssetDoc;
    await db.remove(existing);
    emitSyncEvent({
      resourceType: 'asset',
      resourceId: id,
      operation: 'delete',
      orgId: typed.orgId,
      hospitalId: typed.facilityId,
    });
    return true;
  } catch {
    return false;
  }
}

// ===== Aggregates for dashboards =====

export interface AssetSummary {
  total: number;
  operational: number;
  needsService: number;
  underRepair: number;
  decommissioned: number;
  serviceDueSoon: number;       // due within 30 days
  warrantyExpiringSoon: number; // expiring within 60 days
  byCategory: Record<string, number>;
}

export async function getAssetSummary(scope?: DataScope): Promise<AssetSummary> {
  const all = await getAllAssets(scope);
  const now = Date.now();
  const dueSoonMs = 30 * 86400000;
  const warrantySoonMs = 60 * 86400000;

  const summary: AssetSummary = {
    total: all.length,
    operational: 0, needsService: 0, underRepair: 0, decommissioned: 0,
    serviceDueSoon: 0, warrantyExpiringSoon: 0,
    byCategory: {},
  };

  for (const a of all) {
    if (a.status === 'operational') summary.operational++;
    else if (a.status === 'needs_service') summary.needsService++;
    else if (a.status === 'under_repair') summary.underRepair++;
    else if (a.status === 'decommissioned') summary.decommissioned++;

    if (a.nextServiceDueAt) {
      const due = new Date(a.nextServiceDueAt).getTime();
      if (due - now < dueSoonMs && due - now > -dueSoonMs) summary.serviceDueSoon++;
    }
    if (a.warrantyExpiresAt) {
      const exp = new Date(a.warrantyExpiresAt).getTime();
      if (exp - now < warrantySoonMs && exp > now) summary.warrantyExpiringSoon++;
    }

    summary.byCategory[a.category] = (summary.byCategory[a.category] || 0) + 1;
  }

  return summary;
}
