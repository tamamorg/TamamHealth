/**
 * Per-user read isolation for staff chat.
 *
 * Tenancy and facility scoping decide which ORGANISATION's and which
 * FACILITY's records a device may hold. Staff chat needs a narrower rule: a
 * direct message between two clinicians is not the business of every other
 * account in the organisation, yet until this module existed every device in
 * the org replicated every conversation and every message in it. The app hid
 * the ones you were not in; the data was on the disk all the same.
 *
 * The rule, in one place:
 *   - a `conversation` is readable and writable by its participants;
 *   - a `message` that belongs to a conversation (`conversationId` set) follows
 *     that conversation;
 *   - any other message (patient ↔ staff, lab and radiology notices) is not
 *     staff chat and stays under the existing org/facility scoping.
 *
 * Everything here is pure. The sync gateway is the enforcement point — it is
 * the only path between a browser and CouchDB — and applies these functions to
 * the requests it forwards and the responses it returns.
 */
import type { DatabaseSyncConfig } from './sync-config';

export type ParticipantScopeKind = 'conversation' | 'message';

const SCOPED_DATABASES: Readonly<Record<string, ParticipantScopeKind>> = {
  tamamhealth_conversations: 'conversation',
  tamamhealth_messages: 'message',
};

export const CONVERSATIONS_DATABASE = 'tamamhealth_conversations';

/** Which participant rule, if any, governs a database. */
export function participantScopeKind(config: Pick<DatabaseSyncConfig, 'localName'>): ParticipantScopeKind | null {
  return SCOPED_DATABASES[config.localName] ?? null;
}

type Doc = Record<string, unknown>;

function isParticipant(doc: Doc | null | undefined, userId: string): boolean {
  const ids = doc?.participantIds;
  return Array.isArray(ids) && ids.includes(userId);
}

function conversationIdOf(doc: Doc): string | null {
  const id = doc.conversationId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/* ───────────────────────────── reads ───────────────────────────── */

/**
 * The Mango selector CouchDB evaluates for this user, so documents outside
 * their conversations never enter a changes feed or a query result.
 */
export function participantSelector(
  kind: ParticipantScopeKind,
  userId: string,
  conversationIds: readonly string[],
): Record<string, unknown> {
  if (kind === 'conversation') {
    return { participantIds: { $elemMatch: { $eq: userId } } };
  }
  return {
    $or: [
      { conversationId: { $exists: false } },
      { conversationId: { $in: [null, '', ...conversationIds] } },
    ],
  };
}

/** AND the user's scope onto whatever selector the client asked for. */
export function mergeSelector(
  clientSelector: unknown,
  scope: Record<string, unknown>,
): Record<string, unknown> {
  const client = clientSelector && typeof clientSelector === 'object' && !Array.isArray(clientSelector)
    ? clientSelector as Record<string, unknown>
    : null;
  return client && Object.keys(client).length > 0 ? { $and: [client, scope] } : scope;
}

/**
 * Whether a fetched document may be returned to this user. A deleted stub is
 * always returned: it carries no content, and replication needs it.
 */
export function canReadScopedDoc(
  kind: ParticipantScopeKind,
  doc: unknown,
  userId: string,
  conversationIds: ReadonlySet<string>,
): boolean {
  if (!doc || typeof doc !== 'object') return true;
  const value = doc as Doc;
  if (value._deleted === true) return true;
  if (kind === 'conversation') return isParticipant(value, userId);
  const conversationId = conversationIdOf(value);
  return !conversationId || conversationIds.has(conversationId);
}

const FORBIDDEN = { error: 'forbidden', reason: 'You are not a participant in this conversation.' };

/**
 * Remove documents the user may not read from a JSON read response. Handles
 * the four shapes a document can come back in: a single document, an
 * `open_revs` array, `_bulk_get` results and `_all_docs` / `_find` rows.
 * Entries are replaced with a `forbidden` marker rather than dropped, so a
 * caller can tell "not yours" from "does not exist".
 */
export function filterScopedReadResponse(
  payload: unknown,
  allowed: (doc: unknown) => boolean,
): { payload: unknown; denied: number; status?: number } {
  let denied = 0;
  if (Array.isArray(payload)) {
    // GET /db/doc?open_revs=…
    const rows = payload.map(entry => {
      const ok = (entry as { ok?: unknown } | null)?.ok;
      if (ok === undefined || allowed(ok)) return entry;
      denied += 1;
      return { missing: (ok as Doc)._rev };
    });
    return { payload: rows, denied };
  }
  if (!payload || typeof payload !== 'object') return { payload, denied };
  const body = payload as Doc;

  if (Array.isArray(body.results)) {
    // POST /db/_bulk_get
    const results = (body.results as Array<{ id?: unknown; docs?: unknown }>).map(result => ({
      ...result,
      docs: Array.isArray(result.docs)
        ? result.docs.map(entry => {
            const ok = (entry as { ok?: unknown } | null)?.ok;
            if (ok === undefined || allowed(ok)) return entry;
            denied += 1;
            return { error: { id: result.id, rev: (ok as Doc)._rev, ...FORBIDDEN } };
          })
        : result.docs,
    }));
    return { payload: { ...body, results }, denied };
  }
  if (Array.isArray(body.rows)) {
    // GET|POST /db/_all_docs?include_docs=true
    const rows = (body.rows as Array<{ key?: unknown; id?: unknown; doc?: unknown }>).map(row => {
      if (row.doc === undefined || row.doc === null || allowed(row.doc)) return row;
      denied += 1;
      return { key: row.key ?? row.id, ...FORBIDDEN };
    });
    return { payload: { ...body, rows }, denied };
  }
  if (Array.isArray(body.docs)) {
    // POST /db/_find — the selector is already merged; this is the backstop.
    const docs = (body.docs as unknown[]).filter(doc => {
      if (allowed(doc)) return true;
      denied += 1;
      return false;
    });
    return { payload: { ...body, docs }, denied };
  }
  if (typeof body._id === 'string') {
    // GET /db/doc
    if (allowed(body)) return { payload, denied };
    return { payload: FORBIDDEN, denied: 1, status: 403 };
  }
  return { payload, denied };
}

/* ───────────────────────────── writes ───────────────────────────── */

export type ScopedWriteVerdict = 'allow' | 'refuse' | 'retry';

/**
 * A conversation write is allowed to the people already in it. That is judged
 * on the revision the server holds, never the incoming one — otherwise adding
 * yourself to `participantIds` would be how you joined. Creating a
 * conversation requires being one of its participants.
 */
export function authorizeConversationWrite(next: unknown, previous: unknown, userId: string): ScopedWriteVerdict {
  if (!next || typeof next !== 'object') return 'allow';
  const prior = previous && typeof previous === 'object' && (previous as Doc)._deleted !== true
    ? previous as Doc
    : null;
  if (prior) return isParticipant(prior, userId) ? 'allow' : 'refuse';
  return isParticipant(next as Doc, userId) ? 'allow' : 'refuse';
}

/**
 * A conversation message may be written by a participant of its conversation.
 *
 * `conversation` is the server's copy, or `undefined` when the server has not
 * received it. That last case is ordinary, not hostile: the two databases
 * replicate independently, so a message can arrive before the conversation it
 * belongs to. The author's own message is therefore held for a retry — losing
 * it would be worse than the delay. Someone else's message for a conversation
 * the server has never seen is not this device's to deliver.
 */
export function authorizeMessageWrite(
  next: unknown,
  conversation: unknown | undefined,
  userId: string,
): ScopedWriteVerdict {
  if (!next || typeof next !== 'object') return 'allow';
  const doc = next as Doc;
  if (!conversationIdOf(doc)) return 'allow';
  if (conversation && typeof conversation === 'object' && (conversation as Doc)._deleted !== true) {
    return isParticipant(conversation as Doc, userId) ? 'allow' : 'refuse';
  }
  return doc.fromDoctorId === userId ? 'retry' : 'refuse';
}

/** The live (non-tombstone) documents in a write body, with their position in `docs`. */
export function liveDocsInBody(body: unknown, pathId?: string): Array<{ index: number; id: string; doc: Doc }> {
  const docs = (body as { docs?: unknown } | null)?.docs;
  const values = Array.isArray(docs) ? docs : [body];
  const out: Array<{ index: number; id: string; doc: Doc }> = [];
  values.forEach((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const doc = value as Doc;
    if (doc._deleted === true) return;
    const id = typeof doc._id === 'string' ? doc._id : (Array.isArray(docs) ? undefined : pathId);
    if (id) out.push({ index, id, doc });
  });
  return out;
}
