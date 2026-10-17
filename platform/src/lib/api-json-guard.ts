/**
 * The create-route preamble every JSON POST handler used to retype:
 * authenticate, check the role, parse the body (400 on malformed JSON), and
 * sanitize it. Behaviour is byte-for-byte what the inlined block did, so the
 * status codes and error strings the API tests pin are unchanged.
 *
 * Callers stay inside their own try/catch (and `withAuditLog`); anything this
 * throws propagates to them exactly as before.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { forbidden, getAuthPayload, hasRole, unauthorized } from '@/modules/identity';
import type { AuthPayload } from '@/modules/identity';
import type { UserRole } from '@/lib/db-types';

export type GuardedJson =
  | { auth: AuthPayload; body: Record<string, unknown>; response?: undefined }
  | { response: NextResponse };

export async function authorizeJson(
  request: NextRequest,
  roles: readonly UserRole[],
): Promise<GuardedJson> {
  const auth = await getAuthPayload(request);
  if (!auth) return { response: unauthorized() };
  if (!hasRole(auth, roles)) return { response: forbidden() };
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return { response: NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) };
  }
  const { sanitizePayload } = await import('@/lib/validation');
  return { auth, body: sanitizePayload(body) };
}
