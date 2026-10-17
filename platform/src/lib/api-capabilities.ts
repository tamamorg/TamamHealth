/**
 * Named API capabilities shared by several routes.
 *
 * Derived from the canonical sync groups so the route guard and the CouchDB
 * validator cannot drift: a test pins every role here as a member of the sync
 * group it corresponds to.
 */
import type { UserRole } from '@/lib/db-types';
import { VITAL_EVENTS } from '@/lib/sync/write-permissions';

/**
 * Who may read the vital-events registers (births, deaths, immunisations).
 * `/api/anc` reads a slightly wider set and keeps its own list.
 */
export const VITAL_EVENTS_READ_ROLES: readonly UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'clinician', 'nurse',
  'midwife', 'medical_superintendent', 'front_desk', 'hrio',
  'data_entry_clerk', 'government',
];

/**
 * Who may register a birth, death, immunisation or antenatal visit through the
 * API. Exactly the sync `VITAL_EVENTS` group (single source), so a role that
 * can replicate these documents can also create them over HTTP and vice versa.
 */
export const VITAL_EVENTS_REGISTER_ROLES: readonly UserRole[] = VITAL_EVENTS;
