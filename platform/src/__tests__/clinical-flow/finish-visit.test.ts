/**
 * "Finish visit": moves a visit with the clinician (or parked on a loop whose
 * work is done) to clinic checkout, lists unsigned notes, and never skips the
 * checkout gates because it stops at `ready_for_clinic_checkout`.
 */
const mockGetEncounter = jest.fn();
const mockTransition = jest.fn(async (id: string, to: string) => ({ _id: id, status: to }));
jest.mock('@/lib/services/encounter-service', () => ({
  getEncounter: (...a: unknown[]) => mockGetEncounter(...a),
  transitionEncounter: (...a: unknown[]) => mockTransition(...(a as [string, string])),
}));
const mockOutstanding = jest.fn();
const mockNotes = jest.fn();
jest.mock('@/lib/clinical-notes/note-service', () => ({
  hasOutstandingParkedWork: (...a: unknown[]) => mockOutstanding(...a),
  getNotesByPatient: (...a: unknown[]) => mockNotes(...a),
  isNoteLocked: (n: { status: string }) => n.status === 'signed' || n.status === 'amended',
}));

import {
  canFinishVisit, finishVisit, unsignedNotesForVisit, FinishVisitError,
} from '@/lib/services/finish-visit-service';

const actor = { id: 'dr-1', role: 'doctor' as const };
beforeEach(() => { mockGetEncounter.mockReset(); mockTransition.mockClear(); mockOutstanding.mockReset(); mockNotes.mockReset(); });

describe('canFinishVisit', () => {
  it('is offered only while the patient is with the clinician or parked on a loop', () => {
    expect(canFinishVisit('with_clinician')).toBe(true);
    expect(canFinishVisit('awaiting_labs')).toBe(true);
    expect(canFinishVisit('in_triage')).toBe(false);
    expect(canFinishVisit('ready_for_clinic_checkout')).toBe(false);
    expect(canFinishVisit('discharged')).toBe(false);
    expect(canFinishVisit(undefined)).toBe(false);
  });
});

describe('finishVisit', () => {
  it('moves a visit with the clinician to clinic checkout, not past it', async () => {
    mockGetEncounter.mockResolvedValue({ _id: 'e1', patientId: 'p1', status: 'with_clinician' });
    await finishVisit('e1', actor);
    expect(mockTransition).toHaveBeenCalledTimes(1);
    expect(mockTransition).toHaveBeenCalledWith('e1', 'ready_for_clinic_checkout', { actorId: 'dr-1', actorRole: 'doctor' });
  });

  it('resumes a paused draft first, through the legal edge', async () => {
    mockGetEncounter.mockResolvedValue({ _id: 'e1', patientId: 'p1', status: 'consultation_paused_draft' });
    await finishVisit('e1', actor);
    expect(mockTransition.mock.calls.map(c => c[1])).toEqual(['with_clinician', 'ready_for_clinic_checkout']);
  });

  it('refuses while results or a prescription are still outstanding', async () => {
    mockGetEncounter.mockResolvedValue({ _id: 'e1', patientId: 'p1', status: 'awaiting_labs' });
    mockOutstanding.mockResolvedValue(true);
    await expect(finishVisit('e1', actor)).rejects.toThrow(FinishVisitError);
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it('refuses while a procedure is still outstanding, and finishes once it is settled', async () => {
    mockGetEncounter.mockResolvedValue({ _id: 'e1', patientId: 'p1', status: 'awaiting_procedure' });
    mockOutstanding.mockResolvedValue(true);
    await expect(finishVisit('e1', actor)).rejects.toThrow(/procedure is still in progress/);
    expect(mockOutstanding).toHaveBeenCalledWith('awaiting_procedure', 'e1', 'p1');
    expect(mockTransition).not.toHaveBeenCalled();
    mockOutstanding.mockResolvedValue(false);
    await finishVisit('e1', actor);
    expect(mockTransition).toHaveBeenCalledWith('e1', 'ready_for_clinic_checkout', expect.anything());
  });

  it('finishes a parked visit once its work is done', async () => {
    mockGetEncounter.mockResolvedValue({ _id: 'e1', patientId: 'p1', status: 'awaiting_pharmacy' });
    mockOutstanding.mockResolvedValue(false);
    await finishVisit('e1', actor);
    expect(mockTransition).toHaveBeenCalledWith('e1', 'ready_for_clinic_checkout', expect.anything());
  });

  it('refuses a visit that is not with a clinician', async () => {
    mockGetEncounter.mockResolvedValue({ _id: 'e1', patientId: 'p1', status: 'in_triage' });
    await expect(finishVisit('e1', actor)).rejects.toThrow(/not with a clinician/);
    expect(mockTransition).not.toHaveBeenCalled();
  });
});

describe('unsignedNotesForVisit', () => {
  it('lists unsigned notes of this visit, and of today when unlinked, never signed or other visits', async () => {
    mockNotes.mockResolvedValue([
      { _id: 'n1', noteType: 'soap', status: 'draft', encounterId: 'e1', serviceDate: '2026-11-01' },
      { _id: 'n2', noteType: 'soap', status: 'signed', encounterId: 'e1', serviceDate: '2026-11-08' },
      { _id: 'n3', noteType: 'soap', status: 'draft', encounterId: 'e-other', serviceDate: '2026-11-08' },
      { _id: 'n4', noteType: 'soap', status: 'draft', serviceDate: '2026-11-08' },
      { _id: 'n5', noteType: 'soap', status: 'draft', serviceDate: '2026-11-01' },
    ]);
    const rows = await unsignedNotesForVisit({ _id: 'e1', patientId: 'p1' }, { role: 'doctor', orgId: 'o' }, '2026-11-08');
    expect(rows.map(r => r.id)).toEqual(['n1', 'n4']);
  });
});
