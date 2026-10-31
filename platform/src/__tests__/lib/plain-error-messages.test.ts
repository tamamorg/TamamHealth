/**
 * Internal codes and identifiers never reach the screen: coded errors (with or
 * without appended detail) map to a sentence, sync refusals are explained in
 * plain words, and roles show their on-screen names.
 */
import { CODE_MESSAGES, SESSION_MESSAGE, describeApiError, describeError } from '@/lib/user-facing-error';
import { denialMessageKey } from '@/lib/sync/denial-text';
import { roleLabel } from '@/lib/role-display';
import { humanizeRole } from '@/lib/appointment-staff';

describe('coded errors', () => {
  it('map every post-consult, insurance and checkout code to a sentence', () => {
    for (const code of ['CHECKOUT_BLOCKED', 'DISCHARGE_FORBIDDEN', 'HANDOFF_PLAN_CHANGED', 'INSURANCE_OVERPAYMENT_REVIEW', 'AMBIGUOUS_NOTE_ENCOUNTER']) {
      const text = describeError(new Error(code), 'fallback');
      expect(text).toBe(CODE_MESSAGES[code]);
      expect(text).not.toMatch(/[A-Z]{2,}_[A-Z]/);
    }
  });

  it('read the code at the head of a message that carries detail', () => {
    expect(describeError(new Error('CHECKOUT_BLOCKED: rx_dispensed, notes_signed'), 'fallback')).toBe(CODE_MESSAGES.CHECKOUT_BLOCKED);
    expect(describeApiError({ error: 'CHECKOUT_BLOCKED: rx_dispensed' }, 'fallback')).toBe(CODE_MESSAGES.CHECKOUT_BLOCKED);
  });

  it('treat a missing session scope as an ended session', () => {
    expect(describeError(new Error('NO_SCOPE'), 'fallback')).toBe(SESSION_MESSAGE);
  });

  it('keep the fallback for unknown codes', () => {
    expect(describeError(new Error('SOME_NEW_CODE'), 'Not saved. Try again.')).toBe('Not saved. Try again.');
  });
});

describe('sync refusals', () => {
  it.each([
    ['orgId mismatch: doc=org-a user=org-b', 'connectivity.denial.otherOrganization'],
    ['facility mismatch: doc=h-1 user=h-2', 'connectivity.denial.otherFacility'],
    ['role lab_tech may not move an appointment from cancelled to in_progress', 'connectivity.denial.visitStatus'],
    ['role nurse may not amend providerId on appointment', 'connectivity.denial.field'],
    ['role cashier may not write documents of type prescription', 'connectivity.denial.recordType'],
    ['audit_log is append-only; an existing entry cannot be modified', 'connectivity.denial.locked'],
    ['no role claim on the CouchDB user; cannot write patient', 'connectivity.denial.noRole'],
    ['Invalid handoff tasks', 'connectivity.denial.generic'],
  ])('explain %s', (reason, key) => {
    expect(denialMessageKey(reason)).toBe(key);
  });

  it('pass a reason through when it is already a sentence for the user', () => {
    expect(denialMessageKey('Only the author can remove a message')).toBeNull();
  });
});

describe('role names', () => {
  it('use the on-screen name, not the stored code', () => {
    expect(roleLabel('front_desk')).toBe('Receptionist');
    expect(roleLabel('lab_tech')).not.toMatch(/_/);
    expect(humanizeRole('clinical_officer')).toBe('Clinical Officer');
    expect(roleLabel('some_future_role')).toBe('Some future role');
    expect(roleLabel(undefined)).toBe('');
  });
});
