/**
 * @jest-environment node
 *
 * Every unattended workflow has to be able to raise its hand.
 *
 * An audit on 2026-08-24 found three scheduled jobs failing on a loop with
 * nobody aware:
 *
 *   backups-restore-drill   had NEVER succeeded — every run since 2026-07-01
 *   reminders-cron          failing daily for 5 days; patients received none
 *   transfers-sweep-cron    403 every hour, all day
 *
 * Each had already printed a clear error naming exactly what was missing. Two
 * printed the missing secret names. Detection was never the problem — nothing
 * told anyone, and a job that fails silently for two months is
 * indistinguishable from one that does not exist.
 *
 * `.github/actions/alert-failure` opens one issue while a workflow is broken
 * and closes it on the next success. This asserts it is actually wired into
 * the workflows nobody watches: anything on a schedule, and anything that
 * deploys. A new cron added without one fails here rather than in six weeks.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const WORKFLOWS = path.resolve(process.cwd(), '..', '.github/workflows');
const ALARM = './.github/actions/alert-failure';

interface Workflow { file: string; text: string }

const workflows: Workflow[] = readdirSync(WORKFLOWS)
  .filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
  .map(file => ({ file, text: readFileSync(path.join(WORKFLOWS, file), 'utf8') }));

/** Runs unattended: on a timer, with no human watching the tab. */
const isScheduled = (w: Workflow) => /^\s*schedule:/m.test(w.text);
/** Puts code in front of patients. */
const isDeploy = (w: Workflow) => w.file.startsWith('deploy-');

describe('the alarm exists and is usable', () => {
  it('the composite action is present', () => {
    const action = readFileSync(path.resolve(WORKFLOWS, '../actions/alert-failure/action.yml'), 'utf8');
    expect(action).toContain('name: Alert on workflow failure');
    // Both halves matter. Opening an issue without closing it turns the
    // tracker into a pile of alarms for things that fixed themselves, and
    // then nobody reads any of them.
    expect(action).toContain("status === 'success'");
    expect(action).toContain("state: 'closed'");
  });
});

describe('unattended workflows raise the alarm', () => {
  const unattended = workflows.filter(w => isScheduled(w) || isDeploy(w));

  it('finds the workflows it is meant to cover', () => {
    expect(unattended.length).toBeGreaterThanOrEqual(4);
  });

  it.each(unattended.map(w => w.file))('%s wires in alert-failure', file => {
    const w = workflows.find(x => x.file === file)!;
    expect(w.text).toContain(ALARM);
  });

  it.each(unattended.map(w => w.file))('%s grants issues: write', file => {
    const w = workflows.find(x => x.file === file)!;
    // Without the permission the alarm throws instead of alerting, which is
    // the same silence with extra steps.
    expect(w.text).toMatch(/^\s*issues:\s*write/m);
  });

  it.each(unattended.map(w => w.file))('%s checks out the repo before calling it', file => {
    const w = workflows.find(x => x.file === file)!;
    // `uses: ./…` resolves against the workspace, so a job with no checkout
    // fails ON the alarm step — the alarm itself becoming the silent failure.
    // Four jobs were in exactly that state when the alarm was first wired.
    for (const jobBlock of w.text.split(/\n  (?=[a-z][a-z0-9-]*:\n)/)) {
      if (!jobBlock.includes(ALARM)) continue;
      expect(jobBlock.indexOf('actions/checkout')).toBeGreaterThanOrEqual(0);
      expect(jobBlock.indexOf('actions/checkout')).toBeLessThan(jobBlock.indexOf(ALARM));
    }
  });

  it.each(unattended.map(w => w.file))('%s calls it with always(), not just on failure', file => {
    const w = workflows.find(x => x.file === file)!;
    // `if: failure()` would raise alarms and never clear them.
    const block = w.text.slice(w.text.indexOf(ALARM) - 400, w.text.indexOf(ALARM));
    expect(block).toMatch(/if:\s*always\(\)/);
  });
});
