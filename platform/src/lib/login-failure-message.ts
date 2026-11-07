import type { LoginFailure } from '@/lib/context/types';

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * Name the actual refusal of a failed sign-in. Every failure used to read
 * "Invalid credentials", so a stopped database or a lockout sent people back to
 * retyping a password that was already correct. Shared by the sign-in form and
 * the lock screen's password unlock so both say the same thing.
 */
export function describeLoginFailure(t: Translate, failure: LoginFailure | null, fallback: string): string {
  if (!failure) return fallback;

  // Codes first. A code is the most specific thing the refusal could tell us,
  // and unlike a status it says *why* rather than merely which layer said no.
  // Two of these never involve the network at all.
  switch (failure.code) {
    // Policy: the password was already verified before these were decided.
    case 'impersonation_disabled': return t('login.errorImpersonationDisabled');
    case 'role_not_permitted': return t('login.errorRoleNotPermitted');
    // Offline: the request never left the device.
    case 'offline_no_credential': return t('login.errorOfflineNoCredential');
    case 'offline_bad_password': return t('login.errorOfflineBadPassword');
    default: break;
  }

  if (failure.status === 429) {
    const minutes = failure.retryAfterSeconds ? Math.ceil(failure.retryAfterSeconds / 60) : 0;
    return minutes > 0
      ? t('login.errorTooManyAttemptsIn', { minutes })
      : t('login.errorTooManyAttempts');
  }
  if (failure.status >= 500) return t('login.errorServiceUnavailable');
  // An unrecognised 403 still beats the credentials message: the server's own
  // prose is at least about the real reason, even if it is untranslated.
  if (failure.status === 403 && failure.message) return failure.message;
  return fallback;
}
