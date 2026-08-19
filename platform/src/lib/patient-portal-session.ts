import type { PatientDoc } from '@/lib/db-types';

// Only used now for the demo bank-transfer detail fallback in the billing flow
// below (shown when a facility hasn't configured real bank details) — the
// login screen's demo scaffolding (Demo Accounts panel, ?demo= auto-login)
// has been removed in favor of a single real username/password account.
export const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE !== 'false';
const PATIENT_PORTAL_SESSION_KEY = 'tamamhealth-patient-portal-session';

export type PatientPortalSession = {
  token: string;
  patient: PatientDoc;
};

export function readPatientPortalSession(): PatientPortalSession | null {
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(PATIENT_PORTAL_SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PatientPortalSession;
    if (!parsed.token || !parsed.patient?._id) return null;
    return parsed;
  } catch {
    window.sessionStorage.removeItem(PATIENT_PORTAL_SESSION_KEY);
    return null;
  }
}

// The `storage` event only fires in OTHER tabs, so a same-tab sign-in/out
// won't reach the layout header. Emit a same-tab event alongside every write
// so the header user chip updates immediately without a reload.
const PATIENT_PORTAL_SESSION_EVENT = 'patient-portal-session-change';

export function writePatientPortalSession(session: PatientPortalSession): void {
  window.sessionStorage.setItem(PATIENT_PORTAL_SESSION_KEY, JSON.stringify(session));
  window.dispatchEvent(new Event(PATIENT_PORTAL_SESSION_EVENT));
}

export function clearPatientPortalSession(): void {
  window.sessionStorage.removeItem(PATIENT_PORTAL_SESSION_KEY);
  window.dispatchEvent(new Event(PATIENT_PORTAL_SESSION_EVENT));
}

export async function patientPortalFetch<T>(
  path: string,
  token: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body != null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    if (response.status === 401) clearPatientPortalSession();
    let message = 'Request failed';
    try {
      const body = await response.json() as { error?: string };
      message = body.error || message;
    } catch {
      // keep generic message
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}
