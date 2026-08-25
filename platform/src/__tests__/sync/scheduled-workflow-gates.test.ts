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

  it('fails loudly when a cron cannot authenticate, rather than passing empty', () => {
    /* Neither cron has a long-lived secret left to misconfigure — both mint a
       short-lived GitHub identity per run. What must stay true is that a job
       which cannot get that identity FAILS: reminders spent weeks reporting a
       red run nobody could fix (its secret was never set) and, before that, a
       green run that dispatched nothing at all. A silent success is the worse
       of the two. */
    for (const [file, audience] of [
      ['transfers-sweep-cron.yml', 'tamamhealth-transfer-sweep'],
      ['reminders-cron.yml', 'tamamhealth-reminder-dispatch'],
    ] as const) {
      const text = readFileSync(join(WORKFLOWS, file), 'utf8');
      expect(text).toMatch(/id-token: write/);
      expect(text).toContain(`audience=${audience}`);
      expect(text).toMatch(/::error title=OIDC token missing/);
      expect(text).not.toMatch(/::notice title=[^:]*not configured/);
    }

    // The secrets those two jobs used to hang on are gone from both.
    expect(readFileSync(join(WORKFLOWS, 'transfers-sweep-cron.yml'), 'utf8'))
      .not.toMatch(/secrets\.TRANSFER_SWEEP_SECRET/);
    expect(readFileSync(join(WORKFLOWS, 'reminders-cron.yml'), 'utf8'))
      .not.toMatch(/secrets\.REMINDER_DISPATCH_SECRET/);
  });
});
