/**
 * The controlled-substance register.
 *
 * Every movement of a Schedule I–V medication — intake, dispense, waste,
 * transfer — is a legal record an SSDFCA inspector can ask for. It had no
 * tests, which for a regulatory chain of custody is the one place a silent
 * regression is least acceptable: nobody notices a missing narcotics entry
 * until somebody is counting ampoules against a register that disagrees.
 *
 * The service enforces four things, and each is a control a real diversion
 * would have to defeat: two distinct signatories, a positive quantity, a
 * balance that cannot go negative, and an entry that is written once and never
 * amended. The last of those is enforced in CouchDB — `controlled_substance_log`
 * is in `APPEND_ONLY_TYPES`, so the validator refuses any update or delete —
 * and asserted here so the write path and the storage rule stay in agreement.
 */
const mockPut = jest.fn();
const mockFindByType = jest.fn();

jest.mock('@/lib/db', () => ({
  controlledSubstanceLogDB: () => ({ put: mockPut }),
}));
jest.mock('@/lib/services/db-query', () => ({
  findByType: (...a: unknown[]) => mockFindByType(...a),
}));
jest.mock('@/lib/services/audit-service', () => ({ logAuditSafe: jest.fn() }));
jest.mock('@/lib/services/sync-event-service', () => ({ emitSyncEvent: jest.fn() }));

import {
  recordMovement, ControlledSubstanceError,
} from '@/lib/services/controlled-substance-service';
import { APPEND_ONLY_TYPES } from '@/lib/sync/write-permissions';

const base = {
  inventoryId: 'inv-1',
  medicationName: 'Morphine 10mg/mL',
  schedule: 'II' as const,
  movement: 'dispense' as const,
  quantity: 2,
  unit: 'ampoule',
  beforeBalance: 10,
  operatorId: 'user-pharma', operatorName: 'Rose Gbudue',
  witnessId: 'user-nurse', witnessName: 'Stella Keji',
  facilityId: 'hosp-001', facilityName: 'Juba Teaching Hospital',
  orgId: 'org-moh-ss',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPut.mockResolvedValue({ rev: '1-abc' });
});

describe('two people, every time', () => {
  it('refuses a movement with no witness', async () => {
    await expect(recordMovement({ ...base, witnessId: '' }))
      .rejects.toMatchObject({ code: 'MISSING_WITNESS' });
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('refuses a movement with no operator', async () => {
    await expect(recordMovement({ ...base, operatorId: '' }))
      .rejects.toMatchObject({ code: 'MISSING_WITNESS' });
  });

  it('refuses to let one person witness themselves', async () => {
    // The single control that makes the countersignature mean anything.
    await expect(recordMovement({ ...base, witnessId: base.operatorId }))
      .rejects.toMatchObject({ code: 'SAME_SIGNATORY' });
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('throws a typed error the UI can branch on', async () => {
    await expect(recordMovement({ ...base, witnessId: base.operatorId }))
      .rejects.toBeInstanceOf(ControlledSubstanceError);
  });
});

describe('the arithmetic has to hold', () => {
  it('subtracts a dispense from the balance', async () => {
    const doc = await recordMovement(base);
    expect(doc.afterBalance).toBe(8);
  });

  it('adds an intake to the balance', async () => {
    const doc = await recordMovement({ ...base, movement: 'intake', quantity: 5 });
    expect(doc.afterBalance).toBe(15);
  });

  it('treats waste as leaving the cupboard', async () => {
    // Waste is still a controlled loss — it reduces stock like a dispense.
    const doc = await recordMovement({ ...base, movement: 'waste', quantity: 1 });
    expect(doc.afterBalance).toBe(9);
  });

  it('refuses a movement that would drive the balance negative', async () => {
    // A negative register means the count is already wrong; recording it
    // would launder a discrepancy into the legal record.
    await expect(recordMovement({ ...base, quantity: 11 }))
      .rejects.toMatchObject({ code: 'NEGATIVE_BALANCE' });
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('allows a movement that takes the balance exactly to zero', async () => {
    const doc = await recordMovement({ ...base, quantity: 10 });
    expect(doc.afterBalance).toBe(0);
  });

  it('refuses a zero or negative quantity', async () => {
    await expect(recordMovement({ ...base, quantity: 0 }))
      .rejects.toMatchObject({ code: 'BAD_INPUT' });
    await expect(recordMovement({ ...base, quantity: -3 }))
      .rejects.toMatchObject({ code: 'BAD_INPUT' });
  });
});

describe('what gets written', () => {
  it('records both signatories on the entry itself', async () => {
    // An inspector reads the document, not the audit log beside it.
    const doc = await recordMovement(base);
    expect(doc.operatorId).toBe('user-pharma');
    expect(doc.witnessId).toBe('user-nurse');
    expect(doc.witnessName).toBe('Stella Keji');
  });

  it('stamps the schedule and the facility', async () => {
    const doc = await recordMovement(base);
    expect(doc.schedule).toBe('II');
    expect(doc.facilityId).toBe('hosp-001');
    expect(doc.type).toBe('controlled_substance_log');
  });

  it('mints a fresh id per movement, never reusing one', async () => {
    const a = await recordMovement(base);
    const b = await recordMovement(base);
    expect(a._id).not.toBe(b._id);
    expect(a._id).toMatch(/^cslog-/);
  });
});

describe('the register is append-only', () => {
  it('is declared append-only, so CouchDB refuses to amend or delete an entry', () => {
    // The write path above only ever creates. This asserts the storage layer
    // agrees: without the declaration, a staff member could rewrite or
    // tombstone their own narcotics entry through their local replica.
    expect(APPEND_ONLY_TYPES).toContain('controlled_substance_log');
  });

  it('never sends a _rev, so the write can only ever create', async () => {
    // A read-modify-write would be the shape of an amendment; there is none.
    // Snapshot the argument AT CALL TIME: the service assigns `doc._rev` from
    // the response afterwards, and Jest holds a reference to that same object,
    // so inspecting it later shows a _rev the put never carried.
    let sentKeys: string[] = [];
    mockPut.mockImplementation(async (doc: Record<string, unknown>) => {
      sentKeys = Object.keys(doc);
      return { rev: '1-abc' };
    });

    await recordMovement(base);

    expect(mockPut).toHaveBeenCalledTimes(1);
    expect(sentKeys).not.toContain('_rev');
    expect(sentKeys).toContain('_id');
  });
});
