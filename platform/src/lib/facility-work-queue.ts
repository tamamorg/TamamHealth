/**
 * The facility work queue — inquiries, pending leave, and available staff, as
 * rows.
 *
 * Pure and React-free, so the two surfaces that show these rows share ONE
 * definition of them: the queue's own page (/facility-management/queue), which
 * lists every match, and `buildFacilityOverview` behind the Facility
 * Management dashboard's counts. The shaping used to live inside the dashboard
 * component; the queue moved out to its own page on 2026-08-24, and copying
 * three row mappers across would have left three places for "what a queue row
 * says" to drift apart.
 *
 * Everything here is already-scoped input — no fetching, no tenancy filtering.
 */

import {
  ENQUIRY_STATUS_LABELS, deriveEnquiryStatus, enquiryType, enquiryAssignee,
  type EnquiryStatus,
} from '@/lib/services/enquiry-service';
import { ROLE_LABEL } from '@/lib/role-display';
import { titleCase } from '@/lib/format-utils';
import type { MessageDoc, UserDoc, StaffScheduleDoc } from '@/lib/db-types';
import type { LeaveRequestDoc } from '@/lib/db-types-hr';
import type { ChipTone } from '@/components/admin/sadb-ui';

export interface FacilityInquiryRow {
  id: string;
  name: string;
  type: string;
  channel: string;
  date: string;
  time?: string;
  status: EnquiryStatus;
  statusLabel: string;
  assignee: string | null;
}

export interface FacilityLeaveRow {
  id: string;
  requesterName: string;
  leaveType: string;
  days: number;
  startDate: string;
  endDate: string;
  role: string;
  facility: string;
  reason?: string;
  requestedAt: string;
  status: LeaveRequestDoc['status'];
}

/** A row on the Active Staff queue — enabled accounts marked available today,
 *  shaped like the other two queues' rows. */
export interface FacilityStaffRow {
  id: string;
  name: string;
  role: string;
  department: string;
  /** e.g. "Morning · 08:00–16:00", or null when today carries no schedule row. */
  shift: string | null;
}

/** The dashboard's idle digest: the newest five. */
export const INQUIRY_DIGEST_LIMIT = 5;
/** Searching there widens the window rather than opening the whole archive. */
export const INQUIRY_SEARCH_LIMIT = 20;

/** Inquiry ladder → the kit's chip tones. */
export function enquiryChipTone(status: EnquiryStatus): ChipTone {
  switch (status) {
    case 'new': return 'yellow';
    case 'contacted': return 'blue';
    case 'appointment_scheduled': return 'green';
    case 'closed': return 'neutral';
    default: return 'neutral';
  }
}

function formatClockTimeOrUndefined(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Recent inquiries, newest first (callers pass them already sorted).
 *
 * `limit` is the digest cap: a number caps the list, `null` returns every
 * match. The dashboard shows a top-five digest that widens to twenty while
 * searching; the queue page is the queue, so it caps nothing. `matchCount` is
 * carried alongside so a caller can tell "5 of 5" from "5 of 40".
 */
export function buildInquiryRows(
  enquiries: MessageDoc[],
  search: string,
  limit: number | null,
): { rows: FacilityInquiryRow[]; matchCount: number } {
  const q = search.trim().toLowerCase();
  const matches = enquiries.filter(m => {
    if (!q) return true;
    return `${m.patientName || ''} ${enquiryType(m)} ${enquiryAssignee(m) || ''}`.toLowerCase().includes(q);
  });
  const rows = (limit === null ? matches : matches.slice(0, limit)).map(m => {
    const status = deriveEnquiryStatus(m);
    const at = m.sentAt || m.createdAt || '';
    return {
      id: m._id,
      name: m.patientName || 'Patient',
      type: enquiryType(m),
      channel: (m.channel || 'app').toUpperCase(),
      date: at.slice(0, 10),
      time: formatClockTimeOrUndefined(at),
      status,
      statusLabel: ENQUIRY_STATUS_LABELS[status],
      assignee: enquiryAssignee(m),
    };
  });
  return { rows, matchCount: matches.length };
}

/** Leave requests still waiting on a decision. No cap: a facility's
 *  pending-decision queue runs short by nature. */
export function buildPendingLeaveRows(leave: LeaveRequestDoc[], search: string): FacilityLeaveRow[] {
  const q = search.trim().toLowerCase();
  return leave
    .filter(r => r.status === 'pending')
    .filter(r => !q || `${r.userName || ''} ${r.role || ''} ${r.leaveType || ''} ${r.facilityName || ''}`.toLowerCase().includes(q))
    .map(r => ({
      id: r._id,
      requesterName: r.userName,
      leaveType: r.leaveType,
      days: r.days,
      startDate: r.startDate,
      endDate: r.endDate,
      role: r.role,
      facility: r.facilityName,
      reason: r.reason,
      requestedAt: r.requestedAt,
      status: r.status,
    }));
}

/**
 * Staff who are both enabled AND marked available right now.
 *
 * One staff-state figure, not two: "active" (an enabled account) barely moved
 * off Total Staff, so the useful number is the intersection.
 */
export function activeStaffOf(users: UserDoc[], availableProviderIds: Set<string>): UserDoc[] {
  return users.filter(u => u.isActive !== false && availableProviderIds.has(u._id));
}

/** Those accounts as rows, matched against the fields the row actually shows. */
export function buildStaffRows(
  activeStaff: UserDoc[],
  schedules: StaffScheduleDoc[],
  search: string,
): FacilityStaffRow[] {
  const q = search.trim().toLowerCase();
  return activeStaff
    .map(u => {
      const shift = schedules.find(s => s.userId === u._id);
      return {
        id: u._id,
        name: u.name,
        role: ROLE_LABEL[u.role] || u.role.replace(/_/g, ' '),
        department: u.department || u.hospitalName || 'General',
        shift: shift ? `${titleCase(shift.shiftType)} · ${shift.startTime}–${shift.endTime}` : null,
      };
    })
    .filter(r => !q || `${r.name} ${r.role} ${r.department}`.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));
}
