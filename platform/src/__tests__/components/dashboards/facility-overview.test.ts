/**
 * @jest-environment node
 *
 * `buildFacilityOverview` — the pure combiner behind the Facility Management
 * dashboard (components/dashboards/FacilityManagementDashboard.tsx).
 *
 * Every input is already resolved and already scope-filtered, so this suite
 * only exercises the assembling logic: metric values and their deep links, the
 * degraded /api/users path, and the three workforce panels folded in from the
 * People Overview page. `today` is passed in, so nothing here depends on the
 * wall clock. Mirrors the house pattern in components/doctor/worklist.test.ts.
 */

import {
  buildFacilityOverview,
  type FacilityOverviewInput,
} from '@/components/dashboards/FacilityManagementDashboard';
import type { UserDoc, PatientDoc, MessageDoc, StaffScheduleDoc } from '@/lib/db-types';
import type { LeaveRequestDoc } from '@/lib/db-types-hr';

const TODAY = '2026-08-13';

const user = (over: Partial<UserDoc> & { _id: string }): UserDoc => ({
  type: 'user', username: over._id, name: 'Staff Member', role: 'nurse',
  passwordHash: 'x', isActive: true, createdAt: '', updatedAt: '', ...over,
} as UserDoc);

const leaveReq = (over: Partial<LeaveRequestDoc> & { _id: string }): LeaveRequestDoc => ({
  type: 'leave_request', userId: 'u', userName: 'Staff Member', role: 'nurse',
  facilityId: 'hosp-001', facilityName: 'Juba Teaching Hospital',
  leaveType: 'annual', startDate: TODAY, endDate: TODAY, days: 1,
  status: 'pending', requestedAt: '2026-08-01T00:00:00.000Z',
  createdAt: '', updatedAt: '', ...over,
} as LeaveRequestDoc);

const shift = (over: Partial<StaffScheduleDoc> & { _id: string }): StaffScheduleDoc => ({
  type: 'staff_schedule', userId: 'u', userName: 'Staff Member', role: 'nurse',
  facilityId: 'hosp-001', facilityName: 'Juba Teaching Hospital',
  shiftType: 'morning', shiftDate: TODAY, startTime: '08:00', endTime: '16:00',
  isOnCall: false, status: 'scheduled', createdAt: '', updatedAt: '', ...over,
} as StaffScheduleDoc);

function input(over: Partial<FacilityOverviewInput> = {}): FacilityOverviewInput {
  return {
    today: TODAY,
    search: '',
    users: [],
    usersUnavailable: false,
    patients: [],
    enquiries: [],
    leave: [],
    schedules: [],
    staffingGaps: [],
    availableProviderIds: new Set<string>(),
    availableBeds: 0,
    billing: null,
    ...over,
  };
}

const metric = (out: ReturnType<typeof buildFacilityOverview>, key: string) =>
  out.metrics.find(m => m.key === key)!;

describe('metrics', () => {
  test('counts staff by role and links each metric to its pre-filtered page', () => {
    const out = buildFacilityOverview(input({
      users: [
        user({ _id: 'u1', role: 'doctor' }),
        user({ _id: 'u2', role: 'clinical_officer' }),
        user({ _id: 'u3', role: 'nurse' }),
        user({ _id: 'u4', role: 'midwife' }),
        user({ _id: 'u5', role: 'pharmacist', isActive: false }),
      ],
      availableProviderIds: new Set(['u1', 'u3']),
    }));

    expect(metric(out, 'staff-total').value).toBe(5);
    expect(metric(out, 'staff-active').value).toBe(4);      // u5 deactivated
    expect(metric(out, 'staff-available').value).toBe(2);
    expect(metric(out, 'doctors').value).toBe(2);           // doctor + clinical_officer
    expect(metric(out, 'nurses').value).toBe(2);            // nurse + midwife

    expect(metric(out, 'doctors').href).toBe('/hr?tab=roster&role=doctor');
    expect(metric(out, 'nurses').href).toBe('/hr?tab=roster&role=nurse');
    expect(metric(out, 'staff-active').href).toBe('/hr?tab=roster&status=active');
    expect(metric(out, 'staff-available').href).toBe('/hr?tab=roster&availability=available');
  });

  test('every metric carries a destination', () => {
    const out = buildFacilityOverview(input());
    for (const m of out.metrics) expect(m.href.startsWith('/')).toBe(true);
  });

  test("today's shifts link is dated, and unfilled sums the staffing gaps", () => {
    const out = buildFacilityOverview(input({
      schedules: [shift({ _id: 's1' }), shift({ _id: 's2', shiftType: 'night' })],
      staffingGaps: [
        { shift: 'morning', gap: 3, requiredStaff: 5, currentStaff: 2 },
        { shift: 'night', gap: 2, requiredStaff: 3, currentStaff: 1 },
      ],
    }));
    expect(metric(out, 'shifts-today').value).toBe(2);
    expect(metric(out, 'shifts-today').href).toBe(`/hr?tab=schedule&date=${TODAY}`);
    expect(metric(out, 'shifts-unfilled').value).toBe(5);
  });

  test('a failed users fetch reads as unknown, never as a real zero', () => {
    // A quiet 0 here would tell a manager the facility has no staff.
    const out = buildFacilityOverview(input({ users: [], usersUnavailable: true }));
    for (const key of ['staff-total', 'staff-active', 'staff-available', 'doctors', 'nurses']) {
      expect(metric(out, key).value).toBe('—');
      expect(metric(out, key).tone).toBe('warning');
    }
    // Non-staff metrics are unaffected.
    expect(metric(out, 'beds').value).toBe(0);
  });
});

describe("Today's Shifts panel", () => {
  test('breaks cover down by shift type and counts on-call separately', () => {
    const out = buildFacilityOverview(input({
      schedules: [
        shift({ _id: 's1', shiftType: 'morning' }),
        shift({ _id: 's2', shiftType: 'morning' }),
        shift({ _id: 's3', shiftType: 'afternoon' }),
        shift({ _id: 's4', shiftType: 'night' }),
        shift({ _id: 's5', shiftType: 'on_call', isOnCall: true }),
      ],
    }));
    const by = Object.fromEntries(out.shiftBreakdown.map(s => [s.key, s.count]));
    expect(by).toEqual({ morning: 2, afternoon: 1, night: 1, on_call: 1 });
  });

  test('an absent staff member is not cover', () => {
    const out = buildFacilityOverview(input({
      schedules: [
        shift({ _id: 's1', shiftType: 'morning' }),
        shift({ _id: 's2', shiftType: 'morning', status: 'absent' }),
      ],
    }));
    expect(out.shiftBreakdown.find(s => s.key === 'morning')!.count).toBe(1);
  });
});

describe('Upcoming Leave panel', () => {
  test('lists approved leave starting today or later, soonest first', () => {
    const out = buildFacilityOverview(input({
      leave: [
        leaveReq({ _id: 'l1', status: 'approved', startDate: '2026-09-01', userName: 'Later' }),
        leaveReq({ _id: 'l2', status: 'approved', startDate: '2026-08-20', userName: 'Sooner' }),
        leaveReq({ _id: 'l3', status: 'approved', startDate: '2026-08-01', userName: 'Past' }),
        leaveReq({ _id: 'l4', status: 'pending', startDate: '2026-08-25', userName: 'Undecided' }),
      ],
    }));
    expect(out.upcomingLeave.map(l => l.name)).toEqual(['Sooner', 'Later']);
    expect(out.upcomingLeaveCount).toBe(2);
  });

  test('leave starting today still counts as upcoming', () => {
    const out = buildFacilityOverview(input({
      leave: [leaveReq({ _id: 'l1', status: 'approved', startDate: TODAY })],
    }));
    expect(out.upcomingLeave).toHaveLength(1);
  });

  test('the list is capped at five but the count is not', () => {
    const out = buildFacilityOverview(input({
      leave: Array.from({ length: 8 }, (_, i) =>
        leaveReq({ _id: `l${i}`, status: 'approved', startDate: `2026-08-2${i}` })),
    }));
    expect(out.upcomingLeave).toHaveLength(5);
    expect(out.upcomingLeaveCount).toBe(8);
  });
});

describe('Roster by Role panel', () => {
  test('counts headcount per role, busiest first', () => {
    const out = buildFacilityOverview(input({
      users: [
        user({ _id: 'u1', role: 'nurse' }),
        user({ _id: 'u2', role: 'nurse' }),
        user({ _id: 'u3', role: 'nurse' }),
        user({ _id: 'u4', role: 'doctor' }),
      ],
    }));
    expect(out.roleCounts[0]).toMatchObject({ role: 'nurse', count: 3 });
    expect(out.roleCounts[1]).toMatchObject({ role: 'doctor', count: 1 });
  });

  test('no staff yields an empty list, so the panel can show its empty state', () => {
    expect(buildFacilityOverview(input()).roleCounts).toEqual([]);
  });
});

describe('pending leave queue', () => {
  test('only pending requests reach the queue', () => {
    const out = buildFacilityOverview(input({
      leave: [
        leaveReq({ _id: 'l1', status: 'pending', userName: 'Waiting' }),
        leaveReq({ _id: 'l2', status: 'approved', userName: 'Decided' }),
        leaveReq({ _id: 'l3', status: 'rejected', userName: 'Refused' }),
      ],
    }));
    expect(out.pendingLeaveRows.map(r => r.requesterName)).toEqual(['Waiting']);
    expect(metric(out, 'leave-pending').value).toBe(1);
  });

  test('search narrows the queue by requester, role, type or facility', () => {
    const leave = [
      leaveReq({ _id: 'l1', userName: 'Grace Achai', role: 'nurse' }),
      leaveReq({ _id: 'l2', userName: 'John Bol', role: 'pharmacist' }),
    ];
    expect(buildFacilityOverview(input({ leave, search: 'grace' })).pendingLeaveRows).toHaveLength(1);
    expect(buildFacilityOverview(input({ leave, search: 'pharmacist' })).pendingLeaveRows).toHaveLength(1);
    expect(buildFacilityOverview(input({ leave, search: 'zzz' })).pendingLeaveRows).toHaveLength(0);
  });
});

describe('cash flow', () => {
  test('total invoice is received plus outstanding', () => {
    const out = buildFacilityOverview(input({ billing: { totalRevenue: 25000, totalOutstanding: 148000 } }));
    expect(out.cashFlow).toEqual({ received: 25000, pending: 148000, totalInvoice: 173000 });
  });

  test('missing billing degrades to zeroes rather than NaN', () => {
    expect(buildFacilityOverview(input({ billing: null })).cashFlow)
      .toEqual({ received: 0, pending: 0, totalInvoice: 0 });
  });
});
