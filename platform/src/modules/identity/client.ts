/**
 * Identity — the half of the module a browser may import.
 *
 * ## Why there are two barrels
 *
 * `index.ts` is the server surface. It reaches sessions, tokens, CSRF, the
 * users database and `node:crypto`. A client component that imported it would
 * pull all of that into the browser bundle — at best bloating it, at worst
 * failing the build on a `node:` specifier.
 *
 * A single barrel with careful tree-shaking is not a safe answer to that: it
 * works until someone adds one server import to a file the barrel re-exports,
 * and then it fails somewhere far away with a message about `node:crypto`.
 * Two explicit surfaces make the boundary a decision rather than a property of
 * the bundler on a given day.
 *
 * ## The rule
 *
 * Everything re-exported here must be safe in a browser: pure logic, React
 * components, and hooks. Nothing that touches a database, a cookie, a secret
 * or a Node built-in. If a symbol cannot honestly appear on this list, the
 * client does not get it — it asks the server through an API route instead,
 * which is the correct shape for anything that needed a secret in the first
 * place.
 *
 * Server code may import from here too; `index.ts` does not re-export it only
 * to keep one obvious answer to "where does this symbol come from".
 */

// ── Pure policy the UI has to agree with ────────────────────────────────────
// A form that validates differently from the server is a form that lies. These
// are the exact rules the API applies, so a dialog can say what will happen.
export {
  screenPassword, PasswordPolicyError,
  ABSOLUTE_MIN_PASSWORD_LENGTH, DEFAULT_MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH, PORTAL_MIN_PASSWORD_LENGTH,
  type PasswordScreenInput,
} from './policy/password-policy';
export {
  ROLES_WITHOUT_FACILITY, ROLES_WITHOUT_ORGANIZATION, PLATFORM_ONLY_ASSIGNABLE_ROLES,
  isPlatformOnlyRole, roleNeedsFacility, roleNeedsOrganization, validateUserScope,
  ORG_REQUIRED_MESSAGE, FACILITY_REQUIRED_MESSAGE,
} from './policy/user-scope-rules';
export { STAFF_DIRECTORY_READ_ROLES, canReadStaffDirectory } from './policy/staff-directory-access';

// ── Invitation state, without the token ─────────────────────────────────────
// `invite-window` is the crypto-free half of the invitation: how long one
// lasts and where its link points. The token itself lives in `user-invite.ts`
// and never comes near this file.
export {
  INVITE_TTL_HOURS, isInviteExpired, buildAppUrl, buildInviteUrl,
  type InvitationOutcome,
} from './provisioning/invite-window';
export {
  describeAccountState, canResendInvite, DORMANT_AFTER_DAYS,
  type AccountState, type AccountStateKind,
} from './provisioning/account-state';
export { describeInvitationOutcome, type InvitationCopy } from './provisioning/invitation-copy';

// ── Credential generation that is meant to happen in the browser ────────────
// The temporary password is generated where the administrator can see it, from
// Web Crypto. It is the one credential this module deliberately creates
// client-side, because the whole point is that a human reads it out.
export {
  generateTempPassword, tempPasswordLengthFor, TEMP_PASSWORD_LENGTH,
} from './provisioning/temp-password';
export {
  parseUserImport, splitCsvLine, resolveRole, usernameFromName,
  normaliseImportUsername, IMPORT_TEMPLATE_CSV, MAX_IMPORT_ROWS,
  type ImportRow, type ParsedImport, type ParseOptions,
} from './provisioning/bulk-user-import';
export {
  validateOrgAdminForm, buildOrgAdminUserPayload, emptyOrgAdminForm,
  ORG_ADMIN_MIN_PASSWORD_LENGTH,
  type OrgAdminFormData, type OrgAdminFormErrorCode, type OrgAdminUserPayload,
} from './provisioning/org-admin-provisioning';

// ── Session primitives that genuinely work in a browser ─────────────────────
//
// `jose` and `bcryptjs` both run client-side, and the offline sign-in path
// needs them there: with no network, the browser verifies a cached credential
// and mints its own short-lived token. That is a deliberate capability of an
// offline-first platform, not a leak.
//
// What must NEVER appear here is anything that reads the filesystem or the
// database. `seed-credentials.ts` uses `node:fs`, so it is reachable only from
// the server barrel — and when `context.tsx` briefly imported `createToken`
// from that barrel instead, the root page's client bundle tried to resolve
// `node:fs` and the build failed. This section exists so the browser can have
// the two primitives it legitimately needs without that.
export { createToken, verifyToken, pwdAtClaim, type VerifiedTokenPayload } from './core/auth-token';
export { hashPassword, verifyPassword } from './core/auth';
export { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from './core/csrf';
export {
  cacheOfflineCredential, verifyOfflineCredential, clearOfflineCredential,
} from './core/offline-credential';

// ── Hooks ───────────────────────────────────────────────────────────────────
export { usePasswordPolicy } from './hooks/usePasswordPolicy';

// ── The screens this domain owns ────────────────────────────────────────────
// Named rather than default so the barrel reads as one vocabulary, and so a
// consumer's import line says which module the component came from.
export { default as ForcePasswordChange } from './components/ForcePasswordChange';
export { default as CreateUserModal, type CreatedCredentials } from './components/CreateUserModal';
export { default as CredentialHandoffModal, formatCredentialHandoffText } from './components/CredentialHandoffModal';
export { default as BulkUserImportModal } from './components/BulkUserImportModal';
