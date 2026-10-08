/**
 * What may change in a message once it is sent — the rule the sync gateway
 * applies against the server's own copy, and the same rule compiled into the
 * CouchDB validator.
 *
 * Before this, any staff account could rewrite the body, the author or the
 * timestamp of any message by pushing a new revision. The cases below are the
 * ones that matter: the forgeries that must be refused, and — just as
 * important — the ordinary writes that must NOT be (a read receipt from a
 * device that has not seen an edit yet is a replication race, not an attack).
 */
import { messageIntegrityViolation } from '@/lib/sync/message-integrity';
import { ORG_SCOPED_VALIDATE_FN } from '@/lib/sync/validate-doc-update';
import { buildPushFilter } from '@/lib/sync/sync-service';

const AUTHOR = 'user-ana';
const OTHER = 'user-ben';

const sent = {
  _id: 'msg-1', type: 'message', orgId: 'org-a', conversationId: 'conv-1',
  fromDoctorId: AUTHOR, fromDoctorName: 'Dr. Ana', sentAt: '2026-10-08T09:00:00.000Z',
  createdAt: '2026-10-08T09:00:00.000Z', direction: 'staff_to_staff', recipientType: 'staff',
  patientId: '', channel: 'app', subject: '', body: 'Give 500 mg', readBy: [AUTHOR],
};
const edited = { ...sent, body: 'Give 1 g', editedAt: '2026-10-08T09:05:00.000Z', editHistory: [{ body: 'Give 500 mg', at: sent.sentAt }] };

type ValidateFn = (next: object, prev: object | null, ctx: { roles: string[] }) => void;
const validate = new Function(`return (${ORG_SCOPED_VALIDATE_FN});`)() as ValidateFn;
const ctx = (userId: string) => ({ roles: ['org:org-a', 'role:doctor', `user:${userId}`] });
function validatorRefuses(next: object, prev: object, userId: string): boolean {
  try { validate(next, prev, ctx(userId)); return false; } catch (error) { return !!(error as { forbidden?: string }).forbidden; }
}

/** Both layers must agree on every case. */
function refused(next: object, prev: object, userId: string): boolean {
  const gateway = messageIntegrityViolation(next, prev, userId) !== null;
  expect(validatorRefuses(next, prev, userId)).toBe(gateway);
  return gateway;
}

describe('ordinary writes are allowed', () => {
  test('a read receipt, a reaction and a sync stamp from someone else', () => {
    expect(refused({ ...sent, readBy: [AUTHOR, OTHER] }, sent, OTHER)).toBe(false);
    expect(refused({ ...sent, reactions: [{ emoji: '👍', userId: OTHER }] }, sent, OTHER)).toBe(false);
    expect(refused({ ...sent, offlineSync: { status: 'synced' }, updatedAt: 'later' }, sent, OTHER)).toBe(false);
  });

  test('the author editing, with the earlier wording kept', () => {
    expect(refused(edited, sent, AUTHOR)).toBe(false);
  });

  test('two offline edits arriving as one write', () => {
    const twice = { ...edited, body: 'Give 1 g QID', editHistory: [...edited.editHistory, { body: 'Give 1 g', at: 'x' }] };
    expect(refused(twice, sent, AUTHOR)).toBe(false);
  });

  test('the author retracting, content intact', () => {
    expect(refused({ ...sent, deleted: true, deletedById: AUTHOR }, sent, AUTHOR)).toBe(false);
  });

  test('a read receipt from a device that has not seen the edit yet', () => {
    // Ben's revision still carries the old wording; the server already has the new one.
    expect(refused({ ...sent, readBy: [AUTHOR, OTHER] }, edited, OTHER)).toBe(false);
  });
});

describe('forgeries are refused', () => {
  test('someone else rewriting the text', () => {
    expect(refused({ ...sent, body: 'Give 5 g' }, sent, OTHER)).toBe(true);
  });

  test('someone else rewriting the text and tucking the original into history', () => {
    const forged = { ...sent, body: 'Give 5 g', editHistory: [{ body: 'Give 500 mg', at: 'x' }] };
    expect(refused(forged, sent, OTHER)).toBe(true);
  });

  test('changing who said it, or when', () => {
    expect(refused({ ...sent, fromDoctorId: OTHER }, sent, OTHER)).toBe(true);
    expect(refused({ ...sent, fromDoctorName: 'Dr. Someone Else' }, sent, AUTHOR)).toBe(true);
    expect(refused({ ...sent, sentAt: '2026-10-01T00:00:00.000Z' }, sent, AUTHOR)).toBe(true);
    expect(refused({ ...sent, conversationId: 'conv-2' }, sent, AUTHOR)).toBe(true);
  });

  test('an edit that drops the earlier wording', () => {
    expect(refused({ ...sent, body: 'Give 1 g' }, sent, AUTHOR)).toBe(true);
    expect(refused({ ...edited, body: 'Give 2 g', editHistory: [{ body: 'Give 1 g', at: 'x' }] }, edited, AUTHOR)).toBe(true);
  });

  test('emptying a message — by anyone, including the old "delete" that blanked it', () => {
    expect(refused({ ...sent, body: '', deleted: true }, sent, AUTHOR)).toBe(true);
    expect(refused({ ...sent, body: '' }, sent, OTHER)).toBe(true);
  });

  test('someone else retracting it', () => {
    expect(refused({ ...sent, deleted: true, deletedById: OTHER }, sent, OTHER)).toBe(true);
  });
});

describe('gateway-only rules', () => {
  test('a chat message can only be created as yourself', () => {
    expect(messageIntegrityViolation(sent, null, OTHER)).toMatch(/as yourself/);
    expect(messageIntegrityViolation(sent, null, AUTHOR)).toBeNull();
  });

  test('system notices and patient messages carry no personal authorship to forge', () => {
    const notice = { ...sent, conversationId: undefined, fromDoctorId: 'system', patientId: 'pat-1' };
    expect(messageIntegrityViolation(notice, null, OTHER)).toBeNull();
  });

  test('a seeded demo may create messages for its fictional authors, and nothing more', () => {
    const demo = { allowForeignAuthorOnCreate: true };
    expect(messageIntegrityViolation(sent, null, OTHER, demo)).toBeNull();
    expect(messageIntegrityViolation({ ...sent, body: 'forged' }, sent, OTHER, demo)).not.toBeNull();
  });

  test('attachments cannot be swapped', () => {
    const withFile = { ...sent, attachments: [{ name: 'xray.png', sizeBytes: 100 }] };
    expect(messageIntegrityViolation({ ...withFile, attachments: [{ name: 'other.png', sizeBytes: 100 }] }, withFile, AUTHOR))
      .toMatch(/attachments/);
    expect(messageIntegrityViolation({ ...withFile, attachments: [] }, withFile, AUTHOR)).toMatch(/attachments/);
  });

  test('a removed message cannot be edited afterwards', () => {
    const removed = { ...sent, deleted: true };
    const reworded = { ...removed, body: 'new', editHistory: [{ body: 'Give 500 mg', at: 'x' }] };
    expect(messageIntegrityViolation(reworded, removed, AUTHOR)).toMatch(/removed message/);
  });
});

describe('the validator without a user claim', () => {
  test('fails closed: nobody is treated as the author', () => {
    const anonymous = { roles: ['org:org-a', 'role:doctor'] };
    expect(() => validate(edited, sent, anonymous)).toThrow();
    expect(() => validate({ ...sent, readBy: [AUTHOR, OTHER] }, sent, anonymous)).not.toThrow();
  });
});

describe('push filter: staff chat is offered only by the people it belongs to', () => {
  const filter = buildPushFilter('doctor', { orgId: 'org-a', facilityIds: [], allFacilities: true }, false, OTHER);

  test('a conversation this user is not in is not offered', () => {
    expect(filter({ _id: 'c1', type: 'conversation', orgId: 'org-a', participantIds: [AUTHOR, 'user-cat'] })).toBe(false);
    expect(filter({ _id: 'c2', type: 'conversation', orgId: 'org-a', participantIds: [AUTHOR, OTHER] })).toBe(true);
  });

  test('someone else’s untouched chat message is left to its author; one this user touched is theirs to push', () => {
    expect(filter({ ...sent, _rev: '1-abc' })).toBe(false);
    expect(filter({ ...sent, _rev: '2-abc', readBy: [AUTHOR, OTHER] })).toBe(true);
    expect(filter({ ...sent, _rev: '1-abc', fromDoctorId: OTHER })).toBe(true);
  });

  test('patient messages are unaffected', () => {
    expect(filter({ _id: 'm9', _rev: '1-a', type: 'message', orgId: 'org-a', patientId: 'pat-1', fromDoctorId: 'system' })).toBe(true);
  });
});
