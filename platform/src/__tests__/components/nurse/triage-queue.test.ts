import {
  TERMINAL_TRIAGE_STATUSES,
  countActiveRedTriage,
  isActiveRedTriage,
  isTerminalTriageStatus,
  selectTriageQueueRows,
  sortTriageQueueRows,
} from '@/components/nurse/triage-queue';
import type { TriageDoc } from '@/lib/db-types';

type Priority = TriageDoc['priority'];
type Status = TriageDoc['status'];

interface RedRow {
  priority: Priority;
  status: Status;
  handoffStatus?: TriageDoc['handoffStatus'];
}

function redRow(overrides: Partial<RedRow> & Pick<RedRow, 'priority' | 'status'>): RedRow {
  return { handoffStatus: undefined, ...overrides };
}

interface QueueRow {
  status: Status;
  triagedAt: string;
  priority?: Priority;
}

function queueRow(overrides: Partial<QueueRow> & Pick<QueueRow, 'status'>): QueueRow {
  return { triagedAt: '2026-01-01T08:00:00.000Z', ...overrides };
}

interface SortRow {
  priority?: Priority;
  triagedAt: string;
}

function sortRow(overrides: SortRow): SortRow {
  return overrides;
}

describe('isTerminalTriageStatus / TERMINAL_TRIAGE_STATUSES', () => {
  it('treats admitted, discharged, referred and lwbs as terminal', () => {
    expect([...TERMINAL_TRIAGE_STATUSES].sort()).toEqual(['admitted', 'discharged', 'lwbs', 'referred']);
    for (const status of TERMINAL_TRIAGE_STATUSES) expect(isTerminalTriageStatus(status)).toBe(true);
  });

  it('treats pending and seen as non-terminal', () => {
    expect(isTerminalTriageStatus('pending')).toBe(false);
    expect(isTerminalTriageStatus('seen')).toBe(false);
  });
});

describe('isActiveRedTriage / countActiveRedTriage', () => {
  it('counts a pending RED triage as active', () => {
    expect(isActiveRedTriage(redRow({ priority: 'RED', status: 'pending' }))).toBe(true);
  });

  it('counts a seen RED triage as active unless it is already in consultation', () => {
    expect(isActiveRedTriage(redRow({ priority: 'RED', status: 'seen', handoffStatus: 'assigned' }))).toBe(true);
    expect(isActiveRedTriage(redRow({ priority: 'RED', status: 'seen' }))).toBe(true);
    expect(isActiveRedTriage(redRow({ priority: 'RED', status: 'seen', handoffStatus: 'in_consultation' }))).toBe(false);
  });

  it('never counts a non-RED triage, regardless of status', () => {
    expect(isActiveRedTriage(redRow({ priority: 'YELLOW', status: 'pending' }))).toBe(false);
    expect(isActiveRedTriage(redRow({ priority: 'GREEN', status: 'seen' }))).toBe(false);
  });

  it('does not count a RED triage once it reaches a terminal status', () => {
    expect(isActiveRedTriage(redRow({ priority: 'RED', status: 'admitted' }))).toBe(false);
    expect(isActiveRedTriage(redRow({ priority: 'RED', status: 'discharged' }))).toBe(false);
    expect(isActiveRedTriage(redRow({ priority: 'RED', status: 'referred' }))).toBe(false);
    expect(isActiveRedTriage(redRow({ priority: 'RED', status: 'lwbs' }))).toBe(false);
  });

  it('sums active RED triages across a list — the station header counter', () => {
    const rows = [
      redRow({ priority: 'RED', status: 'pending' }),
      redRow({ priority: 'RED', status: 'seen', handoffStatus: 'in_consultation' }), // not active
      redRow({ priority: 'RED', status: 'seen' }), // active
      redRow({ priority: 'YELLOW', status: 'pending' }),
      redRow({ priority: 'RED', status: 'discharged' }), // terminal, not active
    ];
    expect(countActiveRedTriage(rows)).toBe(2);
  });
});

describe('selectTriageQueueRows', () => {
  const todayIso = '2026-08-29';

  it('excludes terminal statuses from the default (non-completed) view', () => {
    const rows = [
      queueRow({ status: 'pending' }),
      queueRow({ status: 'seen' }),
      queueRow({ status: 'admitted', triagedAt: `${todayIso}T09:00:00.000Z` }),
      queueRow({ status: 'discharged', triagedAt: `${todayIso}T09:00:00.000Z` }),
    ];
    const result = selectTriageQueueRows(rows, { includeCompletedToday: false, todayIso });
    expect(result).toHaveLength(2);
    expect(result.every(r => r.status === 'pending' || r.status === 'seen')).toBe(true);
  });

  it('includes a terminal row only when it finished TODAY and the toggle is on', () => {
    const rows = [
      queueRow({ status: 'discharged', triagedAt: `${todayIso}T09:00:00.000Z` }),
      queueRow({ status: 'discharged', triagedAt: '2026-08-28T09:00:00.000Z' }), // yesterday
    ];
    const result = selectTriageQueueRows(rows, { includeCompletedToday: true, todayIso });
    expect(result).toHaveLength(1);
    expect(result[0].triagedAt).toBe(`${todayIso}T09:00:00.000Z`);
  });

  it('keeps active rows regardless of the toggle', () => {
    const rows = [queueRow({ status: 'pending' })];
    expect(selectTriageQueueRows(rows, { includeCompletedToday: false, todayIso })).toHaveLength(1);
    expect(selectTriageQueueRows(rows, { includeCompletedToday: true, todayIso })).toHaveLength(1);
  });
});

describe('sortTriageQueueRows', () => {
  it('sorts RED before YELLOW before GREEN before unrecognised', () => {
    const rows = [
      sortRow({ priority: 'GREEN', triagedAt: '2026-08-29T08:00:00.000Z' }),
      sortRow({ priority: undefined, triagedAt: '2026-08-29T08:00:00.000Z' }),
      sortRow({ priority: 'RED', triagedAt: '2026-08-29T08:00:00.000Z' }),
      sortRow({ priority: 'YELLOW', triagedAt: '2026-08-29T08:00:00.000Z' }),
    ];
    const sorted = sortTriageQueueRows(rows);
    expect(sorted.map(r => r.priority)).toEqual(['RED', 'YELLOW', 'GREEN', undefined]);
  });

  it('within the same acuity, sorts longest wait (earliest timestamp) first', () => {
    const rows = [
      sortRow({ priority: 'RED', triagedAt: '2026-08-29T09:00:00.000Z' }), // arrived later
      sortRow({ priority: 'RED', triagedAt: '2026-08-29T07:00:00.000Z' }), // arrived first — longest wait
      sortRow({ priority: 'RED', triagedAt: '2026-08-29T08:00:00.000Z' }),
    ];
    const sorted = sortTriageQueueRows(rows);
    expect(sorted.map(r => r.triagedAt)).toEqual([
      '2026-08-29T07:00:00.000Z',
      '2026-08-29T08:00:00.000Z',
      '2026-08-29T09:00:00.000Z',
    ]);
  });

  it('does not mutate the input array', () => {
    const rows = [
      sortRow({ priority: 'GREEN', triagedAt: '2026-08-29T08:00:00.000Z' }),
      sortRow({ priority: 'RED', triagedAt: '2026-08-29T08:00:00.000Z' }),
    ];
    const copy = [...rows];
    sortTriageQueueRows(rows);
    expect(rows).toEqual(copy);
  });
});
