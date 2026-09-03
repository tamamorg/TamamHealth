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

/** Follow a thin Next.js route adapter to the domain-owned implementation. */
function routeSource(file: string): string {
  const source = fs.readFileSync(file, 'utf8');
  const adapter = source.match(/export\s+\{[^}]+\}\s+from\s+['"]@\/(.+)['"]/);
  if (!adapter) return source;
  return fs.readFileSync(path.join(process.cwd(), 'src', `${adapter[1]}.ts`), 'utf8');
}

const STATIC_PUBLIC = new Set([
  '/api/auth/login', '/api/auth/logout', '/api/auth/accept-invite',
  '/api/auth/forgot-password', '/api/auth/password-policy',
  '/api/health', '/api/health/live', '/api/country/metadata',
  '/api/fhir/metadata', '/api/demo-credentials', '/api/checkout',
  '/api/booking/hold', '/api/booking/practice/[slug]', '/api/booking/provider/[slug]',
  '/api/booking/reference/[ref]', '/api/booking/request', '/api/booking/slots',
  '/api/patient-portal/activate', '/api/patient-portal/appointments',
  '/api/patient-portal/billing', '/api/patient-portal/immunizations',
  '/api/patient-portal/labs', '/api/patient-portal/login', '/api/patient-portal/messages',
  '/api/patient-portal/payments', '/api/patient-portal/prescriptions',
  '/api/patient-portal/profile', '/api/patient-portal/records', '/api/patient-portal/refresh',
  '/api/patient-portal/verify-otp', '/api/terminology/[resource]',
  '/api/webhooks/airtel', '/api/webhooks/flutterwave', '/api/webhooks/mpesa',
]);

describe('API route authentication contract', () => {
  it('requires every non-public route to authenticate staff or a signed machine caller', () => {
    const unguarded = routeFiles(API_ROOT).flatMap(file => {
      const route = apiPath(file);
      if (STATIC_PUBLIC.has(route)) return [];
      const source = routeSource(file);
      return /(?:await\s+)?getAuthPayload\s*\(|verifySyncMachineRequest\s*\(/.test(source) ? [] : [route];
    });

    expect(unguarded).toEqual([]);
  });

  it('does not silently make a new route public through a broad path prefix', () => {
    const publicRoutes = routeFiles(API_ROOT).map(apiPath).filter(route => STATIC_PUBLIC.has(route));
    expect(publicRoutes.sort()).toEqual([...STATIC_PUBLIC].sort());
  });

  it('keeps alternate authentication in every public account/payment route', () => {
    const missingGuard = routeFiles(API_ROOT).flatMap(file => {
      const route = apiPath(file);
      if (!route.startsWith('/api/patient-portal/') && !route.startsWith('/api/webhooks/')) return [];
      const source = routeSource(file);
      const guarded = route.startsWith('/api/webhooks/')
        ? /verify\w*Signature\s*\(/.test(source)
        : /verifyPatientToken\s*\(|createPatientToken\s*\(|verifyOtp\s*\(|activatePortalAccount\s*\(/.test(source);
      return guarded ? [] : [route];
    });
    expect(missingGuard).toEqual([]);
  });
});
