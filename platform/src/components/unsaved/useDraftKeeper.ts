'use client';

/**
 * Keeps what is typed in one region of the page (a popup, the chart's
 * workspace drawer, a full-page form) safe across a refresh.
 *
 * While the region is open it:
 *  - counts as unsaved work as soon as a kept field is changed, so a refresh,
 *    a tab close or a link to another page asks first (unsaved-registry);
 *  - writes a sealed draft of the changed fields to this device shortly after
 *    each change (draft-store);
 *  - on opening, puts a draft left by a refresh back into the same fields and
 *    says so, with Discard to undo it.
 *
 * When the region closes the draft goes, because the form was saved or
 * cancelled — unless it was dismissed (X, Escape, Back, a click outside) with
 * changes in it. Then the draft stays, and reopening the form brings the text
 * back. Nothing in any form has to be wired by hand.
 */

import { useCallback, useEffect, useRef, type RefObject } from 'react';
import * as AppContextModule from '@/lib/context';
import * as ToastModule from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import {
  DRAFT_ROOT_ATTR, draftFields, isDraftable, readFieldValue, writeFieldValue, type DraftField, type DraftValues,
} from '@/lib/unsaved/draft-fields';
import { draftStorageKey, loadDraft, removeDraft, saveDraft } from '@/lib/unsaved/draft-store';
import { registerFlusher, registerUnsavedSource } from '@/lib/unsaved/unsaved-registry';

const SAVE_DELAY_MS = 400;
/** Fields that appear only after an earlier answer get a few more chances. */
const RESTORE_PASSES_MS = [0, 300, 900, 2000];

/**
 * A region's draft removal waits one tick, so React's development double
 * mount (mount, unmount, mount) does not delete the draft the second mount is
 * about to restore.
 */
const pendingRemovals = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Call a context hook that some tests replace wholesale with a mock lacking
 * it. Called on every render either way, so hook order never changes.
 */
function callOptional<T>(hook: unknown): T | undefined {
  return typeof hook === 'function' ? (hook as () => T)() : undefined;
}

export interface DraftKeeperOptions {
  /** Whether the region is on screen and its root element is mounted. */
  active: boolean;
  /**
   * What identifies this form across a reload: page, title, whose record.
   * Read once when the region opens. Null keeps no draft (the guard still works).
   */
  scope: () => string | null;
  /** Re-open the keeper when this changes — a drawer switching panels. */
  resetKey?: string | number;
  /** Count only fields inside a `<form>` (a page's search boxes are not work). */
  onlyInForms?: boolean;
}

export function useDraftKeeper(rootRef: RefObject<HTMLElement | null>, options: DraftKeeperOptions) {
  const auth = callOptional<{ currentUser: { _id: string; orgId?: string } | null }>(
    (AppContextModule as { useOptionalAuth?: unknown }).useOptionalAuth,
  );
  const toast = callOptional<{ showToast: (message: string, type?: ToastModule.ToastType, opts?: ToastModule.ToastOptions) => void }>(
    (ToastModule as { useOptionalToast?: unknown }).useOptionalToast,
  );
  const { t } = useTranslation();
  const userId = auth?.currentUser?._id;
  const orgId = auth?.currentUser?.orgId;

  const latest = useRef({ options, toast, t });
  useEffect(() => { latest.current = { options, toast, t }; });
  const dismissedRef = useRef(false);

  /** Closing by X, Escape, Back or a click outside keeps a changed draft. */
  const markDismissed = useCallback(() => { dismissedRef.current = true; }, []);

  const { active, resetKey, onlyInForms = false } = options;

  useEffect(() => {
    const root = rootRef.current;
    if (!active || !root) return;
    dismissedRef.current = false;
    root.setAttribute(DRAFT_ROOT_ATTR, '');

    let cancelled = false;
    let storageKey: string | null = null;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    const restoreTimers: Array<ReturnType<typeof setTimeout>> = [];
    /** Each changed field and the value it held before the user changed it. */
    const baseline = new Map<DraftField, string>();
    /** Restored field key → the value it held before, for Discard. */
    const restored = new Map<string, string | null>();

    // A field's value from before the user touched it. Focus comes before the
    // first keystroke or click; a field changed without focus (a restore, or
    // a checkbox in Safari) falls back to empty.
    const onFocus = (event: Event) => {
      if (kept(event.target) && !baseline.has(event.target)) baseline.set(event.target, readFieldValue(event.target));
    };
    const emptyValue = (el: DraftField) => (
      el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio') ? 'false' : ''
    );
    /** Unsaved: some changed field no longer holds what it started with. */
    const isDirty = () => {
      for (const [el, before] of baseline) {
        if (el.isConnected && readFieldValue(el) !== before) return true;
      }
      return false;
    };

    const kept = (target: EventTarget | null): target is DraftField => (
      target instanceof Element && isDraftable(target)
      && target.closest(`[${DRAFT_ROOT_ATTR}]`) === root
      && (!onlyInForms || !!target.closest('form'))
    );

    const collect = (): DraftValues => {
      const values: DraftValues = {};
      for (const { key, el } of draftFields(root, onlyInForms)) {
        if (baseline.has(el) && readFieldValue(el) !== baseline.get(el)) values[key] = readFieldValue(el);
      }
      return values;
    };

    /**
     * The changed fields as of the last edit, taken while they are still on
     * the page: by the time a closing region cleans up, its fields may have
     * left the DOM (a drawer switching panels).
     */
    let latestValues: DraftValues = {};

    const saveNow = async () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = undefined;
      if (!storageKey || !root.isConnected) return;
      latestValues = collect();
      if (!isDirty()) { removeDraft(storageKey); return; }
      await saveDraft(storageKey, orgId, latestValues);
    };

    const onEdit = (event: Event) => {
      if (!kept(event.target)) return;
      if (!baseline.has(event.target)) baseline.set(event.target, emptyValue(event.target));
      latestValues = collect();
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { void saveNow(); }, SAVE_DELAY_MS);
    };

    const discard = () => {
      const fields = draftFields(root, onlyInForms);
      for (const [key, before] of restored) {
        const field = fields.find(f => f.key === key);
        if (field && before !== null) writeFieldValue(field.el, before);
      }
      restored.clear();
      baseline.clear();
      latestValues = {};
      if (storageKey) removeDraft(storageKey);
    };

    const restore = async (key: string) => {
      const draft = await loadDraft(key);
      if (cancelled || !draft) return;
      const remaining = new Map(Object.entries(draft.values));
      let announced = false;
      let matched = 0;
      const pass = (last: boolean) => {
        if (cancelled) return;
        const fields = draftFields(root, onlyInForms);
        for (const [fieldKey, value] of [...remaining]) {
          const field = fields.find(f => f.key === fieldKey);
          if (!field) continue;
          remaining.delete(fieldKey);
          matched += 1;
          if (!baseline.has(field.el)) baseline.set(field.el, readFieldValue(field.el));
          const before = writeFieldValue(field.el, value);
          if (before !== null) restored.set(fieldKey, before);
        }
        if (restored.size > 0 && !announced) {
          announced = true;
          const { toast: api, t: tr } = latest.current;
          const time = new Date(draft.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          api?.showToast(tr('drafts.restored', { time }), 'info', {
            action: { label: tr('drafts.discard'), onClick: discard },
            durationMs: 15000,
            placement: 'corner',
          });
        }
        // Nothing matched (the form has changed since): the draft is no use.
        if (last && matched === 0) removeDraft(key);
      };
      RESTORE_PASSES_MS.forEach((delay, i) => {
        restoreTimers.push(setTimeout(() => pass(i === RESTORE_PASSES_MS.length - 1), delay));
      });
    };

    const scopeId = userId ? latest.current.options.scope() : null;
    if (userId && scopeId) {
      void draftStorageKey(userId, scopeId).then(key => {
        if (cancelled) return;
        storageKey = key;
        const pending = pendingRemovals.get(key);
        if (pending) { clearTimeout(pending); pendingRemovals.delete(key); }
        void restore(key);
      }).catch(() => { /* no SubtleCrypto: guard only */ });
    }

    // A submitted form counts as saved: what it holds now is the new start.
    // If the save failed, the next change makes it unsaved again.
    const onSubmit = (event: Event) => {
      if (!(event.target instanceof HTMLFormElement) || event.target.closest(`[${DRAFT_ROOT_ATTR}]`) !== root) return;
      for (const el of [...baseline.keys()]) if (event.target.contains(el)) baseline.set(el, readFieldValue(el));
      if (storageKey && !isDirty()) removeDraft(storageKey);
    };

    root.addEventListener('focusin', onFocus, true);
    root.addEventListener('input', onEdit, true);
    root.addEventListener('change', onEdit, true);
    root.addEventListener('submit', onSubmit, true);
    const unregisterSource = registerUnsavedSource(isDirty);
    const unregisterFlusher = registerFlusher(saveNow);

    return () => {
      cancelled = true;
      root.removeEventListener('focusin', onFocus, true);
      root.removeEventListener('input', onEdit, true);
      root.removeEventListener('change', onEdit, true);
      root.removeEventListener('submit', onSubmit, true);
      unregisterSource();
      unregisterFlusher();
      for (const timer of restoreTimers) clearTimeout(timer);
      root.removeAttribute(DRAFT_ROOT_ATTR);
      if (!storageKey) return;
      const key = storageKey;
      if (dismissedRef.current && Object.keys(latestValues).length > 0) {
        // Dismissed with changes: write the latest text and keep it.
        if (saveTimer) clearTimeout(saveTimer);
        void saveDraft(key, orgId, latestValues);
        return;
      }
      if (saveTimer) clearTimeout(saveTimer);
      pendingRemovals.set(key, setTimeout(() => { pendingRemovals.delete(key); removeDraft(key); }, 0));
    };
  }, [active, resetKey, onlyInForms, userId, orgId, rootRef]);

  return { markDismissed };
}
