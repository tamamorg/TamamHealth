/**
 * Every `NEXT_PUBLIC_*` the Dockerfile declares must be supplied by whatever
 * builds the image.
 *
 * `NEXT_PUBLIC_*` is inlined into the client bundle at BUILD time, and
 * platform/Dockerfile passes each one explicitly on the `npm run build` line.
 * That makes an omitted build arg worse than a missing value: the empty ARG
 * default is exported into the build environment, where it OVERRIDES
 * `.env.production` instead of deferring to it — Next's env loader never
 * replaces a variable that is already set.
 *
 * The bug this pins: neither docker-compose.yml nor deploy-staging.yml passed
 * `NEXT_PUBLIC_SYNC_ENABLED` or `NEXT_PUBLIC_COUCHDB_URL`, so every image was
 * built with `isSyncEnabled()` folded to `false` and no CouchDB URL. The
 * running container's env said `NEXT_PUBLIC_SYNC_ENABLED=true`, the sync status
 * looked configured, and no browser ever opened a replication — patients lived
 * only in the tab that registered them. Adding an ARG to the Dockerfile without
 * adding it to the builders reintroduces exactly that, silently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const PLATFORM = join(REPO_ROOT, 'platform');

const read = (...parts: string[]) => readFileSync(join(...parts), 'utf8');

/** The `NEXT_PUBLIC_*` names the Dockerfile declares as build args. */
function dockerfilePublicArgs(): string[] {
  const dockerfile = read(PLATFORM, 'Dockerfile');
  const names = dockerfile
    .split('\n')
    .map(line => /^ARG\s+(NEXT_PUBLIC_[A-Z0-9_]+)/.exec(line.trim())?.[1])
    .filter((n): n is string => Boolean(n));
  return [...new Set(names)];
}

describe('client build flags reach every builder', () => {
  const declared = dockerfilePublicArgs();

  it('the Dockerfile declares the flags this test is about', () => {
    // Guards the parser itself: an empty list would make every assertion below
    // pass vacuously.
    expect(declared).toEqual(expect.arrayContaining([
      'NEXT_PUBLIC_DEMO_MODE',
      'NEXT_PUBLIC_SYNC_ENABLED',
      'NEXT_PUBLIC_COUCHDB_URL',
    ]));
  });

  it('the Dockerfile exports each declared arg into the build', () => {
    // An ARG that is declared but never put on the `npm run build` line is
    // invisible to Next and silently absent from the bundle.
    const dockerfile = read(PLATFORM, 'Dockerfile');
    for (const name of declared) {
      expect(dockerfile).toContain(`${name}="$${name}"`);
    }
  });

  it('docker-compose passes every declared flag as a build arg', () => {
    const compose = read(REPO_ROOT, 'docker-compose.yml');
    const buildArgs = compose.slice(
      compose.indexOf('  platform:'),
      compose.indexOf('env_file', compose.indexOf('  platform:')),
    );
    for (const name of declared) {
      expect(buildArgs).toContain(`${name}:`);
    }
  });

  it('the deploy workflow passes the flags that decide whether records leave the browser', () => {
    const workflow = read(REPO_ROOT, '.github', 'workflows', 'deploy-staging.yml');
    const platformBuild = workflow.slice(0, workflow.indexOf('Build + push website image'));
    // Not the whole list: NEXT_PUBLIC_APP_URL and NEXT_PUBLIC_BUILD_ID are
    // cosmetic there. These three decide whether the image seeds fake patients
    // and whether it can sync at all.
    for (const name of ['NEXT_PUBLIC_DEMO_MODE', 'NEXT_PUBLIC_SYNC_ENABLED', 'NEXT_PUBLIC_COUCHDB_URL']) {
      expect(platformBuild).toContain(`${name}=`);
    }
  });

  it('compose turns sync on, since it ships CouchDB in the same stack', () => {
    const compose = read(REPO_ROOT, 'docker-compose.yml');
    // The regression was an image that could never replicate. A default of
    // "false" here would ship that same image from the one compose file that
    // includes a CouchDB to replicate to.
    expect(compose).toMatch(/NEXT_PUBLIC_SYNC_ENABLED:\s*\$\{NEXT_PUBLIC_SYNC_ENABLED:-true\}/);
    expect(compose).toMatch(/NEXT_PUBLIC_COUCHDB_URL:\s*\$\{NEXT_PUBLIC_COUCHDB_URL:-/);
  });
});
