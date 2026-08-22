/**
 * The second factor, at the level where it is pure maths.
 *
 * `lib/totp.ts` is a from-scratch RFC 6238 implementation — chosen over a
 * dependency because a credential primitive is a poor thing to inherit — so
 * the RFC's own behaviour has to be pinned here rather than assumed.
 */
import {
  base32Encode, base32Decode, generateTotpSecret, totpCode, totpCodeForStep,
  totpStep, verifyTotpCode, buildOtpauthUri, formatSecretForDisplay,
  generateRecoveryCodes, hashRecoveryCode, consumeRecoveryCode,
  TOTP_STEP_SECONDS, RECOVERY_CODE_COUNT,
} from '@/modules/identity/mfa/totp';

describe('base32', () => {
  it('round-trips', () => {
    const bytes = Uint8Array.from([0, 1, 2, 250, 255, 128, 64, 32]);
    expect(Array.from(base32Decode(base32Encode(bytes)))).toEqual(Array.from(bytes));
  });

  it('matches the RFC 4648 vectors an authenticator app expects', () => {
    const encode = (text: string) => base32Encode(new TextEncoder().encode(text));
    expect(encode('f')).toBe('MY');
    expect(encode('fo')).toBe('MZXQ');
    expect(encode('foobar')).toBe('MZXW6YTBOI');
  });

  it('forgives the spacing and case a person types', () => {
    const secret = generateTotpSecret();
    const typed = `${formatSecretForDisplay(secret).toLowerCase()}`;
    expect(Array.from(base32Decode(typed))).toEqual(Array.from(base32Decode(secret)));
  });

  it('refuses a secret with characters that are not base32', () => {
    expect(() => base32Decode('ABC1!')).toThrow(/base32/);
  });
});

describe('codes', () => {
  const secret = base32Encode(new TextEncoder().encode('12345678901234567890'));

  it('produces the RFC 6238 reference values for SHA-1', () => {
    // The published test vectors. If this ever fails, every authenticator app
    // in the field has stopped agreeing with us.
    expect(totpCodeForStep(secret, Math.floor(59 / TOTP_STEP_SECONDS))).toBe('287082');
    expect(totpCodeForStep(secret, Math.floor(1111111109 / TOTP_STEP_SECONDS))).toBe('081804');
    expect(totpCodeForStep(secret, Math.floor(1234567890 / TOTP_STEP_SECONDS))).toBe('005924');
  });

  it('is always six digits, zero-padded', () => {
    for (let step = 0; step < 200; step++) {
      expect(totpCodeForStep(secret, step)).toMatch(/^\d{6}$/);
    }
  });

  it('changes every 30 seconds', () => {
    const now = 1_700_000_000_000;
    expect(totpCode(secret, now)).toBe(totpCode(secret, now + 1000));
    expect(totpCode(secret, now)).not.toBe(totpCode(secret, now + 60_000));
  });
});

describe('verification', () => {
  const secret = generateTotpSecret();
  const now = 1_700_000_000_000;

  it('accepts the current code', () => {
    expect(verifyTotpCode(secret, totpCode(secret, now), { now })).toBe(totpStep(now));
  });

  it('tolerates one step of clock drift in each direction', () => {
    // A cheap phone fifteen seconds fast should not be locked out.
    expect(verifyTotpCode(secret, totpCode(secret, now - 30_000), { now })).not.toBeNull();
    expect(verifyTotpCode(secret, totpCode(secret, now + 30_000), { now })).not.toBeNull();
  });

  it('refuses drift beyond the window', () => {
    expect(verifyTotpCode(secret, totpCode(secret, now - 120_000), { now })).toBeNull();
  });

  it('refuses a code that has already been spent', () => {
    // A TOTP code stays valid for its whole window, so without this a code
    // read over someone's shoulder is replayable for the next thirty seconds.
    const step = verifyTotpCode(secret, totpCode(secret, now), { now });
    expect(step).not.toBeNull();
    expect(verifyTotpCode(secret, totpCode(secret, now), { now, lastUsedStep: step! })).toBeNull();
  });

  it('refuses anything that is not six digits', () => {
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 56 78']) {
      expect(verifyTotpCode(secret, bad, { now })).toBeNull();
    }
  });

  it('does not throw on a corrupt stored secret', () => {
    expect(verifyTotpCode('not-base32!!', '123456', { now })).toBeNull();
  });
});

describe('the otpauth URI', () => {
  it('carries everything an authenticator needs to agree with us', () => {
    const uri = buildOtpauthUri('JBSWY3DPEHPK3PXP', 'dr.wani');
    expect(uri).toContain('otpauth://totp/TamamHealth:dr.wani');
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(uri).toContain('algorithm=SHA1');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });

  it('escapes an account name that would break the URI', () => {
    expect(buildOtpauthUri('JBSWY3DPEHPK3PXP', 'a b/c')).toContain('a%20b%2Fc');
  });
});

describe('recovery codes', () => {
  it('issues a full set of distinct codes', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
  });

  it('excludes the characters people misread off paper', () => {
    // These get written down and read back later — 0/O and 1/I/l are exactly
    // the failures that turn a lost phone into a support call.
    for (const code of generateRecoveryCodes()) {
      expect(code.replace('-', '')).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/);
    }
  });

  it('spends a code exactly once', () => {
    const codes = generateRecoveryCodes(3);
    const hashes = codes.map(hashRecoveryCode);
    const remaining = consumeRecoveryCode(codes[1], hashes);
    expect(remaining).toHaveLength(2);
    expect(consumeRecoveryCode(codes[1], remaining!)).toBeNull();
  });

  it('accepts a code typed without its dash or in lower case', () => {
    const [code] = generateRecoveryCodes(1);
    const hashes = [hashRecoveryCode(code)];
    expect(consumeRecoveryCode(code.replace('-', '').toLowerCase(), hashes)).toEqual([]);
  });

  it('refuses a code that was never issued', () => {
    expect(consumeRecoveryCode('AAAAA-BBBBB', generateRecoveryCodes(2).map(hashRecoveryCode)))
      .toBeNull();
  });
});
