/**
 * `completeTriageHandoff` after a terminal triage status (KAN triage audit,
 * item 7).
 *
 * The bug: `completeTriageHandoff` unconditionally tried to move the triage
 * to 'seen'/'discharged'. `VALID_TRANSITIONS` (triage-service.ts) has no
 * outgoing transition from admitted/discharged/referred/lwbs, so a content
 * correction on an already-closed triage (fixing the destination clinic, a
 * handoff note, a mistyped disposition) threw "Invalid triage status
 * transition" outright — the correction was lost, and because the throw
 * happens inside `updateTriage` before this function's own encounter/
 * appointment walk ever runs, there was no partial state written to chase
 * down, just a hard failure for an edit that should have been ordinary.
 *
 * The fix: read the triage's current status first; when it is already
 * terminal, omit `status` from the update entirely (so `updateTriage` never
 * even consults the transition guard) and return immediately afterward,
 * skipping the encounter/appointment walk that already ran to completion for
 * this visit.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-term` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

const mockUpdateAppointmentStatus = jest.fn();
jest.mock('@/lib/services/appointment-service', () => ({
  updateAppointmentStatus: (...args: unknown[]) => mockUpdateAppointmentStatus(...args),
}));

const mockGetEncounter = jest.fn();
const mockFindOpenEncounterForPatient = jest.fn();
const mockAdvanceEncounterAfterTriage = jest.fn();
const mockEscalateEncounterToEmergency = jest.fn();
const mockTransitionEncounter = jest.fn();
jest.mock('@/lib/services/encounter-service', () => ({
  getEncounter: (...args: unknown[]) => mockGetEncounter(...args),
  findOpenEncounterForPatient: (...args: unknown[]) => mockFindOpenEncounterForPatient(...args),
  advanceEncounterAfterTriage: (...args: unknown[]) => mockAdvanceEncounterAfterTriage(...args),
  escalateEncounterToEmergency: (...args: unknown[]) => mockEscalateEncounterToEmergency(...args),
  transitionEncounter: (...args: unknown[]) => mockTransitionEncounter(...args),
}));

const mockSyncConsultationProgressStage = jest.fn();
jest.mock('@/lib/services/consultation-progress-service', () => ({
  syncConsultationProgressStage: (...args: unknown[]) => mockSyncConsultationProgressStage(...args),
}));

import { teardownTestDBs } from '../helpers/test-db';
import { createTriage, updateTriage } from '@/lib/services/triage-service';
import { completeTriageHandoff } from '@/lib/services/triage-handoff-service';

afterEach(async () => {
  await teardownTestDBs();
  uuidCounter = 0;
  jest.clearAllMocks();
});

function triageInput(overrides: Record<string, unknown> = {}) {
  return {
    patientId: 'patient-1',
    patientName: 'Test Patient',
    airway: 'clear',
    breathing: 'normal',
    circulation: 'normal',
    consciousness: 'alert',
    assessmentSource: 'clinician',
    priority: 'GREEN',
    triagedBy: 'nurse-1',
    triagedByName: 'Nurse Test',
    triagedAt: '2026-08-14T08:00:00.000Z',
    status: 'pending',
    ...overrides,
  } as unknown as Parameters<typeof createTriage>[0];
}

describe.each(['admitted', 'discharged', 'referred', 'lwbs'] as const)(
  'editing a triage already at a terminal status (%s)',
  (terminalStatus) => {
    test('the correction persists without re-opening the encounter/appointment flow', async () => {
      const created = await createTriage(triageInput());
      await updateTriage(created._id, { status: terminalStatus });

      const result = await completeTriageHandoff({
        triageId: created._id,
        patientId: created.patientId,
        patientName: created.patientName,
        disposition: 'general_clinic',
        destinationClinic: 'Corrected Clinic Name',
        handoffNote: 'Correction: routed to the right clinic after the fact.',
      });

      // The content correction was written...
      expect(result.destinationClinic).toBe('Corrected Clinic Name');
      expect(result.handoffNote).toContain('Correction');
      // ...and the status the record was already at is untouched — no
      // attempt to force it back to 'seen'/'discharged'.
      expect(result.status).toBe(terminalStatus);

      // The downstream walk that only makes sense for an ACTIVE handoff
      // never ran for an already-closed visit.
      expect(mockGetEncounter).not.toHaveBeenCalled();
      expect(mockFindOpenEncounterForPatient).not.toHaveBeenCalled();
      expect(mockUpdateAppointmentStatus).not.toHaveBeenCalled();
      expect(mockAdvanceEncounterAfterTriage).not.toHaveBeenCalled();
      expect(mockEscalateEncounterToEmergency).not.toHaveBeenCalled();
      expect(mockTransitionEncounter).not.toHaveBeenCalled();
      expect(mockSyncConsultationProgressStage).not.toHaveBeenCalled();
    });
  },
);

test('a fresh (pending) triage still runs the full handoff walk, unaffected by the terminal-status skip', async () => {
  const created = await createTriage(triageInput());

  const result = await completeTriageHandoff({
    triageId: created._id,
    patientId: created.patientId,
    patientName: created.patientName,
    disposition: 'general_clinic',
    destinationClinic: 'General Clinic',
  });

  expect(result.status).toBe('seen');
  // findOpenEncounterForPatient is the fallback lookup used when the triage
  // carries no `encounterId` — reaching it proves the normal walk still ran.
  expect(mockFindOpenEncounterForPatient).toHaveBeenCalled();
});

test('home_care disposition from pending still reaches "discharged", unaffected by the terminal-status skip', async () => {
  const created = await createTriage(triageInput());

  const result = await completeTriageHandoff({
    triageId: created._id,
    patientId: created.patientId,
    patientName: created.patientName,
    disposition: 'home_care',
  });

  expect(result.status).toBe('discharged');
});
