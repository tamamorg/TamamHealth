/**
 * PHI-safe sanitization for product usage events.
 * Shared by the browser tracker and the ingest API.
 */

import type { UsageEventName } from '../db-types';

const LABEL_MAX = 40;
const ELEMENT_MAX = 120;
const META_MAX_KEYS = 8;

/** Keys whose values must never appear in usage payloads (aligned with stripPHI). */
const PHI_KEY_PATTERNS: readonly RegExp[] = [
  /email/i,
  /phone/i,
  /dob/i,
  /password/i,
  /nationalid/i,
  /national_id/i,
  /notes/i,
  /cookie/i,
];

const STATIC_SEGMENTS = new Set([
  'new', 'edit', 'archive', 'claims', 'users', 'hospitals', 'patients',
  'settings', 'login', 'dashboard', 'admin', 'org-admin', 'analytics',
  'reports', 'calendar', 'front-desk', 'consultation', 'lab', 'pharmacy',
  'wards', 'appointments', 'referrals', 'messages', 'billing', 'payments',
  'immunizations', 'anc', 'births', 'deaths', 'surveillance',
  'government', 'hr', 'equipment', 'blood-bank', 'controlled-substances',
  'emergency-preparedness', 'facility-management', 'facility-settings',
  'branding', 'pricing', 'organizations', 'system', 'control', 'audit',
  'support', 'sync', 'interop', 'data', 'security', 'config', 'flags',
  'risk', 'conflicts', 'it', 'system-admin', 'data-quality',
]);

const USAGE_EVENT_NAMES = new Set<UsageEventName>([
  'session_start', 'session_end', 'page_view', 'click', 'change',
]);

export function isUsageEventName(value: unknown): value is UsageEventName {
  return typeof value === 'string' && USAGE_EVENT_NAMES.has(value as UsageEventName);
}

function isPHIKey(key: string): boolean {
  return PHI_KEY_PATTERNS.some((re) => re.test(key));
}

/** True when a path segment looks like an opaque resource id. */
export function looksLikeId(segment: string): boolean {
  if (!segment || STATIC_SEGMENTS.has(segment)) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) {
    return true;
  }
  if (/^[0-9a-f]{16,}$/i.test(segment)) return true;
  if (/^\d{6,}$/.test(segment)) return true;
  if (/^[A-Z]{2,}[-_]?\d{3,}/i.test(segment)) return true;
  if (/^[a-z]+[-_]\d{3,}/i.test(segment)) return true;
  // Opaque tokens / couch ids: long mixed alnum without being a known word
  if (segment.length >= 12 && /[0-9]/.test(segment) && /[a-z]/i.test(segment)) {
    return true;
  }
  return false;
}

/**
 * Template dynamic IDs out of a pathname.
 * `/patients/abc-123` → `/patients/[id]`
 */
export function templatePath(rawPath: string): string {
  if (!rawPath || typeof rawPath !== 'string') return '/';
  let path = rawPath.split('?')[0].split('#')[0].trim();
  if (!path.startsWith('/')) path = `/${path}`;
  const parts = path.split('/').filter(Boolean);
  const out: string[] = [];
  for (const seg of parts) {
    const decoded = safeDecode(seg);
    out.push(looksLikeId(decoded) ? '[id]' : decoded);
  }
  return `/${out.join('/')}` || '/';
}

function safeDecode(seg: string): string {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

/** Truncate and collapse whitespace for labels. */
export function truncateLabel(text: string, max = LABEL_MAX): string {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

/**
 * Scrub a plain object: drop PHI-keyed fields, recurse, cap size.
 * Never keeps string values for sensitive keys.
 */
export function scrubMeta(input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const key of Object.keys(src)) {
    if (count >= META_MAX_KEYS) break;
    if (isPHIKey(key)) continue;
    const val = src[key];
    if (val === null || val === undefined) continue;
    if (typeof val === 'string') {
      out[key] = truncateLabel(val, 80);
      count += 1;
    } else if (typeof val === 'number' || typeof val === 'boolean') {
      out[key] = val;
      count += 1;
    } else if (typeof val === 'object' && !Array.isArray(val)) {
      const nested = scrubMeta(val);
      if (nested && Object.keys(nested).length > 0) {
        out[key] = nested;
        count += 1;
      }
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Characters an element descriptor may contain. Anything outside this set is
 * rejected wholesale rather than escaped — a descriptor is machine-generated
 * from a fixed vocabulary, so unexpected characters mean the value did not come
 * from `describeElement` and must not be trusted.
 */
const ELEMENT_SAFE_RE = /^[a-z0-9._|=/\-]+$/i;

/** Reduce a developer-authored `data-track` id to the safe charset. */
function sanitizeTrackId(raw: string): string {
  const cleaned = raw.trim().toLowerCase().replace(/[^a-z0-9._|=/-]+/g, '-').replace(/-{2,}/g, '-');
  return cleaned.slice(0, ELEMENT_MAX).replace(/^-|-$/g, '') || 'unknown';
}

/**
 * Build a compact element descriptor.
 *
 * Structural attributes only — never `textContent` and never `aria-label`.
 * Both routinely carry patient identifiers in this app: a patient row renders
 * the patient's name as the link text, and action buttons are labelled
 * "Open chart for <name>". Capturing either put PHI into `usage_events` and,
 * with PostHog enabled, shipped it to a third-party processor.
 *
 * The consequence is that untagged clicks are low-signal (`a|role=button`).
 * That is deliberate: a `data-track` attribute is how a click earns a readable
 * name, which keeps naming a reviewed decision rather than a scrape of
 * whatever text happened to be on screen.
 */
export function describeElement(el: Element | null): string {
  if (!el || typeof (el as Element).closest !== 'function') return 'unknown';
  const tracked = el.closest('[data-track]');
  const track = tracked?.getAttribute('data-track');
  if (track) return sanitizeTrackId(track);

  const target =
    el.closest(
      'button, a, input, select, textarea, [role="button"], [role="menuitem"], [role="tab"], [role="link"]',
    ) || el;

  const tag = target.tagName?.toLowerCase?.() || 'el';
  const role = target.getAttribute?.('role') || '';
  const typeAttr = target.getAttribute?.('type') || '';
  const nameAttr = target.getAttribute?.('name') || '';

  // Never include name attributes that look like PHI fields
  const safeName = nameAttr && !isPHIKey(nameAttr) ? sanitizeTrackId(nameAttr) : '';

  const parts = [
    tag,
    role ? `role=${role}` : '',
    typeAttr ? `type=${typeAttr}` : '',
    safeName ? `name=${safeName.slice(0, 24)}` : '',
  ].filter(Boolean);

  const descriptor = parts.join('|').slice(0, ELEMENT_MAX);
  return ELEMENT_SAFE_RE.test(descriptor) ? descriptor : 'unknown';
}

/** Client/server shared shape before persistence. */
export interface SanitizedUsageEventInput {
  eventName: UsageEventName;
  path: string;
  element?: string;
  sessionId: string;
  ts: string;
  meta?: Record<string, unknown>;
}

/**
 * Normalize and sanitize a single inbound event. Returns null if unusable.
 */
export function sanitizeUsageEvent(raw: unknown): SanitizedUsageEventInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isUsageEventName(r.eventName)) return null;
  const sessionId = typeof r.sessionId === 'string' ? r.sessionId.slice(0, 80) : '';
  if (!sessionId) return null;

  let ts = typeof r.ts === 'string' ? r.ts : '';
  if (!ts || Number.isNaN(Date.parse(ts))) {
    ts = new Date().toISOString();
  }

  const path = templatePath(typeof r.path === 'string' ? r.path : '/');
  // The ingest API runs this on client-supplied JSON, so the descriptor is
  // re-validated here rather than trusted. A value that did not come from
  // describeElement (free text, a patient name, a stale client still sending
  // textContent) fails the charset check and is dropped — the event is still
  // recorded, just without an element.
  const rawElement =
    typeof r.element === 'string' ? r.element.trim().slice(0, ELEMENT_MAX) : '';
  const element = rawElement && ELEMENT_SAFE_RE.test(rawElement) ? rawElement : undefined;
  const meta = scrubMeta(r.meta);

  return {
    eventName: r.eventName,
    path,
    element: element || undefined,
    sessionId,
    ts,
    meta,
  };
}
