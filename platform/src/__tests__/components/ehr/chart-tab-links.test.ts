/**
 * Links into the patient chart land where they say: label-style `?tab=`
 * values resolve, moving between sections keeps the worklist `returnTo`, and
 * a link the viewer's role would be bounced from is recognised as such.
 */
import {
  allowedChartTabIds,
  chartHrefOpensForViewer,
  chartTabHref,
  resolveChartTab,
} from '@/lib/chart-tabs';

describe('resolveChartTab label aliases', () => {
  it.each([
    ['results', 'labs'],
    ['conditions', 'problems'],
    ['visits', 'history'],
    ['careplan', 'careChecklist'],
    ['medications', 'prescriptions'],
  ])('%s opens %s', (alias, tab) => {
    expect(resolveChartTab(alias)).toBe(tab);
  });

  it('still refuses values that are not sections', () => {
    expect(resolveChartTab('nonsense')).toBeNull();
  });
});

describe('chartTabHref', () => {
  it('keeps returnTo so Back still reaches the worklist after a tab change', () => {
    expect(chartTabHref('/patients/pat-1', 'labs', '/front-desk')).toBe('/patients/pat-1?tab=labs&returnTo=%2Ffront-desk');
  });

  it('omits returnTo when the chart was not opened from a worklist', () => {
    expect(chartTabHref('/patients/pat-1', 'vitals')).toBe('/patients/pat-1?tab=vitals');
  });
});

describe('chartHrefOpensForViewer', () => {
  const desk = allowedChartTabIds({ canViewClinical: false, canEnterLabResults: false, canDispense: false, role: 'front_desk' });

  it('rejects a clinical section for the front desk', () => {
    expect(chartHrefOpensForViewer('/patients/pat-1?tab=prescriptions', desk)).toBe(false);
    expect(chartHrefOpensForViewer('/patients/pat-1?tab=labs&focus=lab-1', desk)).toBe(false);
  });

  it('accepts the sections the front desk works in', () => {
    expect(chartHrefOpensForViewer('/patients/pat-1?tab=billing', desk)).toBe(true);
    expect(chartHrefOpensForViewer('/patients/pat-1', desk)).toBe(true);
  });

  it('accepts everything for a clinician and does not judge non-chart links', () => {
    expect(chartHrefOpensForViewer('/patients/pat-1?tab=labs', null)).toBe(true);
    expect(chartHrefOpensForViewer('/pharmacy', desk)).toBe(true);
  });
});
