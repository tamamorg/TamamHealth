/**
 * The front desk's "Needs close-out" list: open visits whose last movement
 * was before today. A triaged patient who quietly left keeps an open
 * encounter forever — this is the human review list that surfaces it (never
 * auto-expiry; a clinical record is closed by a person).
 */
import { staleOpenVisits } from '@/lib/front-desk-utils';
import type { EncounterDoc } from '@/lib/db-types';

const TODAY = '2026-09-02';

function enc(id: string, status: EncounterDoc['status'], movedAt: string): EncounterDoc {
  return {
    _id: id, type: 'clinical_encounter', patientId: `pat-${id}`, patientName: `Patient ${id}`,
    status,
    statusHistory: [{ from: null, to: status, at: movedAt, byUserId: 'u1' }],
    createdAt: movedAt, updatedAt: movedAt,
  } as unknown as EncounterDoc;
}

describe('staleOpenVisits', () => {
  it('surfaces open visits from a previous day, oldest first', () => {
    const rows = staleOpenVisits([
      enc('b', 'routed_to_clinic', '2026-09-01T10:00:00.000Z'),
      enc('a', 'awaiting_triage', '2026-08-27T08:00:00.000Z'),
    ], TODAY);
    expect(rows.map(r => r.encounter._id)).toEqual(['a', 'b']);
  });

  it('leaves out visits that moved today and visits already closed', () => {
    const rows = staleOpenVisits([
      enc('today', 'awaiting_triage', `${TODAY}T08:00:00.000Z`),
      enc('closed', 'lwbs', '2026-08-30T08:00:00.000Z'),
      enc('done', 'discharged', '2026-08-30T08:00:00.000Z'),
    ], TODAY);
    expect(rows).toHaveLength(0);
  });

  it('knows which stale visits can legally close as LWBS and which need a real checkout', () => {
    const rows = staleOpenVisits([
      enc('queueing', 'awaiting_triage', '2026-09-01T08:00:00.000Z'),
      enc('routed', 'routed_to_clinic', '2026-09-01T09:00:00.000Z'),
      enc('mid-consult', 'with_clinician', '2026-09-01T10:00:00.000Z'),
    ], TODAY);
    const byId = new Map(rows.map(r => [r.encounter._id, r.canCloseAsLwbs]));
    expect(byId.get('queueing')).toBe(true);
    expect(byId.get('routed')).toBe(true);
    expect(byId.get('mid-consult')).toBe(false); // no lwbs edge past the clinician
  });

  it('falls back to the document timestamps when a legacy encounter has no transition trail', () => {
    const legacy = { ...enc('legacy', 'awaiting_triage', '2026-08-30T08:00:00.000Z'), statusHistory: undefined } as unknown as EncounterDoc;
    const rows = staleOpenVisits([legacy], TODAY);
    expect(rows).toHaveLength(1);
    expect(rows[0].lastMovedAt).toBe('2026-08-30T08:00:00.000Z');
  });
});
