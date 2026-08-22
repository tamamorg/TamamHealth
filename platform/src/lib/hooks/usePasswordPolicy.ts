'use client';

/**
 * The password minimum this deployment enforces, for the screens where
 * somebody chooses or generates one.
 *
 * Five separate files carried their own literal `8` while /admin/security
 * displayed a configured minimum of 12 that nothing read. The rules now live
 * in `lib/password-policy.ts` and the deployment's value behind
 * `/api/auth/password-policy`; this hook is how a client component asks.
 *
 * Falls back to the documented default rather than blocking render: a form
 * that cannot load the policy still has to be usable, and the server remains
 * the authority — a stricter real policy corrects the hint on submit.
 */

import { useEffect, useState } from 'react';
import { DEFAULT_MIN_PASSWORD_LENGTH } from '../password-policy';
import { tempPasswordLengthFor } from '../temp-password';

export function usePasswordPolicy(): { minLength: number; tempLength: number } {
  const [minLength, setMinLength] = useState(DEFAULT_MIN_PASSWORD_LENGTH);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/password-policy')
      .then(res => (res.ok ? res.json() : null))
      .then(body => {
        if (!cancelled && typeof body?.minLength === 'number') setMinLength(body.minLength);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  return { minLength, tempLength: tempPasswordLengthFor(minLength) };
}
