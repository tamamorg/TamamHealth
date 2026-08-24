/** @jest-environment node */

jest.mock('server-only', () => ({}));

import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
} from 'jose';
import {
  TRANSFER_SWEEP_OIDC_AUDIENCE,
  TRANSFER_SWEEP_REPOSITORY,
  TRANSFER_SWEEP_WORKFLOW_REF,
  verifyTransferSweepOidcToken,
} from '@/lib/github-actions-oidc';

async function signedToken(overrides: Record<string, unknown> = {}) {
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
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer('https://token.actions.githubusercontent.com')
    .setAudience(TRANSFER_SWEEP_OIDC_AUDIENCE)
    .setSubject(`repo:${TRANSFER_SWEEP_REPOSITORY}:ref:refs/heads/main`)
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
