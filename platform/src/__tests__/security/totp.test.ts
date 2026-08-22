/** @jest-environment node */
/**
 * TOTP — the second factor.
 *
 * `lib/totp.ts` arrived with no tests. A second factor is the one place where
 * a silent implementation bug is worst in both directions: get it slightly
 * wrong and either nobody can log in, or the code that should be rejected is
 * accepted. Neither shows up as an exception.
 *
 * So this checks against the published vectors rather than against itself.
 * RFC 4226 Appendix D fixes the HOTP output for the ASCII secret
 * "12345678901234567890" at counters 0-9; any implementation that produces
 * different digits is wrong, no matter how self-consistent it looks. The same
 * secret is the RFC 6238 (TOTP) test key, since TOTP is HOTP over a counter
 * derived from the clock.
 *
 * These vectors also pin the byte handling specifically. The file was rewritten
 * from Node `Buffer` to `Uint8Array` to satisfy @types/node's invariant
 * `Uint8Array<ArrayBuffer>`; that touched the big-endian counter packing and
 * the base32 decode, which is exactly the kind of change that keeps
 * typechecking while producing different digits.
 */
import {
  base32Encode, base32Decode, totpCodeForStep, totpStep,
  generateTotpSecret, TOTP_STEP_SECONDS,
} from '@/lib/totp';

/** RFC 4226 Appendix D: ASCII "12345678901234567890", base32-encoded. */
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

const RFC_4226_VECTORS: [number, string][] = [
  [0, '755224'], [1, '287082'], [2, '359152'], [3, '969429'], [4, '338314'],
  [5, '254676'], [6, '287922'], [7, '162583'], [8, '399871'], [9, '520489'],
];

describe('RFC 4226 test vectors', () => {
  it.each(RFC_4226_VECTORS)('counter %i produces %s', (counter, expected) => {
    expect(totpCodeForStep(RFC_SECRET, counter)).toBe(expected);
  });

  it('produces six digits, zero-padded', () => {
    // Vector 4 (338314) and others can start with a digit that a naive
    // Number->String would keep, but a truncated value below 100000 must still
    // render six characters.
    for (const [counter] of RFC_4226_VECTORS) {
      expect(totpCodeForStep(RFC_SECRET, counter)).toMatch(/^\d{6}$/);
    }
  });
});

describe('base32 round-trips', () => {
  it('decodes the RFC secret back to its ASCII bytes', () => {
    expect(Buffer.from(base32Decode(RFC_SECRET)).toString('utf8'))
      .toBe('12345678901234567890');
  });

  it('re-encodes to the same string', () => {
    expect(base32Encode(base32Decode(RFC_SECRET))).toBe(RFC_SECRET);
  });

  it('accepts the spacing and case an app produces on paste', () => {
    const spaced = 'gezd gnbv gy3t qojq-GEZDGNBVGY3TQOJQ';
    expect(totpCodeForStep(spaced, 0)).toBe('755224');
  });

  it('refuses a secret with a character outside the alphabet', () => {
    // '1' and '8' are not in RFC 4648 base32 — a typo must fail loudly rather
    // than decode to different bytes and reject every code the user enters.
    expect(() => base32Decode('GEZDGNBV1')).toThrow(/base32/i);
  });

  it('returns bytes, not a string, so the HMAC keys on the right thing', () => {
    const decoded = base32Decode(RFC_SECRET);
    expect(decoded).toBeInstanceOf(Uint8Array);
    expect(decoded).toHaveLength(20);
  });
});

describe('the generated secret', () => {
  it('is 20 bytes, the size RFC 4226 specifies for HMAC-SHA1', () => {
    expect(base32Decode(generateTotpSecret())).toHaveLength(20);
  });

  it('is different every time', () => {
    const secrets = new Set(Array.from({ length: 20 }, () => generateTotpSecret()));
    expect(secrets.size).toBe(20);
  });

  it('is usable as a secret immediately', () => {
    expect(totpCodeForStep(generateTotpSecret(), 0)).toMatch(/^\d{6}$/);
  });
});

describe('the counter derived from the clock', () => {
  it('advances once per step interval', () => {
    const base = 1_700_000_000_000;
    expect(totpStep(base + TOTP_STEP_SECONDS * 1000) - totpStep(base)).toBe(1);
  });

  it('does not advance within one interval', () => {
    // Anchored to a step boundary. An arbitrary timestamp sits mid-interval,
    // so "+29s" legitimately crosses into the next step and would make this
    // assert the opposite of what it means to.
    const boundary = 56_666_667 * TOTP_STEP_SECONDS * 1000;
    expect(totpStep(boundary)).toBe(totpStep(boundary + (TOTP_STEP_SECONDS - 1) * 1000));
    expect(totpStep(boundary + TOTP_STEP_SECONDS * 1000)).toBe(totpStep(boundary) + 1);
  });

  it('packs a counter above 2^32 without wrapping', () => {
    // The counter is written as two big-endian 32-bit halves rather than a
    // BigInt. If the high half were dropped, these two steps — which differ
    // only above the 32-bit boundary — would produce the same code.
    const low = 7;
    const high = 0x100000000 + 7;
    expect(totpCodeForStep(RFC_SECRET, low))
      .not.toBe(totpCodeForStep(RFC_SECRET, high));
    expect(totpCodeForStep(RFC_SECRET, low)).toBe('162583');
  });
});
