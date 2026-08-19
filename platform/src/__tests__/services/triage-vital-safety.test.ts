let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-vitals` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs } from '../helpers/test-db';
import { createTriage } from '@/lib/services/triage-service';

afterEach(async () => {
  await teardownTestDBs();
  uuidCounter = 0;
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
    status: 'seen',
    ...overrides,
  } as unknown as Parameters<typeof createTriage>[0];
}

describe('triage persistence safety', () => {
  test('the service refuses impossible vitals even when the UI is bypassed', async () => {
    await expect(createTriage(triageInput({ pulse: 'abc' }))).rejects.toThrow('Pulse must be a number');
    await expect(createTriage(triageInput({ oxygenSaturation: '999' }))).rejects.toThrow('Oxygen saturation must be between');
  });

  test('saving below the recommendation is refused without a recorded reason', async () => {
    await expect(createTriage(triageInput({
      pulse: '160',
      vitalUrgencyRecommendation: 'RED',
      vitalUrgencyWarnings: [{ field: 'pulse', code: 'IITT_ADULT_PULSE_RED', urgency: 'RED', message: 'RED pulse' }],
      vitalUrgencyOverridden: true,
      vitalUrgencyOverrideReason: '   ',
    }))).rejects.toThrow('reason is required');
  });

  test('a reasoned override is persisted for the clinical record and audit trail', async () => {
    const saved = await createTriage(triageInput({
      pulse: '160',
      vitalUrgencyRecommendation: 'RED',
      vitalUrgencyWarnings: [{ field: 'pulse', code: 'IITT_ADULT_PULSE_RED', urgency: 'RED', message: 'RED pulse' }],
      vitalUrgencyOverridden: true,
      vitalUrgencyOverrideReason: 'Pulse repeated manually at 88 bpm after monitor artefact.',
    }));

    expect(saved.priority).toBe('GREEN');
    expect(saved.vitalUrgencyOverridden).toBe(true);
    expect(saved.vitalUrgencyOverrideReason).toContain('repeated manually');
  });
});
