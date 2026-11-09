/**
 * Chart labels that once rendered raw: the Directives table head printed the
 * key `billing.activityColumn.type` (no entry in either locale) and the
 * Directives tab title printed the entity `&amp;` literally.
 */
import en from '@/lib/i18n/locales/en';
import apd from '@/lib/i18n/locales/apd';

describe('chart labels', () => {
  test('the activity Type column head has a string in both locales', () => {
    expect((en as Record<string, string>)['billing.activityColumn.type']).toBe('Type');
    expect((apd as Record<string, string>)['billing.activityColumn.type']).toBeTruthy();
  });

  test('no English string carries an HTML entity that would print as text', () => {
    const entities = Object.entries(en as Record<string, string>).filter(([, v]) => typeof v === 'string' && /&amp;|&nbsp;|&quot;/.test(v));
    expect(entities).toEqual([]);
  });
});
