/**
 * Patient field accessors and sorting.
 *
 * Patient records accumulate registration/visit timestamps from several sources
 * (interactive registration, seed data, birth-derived records), so individual
 * date fields are inconsistently populated. These helpers expose ONE canonical
 * value per concept with a deterministic fallback chain, so every list sorts and
 * displays the same way and undated records never render as a blank "—".
 */

import type { PatientDoc, Patient } from './db-types';

type PatientLike = Partial<Patient> & { createdAt?: string };

/**
 * Canonical registration instant (ISO). Prefers the precise timestamp, falls
 * back to the date-only field, then to the document's createdAt. Always returns
 * a string so callers can sort/format without guarding for undefined.
 */
export function patientRegisteredAt(p: PatientLike): string {
  return p.registeredAt || p.registrationDate || p.createdAt || '';
}

/** Canonical "most recent activity" instant (ISO) — last consult, else last visit. */
export function patientLastActivity(p: PatientLike): string {
  return p.lastConsultedAt || p.lastVisitDate || '';
}

/** Full display name, collapsing any missing middle name and stray whitespace. */
export function patientFullName(p: Pick<Patient, 'firstName' | 'surname'> & { middleName?: string }): string {
  return `${p.firstName} ${p.middleName || ''} ${p.surname}`.replace(/\s+/g, ' ').trim();
}

/** Two-letter initials for avatars (first name + surname), upper-cased. */
export function patientInitials(p: { firstName?: string; surname?: string }): string {
  return `${(p.firstName || '?')[0]}${(p.surname || '?')[0]}`.toUpperCase();
}

/**
 * Two-letter initials from a single display name string (e.g. "Deng Mabior").
 * Shared avatar helper so the same logic isn't re-implemented per component.
 */
// Leading honorific/title tokens to skip so a staff avatar shows initials from
// the person's real name, not their title — e.g. "Dr. James Wani" → "JW",
// "CO Deng Mabior" → "DM", "Nurse Grace Achai" → "GA", "Lab Tech Gatluak Puok"
// → "GP". Patients have no titles, so this is a no-op for them.
const NAME_TITLE_TOKENS = new Set([
  'dr', 'prof', 'mr', 'mrs', 'ms', 'mx', 'sir', 'dame', 'hon',
  'co', 'nurse', 'midwife', 'pharm', 'pharmacist', 'lab', 'tech',
  'rd', 'sister', 'matron', 'mgr', 'hrio', 'hmis', 'biller', 'triage', 'admin',
]);

export function initials(name: string): string {
  const clean = (name || '').trim();
  if (!clean) return '?';
  const words = clean.split(/\s+/).filter(Boolean);
  const norm = (w: string) => w.replace(/[.,]/g, '').toLowerCase();
  // Drop a leading run of title tokens, but never the final word (so a name
  // that is only a title still yields something).
  let start = 0;
  while (start < words.length - 1 && NAME_TITLE_TOKENS.has(norm(words[start]))) start++;
  const nameWords = words.slice(start);
  const twoInitials = nameWords.map(w => w[0]).join('').slice(0, 2);
  if (twoInitials.length >= 2) return twoInitials.toUpperCase();
  // Single remaining word → first two letters of it, so avatars always show two.
  const base = (nameWords[0] || clean).replace(/[^A-Za-z]/g, '');
  return ((base.slice(0, 2) || clean.slice(0, 2)) || '?').toUpperCase();
}

/** The avatar treatment used across the app: a faint tinted plate with the
 *  initials inked in the matching saturated hue (never white-on-solid). Same
 *  values as the triage-tinted `.ehr-patient-icon` variants in globals.css. */
export interface AvatarTint { background: string; color: string }

// These four were literal copies of the --semantic-* tints, so a change to the
// palette moved every pill in the app except the avatars. They read the tokens
// now; the values are unchanged.
export const AVATAR_TINT_RED: AvatarTint = { background: 'var(--semantic-danger-bg)', color: 'var(--semantic-danger)' };
export const AVATAR_TINT_AMBER: AvatarTint = { background: 'var(--semantic-warning-bg)', color: 'var(--semantic-warning)' };
export const AVATAR_TINT_GREEN: AvatarTint = { background: 'var(--semantic-success-bg)', color: 'var(--semantic-success)' };
export const AVATAR_TINT_NEUTRAL: AvatarTint = { background: 'var(--semantic-neutral-bg)', color: 'var(--semantic-neutral)' };

const AVATAR_TINTS: AvatarTint[] = [AVATAR_TINT_RED, AVATAR_TINT_AMBER, AVATAR_TINT_GREEN];

function seedHash(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash;
}

/** Deterministic faint avatar tint for a person — the same name always gets the
 *  same plate. Spread straight onto a style prop: `style={avatarTint(name)}`. */
export function avatarTint(seed: string): AvatarTint {
  return AVATAR_TINTS[seedHash(seed || '') % AVATAR_TINTS.length];
}

/** Legacy accessor: the avatar's background only. Prefer `avatarTint`, which
 *  also carries the ink colour the faint plate needs. */
export function avatarColor(seed: string): string {
  return avatarTint(seed).background;
}

/** State/acuity avatar tint: critical (red), watch (amber), stable (green).
 *  Accepts triage priority (RED/YELLOW/GREEN) or a free-text priority/status;
 *  anything unknown reads as stable. */
export function stateTint(state?: string | null): AvatarTint {
  const s = (state || '').toLowerCase();
  if (s === 'red' || s.includes('critical') || s.includes('emerg')) return AVATAR_TINT_RED;
  if (s === 'yellow' || s.includes('watch') || s.includes('urgent')) return AVATAR_TINT_AMBER;
  return AVATAR_TINT_GREEN;
}

/** Legacy accessor: the state plate's background only. Prefer `stateTint`. */
export function stateColor(state?: string | null): string {
  return stateTint(state).background;
}

/**
 * Patient age in whole years. Prefers an explicit estimatedAge, otherwise
 * derives it from dateOfBirth with a month/day adjustment so it never reads a
 * year too high. Returns null when age is genuinely unknown — every display
 * should use this so the same patient never shows two different ages.
 */
export function patientAge(p: { estimatedAge?: number; dateOfBirth?: string }): number | null {
  if (typeof p.estimatedAge === 'number' && p.estimatedAge > 0) return p.estimatedAge;
  if (!p.dateOfBirth) return null;
  const d = new Date(p.dateOfBirth);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 ? age : null;
}

/** Age label like "34y", or "—" when unknown. */
export function patientAgeLabel(p: { estimatedAge?: number; dateOfBirth?: string }): string {
  const a = patientAge(p);
  return a == null ? '—' : `${a}y`;
}

/** Combined "Male · 34y" identity line; drops parts that are missing. */
export function patientGenderAge(p: { gender?: string; estimatedAge?: number; dateOfBirth?: string }): string {
  const parts: string[] = [];
  if (p.gender) parts.push(p.gender);
  const a = patientAge(p);
  if (a != null) parts.push(`${a}y`);
  return parts.join(' · ');
}

export type PatientSort = 'recent' | 'name' | 'visited' | 'oldest';

export const PATIENT_SORT_OPTIONS: { value: PatientSort; label: string }[] = [
  { value: 'recent', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'visited', label: 'Last visit' },
];

/**
 * Comparator for the given sort key. Stable and total: ties and missing values
 * fall back to name then id so the order is fully deterministic.
 */
export function comparePatients(sort: PatientSort): (a: PatientDoc, b: PatientDoc) => number {
  const byName = (a: PatientDoc, b: PatientDoc) =>
    patientFullName(a).localeCompare(patientFullName(b)) || (a._id || '').localeCompare(b._id || '');

  switch (sort) {
    case 'name':
      return byName;
    case 'oldest':
      return (a, b) => patientRegisteredAt(a).localeCompare(patientRegisteredAt(b)) || byName(a, b);
    case 'visited':
      return (a, b) => patientLastActivity(b).localeCompare(patientLastActivity(a)) || byName(a, b);
    case 'recent':
    default:
      return (a, b) => patientRegisteredAt(b).localeCompare(patientRegisteredAt(a)) || byName(a, b);
  }
}
