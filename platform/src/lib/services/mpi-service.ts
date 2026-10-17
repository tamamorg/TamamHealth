/**
 * Master Patient Index (MPI) matcher for local facility de-duplication and
 * future cross-facility / cross-border patient resolution.
 *
 * Matching strategy (tiered, cheap-first):
 *   1. Deterministic — exact match on national ID, geocode ID, or
 *      hospitalNumber (same country only). These are high-confidence.
 *   2. Probabilistic — Jaro-Winkler similarity over firstName + surname
 *      + dateOfBirth + phone; returns a confidence score. This baseline can
 *      later be replaced with ML or Fellegi-Sunter scoring without changing
 *      the API contract.
 *
 * The regional MPI (the spec's Regional Exchange component) would live on
 * the regional node and call this function per-country then combine. For
 * now it runs entirely inside the facility platform against local PouchDB
 * so facilities benefit from de-duplication even before the regional layer
 * ships.
 */
import { patientsDB } from '../db';
import type { PatientDoc } from '../db-types';
import { findByType } from './db-query';
import { filterByScope, type DataScope } from './data-scope';

export interface MpiCandidate {
  patient: PatientDoc;
  score: number;
  method: 'national_id' | 'geocode' | 'hospital_number' | 'probabilistic';
  reasons: string[];
}

export interface MpiQuery {
  firstName?: string;
  surname?: string;
  dateOfBirth?: string;
  phone?: string;
  nationalId?: string;
  geocodeId?: string;
  hospitalNumber?: string;
  countryId?: string;
}

/** Jaro-Winkler similarity score, 0.0 – 1.0. Higher = more similar. */
export function jaroWinkler(a: string, b: string): number {
  if (!a || !b) return 0;
  a = a.toLowerCase();
  b = b.toLowerCase();
  if (a === b) return 1;

  const m = Math.floor(Math.max(a.length, b.length) / 2) - 1;
  const aMatches = new Array(a.length).fill(false);
  const bMatches = new Array(b.length).fill(false);
  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - m);
    const hi = Math.min(b.length, i + m + 1);
    for (let j = lo; j < hi; j++) {
      if (bMatches[j]) continue;
      if (a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }

  const jaro = (
    matches / a.length
    + matches / b.length
    + (matches - transpositions / 2) / matches
  ) / 3;

  // Winkler prefix bonus (common prefix up to 4 chars)
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Match a query against the local patient index. Returns candidates sorted
 * by descending confidence. A score ≥ 0.90 is a likely match; 0.70 – 0.90
 * is worth reviewing; below 0.70 is probably not the same person.
 */
export async function matchPatient(query: MpiQuery, limit = 10, scope?: DataScope): Promise<MpiCandidate[]> {
  const db = patientsDB();

  /** Tenant/facility isolation — without this a caller could probe the FULL
   *  multi-tenant patient index (names, national IDs, phones) across orgs. */
  const scoped = (docs: PatientDoc[]) => (scope ? filterByScope(docs, scope) : docs);

  const candidates: MpiCandidate[] = [];

  // 1. Deterministic — high-confidence single-hit matches.
  //
  // These run as INDEXED lookups rather than a scan. Previously the whole
  // patient collection was loaded and iterated even when the query carried an
  // exact national ID — at a district hospital's ~50k patients that stalled
  // every registration for seconds. Now an exact identifier hit costs one
  // indexed read and the full collection is never materialised at all.
  //
  // Each selector gets its own compound index ({type, field}) so CouchDB/PouchDB
  // can serve it directly; `ensureIndex` inside `findByType` is idempotent and
  // cached per process.
  // The national ID is encrypted at rest (lib/encrypted-db.ts), so its exact
  // match runs on the keyed fingerprint stored beside it, never the value.
  const { blindIndex } = await import('../org-data-cipher');
  const nationalIdIndex = query.nationalId ? (await blindIndex(query.nationalId)) ?? undefined : undefined;

  const deterministic: Array<{
    value: string | undefined;
    field: 'nationalIdIndex' | 'geocodeId' | 'hospitalNumber';
    /** Shown in the match reason; differs from `value` for an indexed identifier. */
    shown?: string;
    score: number;
    method: MpiCandidate['method'];
    /** Geocode and hospital number were compared case-insensitively before
     *  this became an indexed lookup; preserve that. National ID was always
     *  compared exactly, so it stays exact. */
    caseInsensitive: boolean;
    reason: (v: string) => string;
  }> = [
    { value: nationalIdIndex, shown: query.nationalId, field: 'nationalIdIndex', score: 1.0, method: 'national_id',
      caseInsensitive: false, reason: (v) => `Exact national ID match: ${v}` },
    { value: query.geocodeId, field: 'geocodeId', score: 0.99, method: 'geocode',
      caseInsensitive: true, reason: (v) => `Exact geocode match: ${v}` },
    { value: query.hospitalNumber, field: 'hospitalNumber', score: 0.95, method: 'hospital_number',
      caseInsensitive: true, reason: (v) => `Exact hospital number match: ${v}` },
  ];

  /** Selector that still hits the index but tolerates casing differences.
   *  Both identifiers are generated upper-case, so the realistic mismatch is a
   *  lower-case value typed into a search box — covered by `$in`. */
  const selectorFor = (field: string, value: string, caseInsensitive: boolean) =>
    caseInsensitive
      ? { [field]: { $in: Array.from(new Set([value, value.toUpperCase(), value.toLowerCase()])) } }
      : { [field]: value };

  const alreadyMatched = new Set<string>();
  for (const rule of deterministic) {
    if (!rule.value) continue;
    const hits = scoped(
      await findByType<PatientDoc>(
        db,
        'patient',
        selectorFor(rule.field, rule.value, rule.caseInsensitive),
        { indexFields: ['type', rule.field] },
      ),
    );
    for (const p of hits) {
      // Mirrors the original precedence: a patient already matched by a
      // stronger identifier is not re-scored by a weaker one.
      if (alreadyMatched.has(p._id)) continue;
      alreadyMatched.add(p._id);
      candidates.push({
        patient: p,
        score: rule.score,
        method: rule.method,
        reasons: [rule.reason(rule.shown ?? rule.value)],
      });
    }
  }

  // Skip probabilistic pass if we already have a deterministic 1.0
  const hasExact = candidates.some((c) => c.score === 1.0);
  if (!hasExact) {
    // 2. Probabilistic — name + DOB + phone. This one genuinely needs every
    // candidate document, because Jaro-Winkler similarity is not indexable.
    const patients = scoped(await findByType<PatientDoc>(db, 'patient'));
    for (const p of patients) {
      const reasons: string[] = [];
      let score = 0;
      let parts = 0;

      if (query.firstName && p.firstName) {
        const s = jaroWinkler(query.firstName, p.firstName);
        score += s;
        parts += 1;
        if (s >= 0.9) reasons.push(`first name ${s.toFixed(2)}`);
      }
      if (query.surname && p.surname) {
        const s = jaroWinkler(query.surname, p.surname);
        score += s * 1.2; // surname slightly more weighty
        parts += 1.2;
        if (s >= 0.9) reasons.push(`surname ${s.toFixed(2)}`);
      }
      if (query.dateOfBirth && p.dateOfBirth) {
        const match = query.dateOfBirth === p.dateOfBirth ? 1 : 0;
        score += match * 1.5;
        parts += 1.5;
        if (match) reasons.push('DOB exact');
      }
      if (query.phone && p.phone) {
        const a = query.phone.replace(/\D/g, '');
        const b = p.phone.replace(/\D/g, '');
        const match = a && b && a === b ? 1 : 0;
        score += match * 1.3;
        parts += 1.3;
        if (match) reasons.push('phone exact');
      }

      if (parts === 0) continue;
      const normalized = score / parts;

      if (normalized >= 0.7) {
        candidates.push({
          patient: p,
          score: normalized,
          method: 'probabilistic',
          reasons,
        });
      }
    }
  }

  // Dedupe by patient id (prefer higher score)
  const bestByPatient = new Map<string, MpiCandidate>();
  for (const c of candidates) {
    const prev = bestByPatient.get(c.patient._id);
    if (!prev || c.score > prev.score) bestByPatient.set(c.patient._id, c);
  }

  return Array.from(bestByPatient.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
