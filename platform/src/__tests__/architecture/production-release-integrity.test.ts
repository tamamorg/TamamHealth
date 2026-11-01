import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workflow = readFileSync(
  resolve(process.cwd(), '..', '.github/workflows/deploy-production.yml'),
  'utf8',
);
const dockerfile = readFileSync(resolve(process.cwd(), 'Dockerfile'), 'utf8');

describe('production release integrity', () => {
  it('deploys only immutable SHA image tags', () => {
    expect(workflow).not.toMatch(/tamamhealth-(?:platform|website|sync-worker).*:production/);
    expect(workflow).toContain("expected_sha='${{ needs.build-production-images.outputs.sha }}'");
  });

  it('health-checks and rolls back all application services as one release', () => {
    expect(workflow).toContain('for service in platform website sync-worker');
    expect(workflow).toContain("'.tamamhealth-rollback-stack-$SHA'");
    expect(workflow).toContain('--force-recreate \\$rollback_services');
    expect(workflow).toContain('WEBSITE_HEALTH_URL');
    expect(workflow).toContain('previous_worker=absent');
    expect(workflow).toContain("rollback_services='platform website'");
  });

  it('ships the compose files of the release, and takes them back on rollback', () => {
    const deploy = workflow.indexOf("name: Pull + restart stack");
    const fetched = workflow.indexOf("host_git fetch --quiet --depth 1 '$REPO_URL' '$FULL_SHA'", deploy);
    const checkedOut = workflow.indexOf("host_git checkout --quiet --detach '$FULL_SHA'", deploy);
    const recorded = workflow.indexOf("> '.tamamhealth-rollback-stack-$SHA'", deploy);
    const validated = workflow.indexOf('config --quiet', deploy);
    const pulled = workflow.indexOf('docker-compose.ghcr.yml pull', deploy);
    const started = workflow.indexOf('docker-compose.ghcr.yml up -d', deploy);
    expect([recorded, fetched, checkedOut, validated, pulled, started].every(at => at > deploy)).toBe(true);
    expect([...[recorded, fetched, checkedOut, validated, pulled, started]].sort((a, b) => a - b))
      .toEqual([recorded, fetched, checkedOut, validated, pulled, started]);

    const rollback = workflow.slice(workflow.indexOf('name: Roll back unhealthy release stack'));
    expect(rollback.indexOf("sed -n '4p' '.tamamhealth-rollback-stack-$SHA'")).toBeGreaterThan(-1);
    expect(rollback.indexOf('checkout --quiet --detach')).toBeLessThan(rollback.indexOf('--force-recreate'));
  });

  it('never forces the host checkout over a hand edit', () => {
    expect(workflow).not.toMatch(/git[^\n]*(checkout[^\n]*(-f\b|--force)|reset --hard)/);
  });

  it('carries the one-off data jobs in the image', () => {
    const runtime = dockerfile.slice(dockerfile.lastIndexOf('\nFROM '));
    for (const file of [
      'scripts/encrypt-phi-at-rest.mjs',
      'scripts/migrate-retired-roles.mjs',
      'scripts/rebuild-lost-charges.mjs',
      'src/lib/phi-field-catalog.json',
      'src/lib/user-role.ts',
    ]) expect(runtime).toContain(`COPY --from=builder /app/${file} ./${file}`);
  });

  it('installs CouchDB validators from the exact immutable platform image', () => {
    expect(dockerfile).toContain(
      '/app/scripts/install-validate-doc-updates.mjs ./scripts/install-validate-doc-updates.mjs',
    );
    expect(dockerfile).toContain('/app/src/lib/sync ./src/lib/sync');
    expect(workflow).toContain('npm run setup:couchdb:validators');
    expect(workflow).toContain('CouchDB validators installed from immutable tag $expected_sha');
  });
});
