import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, logApiError, unauthorized } from '@/modules/identity';
import { couchAdminAuthorization, ensureCouchGatewayUser, ensureOrganizationProvisioned } from '@/lib/sync/couch-auth';
import {
  gatewayRequestAllowed,
  isCouchDocumentWrite,
  requiresRetainedDeletionCheck,
  resolveGatewayDatabase,
  retainedDeletionAllowed,
  tombstonesInBody,
  validateGatewayWriteBody,
  type CouchLeaf,
} from '@/lib/sync/sync-gateway';
import { isAppendOnlyDatabase } from '@/lib/sync/write-permissions';
import { logAuditSafe } from '@/lib/services/audit-service';
import type { PatientDoc, PatientTransferDoc } from '@/lib/db-types';
import { tenantDatabaseName } from '@/lib/sync/tenant-database';
import { authorizeReplicatedTransfer } from '@/lib/sync/transfer-gateway-authorization';
import {
  CONVERSATIONS_DATABASE,
  authorizeConversationWrite,
  authorizeMessageWrite,
  canReadScopedDoc,
  filterScopedReadResponse,
  liveDocsInBody,
  mergeSelector,
  participantScopeKind,
  participantSelector,
  type ParticipantScopeKind,
} from '@/lib/sync/participant-scope';
import { messageIntegrityViolation } from '@/lib/sync/message-integrity';
import { SERVER_HELD_BEFORE, applyPortalCredentialAuthority } from '@/lib/sync/portal-credential-authority';

export const dynamic = 'force-dynamic';
const MAX_PROXY_BODY_BYTES = 25 * 1024 * 1024;

async function handler(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  try {
    if (process.env.NEXT_PUBLIC_COUCHDB_GATEWAY_ENABLED !== 'true') {
      return NextResponse.json({ error: 'Sync gateway is disabled' }, { status: 404 });
    }
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();

    const { path } = await context.params;
    if (!Array.isArray(path) || path.length < 1) {
      return NextResponse.json({ error: 'Database path is required' }, { status: 400 });
    }
    const database = path[0];
    const pathAfterDatabase = path.slice(1);
    // Distinguish an actual document write (a real state change worth an
    // audit row) from the replication protocol traffic that dominates this
    // endpoint's volume: read-shaped POSTs (_all_docs, _bulk_get, _changes,
    // _find, _revs_diff), _local checkpoint PUTs, and the fsync-style
    // `_ensure_full_commit` ping every push batch ends with — none of those
    // change a document, so none is a "mutation" for audit purposes even
    // though `isCouchDocumentWrite` (correctly, for its own authorization
    // purpose) treats `_ensure_full_commit` as a write. Reused below, once
    // the request is known to be well-formed and in-scope, to decide
    // whether to write an audit entry.
    const isMutatingWrite =
      isCouchDocumentWrite(request.method, pathAfterDatabase) &&
      (pathAfterDatabase[0] || '') !== '_ensure_full_commit';
    const config = resolveGatewayDatabase(database, auth.orgId);
    if (!config) return forbidden('This database is outside your organization.');
    if (!gatewayRequestAllowed(config, request.method, path.slice(1))) {
      return forbidden('This replication operation is not allowed for the database.');
    }

    const declaredLength = Number(request.headers.get('content-length') || 0);
    if (declaredLength > MAX_PROXY_BODY_BYTES) {
      return NextResponse.json({ error: 'Sync request is too large' }, { status: 413 });
    }

    const base = (process.env.COUCHDB_URL || '').replace(/\/+$/, '');
    if (!base) throw new Error('COUCHDB_URL is not configured');
    // Heals organizations created while tenant provisioning was disabled:
    // their databases (with validators + _security) must exist before any
    // replication traffic is proxied, because clients are never allowed to
    // create databases through this gateway. Memoized — after the first
    // request per org per process this is a resolved promise.
    await ensureOrganizationProvisioned(auth.orgId);
    const credentials = await ensureCouchGatewayUser(auth);
    const upstream = new URL(`${base}/${path.map(encodeURIComponent).join('/')}`);
    request.nextUrl.searchParams.forEach((value, key) => upstream.searchParams.append(key, value));

    const headers = new Headers();
    for (const name of ['accept', 'content-type', 'if-match', 'if-none-match', 'range']) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set(
      'authorization',
      `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`,
    );

    const hasBody = !['GET', 'HEAD'].includes(request.method.toUpperCase());
    let body = hasBody ? await request.arrayBuffer() : undefined;
    if (body && body.byteLength > MAX_PROXY_BODY_BYTES) {
      return NextResponse.json({ error: 'Sync request is too large' }, { status: 413 });
    }
    let parsed: unknown;
    if (hasBody) {
      if (body && body.byteLength > 0 && isJsonRequest(request)) {
        try {
          parsed = JSON.parse(new TextDecoder().decode(body));
        } catch {
          return NextResponse.json({ error: 'Sync request contains invalid JSON' }, { status: 400 });
        }
      }
      // A single-document write names its document in the path, and every
      // check below reads the id from the body when it has one. The two must
      // be the same document.
      const pathId = pathAfterDatabase[0];
      const bodyId = (parsed as { _id?: unknown } | null)?._id;
      if (pathId && !pathId.startsWith('_') && typeof bodyId === 'string' && bodyId !== pathId) {
        return NextResponse.json({ error: 'Document id does not match the request path.' }, { status: 400 });
      }
      const validationError = validateGatewayWriteBody(config, request.method, path.slice(1), parsed);
      if (validationError) {
        const status = body && body.byteLength > 0 && !isJsonRequest(request) ? 415 : 400;
        return NextResponse.json({ error: validationError }, { status });
      }
      if (config.localName === 'tamamhealth_patient_transfers'
          && process.env.OFFLINE_GATEWAY_RELATIONSHIP_AUTHORIZATION !== 'false') {
        const transferError = await validateTransferRelationships(
          parsed,
          auth,
          base,
          database,
          headers.get('authorization') || '',
        );
        if (transferError) return forbidden(transferError);
      }
    }
    // Writes this request may not make. A push batch mixes them with
    // legitimate documents, and failing the whole request would stall every
    // later write from this device behind it — so a refused document is taken
    // out of the batch, the rest is carried, and the response reports that one
    // document as `forbidden`. That is the per-document answer CouchDB's own
    // validator gives, which replication records as denied and moves past,
    // rather than believing the write landed. A single-document write has
    // nothing else to carry and is refused outright.
    const refused = new Map<number, string>();
    const refusal = 'This write is not permitted for your account.';
    let method = request.method.toUpperCase();
    const scopeKind = participantScopeKind(config);
    const authorization = headers.get('authorization') || '';
    const databaseUrl = `${base}/${encodeURIComponent(database)}`;
    // The sibling conversations database, in the same physical layout
    // (tenant or shared) as the one this request addressed.
    const conversationsUrl = `${base}/${encodeURIComponent(
      database === config.localName
        ? CONVERSATIONS_DATABASE
        : tenantDatabaseName(CONVERSATIONS_DATABASE, auth.orgId || ''),
    )}`;

    // Messages and conversations are a retained record: a deletion is only
    // carried upstream when another live revision of the document survives it
    // (conflict pruning). Anything else would erase the record.
    if (requiresRetainedDeletionCheck(config) && isMutatingWrite) {
      if (method === 'DELETE') {
        const id = pathAfterDatabase[0] || '';
        const rev = request.nextUrl.searchParams.get('rev')
          || (request.headers.get('if-match') || '').replace(/"/g, '') || null;
        const leaves = await readCouchLeaves(databaseUrl, id, authorization);
        if (!retainedDeletionAllowed(rev, leaves)) {
          logBlockedWrite('sync.gateway.retained_delete_blocked', auth, database, [id]);
          return forbidden('Messages are a retained record and cannot be deleted.');
        }
      } else if (parsed) {
        const blocked: string[] = [];
        for (const tombstone of tombstonesInBody(parsed, pathAfterDatabase[0])) {
          const leaves = await readCouchLeaves(databaseUrl, tombstone.id, authorization);
          if (!retainedDeletionAllowed(tombstone.parentRev, leaves)) {
            refused.set(tombstone.index, tombstone.id);
            blocked.push(tombstone.id);
          }
        }
        if (blocked.length > 0) logBlockedWrite('sync.gateway.retained_delete_blocked', auth, database, blocked);
      }
    }

    // Append-only trails (audit log, narcotics register, ledger): an entry
    // the server already holds can never be written again. The validator has
    // the same rule but judges a replicated write on the ancestry the CLIENT
    // claims — a revision with invented ancestry reaches it as a brand-new
    // document, is accepted, and outranks the real entry. Verified against
    // CouchDB 3.5 in integration/couch-gateway-live.test.ts. So existence is
    // checked here, against the server. Re-sending the revision the server
    // already has is replication repeating itself, and is left alone.
    if (isAppendOnlyDatabase(config.localName) && isMutatingWrite && parsed) {
      const live = liveDocsInBody(parsed, pathAfterDatabase[0]);
      const existing = await readCouchRevisions(databaseUrl, live.map(entry => entry.id), authorization);
      const rewritten = live.filter(entry => existing.has(entry.id) && existing.get(entry.id) !== entry.doc._rev);
      if (rewritten.length > 0) {
        for (const entry of rewritten) refused.set(entry.index, entry.id);
        logBlockedWrite('sync.gateway.append_only_rewrite_blocked', auth, database, rewritten.map(entry => entry.id));
      }
    }

    // Patient-portal credentials on a patient document are the server's to
    // write (portal-credential-authority.ts). Whatever a device sent in those
    // fields is replaced with what the server holds, so a device can neither
    // plant an activation code on a patient nor undo a suspension.
    let rewritten = false;
    if (config.localName === 'tamamhealth_patients' && isMutatingWrite && parsed) {
      const live = liveDocsInBody(parsed, pathAfterDatabase[0]).filter(entry => entry.doc.type === 'patient');
      const current = await readCouchDocuments(databaseUrl, live.map(entry => entry.id), authorization);
      // A patient with no live copy here is new only if the server has never
      // held them: not as a tombstone in this database (delete, then write
      // back), and not in the server's own register, which activation and
      // sign-in read and which holds every organization's patients.
      const unseen = live
        .filter(entry => !current.has(entry.id) && Object.keys(entry.doc).some(key => key.startsWith('portal')))
        .map(entry => entry.id);
      const heldBefore = await readHeldIds(databaseUrl, unseen, authorization);
      if (database !== config.localName) {
        const inRegister = await readHeldIds(`${base}/${encodeURIComponent(config.localName)}`, unseen, couchAdminAuthorization());
        for (const id of inRegister) heldBefore.add(id);
      }
      const batch = (parsed as { docs?: unknown[] }).docs;
      const planted: string[] = [];
      for (const entry of live) {
        const serverCopy = current.get(entry.id) ?? (heldBefore.has(entry.id) ? SERVER_HELD_BEFORE : null);
        const result = applyPortalCredentialAuthority(entry.doc, serverCopy, auth.role);
        if (!result.changed) continue;
        rewritten = true;
        if (Array.isArray(batch)) batch[entry.index] = result.doc;
        else parsed = result.doc;
        // Only a patient with no live copy arriving with credentials it may
        // not carry is worth an audit row; a stale copy of an existing patient
        // is routine.
        if (!current.has(entry.id)) planted.push(entry.id);
      }
      // A patient written without an id cannot be checked against anything the
      // server holds, and CouchDB would name it itself. Replication always
      // sends one, so such a write carries no portal fields at all.
      const checked = new Set(live.map(entry => entry.index));
      (Array.isArray(batch) ? batch : [parsed]).forEach((value, index) => {
        if (checked.has(index) || !value || typeof value !== 'object' || Array.isArray(value)) return;
        const result = applyPortalCredentialAuthority(value as Record<string, unknown>, SERVER_HELD_BEFORE, auth.role);
        if (!result.changed) return;
        rewritten = true;
        if (Array.isArray(batch)) batch[index] = result.doc;
        else parsed = result.doc;
        planted.push('(no id)');
      });
      if (planted.length > 0) logBlockedWrite('sync.gateway.portal_credentials_stripped', auth, database, planted);
    }

    // Staff chat is readable and writable by its participants only.
    let scope: ParticipantScope | null = null;
    if (scopeKind) {
      scope = {
        kind: scopeKind,
        userId: auth.sub,
        conversationIds: scopeKind === 'message'
          // A change feed advances the device's checkpoint, so it is always
          // scoped by current membership; a stale answer there would step
          // past messages for good. The chatter around it may use the cache.
          ? await participantConversationIds(conversationsUrl, auth.sub, authorization, pathAfterDatabase[0] === '_changes')
          : new Set<string>(),
      };
      if (isMutatingWrite && parsed) {
        const live = liveDocsInBody(parsed, pathAfterDatabase[0]);
        const verdicts = scopeKind === 'conversation'
          ? await judgeConversationWrites(live, databaseUrl, auth.sub, authorization)
          : await judgeMessageWrites(live, conversationsUrl, scope, authorization);
        if (verdicts.retry) {
          // The message's conversation has not reached the server yet. Ask
          // the device to try again rather than lose what its user wrote.
          return NextResponse.json(
            { error: 'A conversation in this batch has not synced yet; retry shortly.' },
            { status: 503, headers: { 'retry-after': '5' } },
          );
        }
        if (verdicts.refused.length > 0) {
          for (const entry of verdicts.refused) refused.set(entry.index, entry.id);
          logBlockedWrite('sync.gateway.participant_write_blocked', auth, database, verdicts.refused.map(entry => entry.id));
        }
        // What a message says, and who said it, is fixed once sent. Judged
        // against the server's own copy: a client describes the revision it
        // is replacing, and can describe one that never existed.
        if (scopeKind === 'message') {
          const candidates = live.filter(entry => !refused.has(entry.index));
          const current = await readCouchDocuments(databaseUrl, candidates.map(entry => entry.id), authorization);
          const tampered = candidates.filter(entry => messageIntegrityViolation(
            entry.doc, current.get(entry.id), auth.sub,
            { allowForeignAuthorOnCreate: process.env.DEMO_MODE === 'true' },
          ));
          if (tampered.length > 0) {
            for (const entry of tampered) refused.set(entry.index, entry.id);
            logBlockedWrite('sync.gateway.message_integrity_blocked', auth, database, tampered.map(entry => entry.id));
          }
        }
      } else if (!isMutatingWrite) {
        const rewrite = scopeReadRequest(scope, request, pathAfterDatabase, parsed, upstream);
        if (rewrite.error) return forbidden(rewrite.error);
        if (rewrite.body !== undefined) {
          method = 'POST';
          headers.set('content-type', 'application/json');
          body = new TextEncoder().encode(JSON.stringify(rewrite.body)).buffer as ArrayBuffer;
        }
        // Responses are filtered as JSON below; never negotiate multipart.
        headers.set('accept', 'application/json');
      }
    }

    if (refused.size > 0) {
      const docs = (parsed as { docs?: unknown[] } | null)?.docs;
      if (pathAfterDatabase[0] !== '_bulk_docs' || !Array.isArray(docs)) return forbidden(refusal);
      const kept = { ...(parsed as object), docs: docs.filter((_, index) => !refused.has(index)) };
      body = new TextEncoder().encode(JSON.stringify(kept)).buffer as ArrayBuffer;
    } else if (rewritten) {
      body = new TextEncoder().encode(JSON.stringify(parsed)).buffer as ArrayBuffer;
    }

    const response = await fetch(upstream, {
      method,
      headers,
      body: body && body.byteLength > 0 ? body : undefined,
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });

    // One audit row per proxied WRITE call — not per proxied request. This
    // route also carries every pull-poll (~15s, across ~77 databases) and
    // every live push replication round-trip; logging all of that would bury
    // real writes in routine sync chatter. `isMutatingWrite` already screened
    // out reads and `_local` checkpoints, so anything reaching here is a
    // genuine attempt to change a document. A `_bulk_docs` batch — the normal
    // shape of a push — still gets exactly one row, not one per document
    // inside it, matching how the rest of the app logs bulk operations
    // (see `logPhiSearch`). Only identifiers are recorded, never document
    // bodies, so PHI never lands in the audit trail through this path.
    if (isMutatingWrite) {
      void logAuditSafe(
        'sync.gateway.write',
        auth.sub,
        auth.username,
        JSON.stringify({
          method: request.method,
          database,
          endpoint: pathAfterDatabase[0] || '',
          status: response.status,
          orgId: auth.orgId,
        }),
        response.status < 400,
      );
    }

    if (refused.size > 0 && response.ok) {
      const docs = (parsed as { docs: Array<{ _id?: string; _rev?: string }> }).docs;
      const upstreamRows = await response.json().catch(() => []) as unknown;
      const rows = Array.isArray(upstreamRows) ? upstreamRows : [];
      for (const index of refused.keys()) {
        rows.push({ id: docs[index]?._id, rev: docs[index]?._rev, error: 'forbidden', reason: refusal });
      }
      return NextResponse.json(rows, { status: response.status, headers: { 'cache-control': 'no-store' } });
    }

    const responseHeaders = new Headers();
    for (const name of ['cache-control', 'content-encoding', 'content-length', 'content-range', 'content-type', 'etag']) {
      const value = response.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    responseHeaders.set('cache-control', 'no-store');
    if (scope && !isMutatingWrite && response.ok && readReturnsDocuments(request, pathAfterDatabase)) {
      // The selector keeps other people's threads out of feeds and queries;
      // this is the backstop for a document asked for by id.
      const readScope = scope;
      const filtered = filterScopedReadResponse(
        await response.json(),
        doc => canReadScopedDoc(readScope.kind, doc, readScope.userId, readScope.conversationIds),
      );
      if (filtered.denied > 0) {
        void logAuditSafe(
          'sync.gateway.participant_read_blocked',
          auth.sub,
          auth.username,
          JSON.stringify({ database, endpoint: pathAfterDatabase[0] || '', count: filtered.denied, orgId: auth.orgId }),
          false,
        );
      }
      return NextResponse.json(filtered.payload, {
        status: filtered.status ?? response.status,
        headers: { 'cache-control': 'no-store' },
      });
    }
    return new NextResponse(request.method === 'HEAD' ? null : response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    logApiError('[API /couch gateway]', error);
    return NextResponse.json({ error: 'Sync gateway unavailable' }, { status: 502 });
  }
}

export const GET = handler;
export const HEAD = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;

function isJsonRequest(request: NextRequest): boolean {
  const contentType = request.headers.get('content-type') || '';
  return contentType.includes('application/json');
}

async function readCouchDocument<T>(url: string, authorization: string): Promise<T | null> {
  const response = await fetch(url, {
    headers: { authorization, accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Related CouchDB document lookup failed (${response.status})`);
  return response.json() as Promise<T>;
}

/** Every leaf revision of a document, or none when the server has never held it. */
async function readCouchLeaves(databaseUrl: string, id: string, authorization: string): Promise<CouchLeaf[]> {
  const rows = await readCouchDocument<Array<{ ok?: CouchLeaf }>>(
    `${databaseUrl}/${encodeURIComponent(id)}?open_revs=all`,
    authorization,
  );
  return (rows || []).flatMap(row => (row.ok ? [row.ok] : []));
}

/** Identifiers only — the audit trail never receives a message body. */
function logBlockedWrite(
  action: string,
  auth: NonNullable<Awaited<ReturnType<typeof getAuthPayload>>>,
  database: string,
  ids: string[],
): void {
  void logAuditSafe(
    action,
    auth.sub,
    auth.username,
    JSON.stringify({ database, ids: ids.slice(0, 50), count: ids.length, orgId: auth.orgId }),
    false,
  );
}

/* ───────────────────── staff chat: participant scope ───────────────────── */

interface ParticipantScope {
  kind: ParticipantScopeKind;
  userId: string;
  conversationIds: Set<string>;
}

/**
 * The conversations a user is in, as the server knows them. Every request to
 * the messages database needs it, so it is remembered briefly for everything
 * except the change feed itself (see the caller).
 */
const CONVERSATION_IDS_TTL_MS = 5_000;
const conversationIdCache = new Map<string, { at: number; ids: Set<string> }>();

async function participantConversationIds(
  conversationsUrl: string,
  userId: string,
  authorization: string,
  fresh = false,
): Promise<Set<string>> {
  const key = `${conversationsUrl}::${userId}`;
  const cached = conversationIdCache.get(key);
  if (!fresh && cached && Date.now() - cached.at < CONVERSATION_IDS_TTL_MS) return cached.ids;
  const response = await fetch(`${conversationsUrl}/_find`, {
    method: 'POST',
    headers: { authorization, accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      selector: { type: 'conversation', ...participantSelector('conversation', userId, []) },
      fields: ['_id'],
      limit: 10_000,
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  // A database that does not exist yet holds no conversations. Any other
  // failure must not read as "no conversations" for a write decision, nor as
  // "all of them" for a read — so it fails the request.
  if (response.status === 404) return new Set();
  if (!response.ok) throw new Error(`Conversation membership lookup failed (${response.status})`);
  const found = await response.json() as { docs?: Array<{ _id?: string }> };
  const ids = new Set((found.docs || []).flatMap(doc => (doc._id ? [doc._id] : [])));
  if (conversationIdCache.size > 5_000) conversationIdCache.clear();
  conversationIdCache.set(key, { at: Date.now(), ids });
  return ids;
}

/** The server's current copy of each document, keyed by id. */
async function readCouchDocuments(
  databaseUrl: string,
  ids: string[],
  authorization: string,
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  if (ids.length === 0) return out;
  const response = await fetch(`${databaseUrl}/_all_docs?include_docs=true`, {
    method: 'POST',
    headers: { authorization, accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ keys: Array.from(new Set(ids)) }),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return out;
  if (!response.ok) throw new Error(`Related CouchDB document lookup failed (${response.status})`);
  const body = await response.json() as { rows?: Array<{ id?: string; doc?: Record<string, unknown> | null }> };
  for (const row of body.rows || []) if (row.id && row.doc) out.set(row.id, row.doc);
  return out;
}

/** The ids a database has ever held: live documents and tombstones alike. */
async function readHeldIds(
  databaseUrl: string,
  ids: string[],
  authorization: string,
): Promise<Set<string>> {
  const out = new Set<string>();
  if (ids.length === 0) return out;
  const response = await fetch(`${databaseUrl}/_all_docs`, {
    method: 'POST',
    headers: { authorization, accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ keys: Array.from(new Set(ids)) }),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return out;
  if (!response.ok) throw new Error(`Related CouchDB document lookup failed (${response.status})`);
  const body = await response.json() as { rows?: Array<{ id?: string; value?: { rev?: string } }> };
  for (const row of body.rows || []) if (row.id && row.value?.rev) out.add(row.id);
  return out;
}

/** The winning revision of each document the server holds, keyed by id. */
async function readCouchRevisions(
  databaseUrl: string,
  ids: string[],
  authorization: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const response = await fetch(`${databaseUrl}/_all_docs`, {
    method: 'POST',
    headers: { authorization, accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ keys: Array.from(new Set(ids)) }),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return out;
  if (!response.ok) throw new Error(`Related CouchDB document lookup failed (${response.status})`);
  const body = await response.json() as { rows?: Array<{ id?: string; value?: { rev?: string; deleted?: boolean } }> };
  for (const row of body.rows || []) {
    if (row.id && row.value?.rev && !row.value.deleted) out.set(row.id, row.value.rev);
  }
  return out;
}

type LiveDoc = ReturnType<typeof liveDocsInBody>[number];
interface WriteVerdicts { refused: Array<{ index: number; id: string }>; retry: boolean }

async function judgeConversationWrites(
  live: LiveDoc[],
  databaseUrl: string,
  userId: string,
  authorization: string,
): Promise<WriteVerdicts> {
  const previous = await readCouchDocuments(databaseUrl, live.map(entry => entry.id), authorization);
  const refused = live.filter(entry => authorizeConversationWrite(entry.doc, previous.get(entry.id), userId) === 'refuse');
  return { refused, retry: false };
}

async function judgeMessageWrites(
  live: LiveDoc[],
  conversationsUrl: string,
  scope: ParticipantScope,
  authorization: string,
): Promise<WriteVerdicts> {
  // Membership the cache already vouches for needs no lookup; anything else is
  // read fresh, because the cache may predate the user joining or creating it.
  const uncertain = live.filter(entry => {
    const id = entry.doc.conversationId;
    return typeof id === 'string' && id.length > 0 && !scope.conversationIds.has(id);
  });
  if (uncertain.length === 0) return { refused: [], retry: false };
  const conversations = await readCouchDocuments(
    conversationsUrl,
    uncertain.map(entry => String(entry.doc.conversationId)),
    authorization,
  );
  const refused: WriteVerdicts['refused'] = [];
  let retry = false;
  for (const entry of uncertain) {
    const verdict = authorizeMessageWrite(entry.doc, conversations.get(String(entry.doc.conversationId)), scope.userId);
    if (verdict === 'refuse') refused.push(entry);
    if (verdict === 'retry') retry = true;
  }
  return { refused, retry };
}

/** Read endpoints whose response carries document bodies to check. */
function readReturnsDocuments(request: NextRequest, pathAfterDatabase: string[]): boolean {
  const endpoint = pathAfterDatabase[0] || '';
  if (endpoint === '_bulk_get' || endpoint === '_all_docs' || endpoint === '_find') return true;
  return !!endpoint && !endpoint.startsWith('_') && request.method.toUpperCase() === 'GET';
}

/**
 * Narrow a read to the user's own conversations before CouchDB runs it.
 *
 * `_changes` and `_find` are rewritten to carry the participant selector, so
 * CouchDB never emits another thread's documents (or their ids) at all. When
 * a rewrite is needed the request goes upstream as a POST with this body.
 */
function scopeReadRequest(
  scope: ParticipantScope,
  request: NextRequest,
  pathAfterDatabase: string[],
  parsed: unknown,
  upstream: URL,
): { body?: unknown; error?: string } {
  const endpoint = pathAfterDatabase[0] || '';
  const selector = participantSelector(scope.kind, scope.userId, Array.from(scope.conversationIds));
  if (endpoint === '_changes') {
    const filter = request.nextUrl.searchParams.get('filter');
    if (filter && filter !== '_selector') return { error: 'Only selector-filtered change feeds are available for this database.' };
    upstream.searchParams.set('filter', '_selector');
    const clientBody = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
    return { body: { ...clientBody, selector: mergeSelector(clientBody.selector, selector) } };
  }
  if (endpoint === '_find') {
    const clientBody = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
    return { body: { ...clientBody, selector: mergeSelector(clientBody.selector, selector) } };
  }
  // Attachments are not used by messaging; a path below a document is refused
  // rather than streamed past the document check.
  if (endpoint && !endpoint.startsWith('_') && pathAfterDatabase.length > 1) {
    return { error: 'Attachments are not available for this database.' };
  }
  return {};
}

async function validateTransferRelationships(
  body: unknown,
  auth: NonNullable<Awaited<ReturnType<typeof getAuthPayload>>>,
  couchBase: string,
  transferDatabase: string,
  authorization: string,
): Promise<string | null> {
  const values = Array.isArray((body as { docs?: unknown } | null)?.docs)
    ? (body as { docs: unknown[] }).docs
    : [body];
  for (const value of values) {
    if (!value || typeof value !== 'object') continue;
    const next = value as PatientTransferDoc;
    if ((next as PatientTransferDoc & { _deleted?: boolean })._deleted) return 'Patient transfers cannot be deleted.';
    if (!next._id || !next.patientId) return 'A patient transfer requires document and patient identifiers.';
    const previous = await readCouchDocument<PatientTransferDoc>(
      `${couchBase}/${encodeURIComponent(transferDatabase)}/${encodeURIComponent(next._id)}`,
      authorization,
    );
    if (!auth.orgId) return 'An organization-scoped session is required for patient transfers.';
    const patientDatabase = tenantDatabaseName('tamamhealth_patients', auth.orgId);
    const patient = await readCouchDocument<PatientDoc>(
      `${couchBase}/${encodeURIComponent(patientDatabase)}/${encodeURIComponent(next.patientId)}`,
      authorization,
    );
    if (!patient) return 'The related patient is unavailable or outside your organization.';
    const error = authorizeReplicatedTransfer(auth, next, previous, patient);
    if (error) return error;
  }
  return null;
}
