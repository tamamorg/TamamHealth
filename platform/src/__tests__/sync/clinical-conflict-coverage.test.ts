/**
 * @jest-environment node
 *
 * A clinical record two devices can write must not settle its own conflicts.
 *
 * Anything absent from `HIGH_RISK_RESOURCES` takes PouchDB's
 * most-recent-revision-wins default, silently — no queue entry, no admin
 * review, no trace that a revision was discarded. That is the right answer for
 * a preference and the wrong one for a record, and in a platform built to work
 * through outages, two devices writing the same document is the normal case
 * rather than the exotic one.
 *
 * An audit on 2026-08-24 found ten clinical types on the wrong side of that
 * line, including the controlled-substance register. This pins them, and pins
 * the rule that put them there.
 */
import { HIGH_RISK_RESOURCES } from '@/lib/services/conflict-service';

describe('records a human must reconcile', () => {
  /**
   * Named individually rather than derived from the document types, because
   * which records are high-risk is a clinical judgement — not something a
   * glob over `db-types.ts` could ever know.
   */
  const MUST_BE_RECONCILED = [
    // Medication and controlled drugs.
    'prescription', 'medication_administration', 'medication_allergy',
    'controlled_substance_log',
    // Inpatient state — a silently chosen bed claim double-books a bed.
    'bed', 'admission', 'discharge', 'shift_handoff',
    // Clinical decisions.
    'allergy', 'adverse_event', 'lab_result', 'triage', 'clinical_encounter',
    'procedure', 'immunization',
    // Legally reportable vital events.
    'birth', 'death',
    // Identity and the movement of care.
    'patient', 'referral', 'patient_transfer',
  ];

  it.each(MUST_BE_RECONCILED)('%s conflicts are queued, not auto-resolved', type => {
    expect(HIGH_RISK_RESOURCES.has(type)).toBe(true);
  });

  it('covers every type the audit found settling its own conflicts', () => {
    // The ten added in Aug 2026. Listed separately so removing one is a
    // deliberate act with a failing test attached, not a quiet edit.
    const ADDED_AFTER_AUDIT = [
      'controlled_substance_log', 'lab_result', 'birth', 'death',
      'clinical_encounter', 'triage', 'procedure', 'immunization',
      'patient', 'patient_transfer',
    ];
    const missing = ADDED_AFTER_AUDIT.filter(t => !HIGH_RISK_RESOURCES.has(t));
    expect(missing).toEqual([]);
  });

  it('stays a judgement, not a catch-all', () => {
    // If this ever equals "every document type", the queue becomes noise and
    // an administrator stops reading it — which is the same failure as not
    // queueing at all. Preferences, drafts and cache-ish documents belong on
    // the default path.
    for (const notClinical of ['user_prefs', 'onboarding_progress', 'usage_event', 'slot_hold']) {
      expect(HIGH_RISK_RESOURCES.has(notClinical)).toBe(false);
    }
  });
});
