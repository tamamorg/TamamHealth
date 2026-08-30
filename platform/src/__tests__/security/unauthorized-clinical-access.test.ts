/**
 * Security — the unauthorized-user journey against clinical data, asserted
 * across BOTH enforcement layers a device actually hits: the Edge route gate
 * (what pages a session can open) and the sync write matrix (what documents a
 * role's offline writes are allowed to push). Each layer has its own unit
 * suite; this composite pins that the layers AGREE for the non-clinical roles
 * most likely to be handed a shared workstation.
 */
import { isPathAllowed } from '@/lib/role-routes';
import { DOC_WRITE_ROLES } from '@/lib/sync/write-permissions';
import type { UserRole } from '@/lib/db-types';

const CLINICAL_PAGES = ['/triage', '/consultation', '/notes', '/wards'];
const CLINICAL_DOC_TYPES = ['triage', 'clinical_note', 'prescription', 'medical_record'];
const NON_CLINICAL_ROLES: UserRole[] = ['cashier', 'medical_biller', 'data_entry_clerk', 'clinic_clerk'];

describe('non-clinical roles cannot reach or author clinical records', () => {
  test.each(NON_CLINICAL_ROLES)('%s is denied every clinical page route', (role) => {
    for (const page of CLINICAL_PAGES) {
      expect(isPathAllowed(role, page)).toBe(false);
    }
  });

  test.each(NON_CLINICAL_ROLES)('%s holds no clinical document write grants', (role) => {
    for (const docType of CLINICAL_DOC_TYPES) {
      const writers = DOC_WRITE_ROLES[docType] ?? [];
      expect(writers).not.toContain(role);
    }
  });

  test('the two layers agree: no role may author a clinical doc type whose module pages are all denied to it', () => {
    // A role that can write triage docs must hold a page where that write
    // actually happens — a write grant with no reachable surface is either
    // dead or a bypass. Three legitimate surfaces exist: the triage module,
    // the shared clinical workspace, and the front-desk station (check-in
    // authors the clerical `pending` placeholder from there).
    for (const role of DOC_WRITE_ROLES.triage ?? []) {
      const reachable = isPathAllowed(role, '/triage')
        || isPathAllowed(role, '/dashboard')
        || isPathAllowed(role, '/dashboard/front-desk');
      expect({ role, reachable }).toEqual({ role, reachable: true });
    }
  });
});
