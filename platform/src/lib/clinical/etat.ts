/**
 * ETAT (Emergency Triage Assessment and Treatment) priority calculator.
 *
 * Single implementation shared by the triage service (`triage-service.ts`,
 * server + browser via PouchDB), the nurse triage form
 * (`components/nurse/shared.tsx`, browser-only), and the `/api/triage` route
 * (server-only, no browser). Those three previously carried independent
 * copies. Two agreed: an incomplete ABCC assessment (any of the four
 * dimensions falsy — unset, not the 'not_assessed' sentinel, which is a real,
 * intentionally-recorded value for clerical check-ins) must return `''`
 * rather than a fabricated priority. The API route's copy did not, so a POST
 * with no ABCC at all silently scored as GREEN once the route defaulted the
 * missing dimensions to `'not_assessed'` for storage — a fabricated finding
 * no clinician made (KAN-100).
 *
 * Encodes the WHO ETAT decision tree: any life-threatening (RED) sign wins,
 * then any priority (YELLOW) sign, else GREEN.
 */
import type { TriagePriority } from '../db-types';

export interface EtatAssessment {
  airway?: string;
  breathing?: string;
  circulation?: string;
  consciousness?: string;
}

export function calculatePriority(data: EtatAssessment): TriagePriority | '' {
  if (!data.airway || !data.breathing || !data.circulation || !data.consciousness) return '';
  // RED — any life-threatening sign
  if (
    data.airway === 'obstructed' ||
    data.breathing === 'absent' ||
    data.circulation === 'absent' ||
    data.consciousness === 'unresponsive'
  ) return 'RED';
  // YELLOW — any priority sign
  if (
    data.breathing === 'distressed' ||
    data.circulation === 'impaired' ||
    data.consciousness === 'pain' ||
    data.consciousness === 'verbal'
  ) return 'YELLOW';
  return 'GREEN';
}
