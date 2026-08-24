import 'server-only';
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
} from 'jose';

const GITHUB_ISSUER = 'https://token.actions.githubusercontent.com';
const GITHUB_JWKS = createRemoteJWKSet(
  new URL('https://token.actions.githubusercontent.com/.well-known/jwks'),
  { timeoutDuration: 5_000, cooldownDuration: 60_000 },
);

export const TRANSFER_SWEEP_OIDC_AUDIENCE = 'tamamhealth-transfer-sweep';
export const TRANSFER_SWEEP_REPOSITORY = 'tamamorg/TamamHealth';
export const TRANSFER_SWEEP_WORKFLOW_REF =
  `${TRANSFER_SWEEP_REPOSITORY}/.github/workflows/transfers-sweep-cron.yml@refs/heads/main`;

/** Verify a short-lived GitHub Actions token is from the one production cron. */
export async function verifyTransferSweepOidcToken(
  token: string,
  getKey: JWTVerifyGetKey = GITHUB_JWKS,
): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, getKey, {
      issuer: GITHUB_ISSUER,
      audience: TRANSFER_SWEEP_OIDC_AUDIENCE,
      algorithms: ['RS256'],
    });
    return payload.repository === TRANSFER_SWEEP_REPOSITORY
      && payload.workflow_ref === TRANSFER_SWEEP_WORKFLOW_REF
      && payload.ref === 'refs/heads/main'
      && payload.ref_type === 'branch'
      && payload.runner_environment === 'github-hosted'
      && (payload.event_name === 'schedule' || payload.event_name === 'workflow_dispatch')
      && payload.sub === `repo:${TRANSFER_SWEEP_REPOSITORY}:ref:refs/heads/main`;
  } catch {
    return false;
  }
}
