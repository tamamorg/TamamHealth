/**
 * The password rules — the half that has no database.
 *
 * These exist because the platform previously stated its password minimum in
 * five separate files as the literal `8`, while /admin/security displayed a
 * configured minimum of 12 that nothing read. The rules now live in one
 * module; this pins the behaviour that module is responsible for.
 */
import {
  screenPassword, assertPasswordAcceptable, PasswordPolicyError,
  ABSOLUTE_MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH, DEFAULT_MIN_PASSWORD_LENGTH,
} from '@/modules/identity/policy/password-policy';

const ok = 'correct horse battery staple';

describe('length', () => {
  it('enforces the deployment minimum', () => {
    expect(screenPassword({ password: 'shortish', minLength: 12 })).toMatch(/at least 12/);
    expect(screenPassword({ password: 'a-long-enough-one', minLength: 12 })).toBeNull();
  });

  it('never drops below the absolute floor, whatever the policy says', () => {
    // An operator typing 4 into the security console must not be able to
    // weaken every account in the platform from a number field.
    const problem = screenPassword({ password: 'abc', minLength: 4 });
    expect(problem).toMatch(new RegExp(`at least ${ABSOLUTE_MIN_PASSWORD_LENGTH}`));
  });

  it('falls back to the documented default for a nonsense policy value', () => {
    const problem = screenPassword({ password: 'x'.repeat(9), minLength: Number.NaN });
    expect(problem).toMatch(new RegExp(`at least ${DEFAULT_MIN_PASSWORD_LENGTH}`));
  });

  it('rejects anything past bcrypt\'s usable input length', () => {
    // Beyond this bcrypt silently ignores the tail, so a longer passphrase
    // would be no stronger while appearing much stronger.
    expect(screenPassword({ password: 'a1B'.repeat(40), minLength: 12 }))
      .toMatch(new RegExp(`${MAX_PASSWORD_LENGTH} characters or fewer`));
  });
});

describe('what it refuses', () => {
  it('refuses the passwords everyone tries first', () => {
    for (const bad of ['Password123', 'password', 'letmein!', 'Superadmin1', 'tamamhealth1']) {
      expect(screenPassword({ password: bad.padEnd(12, '!'), minLength: 12 })).not.toBeNull();
    }
  });

  it('refuses the local vocabulary as well as the global list', () => {
    // A blocklist that only knows "qwerty" is no use where the first guess is
    // the name of the hospital.
    expect(screenPassword({ password: 'jubateaching', minLength: 12 })).toBeNull();
    expect(screenPassword({ password: 'hospital2026', minLength: 12 })).not.toBeNull();
    expect(screenPassword({ password: 'nurse1234567', minLength: 12 })).not.toBeNull();
  });

  it('refuses a password built from the account\'s own identifiers', () => {
    const problem = screenPassword({
      password: 'nyaboth-2026-x',
      minLength: 12,
      identifiers: ['mary.nyaboth', 'Mary Nyaboth', 'mary@example.org'],
    });
    expect(problem).toMatch(/your name, username or email/);
  });

  it('ignores identifier fragments too short to be distinctive', () => {
    // Refusing every password containing "bol" would reject a great many
    // perfectly good ones.
    expect(screenPassword({
      password: 'symphony-parachute',
      minLength: 12,
      identifiers: ['bol', 'a'],
    })).toBeNull();
  });

  it('refuses repetition and straight runs', () => {
    expect(screenPassword({ password: 'aaaaaaaaaaaa', minLength: 12 })).toMatch(/same character/);
    expect(screenPassword({ password: 'abcdefghijkl', minLength: 12 })).toMatch(/straight run/);
    expect(screenPassword({ password: 'zyxwvutsrqpo', minLength: 12 })).toMatch(/straight run/);
    // …but a run that turns back on itself is not a run, and must pass.
    expect(screenPassword({ password: '987654321098', minLength: 12 })).toBeNull();
  });

  it('refuses edge whitespace', () => {
    expect(screenPassword({ password: ` ${ok}`, minLength: 12 })).toMatch(/start or end with spaces/);
  });
});

describe('what it deliberately does NOT do', () => {
  it('imposes no character-class rules', () => {
    // NIST SP 800-63B-4 prohibits mandating mixed case / digits / symbols
    // rather than merely discouraging it. A long all-lowercase passphrase is
    // exactly what the guidance wants people to choose.
    expect(screenPassword({ password: 'the quiet ward at midnight', minLength: 15 })).toBeNull();
  });

  it('accepts spaces inside the password', () => {
    expect(screenPassword({ password: ok, minLength: 12 })).toBeNull();
  });
});

describe('the throwing form', () => {
  it('raises a typed error the API layer can recognise', () => {
    // Recognised by TYPE rather than by matching the message, so rewording an
    // error can never turn a 400 into a 500.
    expect(() => assertPasswordAcceptable({ password: 'short', minLength: 12 }))
      .toThrow(PasswordPolicyError);
    expect(() => assertPasswordAcceptable({ password: ok, minLength: 12 })).not.toThrow();
  });
});
