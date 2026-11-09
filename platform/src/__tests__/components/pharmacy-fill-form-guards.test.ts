/**
 * The pharmacy fill form: out of stock says so plainly (no partial-fill picker
 * that cannot help), the quantity cannot exceed what is left of the course, a
 * second visit after a partial fill defaults to the balance, and the slider
 * keeps no draft (two scripts for one medicine and patient share a title).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import en from '@/lib/i18n/locales/en';
import apd from '@/lib/i18n/locales/apd';
import { remainingOnCourse } from '@/components/pharmacy/workflow/pharmacy-workflow-types';

const read = (path: string) => readFileSync(join(process.cwd(), 'src', path), 'utf8');
const panel = read('components/pharmacy/workflow/PharmacyWorkflowPanel.tsx');
const hook = read('components/pharmacy/workflow/usePharmacyWorkflow.ts');

describe('pharmacy fill form guards', () => {
  it('blocks the fill and names the drug when nothing is on the shelf', () => {
    expect(hook).toContain('const outOfStock = !stock.loading && stock.plan !== null && stock.plan.available <= 0');
    expect(panel).toContain("t('rxFlow.errNotInStock', { medication: rx.medication })");
    expect(panel).toContain('ctrl.outOfStock ||');
    expect((en as Record<string, string>)['rxFlow.errNotInStock']).toMatch(/is not currently in stock/);
    expect((en as Record<string, string>)['rxFlow.errNotInStock']).not.toMatch(/must be reviewed and cleared/);
  });

  it('shows a dispensed or empty stock figure as 0, not a dash', () => {
    expect(panel).toContain("String(ctrl.stock.plan?.available ?? 0)");
  });

  it('caps the quantity at what is left of the course and defaults to the balance', () => {
    expect(hook).toContain('const remaining = remainingOnCourse(rx)');
    expect(hook).toContain("if (dispenseDraft.quantity > remaining) throw dispenseStop(t('rxFlow.errOverCourse', { remaining }))");
    expect(panel).toContain('draft.quantity > ctrl.remaining');
  });

  it('has the over-course message in both locales', () => {
    expect((en as Record<string, string>)['rxFlow.errOverCourse']).toContain('{{remaining}}');
    expect((apd as Record<string, string>)['rxFlow.errOverCourse']).toContain('{{remaining}}');
  });

  it('keeps no unsaved draft on the dispense slider', () => {
    expect(read('components/pharmacy/workflow/DispenseSlider.tsx')).toContain('keepDraft={false}');
    expect(read('components/overlay/FormSlider.tsx')).toContain('keepDraft={keepDraft}');
  });

  // Review 2026-11-08: an older script with no stated course read as a course
  // of 1, so the guard blocked any real fill the server would have accepted.
  it('owes the balance of a stated course, and sets no ceiling on a script without one', () => {
    expect(remainingOnCourse({ quantityToDispense: 21, quantityDispensed: 10 })).toBe(11);
    expect(remainingOnCourse({ quantityToDispense: 21, quantityDispensed: 21 })).toBe(0);
    expect(remainingOnCourse({ quantityToDispense: 21 })).toBe(21);
    expect(remainingOnCourse({})).toBe(Number.POSITIVE_INFINITY);
    expect(remainingOnCourse({ quantityToDispense: 0 })).toBe(Number.POSITIVE_INFINITY);
  });
});
