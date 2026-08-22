import type { UserRole } from '@/lib/db-types';

/**
 * Who may read the staff directory (`GET /api/users`).
 *
 * One list, imported by both sides: `/api/users` enforces it as the boundary,
 * and `useUsers` reads it to decide whether to ask at all. They used to be
 * implicit and mismatched — the API allowed nine roles while the app shell
 * (MessagingDock) called the endpoint for every signed-in role, so a front-desk
 * or cashier session fetched a directory it could never read, logged a
 * "Forbidden" error, and retried on every consumer mount and every tab focus.
 *
 * The directory is org-scoped (`buildScopeFromAuth`) and redacted
 * (`redactUserForClient`) — a colleague list, not PHI. Even so this stays a
 * deliberate list rather than "everyone signed in": it names who is on staff at
 * a facility, which is not something a session needs by default.
 *
 * Keeping the API in charge is the point of exporting the list rather than a
 * client-side check: the hook uses it only to avoid a request it knows will be
 * refused. Removing a role here removes the request, never the enforcement.
 */
export const STAFF_DIRECTORY_READ_ROLES: readonly UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'nurse',
  'pharmacist', 'medical_superintendent', 'hospital_manager', 'hrio',
];

export function canReadStaffDirectory(role?: UserRole | string | null): boolean {
  return !!role && (STAFF_DIRECTORY_READ_ROLES as readonly string[]).includes(role);
}
