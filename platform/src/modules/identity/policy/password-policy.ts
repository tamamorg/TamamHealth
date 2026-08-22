/**
 * The password rules, stated once.
 *
 * Before this module the minimum length was the literal `8`, written out
 * independently in `user-service`, `/api/auth/change-password`,
 * `/api/auth/accept-invite`, `ForcePasswordChange` and `CreateUserModal` —
 * while `/admin/security` displayed a `passwordMinLength` policy of 12 that
 * nothing read. Five copies of one number and a sixth that was decorative.
 *
 * The shape of the rules follows NIST SP 800-63B-4 (finalised 2025):
 *
 *   - Length and screening carry the weight. A blocklist of known-bad and
 *     context-derived passwords stops far more real attacks than a rule that
 *     demands a digit and a capital, which mostly produces `Password1!`.
 *   - NO composition rules. Rev 4 prohibits mandating character classes
 *     rather than merely discouraging it, so this module deliberately does
 *     not check for mixed case, digits or symbols, and nothing should add it.
 *   - Long passwords and spaces are accepted, and nothing here blocks paste —
 *     password managers are the point.
 *   - No periodic expiry. A change is forced only when an administrator
 *     issued the credential, which is the one case Rev 4 still endorses.
 *
 * `MAX_PASSWORD_LENGTH` is 64 because that is the figure Rev 4 names, and it
 * also keeps every accepted password inside bcrypt's 72-BYTE input limit for
 * ASCII input. Beyond that limit bcrypt silently ignores the tail, so a
 * 200-character passphrase would be no stronger than its first 72 bytes while
 * appearing much stronger. Rejecting is honest; truncating is not.
 *
 * No database or Next imports: this is read by API routes, by the node-side
 * service layer, and by client components alike. The POLICY (which minimum
 * this deployment runs) lives in `password-policy-server.ts`, because reading
 * it needs the platform config database.
 */

/**
 * The floor a deployment cannot go below, whatever the platform policy says.
 * An operator who types `4` into the security console must not be able to
 * weaken every account in the platform from a text field.
 */
export const ABSOLUTE_MIN_PASSWORD_LENGTH = 8;

/** The default minimum when no platform policy has been configured. */
export const DEFAULT_MIN_PASSWORD_LENGTH = 12;

/** See the note above on bcrypt's 72-byte input limit. */
export const MAX_PASSWORD_LENGTH = 64;

/**
 * The floor for a PATIENT's portal password, which is lower than staff.
 *
 * A staff account can read every chart in the facility; a portal account reads
 * exactly one, its owner's. The portal also carries a real second factor (SMS
 * OTP), and NIST SP 800-63B-4 puts the 8-character floor precisely at
 * "password plus a second factor". Holding patients to the staff minimum would
 * mostly succeed in excluding the older ones this is hardest to reach.
 *
 * Lives here rather than in `patient-portal-enrolment.ts` because the
 * activation PAGE needs it, and that service reaches the patients database —
 * importing it into a client component would drag PouchDB and `node:crypto`
 * into the browser bundle.
 */
export const PORTAL_MIN_PASSWORD_LENGTH = 8;

/**
 * Passwords that are refused outright.
 *
 * Two groups: the credentials that top every breach-corpus ranking, and the
 * words this deployment's own users reach for first — the product name, the
 * country, the city, the job titles. A blocklist does not need to be
 * exhaustive to work; it needs to cover what someone would try before a rate
 * limiter stops them, and the local vocabulary is a large part of that here.
 *
 * Compared after normalisation (lower-cased, leading/trailing space removed,
 * and with trailing digits stripped) so `Password123` and `tamam2026` are
 * caught by their stems rather than needing an entry each.
 */
const BLOCKED_STEMS: readonly string[] = [
  // Breach-corpus perennials
  'password', 'passw0rd', 'pass', 'qwerty', 'qwertyuiop', 'azerty', 'letmein',
  'welcome', 'monkey', 'dragon', 'sunshine', 'princess', 'football', 'baseball',
  'iloveyou', 'trustno', 'master', 'shadow', 'superman', 'batman', 'access',
  'flower', 'hottie', 'loveme', 'zaq', 'qazwsx', 'starwars', 'whatever',
  'freedom', 'ninja', 'mustang', 'jordan', 'harley', 'ranger', 'hunter',
  'buster', 'soccer', 'killer', 'jennifer', 'michael', 'charlie', 'thomas',
  'robert', 'daniel', 'george', 'joshua', 'andrew', 'matthew', 'computer',
  'internet', 'samsung', 'google', 'facebook', 'whatsapp', 'secret', 'changeme',
  'default', 'temp', 'temporary', 'test', 'testing', 'guest', 'user', 'login',
  'abc', 'abcd', 'abcdef', 'abcdefg', 'asdf', 'asdfgh', 'zxcvbn', 'qweasd',
  'iloveu', 'lovely', 'nothing', 'password1', 'p@ssword', 'p@ssw0rd',

  // Administrative vocabulary — the first thing someone types when told to
  // "just set something for now".
  'admin', 'administrator', 'superadmin', 'sysadmin', 'root', 'manager',
  'supervisor', 'operator', 'orgadmin',

  // This platform, and the setting it runs in.
  'tamam', 'tamamhealth', 'tamamhealthcare', 'health', 'healthcare', 'hospital',
  'hospitals', 'clinic', 'clinical', 'medical', 'medicine', 'patient',
  'patients', 'record', 'records', 'juba', 'wau', 'malakal', 'bentiu',
  'sudan', 'southsudan', 'ssudan', 'moh', 'ministry', 'mercy',

  // Job titles — a role is the most guessable thing about a staff account.
  'doctor', 'doctors', 'nurse', 'nurses', 'midwife', 'pharmacy', 'pharmacist',
  'lab', 'labtech', 'laboratory', 'reception', 'frontdesk', 'cashier',
  'clerk', 'biller', 'billing', 'radiology', 'radiologist', 'nutrition',
];

/** Normalise for blocklist comparison — see the note on BLOCKED_STEMS. */
function stem(value: string): string {
  return value
    .trim()
    .toLowerCase()
    // Strip a trailing run of digits and punctuation ("password123!" → "password").
    .replace(/[0-9!@#$%^&*_.\-+=]+$/, '');
}

/** True when every character is the same one ("aaaaaaaaaaaa"). */
function isSingleCharacter(value: string): boolean {
  return value.length > 0 && new Set(value).size === 1;
}

/**
 * True for a straight run up or down the keyboard row or the alphabet, of at
 * least 6 characters — "123456789", "abcdefgh", "987654321".
 */
function isSequential(value: string): boolean {
  const lower = value.toLowerCase();
  if (lower.length < 6) return false;
  let ascending = true;
  let descending = true;
  for (let i = 1; i < lower.length; i++) {
    const delta = lower.charCodeAt(i) - lower.charCodeAt(i - 1);
    if (delta !== 1) ascending = false;
    if (delta !== -1) descending = false;
    if (!ascending && !descending) return false;
  }
  return ascending || descending;
}

/**
 * True when the password is built out of the account's own identifiers.
 *
 * Checked in both directions: `mary.nyaboth` as a password, and `nyaboth2026`
 * for the account `mary.nyaboth`. Identifier fragments under 4 characters are
 * ignored — refusing every password containing "bol" would reject a great
 * many perfectly good ones.
 */
function derivedFromIdentity(password: string, identifiers: readonly string[]): boolean {
  const lower = password.toLowerCase();
  for (const raw of identifiers) {
    if (!raw) continue;
    for (const part of raw.toLowerCase().split(/[^a-z0-9]+/)) {
      if (part.length < 4) continue;
      if (lower.includes(part)) return true;
    }
  }
  return false;
}

export interface PasswordScreenInput {
  /** The candidate password, exactly as the user typed it. */
  password: string;
  /** The minimum this deployment enforces — from the platform policy. */
  minLength: number;
  /**
   * Username, display name, email — anything the account is publicly known
   * by. A password built from them is guessable by anyone holding the staff
   * directory, which every colleague does.
   */
  identifiers?: readonly string[];
}

/**
 * Screen a candidate password. Returns the message to show the user, or null
 * when it is acceptable.
 *
 * Every message says what is wrong AND what to do instead: the person is
 * choosing a password, often on a shared clinic machine with someone waiting,
 * and "invalid password" sends them round the loop guessing.
 */
export function screenPassword(input: PasswordScreenInput): string | null {
  const { password, identifiers = [] } = input;
  const minLength = Math.max(ABSOLUTE_MIN_PASSWORD_LENGTH, Math.trunc(input.minLength) || DEFAULT_MIN_PASSWORD_LENGTH);

  if (password !== password.trim()) {
    return 'Password cannot start or end with spaces.';
  }
  if (password.length < minLength) {
    return `Password must be at least ${minLength} characters. A short phrase you will remember is stronger than a short word.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password must be ${MAX_PASSWORD_LENGTH} characters or fewer.`;
  }
  if (isSingleCharacter(password)) {
    return 'Password cannot be the same character repeated. Use a phrase instead.';
  }
  if (isSequential(password)) {
    return 'Password cannot be a straight run of letters or numbers. Use a phrase instead.';
  }
  if (BLOCKED_STEMS.includes(stem(password))) {
    return 'That password is one of the most commonly used ones, so it is among the first an attacker tries. Choose something else.';
  }
  if (derivedFromIdentity(password, identifiers)) {
    return 'Password cannot contain your name, username or email — anyone with the staff list could guess it.';
  }
  return null;
}

/**
 * A rejected password, as an error the API layer can recognise by type.
 *
 * `POST /api/users` used to sort validation throws from genuine faults by
 * matching `/^Password/i` on the message, which quietly made the copy part of
 * the control flow: rewording an error to read better would have turned a 400
 * into a 500. The type carries that meaning now, and the wording is free.
 */
export class PasswordPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PasswordPolicyError';
  }
}

/** Throwing form, for the service layer. */
export function assertPasswordAcceptable(input: PasswordScreenInput): void {
  const problem = screenPassword(input);
  if (problem) throw new PasswordPolicyError(problem);
}
