/**
 * Browser usage tracker — batches sanitized interaction events to /api/usage/events.
 */

import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '@/modules/identity/client';
import {
  describeElement,
  sanitizeUsageEvent,
  templatePath,
  type SanitizedUsageEventInput,
} from './sanitize';
import type { UsageEventName } from '../db-types';
import { captureUsageToPostHog, isPostHogEnabled } from './posthog';

const QUEUE_KEY = 'tamamhealth_usage_queue';
const SESSION_KEY = 'tamamhealth_usage_session';
const MAX_QUEUE = 200;
const BATCH_SIZE = 25;
const FLUSH_MS = 5000;
const MAX_BATCH_POST = 50;

type QueuedEvent = SanitizedUsageEventInput;

let flushTimer: ReturnType<typeof setInterval> | null = null;
let flushing = false;
let identity: { userId: string; orgId?: string; role?: string } | null = null;

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const target = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(target)) {
      return decodeURIComponent(trimmed.slice(target.length));
    }
  }
  return null;
}

function loadQueue(): QueuedEvent[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedEvent[]) : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedEvent[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const capped = queue.length > MAX_QUEUE ? queue.slice(queue.length - MAX_QUEUE) : queue;
    localStorage.setItem(QUEUE_KEY, JSON.stringify(capped));
  } catch {
    /* quota — drop oldest half */
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-Math.floor(MAX_QUEUE / 2))));
    } catch {
      /* give up */
    }
  }
}

export function getOrCreateSessionId(): string {
  if (typeof sessionStorage === 'undefined') {
    return `sess-${Date.now()}`;
  }
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? `sess-${crypto.randomUUID()}`
          : `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return `sess-${Date.now()}`;
  }
}

export function setUsageIdentity(next: { userId: string; orgId?: string; role?: string } | null): void {
  identity = next;
}

export function track(
  eventName: UsageEventName,
  opts: { path?: string; element?: string; meta?: Record<string, unknown> } = {},
): void {
  if (typeof window === 'undefined') return;

  const path = templatePath(opts.path || window.location.pathname);
  const raw = {
    eventName,
    path,
    element: opts.element,
    sessionId: getOrCreateSessionId(),
    ts: new Date().toISOString(),
    meta: opts.meta,
  };
  const sanitized = sanitizeUsageEvent(raw);
  if (!sanitized) return;

  const queue = loadQueue();
  queue.push(sanitized);
  saveQueue(queue);

  if (isPostHogEnabled() && identity?.userId) {
    captureUsageToPostHog([sanitized], identity);
  }

  if (queue.length >= BATCH_SIZE) {
    void flushUsageQueue();
  }
}

/**
 * Silent CSRF-aware POST — does not redirect on 401 (telemetry must not bounce the user).
 */
async function postEvents(batch: QueuedEvent[]): Promise<boolean> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const csrf = readCookie(CSRF_COOKIE_NAME);
  if (csrf) headers[CSRF_HEADER_NAME] = csrf;

  try {
    const res = await fetch('/api/usage/events', {
      method: 'POST',
      headers,
      body: JSON.stringify({ events: batch.slice(0, MAX_BATCH_POST) }),
      keepalive: true,
      credentials: 'same-origin',
    });
    return res.ok || res.status === 202;
  } catch {
    return false;
  }
}

export async function flushUsageQueue(): Promise<void> {
  if (flushing || typeof window === 'undefined') return;
  flushing = true;
  try {
    let queue = loadQueue();
    while (queue.length > 0) {
      const batch = queue.slice(0, MAX_BATCH_POST);
      const ok = await postEvents(batch);
      if (!ok) break;
      queue = queue.slice(batch.length);
      saveQueue(queue);
    }
  } finally {
    flushing = false;
  }
}

export function startUsageFlushLoop(): () => void {
  if (typeof window === 'undefined') return () => {};
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = setInterval(() => {
    void flushUsageQueue();
  }, FLUSH_MS);
  void flushUsageQueue();
  return () => {
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
  };
}

/** Build click/change descriptors from a DOM event target. */
export function trackDomEvent(
  eventName: 'click' | 'change',
  target: EventTarget | null,
  path?: string,
): void {
  if (!target || !(target instanceof Element)) return;
  // Ignore pure typing into password fields (never track password inputs)
  if (target instanceof HTMLInputElement && target.type === 'password') return;
  track(eventName, {
    path,
    element: describeElement(target),
  });
}

/** Exposed for unit tests */
export const __test = {
  loadQueue,
  saveQueue,
  MAX_QUEUE,
  BATCH_SIZE,
  QUEUE_KEY,
};
