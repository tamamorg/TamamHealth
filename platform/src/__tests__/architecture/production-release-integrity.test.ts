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
    expect(workflow).toContain('--image-tag "${{ needs.build-production-images.outputs.sha }}"');
  });

  it('health-checks and rolls back all application services as one release', () => {
    expect(workflow).toContain('for service in platform website sync-worker');
    expect(workflow).toContain("'.tamamhealth-rollback-stack-$SHA'");
    expect(workflow).toContain('--force-recreate \\$rollback_services');
    expect(workflow).toContain('WEBSITE_HEALTH_URL');
    expect(workflow).toContain('previous_worker=absent');
    expect(workflow).toContain("rollback_services='platform website'");
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
