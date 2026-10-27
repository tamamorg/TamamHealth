/**
 * Clinical favorites — a per-clinician shortcut list for the diagnoses,
 * medicines and procedures a provider reaches for most. Mirrors the
 * HealthBridge "favorites under every section" idea: one tap to add a frequent
 * item to a consultation instead of searching for it every time.
 *
 * Stored one doc per (user, kind, code) so toggling on/off is idempotent and a
 * picker can render its stars without de-duping. Synced org-scoped (a clinician
 * keeps their favorites at any workstation) but excluded from national analytics
 * — see the sync coverage matrix.
 */
import { clinicalFavoritesDB } from '../db';
import type { ClinicalFavoriteDoc, FavoriteKind } from '../db-types';
import { findByType } from './db-query';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';

/** Deterministic id so the same favorite for a user is a single doc. */
function favoriteId(userId: string, kind: FavoriteKind, code: string): string {
  const safe = `${userId}:${kind}:${code}`.toLowerCase().replace(/[^a-z0-9:_-]/g, '_');
  return `fav-${safe}`;
}

function byUse(a: ClinicalFavoriteDoc, b: ClinicalFavoriteDoc): number {
  const u = (b.useCount ?? 0) - (a.useCount ?? 0);
  if (u !== 0) return u;
  return (a.label || '').localeCompare(b.label || '');
}

/** All favorites for a clinician, optionally narrowed to one kind, most-used first. */
export async function getFavorites(userId: string, kind?: FavoriteKind): Promise<ClinicalFavoriteDoc[]> {
  const filter: Record<string, unknown> = { userId };
  if (kind) filter.kind = kind;
  const rows = await findByType<ClinicalFavoriteDoc>(
    clinicalFavoritesDB(),
    'clinical_favorite',
    filter,
    { indexFields: ['type', 'userId'] },
  );
  return rows.sort(byUse);
}

export interface AddFavoriteInput {
  userId: string;
  userName?: string;
  kind: FavoriteKind;
  code: string;
  label: string;
  meta?: ClinicalFavoriteDoc['meta'];
  hospitalId?: string;
  orgId?: string;
}

/** Whether a given item is already a favorite for the user. */
export async function isFavorite(userId: string, kind: FavoriteKind, code: string): Promise<boolean> {
  try {
    await clinicalFavoritesDB().get(favoriteId(userId, kind, code));
    return true;
  } catch {
    return false;
  }
}

/** Add (or refresh) a favorite. Idempotent — re-adding updates the label/meta. */
export async function addFavorite(input: AddFavoriteInput): Promise<ClinicalFavoriteDoc> {
  if (!input.code || !input.label) throw new Error('Select a code and enter a label for this favorite.');
  const db = clinicalFavoritesDB();
  const _id = favoriteId(input.userId, input.kind, input.code);
  const now = new Date().toISOString();
  let existing: ClinicalFavoriteDoc | null = null;
  try {
    existing = (await db.get(_id)) as ClinicalFavoriteDoc;
  } catch {
    existing = null;
  }
  const doc: ClinicalFavoriteDoc = {
    _id,
    _rev: existing?._rev,
    type: 'clinical_favorite',
    userId: input.userId,
    kind: input.kind,
    code: input.code,
    label: input.label,
    meta: input.meta ?? existing?.meta,
    useCount: existing?.useCount ?? 0,
    hospitalId: input.hospitalId ?? existing?.hospitalId,
    orgId: input.orgId ?? existing?.orgId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  await logAuditSafe('ADD_FAVORITE', input.userId, input.userName, `Favorited ${input.kind} "${input.label}"`);
  emitSyncEvent({ resourceType: 'clinical_favorite', resourceId: doc._id, operation: existing ? 'update' : 'create', resourceVersion: doc._rev, hospitalId: doc.hospitalId, orgId: doc.orgId });
  return doc;
}

/** Remove a favorite. Returns true if it existed. */
export async function removeFavorite(userId: string, kind: FavoriteKind, code: string, userName?: string): Promise<boolean> {
  const db = clinicalFavoritesDB();
  const _id = favoriteId(userId, kind, code);
  try {
    const doc = (await db.get(_id)) as ClinicalFavoriteDoc;
    await db.remove({ _id: doc._id, _rev: doc._rev! });
    await logAuditSafe('REMOVE_FAVORITE', userId, userName, `Unfavorited ${kind} "${doc.label}"`);
    emitSyncEvent({ resourceType: 'clinical_favorite', resourceId: _id, operation: 'delete', hospitalId: doc.hospitalId, orgId: doc.orgId });
    return true;
  } catch {
    return false;
  }
}

/**
 * Toggle a favorite on/off and report the resulting state — the primary call
 * behind a star button. Returns true when the item is now a favorite.
 */
export async function toggleFavorite(input: AddFavoriteInput): Promise<boolean> {
  if (await isFavorite(input.userId, input.kind, input.code)) {
    await removeFavorite(input.userId, input.kind, input.code, input.userName);
    return false;
  }
  await addFavorite(input);
  return true;
}

/**
 * Record that a favorite was used (bumps its useCount so the picker keeps the
 * most-reached-for items on top). Best-effort: never throws into the consult.
 */
export async function bumpFavoriteUse(userId: string, kind: FavoriteKind, code: string): Promise<void> {
  const db = clinicalFavoritesDB();
  const _id = favoriteId(userId, kind, code);
  try {
    const doc = (await db.get(_id)) as ClinicalFavoriteDoc;
    doc.useCount = (doc.useCount ?? 0) + 1;
    doc.updatedAt = new Date().toISOString();
    const resp = await db.put(doc);
    emitSyncEvent({ resourceType: 'clinical_favorite', resourceId: _id, operation: 'update', resourceVersion: resp.rev, hospitalId: doc.hospitalId, orgId: doc.orgId });
  } catch {
    /* not a favorite (or transient) — nothing to bump */
  }
}
