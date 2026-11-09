/**
 * @jest-environment node
 *
 * Round 2b sweep fixes: messages i18n, ward admit notice, registration toast,
 * facility name limit.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import en from '@/lib/i18n/locales/en';
import apd from '@/lib/i18n/locales/apd';
import { validateFacilityForm, FACILITY_NAME_MAX, type FacilityFormValues } from '@/lib/facility-form';

const read = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');

describe('/messages has no hardcoded English', () => {
  const src = read('app/(dashboard)/messages/page.tsx');
  it.each(['Pin to top', 'Unpin', 'Show original', 'Hide original', 'kept on record', 'removed this message', 'Show earlier versions'])(
    'does not inline "%s"', phrase => {
      expect(src).not.toContain(`'${phrase}'`);
      expect(src).not.toContain(`${phrase}\``);
    },
  );
  it('every msgs.* key it uses exists in en and apd', () => {
    const keys = [...src.matchAll(/'(msgs\.[A-Za-z]+)'/g)].map(m => m[1]);
    for (const p of ['msgs.presenceActive', 'msgs.presenceOnCall', 'msgs.presenceInClinic']) keys.push(p);
    expect(keys.length).toBeGreaterThan(15);
    for (const k of keys) {
      expect((en as Record<string, string>)[k]).toBeTruthy();
      expect((apd as Record<string, string>)[k]).toBeTruthy();
    }
  });
});

describe('ward admit notice', () => {
  it('does not mention an Unspecified tick the form does not have', () => {
    expect(read('components/wards/WardAdmitForm.tsx')).toContain('o3form.missingRequiredNoUnspecified');
    expect((en as Record<string, string>)['o3form.missingRequiredNoUnspecified']).not.toMatch(/Unspecified/);
    expect((en as Record<string, string>)['o3form.missingRequired']).toMatch(/Unspecified/);
  });
});

describe('registration required-fields toast', () => {
  it('is dismissed when validation passes', () => {
    const src = read('components/patients/registration/PatientRegistrationForm.tsx');
    expect(src).toContain('requiredToastId.current = showToast(');
    expect(src).toContain('dismissToast?.(requiredToastId.current)');
  });
});

describe('facility name length', () => {
  const base = {
    name: 'Juba Teaching Hospital', state: 'Central Equatoria', town: 'Juba', facilityType: 'state_hospital',
    totalBeds: 10, icuBeds: 0, maternityBeds: 0, pediatricBeds: 0,
    doctors: 0, clinicalOfficers: 0, nurses: 0, labTechnicians: 0, pharmacists: 0,
    lat: 0, lng: 0, phone: '', email: '',
  } as unknown as FacilityFormValues;
  it('accepts the maximum and refuses one more', () => {
    expect(validateFacilityForm({ ...base, name: 'A'.repeat(FACILITY_NAME_MAX) })).toBeNull();
    expect(validateFacilityForm({ ...base, name: 'A'.repeat(FACILITY_NAME_MAX + 1) })).toBe('name-too-long');
  });
});
