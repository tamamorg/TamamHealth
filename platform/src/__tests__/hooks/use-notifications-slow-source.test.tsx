/**
 * One notification source that never settles must not hold the whole feed on
 * "Loading…". After the slow-source timeout the hook shows what the finished
 * sources produced and keeps the stuck pass running in the background.
 */
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());
jest.mock('@/lib/context', () => ({
  useAuth: () => ({ currentUser: { _id: 'user-desk-1', name: 'Desk', role: 'front_desk', hospitalId: 'hosp-001', orgId: 'org-moh-ss' } }),
}));
// The visit source reads encounters first; this read never resolves.
jest.mock('@/lib/services/encounter-service', () => ({
  ...jest.requireActual('@/lib/services/encounter-service'),
  getAllEncounters: () => new Promise(() => undefined),
}));

jest.setTimeout(40000);

import { teardownTestDBs } from '../helpers/test-db';
import { useNotifications } from '@/modules/communication/hooks/useNotifications';

const hook: { state: ReturnType<typeof useNotifications> | null } = { state: null };
function Harness() {
  const state = useNotifications();
  useEffect(() => { hook.state = state; });
  return null;
}

let root: Root;
afterEach(async () => {
  await act(async () => { root.unmount(); });
  await teardownTestDBs();
});

it('stops showing "Loading…" when one source hangs', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<Harness />); });
  const started = Date.now();
  while (hook.state?.loading !== false && Date.now() - started < 20000) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)); });
  }
  expect(hook.state?.loading).toBe(false);
  expect(Date.now() - started).toBeGreaterThanOrEqual(9000);
});
