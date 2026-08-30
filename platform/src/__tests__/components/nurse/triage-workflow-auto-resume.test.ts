/**
 * W1 (audit) — the DUPLICATE_ACTIVE_TRIAGE retry in `handleSubmitTriage`
 * (TriageWorkflow.tsx) used to auto-resume onto whatever record the error
 * named, with no check of what that record actually was. `createTriage`'s
 * `resumePendingId` path skips the duplicate guard entirely and
 * `updateTriage` lets a `seen -> seen` write through with no guard of its
 * own, so retrying onto another station's already-completed ETAT (or, on a
 * multi-org replica, a same-id record from a different tenant) silently
 * overwrote it.
 *
 * `mayAutoResume` is the guard the retry now runs before resuming: only an
 * unassessed placeholder — `status === 'pending'` and/or
 * `assessmentSource === 'clerical_checkin'` (the walk-in check-in record,
 * KAN-100) — may be resumed. Anything else, most importantly a completed
 * `seen` clinician assessment, must fall through to the "refresh, don't
 * overwrite" path instead.
 */
import { mayAutoResume } from '@/components/nurse/TriageWorkflow';
import type { TriageDoc } from '@/lib/db-types';

type Existing = Pick<TriageDoc, 'status' | 'assessmentSource'>;

function record(overrides: Partial<Existing>): Existing {
  return { status: 'pending', assessmentSource: undefined, ...overrides };
}

describe('mayAutoResume', () => {
  it('allows resuming a pending clerical placeholder', () => {
    expect(mayAutoResume(record({ status: 'pending', assessmentSource: 'clerical_checkin' }))).toBe(true);
  });

  it('allows resuming a pending record even without an explicit assessmentSource', () => {
    expect(mayAutoResume(record({ status: 'pending', assessmentSource: undefined }))).toBe(true);
  });

  it('allows resuming a clerical_checkin record even if status has drifted off pending', () => {
    // Defense in depth: the placeholder is identified by EITHER signal, since
    // status and assessmentSource are meant to agree but nothing enforces
    // that they always do.
    expect(mayAutoResume(record({ status: 'seen', assessmentSource: 'clerical_checkin' }))).toBe(true);
  });

  it('refuses a completed clinician assessment', () => {
    expect(mayAutoResume(record({ status: 'seen', assessmentSource: 'clinician' }))).toBe(false);
  });

  it('refuses a seen record with no recorded assessment source', () => {
    expect(mayAutoResume(record({ status: 'seen', assessmentSource: undefined }))).toBe(false);
  });

  it('refuses a terminal (already-closed) record', () => {
    expect(mayAutoResume(record({ status: 'discharged', assessmentSource: 'clinician' }))).toBe(false);
  });

  it('refuses when no existing record was found', () => {
    expect(mayAutoResume(undefined)).toBe(false);
    expect(mayAutoResume(null)).toBe(false);
  });
});
