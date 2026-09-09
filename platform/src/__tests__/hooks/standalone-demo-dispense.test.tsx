/**
 * `usePrescriptions.dispense()` on a standalone demo deployment
 * (NEXT_PUBLIC_DEMO_MODE=true, NEXT_PUBLIC_SYNC_ENABLED=false — see
 * `isStandaloneDemoDeployment` in `@/lib/sync/sync-config`).
 *
 * Before this fix, `dispense()` branched purely on `navigator.onLine`: online
 * meant `PATCH /api/prescriptions/:id`, and every prescription on this
 * deployment lives only in the browser's own PouchDB — nothing server-side
 * ever has it — so the request 404'd "Prescription not found" no matter how
 * healthy the network was. That's what made "Counsel & dispense" toast the
 * error and leave the modal open for pharma.rose.
 *
 * `dispense()` now also checks `isStandaloneDemoDeployment()` and takes the
 * local transaction whenever it's true, regardless of `navigator.onLine`.
 * This test forces `navigator.onLine = true` and asserts the local path ran
 * (and, symmetrically, that a real/non-demo deployment is untouched — online
 * still means the API call).
 */
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

const CURRENT_USER = {
  _id: 'user-pharma-rose', name: 'Rose Pharmacist', role: 'pharmacist' as const,
  hospitalId: 'hosp-001', hospitalName: 'Juba Teaching Hospital', orgId: 'org-moh-ss',
};
jest.mock('@/lib/context', () => ({ useAuth: () => ({ currentUser: CURRENT_USER }) }));

// The two branches under test. Each records whether it ran; `apiFetch`
// throwing loudly if the wrong branch reaches it is the point of this test.
const dispenseMedicationMock = jest.fn(async (..._args: unknown[]) => ({
  prescription: { _id: 'rx-1', _rev: '2-local' },
  allocations: [],
  quantityDispensed: 1,
  outcome: 'dispensed' as const,
}));
jest.mock('@/lib/services/dispensing-service', () => ({
  dispenseMedication: (...args: unknown[]) => dispenseMedicationMock(...args),
  recordUnfilled: jest.fn(),
}));

const apiFetchMock = jest.fn(async (..._args: unknown[]) => ({
  ok: true,
  status: 200,
  json: async () => ({
    prescription: { _id: 'rx-1', _rev: '2-server' },
    allocations: [],
    quantityDispensed: 1,
    outcome: 'dispensed',
  }),
}));
jest.mock('@/lib/api-fetch', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

import { teardownTestDBs } from '../helpers/test-db';
import { usePrescriptions } from '@/lib/hooks/usePrescriptions';
import type { DispenseInput } from '@/lib/services/dispensing-service';

const hook: { result: ReturnType<typeof usePrescriptions> | null } = { result: null };
function Harness() {
  const result = usePrescriptions();
  useEffect(() => { hook.result = result; });
  return null;
}

function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

const RX = { _id: 'rx-1', _rev: '1-x', type: 'prescription' } as unknown as DispenseInput['prescription'];

const ORIGINAL_ONLINE = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value });
}

const MANAGED_KEYS = ['NEXT_PUBLIC_DEMO_MODE', 'NEXT_PUBLIC_SYNC_ENABLED', 'NEXT_PUBLIC_COUCHDB_URL'] as const;
const ORIGINAL_ENV: Record<string, string | undefined> = Object.fromEntries(
  MANAGED_KEYS.map(k => [k, process.env[k]]),
);
function applyEnv(next: Partial<Record<typeof MANAGED_KEYS[number], string | undefined>>) {
  for (const key of MANAGED_KEYS) {
    const value = next[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  hook.result = null;
  dispenseMedicationMock.mockClear();
  apiFetchMock.mockClear();
});

afterEach(async () => {
  act(() => { root.unmount(); });
  container.remove();
  await teardownTestDBs();
  applyEnv(ORIGINAL_ENV);
  if (ORIGINAL_ONLINE) Object.defineProperty(window.navigator, 'onLine', ORIGINAL_ONLINE);
});

async function mountAndDispense() {
  act(() => { root.render(<Harness />); });
  await act(async () => { await flush(); });
  await act(async () => {
    await hook.result!.dispense({ prescription: RX, quantity: 1, dispenserId: CURRENT_USER._id, dispenserName: CURRENT_USER.name, facilityId: CURRENT_USER.hospitalId } as DispenseInput);
  });
}

it('on a standalone demo deployment, dispenses locally even while navigator.onLine is true', async () => {
  applyEnv({ NEXT_PUBLIC_DEMO_MODE: 'true', NEXT_PUBLIC_SYNC_ENABLED: 'false' });
  setOnline(true);

  await mountAndDispense();

  expect(dispenseMedicationMock).toHaveBeenCalledTimes(1);
  expect(apiFetchMock).not.toHaveBeenCalled();
});

it('on a real (non-demo) deployment, still dispenses through the API while online', async () => {
  applyEnv({ NEXT_PUBLIC_DEMO_MODE: 'false', NEXT_PUBLIC_SYNC_ENABLED: 'true', NEXT_PUBLIC_COUCHDB_URL: 'https://couch.example.org' });
  setOnline(true);

  await mountAndDispense();

  expect(apiFetchMock).toHaveBeenCalledTimes(1);
  expect(dispenseMedicationMock).not.toHaveBeenCalled();
});
