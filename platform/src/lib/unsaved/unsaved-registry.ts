'use client';

/**
 * One place that knows whether anything on the page holds unsaved work.
 *
 * Forms register a check (`registerUnsavedSource`) and, when they keep a
 * draft or a pending write, a flush (`registerFlusher`). From those this
 * module:
 *
 *  - asks the browser to confirm a refresh or tab close while anything is
 *    unsaved. The browser shows its own fixed wording; no site can change it.
 *  - asks before an in-app link leaves the current page.
 *  - writes pending drafts when the page is hidden or about to go.
 *  - turns the app's own reloads into a question while anything is unsaved
 *    (`requestReload`), answered by the bar in `ReloadPrompt`.
 *
 * The listeners are attached only while something is registered: an
 * unconditional `beforeunload` listener stops some browsers keeping the page
 * in their back/forward cache.
 */

type Source = () => boolean;
type Flusher = () => Promise<void> | void;

const sources = new Set<Source>();
const flushers = new Set<Flusher>();
let attached = false;
/** Set when the user has already chosen to reload in the app's own prompt. */
let bypassPrompt = false;

const LEAVE_MESSAGE_FALLBACK = 'You have unsaved changes. Leave this page anyway?';
let leaveMessage = LEAVE_MESSAGE_FALLBACK;

/** The wording of the in-app "leave this page?" question, in the user's language. */
export function setLeaveMessage(message: string): void {
  leaveMessage = message || LEAVE_MESSAGE_FALLBACK;
}

export function hasUnsavedWork(): boolean {
  for (const source of sources) {
    try { if (source()) return true; } catch { /* a broken check never blocks leaving */ }
  }
  return false;
}

/** Write every pending draft and edit now. Never throws. */
export async function flushUnsavedWork(): Promise<void> {
  await Promise.allSettled([...flushers].map(flush => Promise.resolve().then(flush)));
}

function onBeforeUnload(event: BeforeUnloadEvent) {
  void flushUnsavedWork();
  if (bypassPrompt || !hasUnsavedWork()) return;
  event.preventDefault();
  // Older browsers need this set; modern ones show their own text instead.
  event.returnValue = '';
}

function onHidden() {
  if (document.visibilityState === 'hidden') void flushUnsavedWork();
}

function onPageHide() {
  void flushUnsavedWork();
}

/**
 * An in-app link to another page, while something is unsaved, asks first.
 * Links that stay on the same page (a chart tab is `?tab=`) do not: forms
 * docked beside the page stay open across them.
 */
function onDocumentClick(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0
    || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const target = event.target;
  const link = target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null;
  if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
  let destination: URL;
  try { destination = new URL(link.href, window.location.href); } catch { return; }
  if (destination.origin === window.location.origin && destination.pathname === window.location.pathname) return;
  if (!hasUnsavedWork()) return;
  if (!window.confirm(leaveMessage)) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}

function attach() {
  if (attached || typeof window === 'undefined') return;
  window.addEventListener('beforeunload', onBeforeUnload);
  window.addEventListener('pagehide', onPageHide);
  document.addEventListener('visibilitychange', onHidden);
  document.addEventListener('click', onDocumentClick, true);
  attached = true;
}

function detachIfIdle() {
  if (!attached || sources.size > 0 || flushers.size > 0) return;
  window.removeEventListener('beforeunload', onBeforeUnload);
  window.removeEventListener('pagehide', onPageHide);
  document.removeEventListener('visibilitychange', onHidden);
  document.removeEventListener('click', onDocumentClick, true);
  attached = false;
}

/** Register a "does this hold unsaved work?" check. Returns the unregister. */
export function registerUnsavedSource(isDirty: Source): () => void {
  sources.add(isDirty);
  attach();
  return () => { sources.delete(isDirty); detachIfIdle(); };
}

/** Register a write to run before the page goes. Returns the unregister. */
export function registerFlusher(flush: Flusher): () => void {
  flushers.add(flush);
  attach();
  return () => { flushers.delete(flush); detachIfIdle(); };
}

/** Ask the user before an in-app action that would discard unsaved work. */
export function confirmDiscardUnsaved(): boolean {
  return !hasUnsavedWork() || window.confirm(leaveMessage);
}

/* ─────────────────────────── the app's own reloads ─────────────────────────── */

type ReloadListener = (reason: string | null) => void;
const reloadListeners = new Set<ReloadListener>();
let pendingReason: string | null = null;

function hardReload() {
  bypassPrompt = true;
  window.location.reload();
}

/**
 * The app wants a reload (fresh assets, a chart that has just arrived). With
 * nothing unsaved it reloads at once, as before; otherwise it asks, and the
 * page stays as it is until the user chooses.
 */
export function requestReload(reason: string): void {
  if (typeof window === 'undefined') return;
  if (!hasUnsavedWork()) { hardReload(); return; }
  pendingReason = reason;
  for (const listener of reloadListeners) listener(pendingReason);
}

export function pendingReloadReason(): string | null {
  return pendingReason;
}

export function subscribeReloadRequests(listener: ReloadListener): () => void {
  reloadListeners.add(listener);
  return () => { reloadListeners.delete(listener); };
}

/** "Later": keep working; the next request asks again. */
export function dismissReloadRequest(): void {
  pendingReason = null;
  for (const listener of reloadListeners) listener(null);
}

/** "Reload now": write drafts first, then reload without the browser asking again. */
export async function reloadNow(): Promise<void> {
  await flushUnsavedWork();
  hardReload();
}

/** Test-only: forget every registration. */
export function __resetUnsavedRegistryForTests(): void {
  sources.clear();
  flushers.clear();
  reloadListeners.clear();
  pendingReason = null;
  bypassPrompt = false;
  detachIfIdle();
}
