/**
 * Patient-portal secret hashes never replicate DOWN to staff devices.
 *
 * `portalPasswordHash` (bcrypt) and `portalInviteTokenHash` live on the patient
 * document, which every clinical device pulls. The push side already makes the
 * server authoritative for those fields (portal-credential-authority.ts); this
 * is the read side: the sync gateway removes the two hash fields from every
 * patients-database response that carries document bodies, and refuses a query
 * that names them (a `$regex` selector would otherwise read a hash out one
 * character at a time without ever receiving the field).
 *
 * Why stripping is safe for replication:
 *   - PouchDB stores a pulled revision under the rev id the server reports and
 *     does not verify a content hash against it, so a body without the fields
 *     is stored as that same revision.
 *   - When a device later pushes a patient written from a stripped copy, the
 *     gateway's authority replaces the document's `portal*` fields with the
 *     server's own, hashes included -- the hashes are restored, never lost.
 *   - A patient registered on a device keeps the invitation hash it minted
 *     locally; the create is accepted by the authority and stored server-side.
 *   - No client code reads either field (summarisePortalAccess runs in the
 *     /api/patients/portal-access route against the server's own copy).
 */

/** The two fields that are credentials rather than state. */
export const PORTAL_SECRET_FIELDS = ['portalPasswordHash', 'portalInviteTokenHash'] as const;

type Doc = Record<string, unknown>;
const isObject = (value: unknown): value is Doc =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function stripDoc(doc: unknown): void {
  if (!isObject(doc)) return;
  for (const field of PORTAL_SECRET_FIELDS) delete doc[field];
}

/**
 * Remove the secret fields from a parsed CouchDB read response, in place, and
 * return it. Handles every shape that carries bodies: a single document,
 * `?open_revs` (array of `{ok}`), `_bulk_get` (`results[].docs[].ok`),
 * `_changes?include_docs` (`results[].doc`), `_all_docs?include_docs`
 * (`rows[].doc`) and `_find` (`docs[]`).
 */
export function stripPortalSecrets<T>(payload: T): T {
  if (Array.isArray(payload)) {
    for (const entry of payload) if (isObject(entry)) stripDoc(entry.ok);
    return payload;
  }
  if (!isObject(payload)) return payload;
  if (Array.isArray(payload.results)) {
    for (const result of payload.results) {
      if (!isObject(result)) continue;
      stripDoc(result.doc);
      if (Array.isArray(result.docs)) for (const entry of result.docs) if (isObject(entry)) stripDoc(entry.ok);
      // `_all_docs/queries`: one `rows` list per query.
      if (Array.isArray(result.rows)) for (const row of result.rows) if (isObject(row)) stripDoc(row.doc);
    }
  }
  if (Array.isArray(payload.rows)) {
    for (const row of payload.rows) if (isObject(row)) stripDoc(row.doc);
  }
  if (Array.isArray(payload.docs)) {
    for (const doc of payload.docs) stripDoc(doc);
  }
  if (typeof payload._id === 'string') stripDoc(payload);
  return payload;
}

/**
 * True when a read request names a secret field anywhere in its query string or
 * JSON body (selector, fields, sort, ...). Such a query is an extraction
 * oracle even when the response is stripped.
 */
export function readRequestNamesPortalSecret(search: string, body: unknown): boolean {
  let haystack = search;
  if (body !== undefined && body !== null) {
    try { haystack += JSON.stringify(body); } catch { return true; }
  }
  const decoded = (() => { try { return decodeURIComponent(haystack); } catch { return haystack; } })();
  return PORTAL_SECRET_FIELDS.some(field => decoded.includes(field));
}
