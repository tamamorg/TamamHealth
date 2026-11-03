'use client';

/**
 * Unsaved form text kept on this device so it survives a refresh, a crash or
 * a power cut.
 *
 * What is typed is patient information, so a draft is stored only as an
 * envelope sealed under the organisation's data key — the same encryption as
 * patient records (lib/org-data-cipher.ts). When no key is available the draft
 * is simply not kept; plaintext is never written. Drafts never sync: they
 * live in this browser's storage only, under the user who typed them.
 *
 * A draft goes when its form is saved or cancelled, when anyone signs out on
 * this device, and after DRAFT_MAX_AGE_MS regardless.
 */

import { decryptForOrg, encryptForOrg, isOrgEncrypted } from '@/lib/org-data-cipher';
import type { DraftValues } from './draft-fields';

const PREFIX = 'tamam.draft.v1.';
export const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface StoredDraft {
  savedAt: string;
  sealed: string;
}

function storage(): Storage | null {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}

/**
 * The storage key for one form. The form's identity (page, title, whose
 * record) is hashed, so a patient's name in a form title never sits in the
 * key in clear.
 */
export async function draftStorageKey(userId: string, scope: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${userId}\u0001${scope}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hex = Array.from(digest.slice(0, 16), b => b.toString(16).padStart(2, '0')).join('');
  return `${PREFIX}${userId}.${hex}`;
}

/** Seal and keep a draft. Returns false when it could not be kept safely. */
export async function saveDraft(storageKey: string, orgId: string | undefined, values: DraftValues): Promise<boolean> {
  const store = storage();
  if (!store) return false;
  if (Object.keys(values).length === 0) { store.removeItem(storageKey); return true; }
  try {
    const sealed = await encryptForOrg(JSON.stringify(values), orgId ?? null);
    if (!isOrgEncrypted(sealed)) return false;
    const record: StoredDraft = { savedAt: new Date().toISOString(), sealed };
    store.setItem(storageKey, JSON.stringify(record));
    return true;
  } catch {
    // No key on this device, or storage full: the warning still protects the text.
    return false;
  }
}

/** A kept draft, opened, or null. An expired or unreadable one is removed. */
export async function loadDraft(storageKey: string, now = Date.now()): Promise<{ values: DraftValues; savedAt: string } | null> {
  const store = storage();
  const raw = store?.getItem(storageKey);
  if (!store || !raw) return null;
  try {
    const record = JSON.parse(raw) as StoredDraft;
    if (!record.savedAt || !record.sealed || now - Date.parse(record.savedAt) > DRAFT_MAX_AGE_MS) {
      store.removeItem(storageKey);
      return null;
    }
    const values = JSON.parse(await decryptForOrg(record.sealed)) as DraftValues;
    return { values, savedAt: record.savedAt };
  } catch {
    store.removeItem(storageKey);
    return null;
  }
}

export function removeDraft(storageKey: string): void {
  storage()?.removeItem(storageKey);
}

/** Every draft on this device, for every user — sign-out and device wipe. */
export function clearAllDrafts(): void {
  const store = storage();
  if (!store) return;
  for (const key of Object.keys(store)) if (key.startsWith(PREFIX)) store.removeItem(key);
}

/** Drop drafts past their age, without opening them. */
export function purgeExpiredDrafts(now = Date.now()): void {
  const store = storage();
  if (!store) return;
  for (const key of Object.keys(store)) {
    if (!key.startsWith(PREFIX)) continue;
    try {
      const record = JSON.parse(store.getItem(key) || '{}') as Partial<StoredDraft>;
      if (!record.savedAt || now - Date.parse(record.savedAt) > DRAFT_MAX_AGE_MS) store.removeItem(key);
    } catch {
      store.removeItem(key);
    }
  }
}
