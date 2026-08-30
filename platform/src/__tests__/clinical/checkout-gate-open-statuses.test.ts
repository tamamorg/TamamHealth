/**
 * `evaluateCheckoutGate`'s "all clinic visits closed" item used to hand-list
 * exactly 4 open statuses (`with_clinician`, `in_rooming`, `in_triage`,
 * `awaiting_labs`) and silently treated every other non-terminal status —
 * `awaiting_imaging`, `awaiting_pharmacy`, `awaiting_procedure`,
 * `consultation_paused_draft`, `ready_for_clinician`, `routed_to_clinic`, and
 * more — as "closed", which cleared a CRITICAL gate item for a patient who
 * was still mid-visit. The predicate is now derived from the journey
 * module's own terminal/closing vocabulary (KAN-100 audit item 3) instead of
 * a hand-list, so a new non-terminal status is covered automatically.
 */
jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

// Each case runs evaluateCheckoutGate's full 6-condition sweep (each with its
// own dynamic import + Mango index creation on a cold DB) 17 times over — the
// 5s default flakes on a loaded machine, same as the other multi-case
// encounter-journey suites.
jest.setTimeout(30000);

import { teardownTestDBs } from '../helpers/test-db';
import { evaluateCheckoutGate } from '@/lib/services/checkout-gate-service';
import type { EncounterDoc } from '@/lib/db-types';
import type { EncounterStatus } from '@/lib/clinical-flow/encounter-journey';

afterEach(async () => {
  await teardownTestDBs();
});

function encounterAt(status: EncounterStatus): EncounterDoc {
  return {
    _id: 'enc-test', type: 'clinical_encounter', patientId: 'pat-1', patientName: 'Test Patient',
    clinicianId: '', clinicianName: '', hospitalId: 'hosp-1', status,
    stageKey: 'clinical_consultation', snapshot: {}, labOrderIds: [],
    startedAt: new Date().toISOString(), createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as EncounterDoc;
}

async function isClosedSatisfied(status: EncounterStatus): Promise<boolean> {
  const gate = await evaluateCheckoutGate('pat-1', encounterAt(status));
  return gate.conditions.find(c => c.key === 'all_clinic_visits_closed')!.satisfied;
}

describe('checkout gate — all_clinic_visits_closed derivation', () => {
  const STILL_OPEN: EncounterStatus[] = [
    // Previously covered by the hand-list — pinned so the rewrite doesn't
    // silently drop them.
    'with_clinician', 'in_rooming', 'in_triage', 'awaiting_labs',
    // The six the audit found missing.
    'awaiting_imaging', 'awaiting_pharmacy', 'awaiting_procedure',
    'consultation_paused_draft', 'ready_for_clinician', 'routed_to_clinic',
  ];

  it.each(STILL_OPEN)('%s still blocks discharge — the visit is open', async (status) => {
    expect(await isClosedSatisfied(status)).toBe(false);
  });

  const CLOSED_BUT_NOT_TERMINAL: EncounterStatus[] = [
    // The two statuses that themselves close the clinic portion.
    'ready_for_clinic_checkout', 'referred_out',
    // Everything past them (Stage 9/10) was already closed at that earlier
    // hop — closedAt persists forward even though status keeps moving.
    'in_clinic_checkout', 'clinic_complete_awaiting_next_station',
    'awaiting_facility_checkout', 'in_facility_checkout',
  ];

  it.each(CLOSED_BUT_NOT_TERMINAL)('%s reads as closed — the clinic portion is already done', async (status) => {
    expect(await isClosedSatisfied(status)).toBe(true);
  });

  it('a terminal status reads as closed', async () => {
    expect(await isClosedSatisfied('discharged')).toBe(true);
  });

  it('no encounter at all blocks discharge (fail closed, not fail open)', async () => {
    const gate = await evaluateCheckoutGate('pat-1', undefined);
    expect(gate.conditions.find(c => c.key === 'all_clinic_visits_closed')!.satisfied).toBe(false);
  });
});
