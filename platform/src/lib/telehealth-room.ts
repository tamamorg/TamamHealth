/**
 * Telehealth room naming and join-URL construction.
 *
 * Kept separate from the token route so the provider room, the patient join
 * surfaces, and the session service all derive the same room name from the
 * same rule — a mismatch here means two people "in the same visit" who cannot
 * see each other, which is the hardest class of bug to diagnose in the field.
 */

/**
 * Canonical LiveKit room name for a session.
 *
 * Derived from the session id rather than stored, so it cannot drift from the
 * record and cannot be tampered with by a client. The session id is already a
 * server-issued opaque id.
 *
 * NOTE: the room name is NOT a secret — anyone who can guess it still cannot
 * join, because the LiveKit server rejects any connection without a token
 * signed by our API secret. Authorisation lives in the token, not the name.
 */
export function roomNameForSession(sessionId: string): string {
  return `th-${sessionId}`;
}

/** Participant identity for the clinician side of a visit. */
export function providerIdentity(userId: string): string {
  return `provider:${userId}`;
}

/** Participant identity for the patient side of a visit. */
export function patientIdentity(patientId: string): string {
  return `patient:${patientId}`;
}

/**
 * Public join URL handed to a patient.
 *
 * Deliberately carries only the session id — NOT a token. Tokens are minted
 * per-request at `/api/telehealth/token` after the caller has authenticated,
 * so a URL that leaks (SMS forwarded, screenshot, shoulder-surfed) grants
 * nothing on its own. Embedding a long-lived token in a shareable link is the
 * usual way telehealth deployments leak access to consultations.
 */
export function buildPatientJoinUrl(sessionId: string, baseUrl?: string): string {
  const base = (baseUrl || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
  return `${base}/telehealth/join/${encodeURIComponent(sessionId)}`;
}

/**
 * Clinician-facing room URL. Same reasoning as the patient link: no token in it.
 *
 * Takes the APPOINTMENT id, not the session id. `/telehealth/visit/[appointmentId]`
 * resolves its visit out of the appointment list, so a URL built from a session
 * id lands on a page that cannot find anything. That mismatch shipped and went
 * unnoticed only because the stored `providerJoinUrl` had no readers yet — the
 * first feature to use it (an SMS to the clinician, a calendar invite) would
 * have been the one to discover it.
 *
 * Walk-in sessions have no appointment to key on, so they have no provider URL;
 * callers get `null` rather than a link to `/telehealth/visit/undefined`.
 */
export function buildProviderJoinUrl(appointmentId: string | undefined, baseUrl?: string): string | null {
  if (!appointmentId) return null;
  const base = (baseUrl || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
  return `${base}/telehealth/visit/${encodeURIComponent(appointmentId)}`;
}

/** Whether a LiveKit server is configured. Callers degrade rather than crash. */
export function isLiveKitConfigured(): boolean {
  return Boolean(
    process.env.LIVEKIT_API_KEY &&
    process.env.LIVEKIT_API_SECRET &&
    (process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LIVEKIT_URL),
  );
}
