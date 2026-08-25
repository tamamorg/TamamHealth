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
const MAIN_REF = 'refs/heads/main';

/**
 * The subject GitHub actually stamps on this repository's tokens.
 *
 * Two forms exist. The classic one names the repository as text:
 *
 *   repo:tamamorg/TamamHealth:ref:refs/heads/main
 *
 * The immutable one — which this repository is issued, and which cannot be
 * turned off from the workflow side — carries the numeric owner and repository
 * ids so a rename cannot let a different repo inherit the identity:
 *
 *   repo:tamamorg@294300183/TamamHealth@1250607401:ref:refs/heads/main
 *
 * Accepting only the first is what made the hourly sweep 401 on every run since
 * it moved to OIDC: every other claim matched, and this one could not. The ids
 * are not hard-coded here — they are whatever GitHub minted — because the name
 * either side of them is checked against the constant, and `repository` and
 * `workflow_ref` are verified independently below.
 */
/* Numbered groups, not named ones: this package's `target` predates ES2018 and
   `tsc` refuses `(?<name>…)` outright. */
const IMMUTABLE_SUBJECT = /^repo:([^@/:]+)@\d+\/([^@/:]+)@\d+:ref:(.+)$/;

function subjectNamesTheSweepWorkflow(subject: unknown): boolean {
  if (typeof subject !== 'string') return false;
  if (subject === `repo:${TRANSFER_SWEEP_REPOSITORY}:ref:${MAIN_REF}`) return true;
  const parts = IMMUTABLE_SUBJECT.exec(subject);
  if (!parts) return false;
  const [, owner, repo, ref] = parts;
  return `${owner}/${repo}` === TRANSFER_SWEEP_REPOSITORY && ref === MAIN_REF;
}

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
      && payload.ref === MAIN_REF
      && payload.ref_type === 'branch'
      && payload.runner_environment === 'github-hosted'
      && (payload.event_name === 'schedule' || payload.event_name === 'workflow_dispatch')
      && subjectNamesTheSweepWorkflow(payload.sub);
  } catch {
    return false;
  }
}
