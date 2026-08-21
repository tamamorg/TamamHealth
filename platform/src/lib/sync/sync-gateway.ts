import {
  DATABASE_DOCUMENT_TYPES,
  DATABASE_SYNC_CONFIGS,
  type DatabaseSyncConfig,
} from './sync-config';
import { tenantDatabaseName } from './tenant-database';
import { isAppendOnlyDatabase } from './write-permissions';

const READ_POST_ENDPOINTS = new Set(['_all_docs', '_bulk_get', '_changes', '_find', '_revs_diff']);
const ALLOWED_INTERNAL_ENDPOINTS = new Set([
  '_all_docs', '_bulk_docs', '_bulk_get', '_changes', '_ensure_full_commit',
  '_find', '_local', '_revs_diff',
]);

/**
 * Databases whose every permitted document type is append-only.
 *
 * Derived rather than listed so adding a type to `APPEND_ONLY_TYPES` covers its
 * database automatically. The CouchDB validator is the authority — it sees
 * `oldDoc` and can tell an amendment from a create; the gateway sees only the
 * request, so it enforces the coarser half it *can* be sure of: nothing is ever
 * deleted out of one of these databases.
 */
function appendOnlyRejection(config: DatabaseSyncConfig): string | null {
  return isAppendOnlyDatabase(config.localName)
    ? `${config.localName} is an append-only record; entries cannot be deleted.`
    : null;
}

export function resolveGatewayDatabase(
  requestedDatabase: string,
  orgId: string | undefined,
): DatabaseSyncConfig | null {
  for (const config of DATABASE_SYNC_CONFIGS) {
    const expected = config.orgScoped
      ? (orgId ? tenantDatabaseName(config.localName, orgId) : null)
      : config.localName;
    if (expected && requestedDatabase === expected) return config;
  }
  return null;
}

export function isCouchDocumentWrite(methodInput: string, pathAfterDatabase: string[]): boolean {
  const method = methodInput.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
  const endpoint = pathAfterDatabase[0] || '';
  // Replication checkpoints are client-specific metadata, not domain records.
  if (endpoint === '_local') return false;
  if (method === 'POST' && READ_POST_ENDPOINTS.has(endpoint)) return false;
  return true;
}

export function gatewayRequestAllowed(
  config: DatabaseSyncConfig,
  method: string,
  pathAfterDatabase: string[],
): boolean {
  const endpoint = pathAfterDatabase[0] || '';
  if (endpoint === '_security' || endpoint === '_compact' || endpoint === '_design') return false;
  if (endpoint.startsWith('_') && !ALLOWED_INTERNAL_ENDPOINTS.has(endpoint)) return false;

  const isWrite = isCouchDocumentWrite(method, pathAfterDatabase);
  if (config.direction === 'pull' && isWrite) return false;

  // Push-only data may use replication metadata and write domain documents,
  // but the browser must not query the server-side audit/regulatory history.
  if (config.direction === 'push' && !isWrite) {
    return endpoint === '_revs_diff' || endpoint === '_local' || endpoint === '';
  }
  return true;
}

type GatewayDocument = { _id?: unknown; _deleted?: unknown; type?: unknown };

function validateDocument(config: DatabaseSyncConfig, value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Document body must be an object.';
  const document = value as GatewayDocument;
  // A tombstone carries no `type` to check, so the type allowlist cannot apply.
  // That is not a reason to wave it through: on an append-only database a
  // deletion is the one write that must never be forwarded.
  if (document._deleted === true) return appendOnlyRejection(config);
  const allowed = DATABASE_DOCUMENT_TYPES[config.localName] || [];
  if (typeof document.type !== 'string' || !allowed.includes(document.type)) {
    return `Document type is not permitted in ${config.localName}.`;
  }
  return null;
}

/** Validate JSON document writes before forwarding them to CouchDB. */
export function validateGatewayWriteBody(
  config: DatabaseSyncConfig,
  methodInput: string,
  pathAfterDatabase: string[],
  body: unknown,
): string | null {
  const method = methodInput.toUpperCase();
  if (!isCouchDocumentWrite(method, pathAfterDatabase)) return null;
  const endpoint = pathAfterDatabase[0] || '';
  if (endpoint === '_ensure_full_commit') return null;
  // `DELETE /<db>/<docid>?rev=` has no body to inspect, so the database itself
  // is the only thing left to judge it on.
  if (method === 'DELETE') return appendOnlyRejection(config);
  if (endpoint === '_bulk_docs') {
    const docs = (body as { docs?: unknown } | null)?.docs;
    if (!Array.isArray(docs)) return 'Bulk write body must contain a docs array.';
    for (const document of docs) {
      const error = validateDocument(config, document);
      if (error) return error;
    }
    return null;
  }
  return validateDocument(config, body);
}
