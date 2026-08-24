/**
 * A scheduled workflow must not sit behind a deployment approval gate.
 *
 * The `production` environment carries required reviewers so a human confirms
 * a DEPLOYMENT. A cron cannot answer that: the run waits for approval, the
 * next scheduled run supersedes it in the concurrency group, and it is
 * cancelled. Adding reviewers to `production` on 2026-08-18 silently stopped
 * the hourly transfer sweep and the daily reminder
 * dispatch — every run cancelled, no alert, because a cancelled run is not a
 * failed one.
 *
 * The concurrency groups are NOT the problem and must stay: they are what stop
 * two sweeps racing the same records.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const WORKFLOWS = join(__dirname, '..', '..', '..', '..', '.github', 'workflows');

interface Workflow { name: string; text: string }

function workflows(): Workflow[] {
  return readdirSync(WORKFLOWS)
    .filter(f => f.endsWith('.yml'))
    .map(name => ({ name, text: readFileSync(join(WORKFLOWS, name), 'utf8') }));
}

/** Workflows with a `schedule:` trigger. */
const scheduled = () => workflows().filter(w => /^on:/m.test(w.text) && /^\s*schedule:/m.test(w.text));

/** Job-level `environment:` values, ignoring the word inside comments. */
function environments(text: string): string[] {
  return text
    .split('\n')
    .filter(l => !l.trimStart().startsWith('#'))
    .map(l => /^\s+environment:\s*(\S+)/.exec(l)?.[1])
    .filter((v): v is string => Boolean(v));
}

describe('scheduled workflows are not gated on human approval', () => {
  it('finds the scheduled workflows this test is about', () => {
    // Guards the parser: an empty list would make the assertions vacuous.
    const names = scheduled().map(w => w.name);
    expect(names).toEqual(expect.arrayContaining([
      'transfers-sweep-cron.yml',
      'reminders-cron.yml',
    ]));
  });

  it('no scheduled workflow runs in the reviewer-gated `production` environment', () => {
    const offenders = scheduled()
      .filter(w => environments(w.text).includes('production'))
      .map(w => w.name);
    expect(offenders).toEqual([]);
  });

  it('keeps the concurrency groups that stop two sweeps racing', () => {
    // The cancellations were caused by the approval gate, not by these. Removing
    // them would let two sweeps read the same due transfer before either wrote.
    for (const w of scheduled()) {
      expect(w.text).toMatch(/^concurrency:/m);
      expect(w.text).toMatch(/^\s+group:\s*\S+/m);
    }
  });

  it('still gates the actual deployments', () => {
    // The counterpart: this rule must not be "read" as an argument for
    // ungating deploys, which is what the reviewer requirement is for.
    for (const name of ['deploy-production.yml', 'deploy-website.yml']) {
      const text = readFileSync(join(WORKFLOWS, name), 'utf8');
      expect(environments(text)).toContain('production');
    }
  });

  it('fails loudly when a sweep is unconfigured rather than passing empty', () => {
    // Reminders still uses a shared secret and must reject an unset one.
    const reminders = readFileSync(join(WORKFLOWS, 'reminders-cron.yml'), 'utf8');
    expect(reminders).toMatch(/::error title=[^:]*not configured/);
    expect(reminders).not.toMatch(/::notice title=[^:]*not configured/);

    // Transfers no longer has a long-lived secret to misconfigure. Its OIDC
    // request must itself fail loudly if GitHub cannot issue the short-lived
    // workflow identity.
    const transfers = readFileSync(join(WORKFLOWS, 'transfers-sweep-cron.yml'), 'utf8');
    expect(transfers).toMatch(/id-token: write/);
    expect(transfers).toMatch(/audience=tamamhealth-transfer-sweep/);
    expect(transfers).toMatch(/::error title=OIDC token missing/);
    expect(transfers).not.toMatch(/secrets\.TRANSFER_SWEEP_SECRET/);
  });
});
