/**
 * Identity — who may sign in, as what, and how they got an account.
 *
 * **This file is the module's entire public surface.** Everything else under
 * `modules/identity/` is private: the lint rules in `eslint.config.mjs` make
 * a deep import an error, so what is re-exported here is a deliberate
 * decision rather than an accident of where a file happens to live. See
 * `docs/adr/0003-domain-modules.md`.
 *
 * What the domain owns:
 *
 *   core/         sessions, tokens, CSRF, the request-time auth guard
 *   policy/       password rules, role/scope rules, who may approve what
 *   provisioning/ invitations, temporary credentials, bulk import
 *   services/     the write paths and their data access
 *   email/        the messages this domain sends
 *   components/   the screens this domain owns
 *
 * Two deliberate omissions, both because a barrel is a bundling decision as
 * well as an API:
 *
 *   - **No client component is exported from a path that also pulls server
 *     code.** `core/*` reaches `node:crypto` and PouchDB. A client component
 *     importing this barrel would drag those into the browser bundle, so the
 *     UI pieces are re-exported here for server/shared callers, and client
 *     components import the module's component files directly — which is why
 *     the lint rule carves out `src/modules/identity/**` from its own
 *     restriction.
 *   - **`services/*` is exported by name, not by `export *`.** These modules
 *     hold the write paths; naming each one keeps a new export from becoming
 *     public simply by existing.
 */

// ── Request-time authentication ─────────────────────────────────────────────
// By far the widest surface: 106 files ask this module "who is calling?".
export {
  getAuthPayload, unauthorized, forbidden, hasRole, validationError,
  serverError, sanitizeError, logApiError,
  type AuthPayload,
} from './core/api-auth';

// ── Sessions and tokens ─────────────────────────────────────────────────────
export {
  createToken, verifyToken, pwdAtClaim,
  type VerifiedTokenPayload,
} from './core/auth-token';
export { hashPassword, verifyPassword, bcryptCost } from './core/auth';
export {
  applySessionCookies, SESSION_COOKIE_NAME,
  SESSION_TTL_SEC, SESSION_RENEW_AFTER_SEC,
} from './core/session';
export { mintCsrfToken, verifyCsrfToken, CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from './core/csrf';
export { isTokenRevoked, revokeToken } from './core/token-blacklist';
export {
  authenticateUser, isStandaloneDemo, UsersDbUnavailableError, type ServerUser,
} from './core/server-users';
export {
  issueSessionResponse, resolveEffectiveIdentity, ROLES_WITHOUT_HOSPITAL,
  type EffectiveIdentity, type RolePickerResult,
} from './core/login-session';
export {
  cacheOfflineCredential, verifyOfflineCredential, clearOfflineCredential,
} from './core/offline-credential';
export {
  getOrCreateSeedCredentials, getSeedPasswordFor, deleteSeedCredentialsFile,
  DEMO_USER_PROFILES, type SeedUserProfile,
} from './core/seed-credentials';

// ── Policy ──────────────────────────────────────────────────────────────────
export {
  screenPassword, assertPasswordAcceptable, PasswordPolicyError,
  ABSOLUTE_MIN_PASSWORD_LENGTH, DEFAULT_MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH, PORTAL_MIN_PASSWORD_LENGTH,
  type PasswordScreenInput,
} from './policy/password-policy';
export {
  getMinPasswordLength, screenPasswordForDeployment, assertPasswordForDeployment,
  _resetPasswordPolicyCache,
} from './policy/password-policy-server';
export {
  ROLES_WITHOUT_FACILITY, ROLES_WITHOUT_ORGANIZATION, PLATFORM_ONLY_ASSIGNABLE_ROLES,
  isPlatformOnlyRole, roleNeedsFacility, roleNeedsOrganization, validateUserScope,
  ORG_REQUIRED_MESSAGE, FACILITY_REQUIRED_MESSAGE,
} from './policy/user-scope-rules';
export { STAFF_DIRECTORY_READ_ROLES, canReadStaffDirectory } from './policy/staff-directory-access';
export {
  PLATFORM_APPROVAL_ROLES, REQUESTABLE_ROLES, ROLES_REQUIRING_REGISTRATION,
  ACCOUNT_REQUEST_ROLES_WITHOUT_FACILITY, IDENTITY_ATTESTATION_METHODS,
  isRequestableRole, approverTierFor, accountRequestRoleNeedsFacility,
  accountRequestFacilityMatchesOrg, roleRequiresRegistrationNumber, isValidAttestation,
} from './policy/account-request-roles';

// ── Provisioning ────────────────────────────────────────────────────────────
export {
  issueInvite, hashInviteToken, inviteHashMatches, isInviteExpired,
  buildAppUrl, buildInviteUrl, INVITE_TTL_HOURS,
  type IssuedInvite, type InvitationOutcome,
} from './provisioning/user-invite';
export { generateTempPassword, tempPasswordLengthFor, TEMP_PASSWORD_LENGTH } from './provisioning/temp-password';
export {
  describeAccountState, canResendInvite, DORMANT_AFTER_DAYS,
  type AccountState, type AccountStateKind,
} from './provisioning/account-state';
export { describeInvitationOutcome, type InvitationCopy } from './provisioning/invitation-copy';
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

// ── Services are NOT re-exported here, and that is the point ────────────────
//
// They reach the database. Re-exporting them from this barrel would make every
// file that wants `getAuthPayload` eagerly load PouchDB and the whole write
// layer at module-init time — which is precisely why this codebase already
// reaches for services with `await import(...)` inside the function that needs
// them, keeping route cold-start light.
//
// Putting them here broke that in a way a type-check cannot see: a route that
// statically imported this barrel pulled `user-service` into its module graph
// before its first request, and a test that mocked `user-service` found the
// factory running before its own `const` had initialised.
//
// So services are a second, named entrypoint tier:
//
//     import { createUser } from '@/modules/identity/services/user-service';
//     const { createUser } = await import('@/modules/identity/services/user-service');
//
// The lint rules allow `@/modules/identity/services/*` for exactly this reason
// and block every other deep path. `core/`, `policy/`, `provisioning/`
// and `email/` stay private behind this file.

// ── Email this domain sends ─────────────────────────────────────────────────
export { sendWelcomeEmail, renderWelcomeEmail, type WelcomeEmailInput } from './email/user-welcome';
export { sendPasswordResetEmail, renderPasswordResetEmail, type PasswordResetEmailInput } from './email/password-reset';
export {
  sendAccountRequestVerifyEmail, renderAccountRequestVerifyEmail, type AccountRequestVerifyInput,
} from './email/account-request-verify';
export {
  sendAccountRequestAlertEmail, renderAccountRequestAlertEmail, type AccountRequestAlertInput,
} from './email/account-request-alert';
