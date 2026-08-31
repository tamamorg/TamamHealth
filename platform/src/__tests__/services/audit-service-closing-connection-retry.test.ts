/**
 * @jest-environment node
 *
 * `logAudit` / `logPhiRead` must survive the same IndexedDB "connection is
 * closing" race documented in db-query-closing-connection-retry.test.ts.
 *
 * `logAudit` already treats a write failure as non-fatal (its own comment:
 * "Never let audit logging failures break the main flow"), so the closing
 * race never broke a login or a chart open — but it was a visible symptom of
 * the underlying db-lifecycle bug (a `[Audit] Failed to write audit log`
 * console error right after a fast re-login), and a lost audit row is a real
 * compliance gap even when the caller-facing flow is unaffected. The retry
 * quiets the false alarm and keeps the row.
 */

let putMock: jest.Mock;

jest.mock('@/lib/db', () => ({
  auditLogDB: () => ({ put: (...args: unknown[]) => putMock(...args) }),
  isClosingConnectionError: (err: unknown) =>
    err instanceof Error && err.name === 'InvalidStateError' && /connection is closing/i.test(err.message),
}));

import { logAudit, logPhiRead } from '@/lib/services/audit-service';

function closingError(): Error {
  const err = new Error(
    "Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing.",
  );
  err.name = 'InvalidStateError';
  return err;
}

describe('logAudit survives a closing-connection race', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('retries once against a fresh auditLogDB() and the row is written', async () => {
    let calls = 0;
    putMock = jest.fn(async () => {
      calls += 1;
      if (calls === 1) throw closingError();
    });

    await logAudit('login_success', 'u-1', 'amina', 'API login', true);

    expect(putMock).toHaveBeenCalledTimes(2);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('still never throws when the retry also fails', async () => {
    putMock = jest.fn(async () => { throw closingError(); });

    await expect(
      logAudit('login_success', 'u-1', 'amina', 'API login', true),
    ).resolves.toBeUndefined();

    expect(putMock).toHaveBeenCalledTimes(2);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('does not retry (and still swallows) an unrelated write failure', async () => {
    putMock = jest.fn(async () => { throw new Error('conflict'); });

    await expect(
      logAudit('login_success', 'u-1', 'amina', 'API login', true),
    ).resolves.toBeUndefined();

    expect(putMock).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

describe('logPhiRead survives the same race', () => {
  it('retries once against a fresh auditLogDB()', async () => {
    let calls = 0;
    putMock = jest.fn(async () => {
      calls += 1;
      if (calls === 1) throw closingError();
    });

    await logPhiRead({ userId: 'u-1', username: 'amina' }, 'patient', { patientId: 'pat-1' });

    expect(putMock).toHaveBeenCalledTimes(2);
  });
});
