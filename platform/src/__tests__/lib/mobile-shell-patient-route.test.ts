/**
 * On a phone, /patients/<id> (the rooming screen's Triage, notification links)
 * rendered the patient LIST and dropped the form. A patient's own page is a
 * real page like registration; only /patients itself is the list tab.
 */
import { tabForPathname } from '@/lib/mobile-shell/use-mobile-shell-state';

describe('tabForPathname', () => {
  it('keeps the patient list on /patients', () => {
    expect(tabForPathname('/patients')).toBe('patients');
  });
  it('renders a patient page and registration as real pages', () => {
    expect(tabForPathname('/patients/pat-123')).toBeNull();
    expect(tabForPathname('/patients/new')).toBeNull();
  });
  it('leaves the other tabs alone', () => {
    expect(tabForPathname('/dashboard/front-desk')).toBe('dashboard');
    expect(tabForPathname('/appointments')).toBe('calendar');
    expect(tabForPathname('/messages')).toBe('inbox');
  });
});
