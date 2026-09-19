/**
 * "Hide patient identifiers on shared screens" (`security.mask`).
 *
 * The switch saved and loaded correctly while masking almost nothing: the
 * phone helper had four callers, the address helper had none, and the patient
 * list, the find-patient picker, the inquiries worklist and the lab order
 * strip all printed the full value. Two halves are pinned here — that the
 * formatters obey the switch, and that every shared surface still routes
 * through them, so dropping a consumer fails here rather than in a waiting room.
 */
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  initRoleSettings,
  clearRoleSettings,
  setRoleSettings,
  roleSettingDefaults,
} from '@/lib/settings/role-settings-store';
import {
  formatPhoneDisplay,
  formatPhoneShared,
  formatAddressShared,
  formatLocationShared,
} from '@/lib/field-formats';

const USER_ID = 'user-mask-1';
const PHONE = '+211912345678';

beforeEach(() => {
  window.localStorage.clear();
  clearRoleSettings();
});

describe('shared-screen formatters', () => {
  it('show the full value while the switch is off', () => {
    initRoleSettings(USER_ID, 'doctor');
    setRoleSettings({ 'security.mask': false });
    expect(formatPhoneShared(PHONE)).toBe('+211 912 345 678');
    expect(formatAddressShared('Plot 14, Hai Malakal')).toBe('Plot 14, Hai Malakal');
    expect(formatLocationShared(['Juba', 'Central Equatoria'])).toBe('Juba, Central Equatoria');
  });

  it('mask phone, address and location once it is on', () => {
    initRoleSettings(USER_ID, 'doctor');
    setRoleSettings({ 'security.mask': true });
    // The last two digits survive so staff can confirm the right patient.
    expect(formatPhoneShared(PHONE)).toBe('••• ••• 78');
    expect(formatAddressShared('Plot 14, Hai Malakal')).toBe('Address hidden');
    expect(formatLocationShared(['Juba', 'Central Equatoria'])).toBe('Location hidden');
  });

  it('follow the switch live, without a re-init', () => {
    initRoleSettings(USER_ID, 'doctor');
    setRoleSettings({ 'security.mask': true });
    expect(formatPhoneShared(PHONE)).toBe('••• ••• 78');
    setRoleSettings({ 'security.mask': false });
    expect(formatPhoneShared(PHONE)).toBe('+211 912 345 678');
  });

  it('never invent a value: empty in, empty out, masked or not', () => {
    initRoleSettings(USER_ID, 'doctor');
    setRoleSettings({ 'security.mask': true });
    expect(formatPhoneShared('')).toBe('');
    expect(formatPhoneShared(undefined)).toBe('');
    expect(formatAddressShared('   ')).toBe('');
    // A caller's `|| 'Location unknown'` fallback must still win over the mask.
    expect(formatLocationShared([undefined, ''])).toBe('');
  });

  it('leave the chart formatter alone — the clinician still has to dial', () => {
    initRoleSettings(USER_ID, 'doctor');
    setRoleSettings({ 'security.mask': true });
    expect(formatPhoneDisplay(PHONE)).toBe('+211 912 345 678');
  });

  it('apply the role default before the user has touched the switch', () => {
    // Front desk works a counter facing the waiting room: masked by default.
    expect(roleSettingDefaults('front_desk')['security.mask']).toBe(true);
    initRoleSettings(USER_ID, 'front_desk');
    expect(formatPhoneShared(PHONE)).toBe('••• ••• 78');
  });
});

describe('shared surfaces route through the mask', () => {
  const read = (rel: string) => readFileSync(path.join(process.cwd(), 'src', rel), 'utf8');

  const PHONE_SURFACES = [
    'components/ehr/EhrTopRail.tsx',
    'components/ehr/EhrClinicalDashboard.tsx',
    'components/lab/order/LabOrderPatientStrip.tsx',
    'app/(dashboard)/dashboard/front-desk/page.tsx',
    'app/(dashboard)/inquiries/page.tsx',
    'app/(dashboard)/referrals/page.tsx',
  ];
  const LOCATION_SURFACES = [
    'app/(dashboard)/patients/page.tsx',
    'app/(dashboard)/dashboard/front-desk/page.tsx',
    'app/(dashboard)/referrals/page.tsx',
  ];

  it.each(PHONE_SURFACES)('%s formats phone with formatPhoneShared', (file) => {
    expect(read(file)).toContain('formatPhoneShared(');
  });

  it.each(LOCATION_SURFACES)('%s formats location with formatLocationShared', (file) => {
    expect(read(file)).toContain('formatLocationShared(');
  });

  it.each([...new Set([...PHONE_SURFACES, ...LOCATION_SURFACES])])(
    '%s subscribes to the switch so a change applies without a navigation',
    (file) => {
      expect(read(file)).toContain('useSharedScreenMask(');
    },
  );

  it.each(PHONE_SURFACES)('%s renders no bare phone value', (file) => {
    // `{x.phone || '—'}` / `x.phone].filter(` is the unmasked shape this fix removed.
    // `${x.phone || ''}` is left alone: that is a search haystack, matched
    // against what the user typed and never painted.
    const source = read(file);
    expect(source).not.toMatch(/(?<!\$)\{\s*\w+\.(?:phone|patientPhone)\s*\|\|\s*['"]/);
    expect(source).not.toMatch(/\.phone\s*\]\s*\.filter\(/);
  });
});
