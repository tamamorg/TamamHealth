/** A visit parked at awaiting_procedure is held by a procedure of that visit that is not settled. */
const mockProcedures = jest.fn();
jest.mock('@/lib/services/procedure-service', () => ({
  getProceduresByPatient: (...a: unknown[]) => mockProcedures(...a),
  isProcedureSettled: (p: { status?: string }) => !p.status || ['released', 'aborted', 'ae_reported'].includes(p.status),
}));

import { hasOutstandingParkedWork } from '@/lib/clinical-notes/note-service';

describe('hasOutstandingParkedWork for a procedure', () => {
  beforeEach(() => mockProcedures.mockReset());

  test('an in-progress procedure of this visit holds it', async () => {
    mockProcedures.mockResolvedValue([{ encounterId: 'e1', status: 'in_procedure' }]);
    expect(await hasOutstandingParkedWork('awaiting_procedure', 'e1', 'p1')).toBe(true);
  });
  test('a settled one, one with no status, or another visit does not', async () => {
    mockProcedures.mockResolvedValue([{ encounterId: 'e1', status: 'released' }, { encounterId: 'e1' }, { encounterId: 'e2', status: 'in_procedure' }]);
    expect(await hasOutstandingParkedWork('awaiting_procedure', 'e1', 'p1')).toBe(false);
  });
  test('an unreadable list is treated as outstanding', async () => {
    mockProcedures.mockRejectedValue(new Error('db'));
    expect(await hasOutstandingParkedWork('awaiting_procedure', 'e1', 'p1')).toBe(true);
  });
});
