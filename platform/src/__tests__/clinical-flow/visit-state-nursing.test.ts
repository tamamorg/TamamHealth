/**
 * Signing the note moves the encounter to ready-for-checkout, but checkout
 * stays blocked while post-consultation nursing is open. Every board reads the
 * stage through resolveOperationalVisitState, so the rule lives there — the
 * desk said "Post-consultation nursing" while the doctor's board said "Ready
 * for clinic checkout" for the same visit (2026-10-29).
 */
import { resolveOperationalVisitState } from '@/lib/clinical-flow/visit-state';

const ready = { status: 'ready_for_clinic_checkout' } as const;

test('a ready-for-checkout visit with nursing open reads as post-consultation nursing', () => {
  const state = resolveOperationalVisitState({ status: 'in_progress' }, ready, { nursingReviewOpen: true });
  expect(state.label).toBe('Post-consultation nursing');
  expect(state.i18nKey).toBe('postConsult.title');
});

test('without open nursing it is ready for checkout', () => {
  expect(resolveOperationalVisitState({ status: 'in_progress' }, ready).label).toBe('Ready for clinic checkout');
});

test('open nursing does not relabel a visit that is still with the clinician', () => {
  const state = resolveOperationalVisitState({ status: 'in_progress' }, { status: 'with_clinician' }, { nursingReviewOpen: true });
  expect(state.label).not.toBe('Post-consultation nursing');
});
