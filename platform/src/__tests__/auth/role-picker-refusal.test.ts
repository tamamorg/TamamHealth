/**
 * @jest-environment node
 *
 * A refused role pick has to say why.
 *
 * By the time `resolveEffectiveIdentity` runs, the password has already been
 * verified — so every refusal it returns is a statement about platform policy,
 * never about credentials. The sign-in form did not know that: it translated
 * anything that was not a 429 or a 5xx into "Invalid credentials. Please try
 * again.", so a super-admin blocked by the impersonation switch was told to
 * retype a password that was already correct, with nothing on screen naming
 * the setting that actually stopped them.
 *
 * The fix is a stable `code` on the refusal. `error` stays for API clients with
 * no locale, but prose is not something a translated UI can match on — these
 * tests pin the codes, and pin that both locales can render each one.
 */
import { resolveEffectiveIdentity } from '@/modules/identity/core/login-session';
import type { ServerUser } from '@/modules/identity/core/server-users';
import en from '@/lib/i18n/locales/en';
import apd from '@/lib/i18n/locales/apd';

jest.mock('@/lib/services/platform-config-service', () => ({
  getPlatformConfig: jest.fn(),
}));
jest.mock('@/lib/services/hospital-service', () => ({
  getHospitalById: jest.fn(),
}));

const { getPlatformConfig } = jest.requireMock('@/lib/services/platform-config-service');
const { getHospitalById } = jest.requireMock('@/lib/services/hospital-service');

const asUser = (over: Partial<ServerUser> = {}): ServerUser => ({
  _id: 'user-superadmin',
  username: 'superadmin',
  name: 'TamamHealth Platform Admin',
  role: 'super_admin',
  ...over,
} as ServerUser);

const impersonation = (enabled: boolean) =>
  getPlatformConfig.mockResolvedValue({ superAdminPolicies: { impersonationEnabled: enabled } });

beforeEach(() => {
  jest.clearAllMocks();
  getHospitalById.mockResolvedValue(null);
});

describe('signing in as your own role', () => {
  it('is never a role pick, so policy is not consulted at all', async () => {
    const result = await resolveEffectiveIdentity(asUser({ role: 'doctor' }), 'doctor');
    expect(result.ok).toBe(true);
    expect(getPlatformConfig).not.toHaveBeenCalled();
  });

  it('is the same when no role is requested', async () => {
    const result = await resolveEffectiveIdentity(asUser({ role: 'doctor' }), undefined);
    expect(result.ok).toBe(true);
  });

  it('hydrates a legacy session facility name before the first authenticated render', async () => {
    getHospitalById.mockResolvedValue({ _id: 'hospital-1', name: 'Juba Teaching Hospital' });
    const result = await resolveEffectiveIdentity(asUser({
      role: 'nurse', hospitalId: 'hospital-1', hospitalName: undefined,
    }), undefined);
    expect(result).toMatchObject({
      ok: true,
      effective: { role: 'nurse', hospitalId: 'hospital-1', hospitalName: 'Juba Teaching Hospital' },
    });
  });
});

describe('a refusal names its reason', () => {
  it('tells a non-super-admin it may only use its assigned role', async () => {
    impersonation(true);
    const result = await resolveEffectiveIdentity(asUser({ role: 'nurse' }), 'doctor');
    expect(result).toMatchObject({ ok: false, code: 'role_not_permitted', status: 403 });
  });

  it('tells a super-admin that the impersonation switch is off', async () => {
    impersonation(false);
    const result = await resolveEffectiveIdentity(asUser(), 'doctor');
    expect(result).toMatchObject({ ok: false, code: 'impersonation_disabled', status: 403 });
  });

  it('lets a super-admin through once the switch is on', async () => {
    impersonation(true);
    const result = await resolveEffectiveIdentity(asUser(), 'doctor');
    expect(result.ok).toBe(true);
  });

  it('never refuses without a code — a bare 403 is what forced the wrong message', async () => {
    impersonation(false);
    for (const [user, role] of [[asUser(), 'doctor'], [asUser({ role: 'nurse' }), 'doctor']] as const) {
      const result = await resolveEffectiveIdentity(user, role);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(typeof result.code).toBe('string');
    }
  });
});

describe('every refusal code is something the form can say', () => {
  // The point of a code is that the browser phrases the message itself. A code
  // with no key in both locales silently falls back to the server's English
  // prose, which is the half-translated state `npm run i18n:check` exists to
  // stop and cannot see here.
  const KEYS = {
    role_not_permitted: 'login.errorRoleNotPermitted',
    impersonation_disabled: 'login.errorImpersonationDisabled',
  } as const;

  it.each(Object.entries(KEYS))('%s renders in both locales', (_code, key) => {
    expect((en as Record<string, string>)[key]).toBeTruthy();
    expect((apd as Record<string, string>)[key]).toBeTruthy();
  });
});
