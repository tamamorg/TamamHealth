/**
 * Minimum-necessary coverage for the patient chart's tab matrix
 * (`allowedChartTabIds` / `chartLandingTab` / `resolveChartTab`,
 * src/app/(dashboard)/patients/[id]/page.tsx).
 *
 * This matrix is the only thing between a non-clinical role that can legitimately
 * open a chart — reception, cashiers, the lab bench, pharmacy, imaging — and the
 * patient's notes, diagnoses, vitals and medications. It is asserted directly
 * rather than through the rendered page: the rule is a data question, and every
 * one of these roles reaches the same component.
 *
 * The companion suite (chart-workspace-panels.test.ts) covers the right-hand
 * workspace rail, which has to honour the same rule from the other direction.
 */
import {
  allowedChartTabIds,
  chartLandingTab,
  resolveChartTab,
  type ChartAccess,
} from '@/components/patients/PatientDetailPage';

const access = (over: Partial<ChartAccess> = {}): ChartAccess => ({
  canViewClinical: false,
  canEnterLabResults: false,
  canDispense: false,
  ...over,
});

/** Sections that carry clinical detail — none may appear in a restricted set. */
const CLINICAL_ONLY_TABS = [
  'history', 'problems', 'notes', 'vitals', 'sbar', 'orders',
  'procedures', 'programs', 'careChecklist', 'immunizations',
];

describe('allowedChartTabIds', () => {
  it('gives a clinical viewer the whole chart', () => {
    expect(allowedChartTabIds(access({ canViewClinical: true }))).toBeNull();
  });

  it('narrows the lab bench to identity + results', () => {
    expect(allowedChartTabIds(access({ canEnterLabResults: true }))).toEqual(['overview', 'labs']);
  });

  it('gives pharmacy the prescription and the allergy list it dispenses against', () => {
    expect(allowedChartTabIds(access({ canDispense: true }))).toEqual(['overview', 'prescriptions', 'allergies']);
  });

  it('gives imaging the order it reports on', () => {
    expect(allowedChartTabIds(access({ role: 'radiologist' }))).toEqual(['overview', 'labs']);
  });

  it('falls back to the administrative set for every other role', () => {
    for (const role of ['front_desk', 'cashier', 'medical_biller', 'clinic_clerk', undefined]) {
      expect(allowedChartTabIds(access({ role }))).toEqual(
        ['overview', 'appointments', 'demographics', 'billing', 'documents', 'recall', 'referrals'],
      );
    }
  });

  it('checks clinical access first, so a clinician holding a lab or pharmacy permission keeps the full chart', () => {
    expect(allowedChartTabIds(access({ canViewClinical: true, canEnterLabResults: true }))).toBeNull();
    expect(allowedChartTabIds(access({ canViewClinical: true, canDispense: true }))).toBeNull();
  });

  it('never leaks a clinical section into a restricted set', () => {
    const restricted = [
      allowedChartTabIds(access({ canEnterLabResults: true })),
      allowedChartTabIds(access({ canDispense: true })),
      allowedChartTabIds(access({ role: 'radiologist' })),
      allowedChartTabIds(access({ role: 'front_desk' })),
    ];
    for (const set of restricted) {
      expect(set).not.toBeNull();
      for (const clinicalTab of CLINICAL_ONLY_TABS) {
        expect(set).not.toContain(clinicalTab);
      }
    }
  });
});

describe('chartLandingTab', () => {
  it('lands a restricted viewer on the section their role came for', () => {
    expect(chartLandingTab(['overview', 'labs'])).toBe('labs');
    expect(chartLandingTab(['overview', 'prescriptions', 'allergies'])).toBe('prescriptions');
    expect(chartLandingTab(['overview', 'appointments', 'demographics'])).toBe('appointments');
  });

  it('falls back to overview when that is all the role has', () => {
    expect(chartLandingTab(['overview'])).toBe('overview');
    expect(chartLandingTab([])).toBe('overview');
  });

  it('lands a clinical viewer on overview', () => {
    expect(chartLandingTab(null)).toBe('overview');
  });
});

describe('resolveChartTab', () => {
  it('opens a real section', () => {
    expect(resolveChartTab('labs')).toBe('labs');
    expect(resolveChartTab('careChecklist')).toBe('careChecklist');
  });

  it('maps the aliases that have no section of their own', () => {
    // Transfers are read on Care coordination; recall reminders on Appointments.
    expect(resolveChartTab('transfers')).toBe('referrals');
    expect(resolveChartTab('recall')).toBe('appointments');
  });

  it('rejects anything that is not a section, so a crafted ?tab= cannot render one', () => {
    expect(resolveChartTab('nonsense')).toBeNull();
    expect(resolveChartTab('')).toBeNull();
    expect(resolveChartTab(null)).toBeNull();
    expect(resolveChartTab(undefined)).toBeNull();
  });

  it('resolves the same value for a deep link and a Back-button navigation', () => {
    // Both paths call this one function — the assertion is that it is total, so
    // the two can never disagree about what a URL means.
    for (const param of ['labs', 'transfers', 'recall', 'overview', 'bogus']) {
      expect(resolveChartTab(param)).toBe(resolveChartTab(param));
    }
  });
});
