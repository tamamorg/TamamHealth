/**
 * Generic CRUD service factory.
 *
 * Most data services repeat the same boilerplate: build a `{ _id, type,
 * ...data, createdAt, updatedAt }` doc, `db.put`, write an audit-log entry,
 * and emit a sync event; plus matching update / get / list / remove. This
 * factory captures that pattern once so services only declare their config
 * and add their domain-specific functions on top.
 *
 * Behavior is intentionally identical to the hand-rolled services it replaces:
 *   create → `${idPrefix}-<uuid8>`, type stamped, timestamps set, audit
 *            `CREATE_<AUDIT>`, sync `create`.
 *   update → merge + bump updatedAt, audit `UPDATE_<AUDIT>`, sync `update`.
 *   remove → db.remove, audit `DELETE_<AUDIT>`, sync `delete`.
 *
 * Services with special semantics (financial ledgers, append-only logs,
 * clinical lifecycles) keep their bespoke logic — adopt this only where the
 * standard pattern fits.
 */

import { v4 as uuidv4 } from 'uuid';
import type { BaseDoc } from '../db-types';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { findByType } from './db-query';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';

type AnyDB = PouchDB.Database;
type WithOrgScope = { orgId?: string; hospitalId?: string };

export interface CrudServiceConfig {
  /** PouchDB accessor (e.g. `() => assetsDB()`). */
  db: () => AnyDB;
  /** Doc `type` discriminator (e.g. `'asset'`). */
  type: string;
  /** `_id` prefix (e.g. `'asset'` → `asset-ab12cd34`). */
  idPrefix: string;
  /** Sync `resourceType` (defaults to `type`). */
  resourceType?: string;
  /** Audit-action suffix (e.g. `'ASSET'` → `CREATE_ASSET`). Defaults to type upper-cased. */
  auditLabel?: string;
}

export type CreateInput<TDoc extends BaseDoc & { type: string }> =
  Omit<TDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>;

export interface CrudService<TDoc extends BaseDoc> {
  create(data: CreateInput<TDoc & { type: string }>): Promise<TDoc>;
  update(id: string, data: Partial<TDoc>): Promise<TDoc | null>;
  get(id: string): Promise<TDoc | null>;
  list(scope?: DataScope): Promise<TDoc[]>;
  remove(id: string): Promise<boolean>;
}

export function createCrudService<TDoc extends BaseDoc & { type: string } & WithOrgScope>(
  config: CrudServiceConfig,
): CrudService<TDoc> {
  const resourceType = config.resourceType ?? config.type;
  const auditLabel = config.auditLabel ?? config.type.toUpperCase();

  async function create(data: CreateInput<TDoc>): Promise<TDoc> {
    const db = config.db();
    const now = new Date().toISOString();
    const doc = {
      _id: `${config.idPrefix}-${uuidv4()}`,
      type: config.type,
      ...data,
      createdAt: now,
      updatedAt: now,
    } as unknown as TDoc;
    const resp = await db.put(doc);
    doc._rev = resp.rev;
    await logAuditSafe(`CREATE_${auditLabel}`, undefined, undefined, `${config.type} ${doc._id}`);
    await emitSyncEvent({
      resourceType, resourceId: doc._id, operation: 'create',
      resourceVersion: doc._rev, orgId: doc.orgId, hospitalId: doc.hospitalId,
    });
    return doc;
  }

  async function update(id: string, data: Partial<TDoc>): Promise<TDoc | null> {
    const db = config.db();
    try {
      const existing = await db.get(id) as TDoc;
      const updated = { ...existing, ...data, _id: existing._id, _rev: existing._rev, updatedAt: new Date().toISOString() } as TDoc;
      const resp = await db.put(updated);
      updated._rev = resp.rev;
      await logAuditSafe(`UPDATE_${auditLabel}`, undefined, undefined, `${config.type} ${id}`);
      await emitSyncEvent({
        resourceType, resourceId: id, operation: 'update',
        resourceVersion: updated._rev, orgId: updated.orgId, hospitalId: updated.hospitalId,
      });
      return updated;
    } catch {
      return null;
    }
  }

  async function get(id: string): Promise<TDoc | null> {
    try {
      return await config.db().get(id) as TDoc;
    } catch {
      return null;
    }
  }

  async function list(scope?: DataScope): Promise<TDoc[]> {
    const docs = await findByType<TDoc>(config.db(), config.type);
    return scope ? filterByScope(docs, scope) : docs;
  }

  async function remove(id: string): Promise<boolean> {
    const db = config.db();
    try {
      const doc = await db.get(id);
      await db.remove(doc);
      await logAuditSafe(`DELETE_${auditLabel}`, undefined, undefined, `${config.type} ${id}`);
      await emitSyncEvent({ resourceType, resourceId: id, operation: 'delete' });
      return true;
    } catch {
      return false;
    }
  }

  return { create, update, get, list, remove };
}
