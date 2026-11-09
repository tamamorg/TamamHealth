/**
 * @jest-environment node
 *
 * Front-desk registration read-back: three defects found in the 2026-11-08 sweep.
 *  - the review showed the coverage slug ("out-of-pocket"), not the label;
 *  - the rail's action stack was a <div>, which the slider action-bar kit
 *    (.tm-slider div:has(> .btn-primary):has(> .btn-secondary):last-child)
 *    grabbed on the read-back, squeezing it into one-letter-wide columns;
 *  - "+ Add another contact" went blue-on-blue on hover.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildReviewGroups } from '@/components/patients/registration/review-groups';

const read = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');

describe('registration read-back polish', () => {
  it('shows the coverage label, not the stored slug', () => {
    const t = (k: string) => (k === 'patientNew.coverageOutOfPocket' ? 'Out of Pocket' : k);
    const groups = buildReviewGroups(['a', 'b', 'c', 'd', 'e'], {
      form: { payorCoverageType: 'out-of-pocket' }, additionalNok: [], fingerprintCount: 0,
    }, t);
    const row = groups[4].rows.find(([l]) => l === 'patientNew.coverageTypeLabel');
    expect(row?.[1]).toBe('Out of Pocket');
  });

  it('keeps the rail actions out of the slider action-bar selector', () => {
    for (const f of [
      'components/patients/registration/PatientRegistrationForm.tsx',
      'components/nurse/triage/TriageRail.tsx',
    ]) {
      const src = read(f);
      expect(src).toContain('<footer className="tamam-reg-railactions">');
      expect(src).not.toContain('<div className="tamam-reg-railactions">');
    }
  });

  it('forces white type on the hovered secondary button inside the form', () => {
    const css = read('app/globals.css');
    const m = css.match(/\.tamam-reg \.tamam-reg-fields \.btn-secondary:hover \{[^}]*\}/);
    expect(m?.[0]).toMatch(/color:\s*#fff\s*!important/);
  });

  it('keeps the form from roles that may not create a patient', () => {
    const src = read('components/patients/registration/PatientRegistrationForm.tsx');
    expect(src).toContain('DOC_WRITE_ROLES.patient');
    expect(src).toContain('if (!mayRegister) return null;');
  });

  it('shows the facility name, and keeps the years unit off the stepper', () => {
    const src = read('app/(dashboard)/patients/page.tsx');
    expect(src).toContain('hospitalNameById');
    expect(src).toContain('insetInlineEnd: 84');
  });

  it('does not warn about the patient this form just registered', () => {
    const src = read('components/patients/registration/PatientRegistrationForm.tsx');
    expect(src).toContain('setRegisteredId(result._id)');
    expect(src).toContain('m.patient._id !== registeredId');
  });

  it('explains a dimmed Start visit button when payment is missing', () => {
    const src = read('components/ehr/chart/panels/StartVisitPanel.tsx');
    expect(src).toMatch(/!visitBillingComplete\(billing\)[\s\S]{0,300}startVisit\.billingIncomplete/);
  });
});
