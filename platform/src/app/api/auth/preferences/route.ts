import { NextRequest, NextResponse } from 'next/server';
import { getAuthPayload, logApiError, serverError, unauthorized } from '@/modules/identity';
import type { UserPreferences } from '@/lib/db-types';

const THEMES = new Set(['light', 'dark', 'system']);
const DENSITIES = new Set(['comfortable', 'compact']);
const LOCALES = new Set(['en', 'apd']);

function clean(body: unknown): UserPreferences | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const raw = body as Record<string, unknown>;
  const out: UserPreferences = {};
  if (raw.theme !== undefined) {
    if (typeof raw.theme !== 'string' || !THEMES.has(raw.theme)) return null;
    out.theme = raw.theme as UserPreferences['theme'];
  }
  if (raw.density !== undefined) {
    if (typeof raw.density !== 'string' || !DENSITIES.has(raw.density)) return null;
    out.density = raw.density as UserPreferences['density'];
  }
  if (raw.locale !== undefined) {
    if (typeof raw.locale !== 'string' || !LOCALES.has(raw.locale)) return null;
    out.locale = raw.locale as UserPreferences['locale'];
  }
  if (raw.roleSettings !== undefined) {
    if (!raw.roleSettings || typeof raw.roleSettings !== 'object' || Array.isArray(raw.roleSettings)) return null;
    const settings: Record<string, boolean | string> = {};
    for (const [key, value] of Object.entries(raw.roleSettings as Record<string, unknown>)) {
      if (!/^[a-z][a-zA-Z0-9.]{0,79}$/.test(key)) return null;
      if (typeof value !== 'boolean' && typeof value !== 'string') return null;
      if (typeof value === 'string' && value.length > 200) return null;
      settings[key] = value;
    }
    out.roleSettings = settings;
  }
  return out;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    const { getUserById } = await import('@/modules/identity/services/user-service');
    const user = await getUserById(auth.sub);
    if (!user) return unauthorized();
    return NextResponse.json({ preferences: user.preferences || {} });
  } catch (error) {
    logApiError('[API /auth/preferences GET]', error);
    return serverError();
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    const body = clean(await request.json().catch(() => null));
    if (!body) return NextResponse.json({ error: 'Invalid preferences' }, { status: 400 });
    if (body.roleSettings) {
      const { sanitizeRoleSettingsForRole } = await import('@/lib/role-settings');
      body.roleSettings = sanitizeRoleSettingsForRole(auth.role as import('@/lib/db-types').UserRole, body.roleSettings);
    }
    const { updateOwnPreferences } = await import('@/modules/identity/services/user-service');
    const preferences = await updateOwnPreferences(auth.sub, body);
    return NextResponse.json({ preferences });
  } catch (error) {
    logApiError('[API /auth/preferences PATCH]', error);
    return serverError();
  }
}
