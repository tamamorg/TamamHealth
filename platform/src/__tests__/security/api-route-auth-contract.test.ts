/**
 * @jest-environment node
 *
 * Every new API route must deliberately join one of two security models:
 * staff/machine authentication, or an explicitly public surface with its own
 * narrower guard. This turns the API audit into a maintained contract instead
 * of a one-off review that silently goes stale.
 */
import fs from 'node:fs';
import path from 'node:path';

const API_ROOT = path.join(process.cwd(), 'src/app/api');

function routeFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? routeFiles(full) : entry.name === 'route.ts' ? [full] : [];
  });
}

function apiPath(file: string): string {
  return `/api/${path.relative(API_ROOT, path.dirname(file)).split(path.sep).join('/')}`;
}

function isIntentionalPublicRoute(route: string): boolean {
  return route === '/api/auth/login'
    || route === '/api/auth/logout'
    || route === '/api/auth/accept-invite'
    || route === '/api/auth/forgot-password'
    || route === '/api/auth/password-policy'
    || route === '/api/health'
    || route === '/api/health/live'
    || route === '/api/country/metadata'
    || route === '/api/fhir/metadata'
    || route === '/api/demo-credentials'
    || route === '/api/checkout'
    || route.startsWith('/api/booking/')
    || route.startsWith('/api/patient-portal/')
    || route.startsWith('/api/terminology/')
    || route.startsWith('/api/webhooks/');
}

describe('API route authentication contract', () => {
  it('requires every non-public route to authenticate staff or a signed machine caller', () => {
    const unguarded = routeFiles(API_ROOT).flatMap(file => {
      const route = apiPath(file);
      if (isIntentionalPublicRoute(route)) return [];
      const source = fs.readFileSync(file, 'utf8');
      return /getAuthPayload|verifySyncMachineRequest/.test(source) ? [] : [route];
    });

    expect(unguarded).toEqual([]);
  });
});
