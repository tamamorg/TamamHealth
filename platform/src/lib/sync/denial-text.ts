/**
 * The sentence to show when the server refuses a synced record.
 *
 * CouchDB's validator and the sync gateway explain a refusal for a developer
 * ("role lab_tech may not amend providerId on appointment", "orgId mismatch:
 * doc=org-a user=org-b"). That reason is kept on the denial for logs and
 * support; the screen gets one of these keys instead. Only the
 * message-integrity rules, which the validator words for the person editing a
 * message, pass through unchanged — other validator reasons can look like
 * sentences ("Invalid handoff tasks") without being written for a user.
 */

const DENIAL_KINDS: Array<[RegExp, string]> = [
  [/orgId (is required|mismatch)/i, 'connectivity.denial.otherOrganization'],
  [/facility mismatch/i, 'connectivity.denial.otherFacility'],
  [/no role claim/i, 'connectivity.denial.noRole'],
  [/may not move an appointment/i, 'connectivity.denial.visitStatus'],
  [/may not (amend|remove)\b/i, 'connectivity.denial.field'],
  [/may not (write|delete) documents|may create .+ only when|unknown document type/i, 'connectivity.denial.recordType'],
  [/append-only|retained record|immutable|cannot be (modified|deleted|changed|removed)/i, 'connectivity.denial.locked'],
];

/** Validator reasons written for the person at the screen (message-integrity.ts). */
const USER_WORDED = /^(The \w+ of a message cannot be changed|A message cannot be emptied|An edit must keep every earlier wording|Only the author can|An audit entry cannot be written)/;

/** An i18n key for `reason`, or `null` when the reason is fit to show as is. */
export function denialMessageKey(reason: string): string | null {
  for (const [pattern, key] of DENIAL_KINDS) if (pattern.test(reason)) return key;
  return USER_WORDED.test(reason) ? null : 'connectivity.denial.generic';
}
