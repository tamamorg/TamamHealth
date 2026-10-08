/**
 * What may change in a message once it has been sent.
 *
 * A message is a record of what was said, by whom, and when. Read receipts,
 * reactions and delivery status move on after sending; the statement itself
 * does not. Until this module existed the server accepted any field of any
 * message from any staff account — the body, the author, the timestamp.
 *
 * The rule, judged against the copy the SERVER holds (never the device's idea
 * of the previous revision, which a client can invent):
 *
 *   - who said it, when, where, and to whom is fixed at creation;
 *   - only the author can change the wording, and every earlier wording stays
 *     in `editHistory` — an edit adds to the record, it cannot replace it;
 *   - nobody else can introduce wording. A non-author's revision may carry an
 *     OLDER wording (their device had not seen the edit yet — an ordinary
 *     replication race), but never text the record has not already held;
 *   - a message cannot be emptied;
 *   - only the author can retract it.
 *
 * `readBy`, `reactions`, delivery and triage fields and sync bookkeeping are
 * deliberately not policed here: they are written by many devices at once and
 * conflict by design, and a false refusal costs more than a forged tick.
 */

type Doc = Record<string, unknown>;

/** Fixed at creation. Compared as JSON, with absent/empty treated alike. */
export const MESSAGE_IMMUTABLE_FIELDS: readonly string[] = [
  'fromDoctorId', 'fromDoctorName', 'sentAt', 'createdAt', 'conversationId',
  'patientId', 'direction', 'recipientType', 'replyToId', 'channel',
  // Whether a person wrote it, and which clinician a patient's reply is
  // addressed to. Both decide who is told a patient is waiting: flipping
  // `automated` on a real reply re-raises the patient as unanswered (and on a
  // reminder, silences them), and rewriting the addressee moves the alert to
  // someone else's bell.
  'automated', 'recipientStaffId',
];

function same(a: unknown, b: unknown): boolean {
  const norm = (value: unknown) => (value === undefined || value === null || value === '' ? null : value);
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

function bodyOf(doc: Doc): string {
  return typeof doc.body === 'string' ? doc.body : '';
}

/** Every wording the document records: what it says now and what it said before. */
function wordings(doc: Doc): Set<string> {
  const out = new Set<string>();
  if (bodyOf(doc)) out.add(bodyOf(doc));
  if (Array.isArray(doc.editHistory)) {
    for (const entry of doc.editHistory) {
      const body = (entry as Doc | null)?.body;
      if (typeof body === 'string' && body) out.add(body);
    }
  }
  return out;
}

/** Attachments are fixed too, but compared by identity rather than megabytes of base64. */
function attachmentKey(doc: Doc): string {
  const list = Array.isArray(doc.attachments) ? doc.attachments : [];
  return list.map(item => `${(item as Doc)?.name}:${(item as Doc)?.sizeBytes}`).join('|');
}

export interface MessageIntegrityOptions {
  /**
   * Seeded demo environments write messages on behalf of fictional authors,
   * so a device legitimately creates chat messages it did not author. Never
   * set outside a seeded demo.
   */
  allowForeignAuthorOnCreate?: boolean;
}

/**
 * Why a message write must be refused, or null when it may proceed.
 * `current` is the server's copy, or null/undefined when it holds none.
 */
export function messageIntegrityViolation(
  next: unknown,
  current: unknown,
  userId: string,
  options: MessageIntegrityOptions = {},
): string | null {
  if (!next || typeof next !== 'object') return null;
  const doc = next as Doc;
  if (doc.type !== 'message' || doc._deleted === true) return null;
  const prior = current && typeof current === 'object' && (current as Doc)._deleted !== true
    ? current as Doc
    : null;

  if (!prior) {
    // Staff chat is attributed speech: you may only say things as yourself.
    // System notices and patient messages carry no person's authorship claim.
    const isChat = typeof doc.conversationId === 'string' && doc.conversationId.length > 0;
    if (isChat && !options.allowForeignAuthorOnCreate && doc.fromDoctorId !== userId) {
      return 'A chat message can only be sent as yourself.';
    }
    return null;
  }

  for (const field of MESSAGE_IMMUTABLE_FIELDS) {
    if (!same(doc[field], prior[field])) return `A message's ${field} cannot be changed.`;
  }
  if (attachmentKey(doc) !== attachmentKey(prior)) return "A message's attachments cannot be changed.";

  const isAuthor = prior.fromDoctorId === userId;
  const before = wordings(prior);
  const after = wordings(doc);

  if (bodyOf(prior) && !bodyOf(doc)) return 'A message cannot be emptied.';
  if (isAuthor) {
    for (const wording of before) {
      if (!after.has(wording)) return 'An edit must keep every earlier wording on the record.';
    }
    if (bodyOf(doc) !== bodyOf(prior) && prior.deleted === true) return 'A removed message cannot be edited.';
  } else {
    for (const wording of after) {
      if (!before.has(wording)) return 'Only the author can change what a message says.';
    }
    if (!same(doc.subject, prior.subject)) return 'Only the author can change what a message says.';
    if (doc.deleted === true && prior.deleted !== true) return 'Only the author can remove a message.';
  }
  return null;
}
