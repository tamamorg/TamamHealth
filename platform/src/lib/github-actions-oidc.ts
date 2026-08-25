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
 * The daily reminder dispatch, on the same footing as the sweep.
 *
 * It authenticated with a shared secret that was never set, so the job failed
 * every morning and no patient received a reminder. A short-lived token bound
 * to this repository, this workflow and this branch needs nothing configured by
 * hand — which is the difference between a job that works and a job waiting for
 * someone to remember a secret.
 *
 * A DIFFERENT audience from the sweep, deliberately: a token minted for one
 * cron must not authorise the other. The workflow asks for this audience and
 * the verifier insists on it.
 */
export const REMINDER_DISPATCH_OIDC_AUDIENCE = 'tamamhealth-reminder-dispatch';
export const REMINDER_DISPATCH_WORKFLOW_REF =
  `${TRANSFER_SWEEP_REPOSITORY}/.github/workflows/reminders-cron.yml@refs/heads/main`;

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

function subjectNamesThisRepositoryOnMain(subject: unknown): boolean {
  if (typeof subject !== 'string') return false;
  if (subject === `repo:${TRANSFER_SWEEP_REPOSITORY}:ref:${MAIN_REF}`) return true;
  const parts = IMMUTABLE_SUBJECT.exec(subject);
  if (!parts) return false;
  const [, owner, repo, ref] = parts;
  return `${owner}/${repo}` === TRANSFER_SWEEP_REPOSITORY && ref === MAIN_REF;
}

/**
 * Verify a short-lived GitHub Actions token is from one specific production
 * cron: this repository, that workflow file, on main, minted by GitHub's own
 * runners for a schedule or a deliberate dispatch.
 */
async function verifyCronOidcToken(
  token: string,
  audience: string,
  workflowRef: string,
  getKey: JWTVerifyGetKey,
): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, getKey, {
      issuer: GITHUB_ISSUER,
      audience,
      algorithms: ['RS256'],
    });
    return payload.repository === TRANSFER_SWEEP_REPOSITORY
      && payload.workflow_ref === workflowRef
      && payload.ref === MAIN_REF
      && payload.ref_type === 'branch'
      && payload.runner_environment === 'github-hosted'
      && (payload.event_name === 'schedule' || payload.event_name === 'workflow_dispatch')
      && subjectNamesThisRepositoryOnMain(payload.sub);
  } catch {
    return false;
  }
}

/** The hourly patient-transfer sweep. */
export async function verifyTransferSweepOidcToken(
  token: string,
  getKey: JWTVerifyGetKey = GITHUB_JWKS,
): Promise<boolean> {
  return verifyCronOidcToken(token, TRANSFER_SWEEP_OIDC_AUDIENCE, TRANSFER_SWEEP_WORKFLOW_REF, getKey);
}

/** The daily patient-reminder dispatch. */
export async function verifyReminderDispatchOidcToken(
  token: string,
  getKey: JWTVerifyGetKey = GITHUB_JWKS,
): Promise<boolean> {
  return verifyCronOidcToken(token, REMINDER_DISPATCH_OIDC_AUDIENCE, REMINDER_DISPATCH_WORKFLOW_REF, getKey);
}
