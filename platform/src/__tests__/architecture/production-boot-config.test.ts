/**
 * Whatever boot validation needs has to be in the image. A default set only in
 * docker-compose.yml never reached the droplet, and release a1fbe8f refused to
 * boot and rolled back. Deploys now ship the compose files too, but a release
 * must not depend on them to start.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { validateProductionConfig } from '@/lib/config-validation';

const root = path.resolve(__dirname, '../../..');
const dockerfile = readFileSync(path.join(root, 'Dockerfile'), 'utf8');
const runtime = dockerfile.slice(dockerfile.lastIndexOf('\nFROM '));

describe('production image boot settings', () => {
  test('the runtime stage carries what validation requires', () => {
    expect(runtime).toContain('ENV NEXT_PUBLIC_COUCHDB_GATEWAY_ENABLED=${NEXT_PUBLIC_COUCHDB_GATEWAY_ENABLED}');
    expect(runtime).toContain('ENV TOKEN_BLACKLIST_FILE=/app/data/token-blacklist.json');
  });

  test('that revocation path passes validation', () => {
    const errors = validateProductionConfig({ NODE_ENV: 'production', TOKEN_BLACKLIST_FILE: '/app/data/token-blacklist.json' } as never);
    expect(errors.join(' ')).not.toContain('TOKEN_BLACKLIST_FILE');
  });

  test('a refused boot names the problem in the thrown message', () => {
    const source = readFileSync(path.join(root, 'src/instrumentation.ts'), 'utf8');
    expect(source).toContain("Invalid production configuration: ${errors.join(' | ')}");
  });

  test('validation messages carry no secret value', () => {
    const secret = 'do-not-print-this-secret-value-0123456789';
    const errors = validateProductionConfig({
      NODE_ENV: 'production', JWT_SECRET: 'short', COUCHDB_ADMIN_PASSWORD: secret, COUCHDB_GATEWAY_SECRET: secret, ORG_DATA_KEY_SECRET: 'short',
    } as never);
    expect(errors.join(' ')).not.toContain(secret);
    expect(errors.join(' ')).not.toContain('short ');
  });
});
