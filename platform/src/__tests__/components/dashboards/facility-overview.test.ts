/**
 * @jest-environment node
 *
 * `buildFacilityOverview` — the pure combiner behind the Facility Management
 * dashboard (components/dashboards/FacilityManagementDashboard.tsx).
 *
 * Every input is already resolved and already scope-filtered, so this suite
 * only exercises the assembling logic: metric values and their deep links, the
 * degraded /api/users path, and the queues. `today` is passed in, so nothing
 * here depends on the wall clock. Mirrors the house pattern in components/doctor/worklist.test.ts.
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
    usersHref: '/org-admin/users',
    availableBeds: 0,
    billing: null,
    ...over,
  };
}

const metric = (out: ReturnType<typeof buildFacilityOverview>, key: string) =>
  out.metrics.find(m => m.key === key)!;

describe('metrics', () => {
  test('counts staff by role and links each metric to a destination', () => {
    const out = buildFacilityOverview(input({
      users: [
        user({ _id: 'u1', role: 'doctor' }),
        user({ _id: 'u2', role: 'clinical_officer' }),
        user({ _id: 'u3', role: 'nurse' }),
        user({ _id: 'u4', role: 'midwife' }),
        user({ _id: 'u5', role: 'pharmacist', isActive: false }),
      ],
    }));

    expect(metric(out, 'staff-total').value).toBe(5);
    expect(metric(out, 'doctors').value).toBe(2);           // doctor + clinical_officer
    expect(metric(out, 'nurses').value).toBe(2);            // nurse + midwife

    // Staff figures all land on the one staff list this role has.
    expect(metric(out, 'doctors').href).toBe('/org-admin/users');
    expect(metric(out, 'nurses').href).toBe('/org-admin/users');
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
    expect(metric(out, 'shifts-today').href).toBe(`/hr/schedule?date=${TODAY}`);
    expect(metric(out, 'shifts-unfilled').value).toBe(5);
  });

  test('a failed users fetch reads as unknown, never as a real zero', () => {
    // A quiet 0 here would tell a manager the facility has no staff.
    const out = buildFacilityOverview(input({ users: [], usersUnavailable: true }));
    for (const key of ['staff-total', 'doctors', 'nurses']) {
      expect(metric(out, key).value).toBe('—');
      expect(metric(out, key).tone).toBe('warning');
    }
    // The queue-heading figure degrades the same way.
    expect(out.activeStaff.count).toBe('—');
    expect(out.activeStaff.unavailable).toBe(true);
    // Non-staff metrics are unaffected.
    expect(metric(out, 'beds').value).toBe(0);
  });
});

describe('active staff figure', () => {
  test('counts enabled accounts that are available today, and links to the staff list', () => {
    const out = buildFacilityOverview(input({
      users: [
        user({ _id: 'u1', role: 'doctor' }),
        user({ _id: 'u3', role: 'nurse' }),
        user({ _id: 'u5', role: 'pharmacist', isActive: false }),
      ],
      // u5 is marked available but deactivated — it must not be counted.
      availableProviderIds: new Set(['u1', 'u3', 'u5']),
    }));
    expect(out.activeStaff.count).toBe(2);
    expect(out.activeStaff.unavailable).toBe(false);
    expect(out.activeStaff.href).toBe('/org-admin/users');
    expect(out.activeStaff.rows.map(r => r.id)).toEqual(['u1', 'u3']);
  });

  test('the tab search narrows the rows by name, role or department', () => {
    const staff = [
      user({ _id: 'u1', role: 'doctor', name: 'Grace Achai' }),
      user({ _id: 'u2', role: 'pharmacist', name: 'John Bol' }),
    ];
    const withSearch = (search: string) => buildFacilityOverview(input({
      users: staff, availableProviderIds: new Set(['u1', 'u2']), search,
    })).activeStaff;
    expect(withSearch('grace').rows).toHaveLength(1);
    expect(withSearch('pharmacist').rows).toHaveLength(1);
    expect(withSearch('zzz').rows).toHaveLength(0);
    // The pill count is the roster figure, not the filtered list.
    expect(withSearch('zzz').count).toBe(2);
  });

  test('a shift on the day is shown against the row', () => {
    const out = buildFacilityOverview(input({
      users: [user({ _id: 'u1', role: 'nurse' })],
      availableProviderIds: new Set(['u1']),
      schedules: [shift({ _id: 's1', userId: 'u1', shiftType: 'morning' })],
    }));
    expect(out.activeStaff.rows[0].shift).toBe('Morning · 08:00–16:00');
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
