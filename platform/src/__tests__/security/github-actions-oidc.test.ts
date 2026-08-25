/** @jest-environment node */

jest.mock('server-only', () => ({}));

import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
} from 'jose';
import {
  REMINDER_DISPATCH_OIDC_AUDIENCE,
  REMINDER_DISPATCH_WORKFLOW_REF,
  TRANSFER_SWEEP_OIDC_AUDIENCE,
  TRANSFER_SWEEP_REPOSITORY,
  TRANSFER_SWEEP_WORKFLOW_REF,
  verifyReminderDispatchOidcToken,
  verifyTransferSweepOidcToken,
} from '@/lib/github-actions-oidc';

async function signedToken(overrides: Record<string, unknown> = {}, audience = TRANSFER_SWEEP_OIDC_AUDIENCE) {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test-key';
  const getKey = createLocalJWKSet({ keys: [jwk] });
  const claims = {
    repository: TRANSFER_SWEEP_REPOSITORY,
    workflow_ref: TRANSFER_SWEEP_WORKFLOW_REF,
    ref: 'refs/heads/main',
    ref_type: 'branch',
    runner_environment: 'github-hosted',
    event_name: 'schedule',
    ...overrides,
  };
  const { sub, ...rest } = claims as Record<string, unknown> & { sub?: string };
  const token = await new SignJWT(rest)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer('https://token.actions.githubusercontent.com')
    .setAudience(audience)
    .setSubject(sub ?? `repo:${TRANSFER_SWEEP_REPOSITORY}:ref:refs/heads/main`)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
  return { token, getKey };
}

test('accepts the scheduled transfer workflow on main', async () => {
  const { token, getKey } = await signedToken();
  await expect(verifyTransferSweepOidcToken(token, getKey)).resolves.toBe(true);
});

test.each([
  { workflow_ref: `${TRANSFER_SWEEP_REPOSITORY}/.github/workflows/other.yml@refs/heads/main` },
  { ref: 'refs/heads/feature' },
  { event_name: 'pull_request' },
  { runner_environment: 'self-hosted' },
])('rejects an OIDC token outside the exact cron identity: %o', async override => {
  const { token, getKey } = await signedToken(override);
  await expect(verifyTransferSweepOidcToken(token, getKey)).resolves.toBe(false);
});

/* The subject GitHub actually issues for this repository. Owner and repo carry
   their numeric ids so a rename cannot hand the identity to another repo — and
   the verifier rejected it for months, 401ing the hourly sweep on every run
   while every other claim matched. */
test('accepts the immutable subject GitHub issues for this repository', async () => {
  const { token, getKey } = await signedToken({
    sub: 'repo:tamamorg@294300183/TamamHealth@1250607401:ref:refs/heads/main',
  });
  await expect(verifyTransferSweepOidcToken(token, getKey)).resolves.toBe(true);
});

test.each([
  // A different repository wearing the immutable shape.
  { sub: 'repo:someone@1/Other@2:ref:refs/heads/main' },
  // The right repository, the wrong branch.
  { sub: 'repo:tamamorg@294300183/TamamHealth@1250607401:ref:refs/heads/feature' },
  // The shape without ids is only valid as the exact classic subject.
  { sub: 'repo:tamamorg@294300183/TamamHealth:ref:refs/heads/main' },
  { sub: 'repo:tamamorg/TamamHealth@1250607401:ref:refs/heads/main' },
  // A tag, not the branch.
  { sub: 'repo:tamamorg@294300183/TamamHealth@1250607401:ref:refs/tags/v1' },
])('rejects a subject that does not name this repo on main: %o', async override => {
  const { token, getKey } = await signedToken(override);
  await expect(verifyTransferSweepOidcToken(token, getKey)).resolves.toBe(false);
});

/* ── The daily reminder dispatch ──────────────────────────────────────
   Same identity scheme, its own audience and workflow file. It ran on a shared
   secret that was never set, so every morning's run was refused and no patient
   was reminded. */
async function reminderToken(overrides: Record<string, unknown> = {}) {
  return signedToken(
    { workflow_ref: REMINDER_DISPATCH_WORKFLOW_REF, ...overrides },
    REMINDER_DISPATCH_OIDC_AUDIENCE,
  );
}

test('accepts the scheduled reminder dispatch on main', async () => {
  const { token, getKey } = await reminderToken();
  await expect(verifyReminderDispatchOidcToken(token, getKey)).resolves.toBe(true);
});

test('a reminder token cannot run the transfer sweep, or the reverse', async () => {
  const reminder = await reminderToken();
  await expect(verifyTransferSweepOidcToken(reminder.token, reminder.getKey)).resolves.toBe(false);

  const sweep = await signedToken();
  await expect(verifyReminderDispatchOidcToken(sweep.token, sweep.getKey)).resolves.toBe(false);
});

test.each([
  { workflow_ref: `${TRANSFER_SWEEP_REPOSITORY}/.github/workflows/other.yml@refs/heads/main` },
  { ref: 'refs/heads/feature' },
  { event_name: 'pull_request' },
  { runner_environment: 'self-hosted' },
])('rejects a reminder token outside the exact cron identity: %o', async override => {
  const { token, getKey } = await reminderToken(override);
  await expect(verifyReminderDispatchOidcToken(token, getKey)).resolves.toBe(false);
});
