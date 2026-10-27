/**
 * Text shortcuts — the "dot phrases" behind a section's Text Shortcut button.
 *
 * A shortcut trades typing for recognition: pick "Headache" and the section
 * fills with the paragraph this clinician always writes for a headache, ready
 * to edit. Ranking is by use, so the picker's top entries converge on what
 * someone actually reaches for rather than an alphabetical list they must read
 * every time.
 *
 * Shortcuts are per-clinician by default. A `shared` shortcut is visible to the
 * whole organisation, which is how a practice standardises phrasing without
 * forcing it on anyone.
 */

import { getDB } from '../db';
import { findByType } from '../services/db-query';
import { logAuditSafe } from '../services/audit-service';
import type { TextShortcutDoc } from './types';
import type { NoteSectionId } from './note-catalog';

export const textShortcutsDB = () => getDB('tamamhealth_text_shortcuts');

function nowIso(): string {
  return new Date().toISOString();
}

/** Most-used first, then most-recently-used, then alphabetical. */
function byUsage(a: TextShortcutDoc, b: TextShortcutDoc): number {
  const u = (b.useCount ?? 0) - (a.useCount ?? 0);
  if (u !== 0) return u;
  const r = (b.lastUsedAt || '').localeCompare(a.lastUsedAt || '');
  if (r !== 0) return r;
  return (a.name || '').localeCompare(b.name || '');
}

/**
 * Rank shortcuts written for this section above the rest, without hiding
 * anything.
 *
 * Section scoping used to filter: a shortcut tagged `plan` simply did not
 * appear on Subjective. With every starter phrase tagged, opening the picker on
 * an untagged section showed an empty list, which reads as a broken feature
 * rather than a filtered one. A phrase is a starting point for prose — useful
 * in more places than whoever saved it had in mind — so the section decides
 * order, not visibility.
 */
function sectionFirst(sectionId: NoteSectionId | undefined) {
  return (a: TextShortcutDoc, b: TextShortcutDoc): number => {
    if (sectionId) {
      const am = a.sectionId === sectionId ? 0 : 1;
      const bm = b.sectionId === sectionId ? 0 : 1;
      if (am !== bm) return am - bm;
    }
    return byUsage(a, b);
  };
}

export interface ShortcutQuery {
  userId: string;
  orgId?: string;
  /** Section being edited. Ranks its shortcuts first; never hides the others. */
  sectionId?: NoteSectionId;
  /** Free-text filter from the picker's search box. */
  search?: string;
  limit?: number;
}

/**
 * Shortcuts available to a clinician: their own plus any shared in their
 * organisation, ranked by use.
 */
export async function getTextShortcuts(query: ShortcutQuery): Promise<TextShortcutDoc[]> {
  const rows = await findByType<TextShortcutDoc>(
    textShortcutsDB(), 'text_shortcut', {},
    { indexFields: ['type'] },
  );

  const term = (query.search || '').trim().toLowerCase();
  const visible = rows.filter((s) => {
    const mine = s.userId === query.userId;
    const sharedHere = !!s.shared && (!query.orgId || !s.orgId || s.orgId === query.orgId);
    if (!mine && !sharedHere) return false;
    // Section no longer excludes — see sectionFirst. It orders instead.
    if (term) {
      const hay = `${s.name} ${s.body}`.toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  });

  const sorted = visible.sort(sectionFirst(query.sectionId));
  return typeof query.limit === 'number' ? sorted.slice(0, query.limit) : sorted;
}

export async function getTextShortcutById(id: string): Promise<TextShortcutDoc | null> {
  try {
    return await textShortcutsDB().get(id) as TextShortcutDoc;
  } catch {
    return null;
  }
}

export interface SaveShortcutInput {
  id?: string;
  userId: string;
  userName?: string;
  name: string;
  body: string;
  sectionId?: NoteSectionId;
  shared?: boolean;
  hospitalId?: string;
  orgId?: string;
}

/** Create or update a shortcut. */
export async function saveTextShortcut(input: SaveShortcutInput): Promise<TextShortcutDoc> {
  const db = textShortcutsDB();
  const name = input.name.trim();
  const body = input.body.trim();
  if (!name) throw new Error('Enter a name for the shortcut.');
  if (!body) throw new Error('Enter the shortcut text.');

  const ts = nowIso();

  if (input.id) {
    const existing = await db.get(input.id) as TextShortcutDoc;
    const updated: TextShortcutDoc = {
      ...existing,
      name, body,
      sectionId: input.sectionId,
      shared: input.shared ?? existing.shared,
      updatedAt: ts,
    };
    const resp = await db.put(updated);
    return { ...updated, _rev: resp.rev };
  }

  const doc: TextShortcutDoc = {
    _id: `shortcut-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'text_shortcut',
    userId: input.userId,
    name, body,
    sectionId: input.sectionId,
    shared: input.shared ?? false,
    useCount: 0,
    hospitalId: input.hospitalId,
    orgId: input.orgId,
    createdBy: input.userId,
    createdAt: ts,
    updatedAt: ts,
  };
  const resp = await db.put(doc);
  await logAuditSafe('TEXT_SHORTCUT_CREATED', input.userId, input.userName,
    `Text shortcut "${name}" created`);
  return { ...doc, _rev: resp.rev };
}

/**
 * Record that a shortcut was used, so ranking reflects real reach-for
 * behaviour. Best-effort: a failed counter update must never block the
 * clinician's text from landing in the note.
 */
export async function bumpShortcutUse(id: string): Promise<void> {
  try {
    const db = textShortcutsDB();
    const existing = await db.get(id) as TextShortcutDoc;
    await db.put({
      ...existing,
      useCount: (existing.useCount ?? 0) + 1,
      lastUsedAt: nowIso(),
      updatedAt: nowIso(),
    });
  } catch {
    /* ranking is a convenience, not a correctness property */
  }
}

export async function deleteTextShortcut(id: string, userName?: string): Promise<boolean> {
  try {
    const db = textShortcutsDB();
    const existing = await db.get(id) as TextShortcutDoc;
    await db.remove({ _id: existing._id, _rev: existing._rev! });
    await logAuditSafe('TEXT_SHORTCUT_DELETED', existing.userId, userName,
      `Text shortcut "${existing.name}" deleted`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Insert a shortcut's body into existing section text.
 *
 * Appends rather than replaces: a clinician who has already typed something and
 * then reaches for a phrase means "and also this", not "throw that away".
 */
export function applyShortcut(existing: string, body: string): string {
  const current = (existing || '').trimEnd();
  const addition = (body || '').trim();
  if (!addition) return existing;
  if (!current) return addition;
  return `${current}\n\n${addition}`;
}
