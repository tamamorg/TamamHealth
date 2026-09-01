/**
 * Two fixes to the notification feed (KAN-100 audit):
 *
 *   - Item 6 (CRITICAL): the triage form saves a completed ETAT straight to
 *     `status: 'seen'` (TriageWorkflow.tsx), but the feed only ever matched
 *     `status === 'pending'` — the clerical check-in state. So a RED patient
 *     who had actually been assessed and was waiting for a doctor never
 *     alerted anyone. The filter now also accepts 'seen' triages that have
 *     not yet reached the clinician (`handoffStatus !== 'in_consultation'`).
 *
 *   - Item 5a: the consultation-progress source pushed every qualifying item
 *     with no `.slice(0, perSourceLimit)`, unlike every other source — a
 *     busy facility's full progress backlog bypassed the cap that keeps the
 *     badge, the bell panel and /notifications reporting the same total.
 */
import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

jest.setTimeout(30000);

const CURRENT_USER = {
  _id: 'user-nurse-1', name: 'Nurse Adut', role: 'nurse' as const,
  hospitalId: 'hosp-001', orgId: 'org-moh-ss', department: undefined,
};
jest.mock('@/lib/context', () => ({ useAuth: () => ({ currentUser: CURRENT_USER }) }));

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { triageDB, consultationProgressDB } from '@/lib/db';
import { useNotifications } from '@/modules/communication/hooks/useNotifications';

function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Poll until `check()` is true, one macrotask tick at a time. `useNotifications`
 * does its real work (7 sources, several behind their own dynamic import + a
 * cold Mango index the first time this process touches that db/field
 * combination) inside a `useEffect` — that chain needs many more than one or
 * two ticks to settle, unlike a directly-awaited call.
 */
async function settle(check: () => boolean, maxTicks = 150): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    if (check()) return;
    await act(async () => { await flush(); });
  }
}

// Reports the hook's value from an effect rather than assigning to an outer
// binding during render (react-hooks/globals, /immutability). Every read below
// happens after an `act()`, which flushes effects.
const hook: { state: ReturnType<typeof useNotifications> | null } = { state: null };
function Harness({ perSourceLimit }: { perSourceLimit?: number }) {
  const state = useNotifications({ perSourceLimit });
  useEffect(() => { hook.state = state; });
  return null;
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  hook.state = null;
});

/**
 * Prime every Mango index `useNotifications` touches, OUTSIDE of the hook's
 * own render. `load()` fetches ~8 sources and a sibling `useEffect` opens
 * live `.changes({since:'now'})` listeners on several of the SAME databases
 * in the same mount pass — building a Mango index for the first time while a
 * live-changes listener is concurrently attached to a brand-new in-memory
 * PouchDB is a race in this test harness (pouchdb-find + the memory adapter),
 * not a production code path (real CouchDB indices are built once, long
 * before any UI loads). Warming each index here, sequentially and outside any
 * component, means every render in the tests below only ever calls the
 * already-indexed `find()`.
 */
async function primeNotificationIndexes(): Promise<void> {
  const scope = { role: 'nurse' as const, orgId: 'org-moh-ss', hospitalId: 'hosp-001' };
  const [
    { getAllReferrals },
    { getAllTransfers },
    { getActiveAlerts },
    { getActiveTriage },
    { getAllLabResults },
    { getAllAppointments },
    { getAllConsultationProgress },
    { getAllPrescriptions },
  ] = await Promise.all([
    import('@/lib/services/referral-service'),
    import('@/lib/services/patient-transfer-service'),
    import('@/lib/services/surveillance-service'),
    import('@/lib/services/triage-service'),
    import('@/lib/services/lab-service'),
    import('@/lib/services/appointment-service'),
    import('@/lib/services/consultation-progress-service'),
    import('@/lib/services/prescription-service'),
  ]);
  await getAllReferrals(scope);
  await getAllTransfers(scope, CURRENT_USER._id);
  await getActiveAlerts(scope);
  await getActiveTriage(scope);
  await getAllLabResults(scope);
  await getAllAppointments(scope);
  await getAllConsultationProgress(scope);
  await getAllPrescriptions(scope);
}

beforeAll(async () => {
  await primeNotificationIndexes();
  await teardownTestDBs();
});

afterEach(async () => {
  act(() => { root.unmount(); });
  container.remove();
  await teardownTestDBs();
});

async function mountAndSettle(perSourceLimit?: number) {
  act(() => { root.render(<Harness perSourceLimit={perSourceLimit} />); });
  await settle(() => hook.state !== null && !hook.state.loading);
}

function baseTriage(id: string, overrides: Record<string, unknown> = {}) {
  return {
    _id: id, type: 'triage', patientId: `pat-${id}`, patientName: `Patient ${id}`,
    airway: 'clear', breathing: 'normal', circulation: 'normal', consciousness: 'alert',
    priority: 'RED', triagedBy: 'nurse-1', triagedByName: 'Nurse Adut',
    triagedAt: new Date().toISOString(), status: 'pending',
    orgId: 'org-moh-ss', facilityId: 'hosp-001',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('useNotifications — triage feed matches ACTIVE triages (item 6)', () => {
  it('alerts on a completed ETAT waiting for a provider (status: seen)', async () => {
    // This is exactly what the real triage form writes for a finished
    // assessment — see TriageWorkflow.tsx's `status: 'seen'` on submit.
    await putDoc(triageDB(), baseTriage('t-seen-waiting', {
      status: 'seen', handoffStatus: 'awaiting_provider',
    }) as never);

    await mountAndSettle();

    const ids = hook.state!.items.filter(i => i.type === 'triage').map(i => i.id);
    expect(ids).toContain('triage-t-seen-waiting');
  });

  it('still alerts on a clerical pending check-in', async () => {
    await putDoc(triageDB(), baseTriage('t-pending', { status: 'pending' }) as never);

    await mountAndSettle();

    const ids = hook.state!.items.filter(i => i.type === 'triage').map(i => i.id);
    expect(ids).toContain('triage-t-pending');
  });

  it('stops alerting once the patient is actually in consultation', async () => {
    await putDoc(triageDB(), baseTriage('t-in-consult', {
      status: 'seen', handoffStatus: 'in_consultation',
    }) as never);

    await mountAndSettle();

    const ids = hook.state!.items.filter(i => i.type === 'triage').map(i => i.id);
    expect(ids).not.toContain('triage-t-in-consult');
  });
});

describe('useNotifications — consultation-progress source respects perSourceLimit (item 5a)', () => {
  async function seedProgress(id: string, updatedAt: string) {
    await putDoc(consultationProgressDB(), {
      _id: id, type: 'consultation_progress', patientId: `pat-${id}`, patientName: `Patient ${id}`,
      hospitalId: 'hosp-001', orgId: 'org-moh-ss', currentStage: 'waiting_for_provider',
      priority: 'routine', milestones: [], tasks: [], events: [],
      createdAt: updatedAt, updatedAt,
    } as never);
  }

  it('with no cap, both qualifying progress trackers appear (sanity check)', async () => {
    await seedProgress('p-older', '2026-08-19T08:00:00.000Z');
    await seedProgress('p-newer', '2026-08-19T09:00:00.000Z');

    await mountAndSettle();

    expect(hook.state!.items.filter(i => i.type === 'progress')).toHaveLength(2);
  });

  it('caps the progress source at perSourceLimit instead of pushing every qualifying item', async () => {
    await seedProgress('p-older', '2026-08-19T08:00:00.000Z');
    await seedProgress('p-newer', '2026-08-19T09:00:00.000Z');

    await mountAndSettle(1);

    const capped = hook.state!.items.filter(i => i.type === 'progress');
    expect(capped).toHaveLength(1);
    // Newest-updated first (getAllConsultationProgress sorts by updatedAt desc).
    expect(capped[0].title).toContain('Patient p-newer');
  });
});
